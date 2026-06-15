"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { ROOT, WATCH_AREAS, JSON_CONTRACT_FILES, DXF_PAYLOAD_SENTINEL } = require("./config");

function toPosix(filePath) {
  return String(filePath || "").split(path.sep).join("/");
}

function rel(filePath) {
  return toPosix(path.relative(ROOT, filePath));
}

function safeStat(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

function safeRead(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function exists(filePath) {
  return Boolean(safeStat(filePath));
}

function listFilesRecursive(targetPath, files = []) {
  const stat = safeStat(targetPath);
  if (!stat) return files;
  if (stat.isFile()) {
    files.push(targetPath);
    return files;
  }
  const entries = fs.readdirSync(targetPath, { withFileTypes: true });
  for (const entry of entries) {
    const abs = path.join(targetPath, entry.name);
    if (entry.isDirectory()) {
      listFilesRecursive(abs, files);
    } else if (entry.isFile()) {
      files.push(abs);
    }
  }
  return files;
}

function lineCount(text) {
  if (!text) return 0;
  return String(text).split(/\r?\n/).length;
}

function collectAreaStats(area) {
  const files = [];
  for (const relativePath of area.paths) {
    const abs = path.join(ROOT, relativePath);
    listFilesRecursive(abs, files);
  }
  const unique = Array.from(new Set(files)).sort();
  const details = unique.map((filePath) => {
    const content = safeRead(filePath);
    return {
      path: rel(filePath),
      lines: lineCount(content),
      bytes: content ? Buffer.byteLength(content, "utf8") : 0
    };
  });
  details.sort((left, right) => right.lines - left.lines || left.path.localeCompare(right.path));
  const totalLines = details.reduce((sum, item) => sum + item.lines, 0);
  const totalBytes = details.reduce((sum, item) => sum + item.bytes, 0);
  return {
    key: area.key,
    label: area.label,
    file_count: details.length,
    total_lines: totalLines,
    total_bytes: totalBytes,
    largest_files: details.slice(0, 10),
    large_files: details.filter((item) => item.lines >= area.large_file_threshold_lines),
    all_files: details
  };
}

function runNodeSyntaxCheck(jsFilePath) {
  const result = spawnSync(process.execPath, ["--check", jsFilePath], {
    cwd: ROOT,
    encoding: "utf8"
  });
  return {
    path: rel(jsFilePath),
    ok: result.status === 0,
    exit_code: typeof result.status === "number" ? result.status : 1,
    stderr: String(result.stderr || "").trim(),
    stdout: String(result.stdout || "").trim()
  };
}

function collectSyntaxChecks() {
  const files = [];
  for (const area of WATCH_AREAS) {
    for (const relativeRoot of area.js_roots) {
      listFilesRecursive(path.join(ROOT, relativeRoot), files);
    }
  }
  const jsFiles = Array.from(new Set(files))
    .filter((filePath) => filePath.endsWith(".js"))
    .sort();
  const results = jsFiles.map(runNodeSyntaxCheck);
  return {
    file_count: results.length,
    failed: results.filter((item) => !item.ok)
  };
}

function collectJsonChecks() {
  const results = JSON_CONTRACT_FILES.map((relativePath) => {
    const abs = path.join(ROOT, relativePath);
    const content = safeRead(abs);
    if (content === null) {
      return { path: relativePath, ok: false, error: "FILE_NOT_FOUND" };
    }
    try {
      JSON.parse(content);
      return { path: relativePath, ok: true, error: null };
    } catch (error) {
      return { path: relativePath, ok: false, error: error.message };
    }
  });
  return {
    file_count: results.length,
    failed: results.filter((item) => !item.ok)
  };
}

function collectPayloadKeyDrift() {
  const primaryContent = safeRead(path.join(ROOT, DXF_PAYLOAD_SENTINEL.primary_file)) || "";
  const evidence = DXF_PAYLOAD_SENTINEL.evidence_files.map((relativePath) => {
    const text = safeRead(path.join(ROOT, relativePath)) || "";
    return {
      path: relativePath,
      key_hits: DXF_PAYLOAD_SENTINEL.required_keys.filter((key) => text.includes(key))
    };
  });
  const missingInPrimary = DXF_PAYLOAD_SENTINEL.required_keys.filter((key) => !primaryContent.includes(key));
  const weakEvidence = evidence.filter((item) => item.key_hits.length === 0);
  return {
    required_keys: DXF_PAYLOAD_SENTINEL.required_keys,
    missing_in_primary: missingInPrimary,
    evidence,
    weak_evidence: weakEvidence
  };
}

function compareAreas(currentAreas, previousAreas) {
  const previousByKey = new Map((previousAreas || []).map((item) => [item.key, item]));
  return currentAreas.map((area) => {
    const prev = previousByKey.get(area.key);
    const deltaLines = prev ? area.total_lines - prev.total_lines : area.total_lines;
    const deltaFiles = prev ? area.file_count - prev.file_count : area.file_count;
    const growthPercent = prev && prev.total_lines > 0
      ? Number((((area.total_lines - prev.total_lines) / prev.total_lines) * 100).toFixed(2))
      : null;
    return {
      key: area.key,
      label: area.label,
      current_lines: area.total_lines,
      previous_lines: prev ? prev.total_lines : null,
      delta_lines: deltaLines,
      delta_files: deltaFiles,
      growth_percent: growthPercent
    };
  });
}

function buildFindings({ areaStats, syntaxChecks, jsonChecks, payloadKeyDrift, trend }) {
  const findings = [];

  for (const failure of syntaxChecks.failed) {
    findings.push({
      severity: "CRITICAL",
      code: "SYNTAX_CHECK_FAILED",
      message: `Syntax check failed: ${failure.path}`,
      details: failure.stderr || failure.stdout || null
    });
  }

  for (const failure of jsonChecks.failed) {
    findings.push({
      severity: "HIGH",
      code: "JSON_CONTRACT_INVALID",
      message: `JSON contract invalid: ${failure.path}`,
      details: failure.error
    });
  }

  if (payloadKeyDrift.missing_in_primary.length) {
    findings.push({
      severity: "CRITICAL",
      code: "DXF_PAYLOAD_KEY_MISSING",
      message: `Primary DXF payload parser is missing canonical keys: ${payloadKeyDrift.missing_in_primary.join(", ")}`,
      details: DXF_PAYLOAD_SENTINEL.primary_file
    });
  }

  for (const weak of payloadKeyDrift.weak_evidence) {
    findings.push({
      severity: "MEDIUM",
      code: "DXF_PAYLOAD_DRIFT_WEAK_EVIDENCE",
      message: `DXF payload evidence file has no canonical key hits: ${weak.path}`,
      details: DXF_PAYLOAD_SENTINEL.required_keys.join(", ")
    });
  }

  for (const area of areaStats) {
    const areaConfig = WATCH_AREAS.find((item) => item.key === area.key);
    for (const file of area.large_files) {
      findings.push({
        severity: file.lines >= areaConfig.large_file_threshold_lines * 1.5 ? "HIGH" : "MEDIUM",
        code: "MODULE_LARGE_FILE",
        message: `${area.label} contains a dense file: ${file.path} (${file.lines} lines)`,
        details: `threshold=${areaConfig.large_file_threshold_lines}`
      });
    }
  }

  for (const item of trend) {
    const areaConfig = WATCH_AREAS.find((entry) => entry.key === item.key);
    if (!areaConfig || item.growth_percent === null) continue;
    if (item.growth_percent >= areaConfig.severe_growth_percent) {
      findings.push({
        severity: "HIGH",
        code: "MODULE_VOLUME_DRIFT_HIGH",
        message: `${item.label} grew by ${item.growth_percent}% since previous run`,
        details: `lines ${item.previous_lines} -> ${item.current_lines}`
      });
    } else if (item.growth_percent >= areaConfig.moderate_growth_percent) {
      findings.push({
        severity: "MEDIUM",
        code: "MODULE_VOLUME_DRIFT_MEDIUM",
        message: `${item.label} grew by ${item.growth_percent}% since previous run`,
        details: `lines ${item.previous_lines} -> ${item.current_lines}`
      });
    }
  }

  if (!findings.length) {
    findings.push({
      severity: "INFO",
      code: "NO_MAJOR_RISK",
      message: "No critical drift detected in watched DXF/Core/GRM areas.",
      details: null
    });
  }

  return findings;
}

function collectCurrentSnapshot(previousSnapshot = null) {
  const areaStats = WATCH_AREAS.map(collectAreaStats);
  const syntaxChecks = collectSyntaxChecks();
  const jsonChecks = collectJsonChecks();
  const payloadKeyDrift = collectPayloadKeyDrift();
  const trend = compareAreas(areaStats, previousSnapshot ? previousSnapshot.area_stats : []);
  const findings = buildFindings({ areaStats, syntaxChecks, jsonChecks, payloadKeyDrift, trend });
  return {
    generated_at: new Date().toISOString(),
    area_stats: areaStats,
    syntax_checks: syntaxChecks,
    json_checks: jsonChecks,
    payload_key_drift: payloadKeyDrift,
    trend,
    findings
  };
}

module.exports = {
  collectCurrentSnapshot,
  rel,
  toPosix,
  exists,
  safeRead
};
