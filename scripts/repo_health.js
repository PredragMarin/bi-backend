"use strict";

/**
 * Repo Health v2
 *
 * Read-only repository snapshot and health report.
 * Writes reports to out/repo_health/report.json and out/repo_health/report.txt.
 *
 * Built-in Node modules only.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, "out", "repo_health");
const OUTPUT_JSON = path.join(OUTPUT_DIR, "report.json");
const OUTPUT_TXT = path.join(OUTPUT_DIR, "report.txt");

const SKIP_DIR_NAMES = new Set([".git", "node_modules", "out"]);
const CODE_EXTENSIONS = new Set([
  ".js",
  ".json",
  ".html",
  ".css",
  ".md",
  ".sql",
  ".sh",
  ".cmd",
  ".ps1"
]);

const LARGE_FILE_BYTES = 500 * 1024;
const MONOLITH_BYTES = 200 * 1024;
const DUPLICATE_MIN_BYTES = 1024;

function toPosixPath(filePath) {
  return filePath.split(path.sep).join("/");
}

function bytesToHuman(bytes) {
  if (!Number.isFinite(bytes)) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
}

function getDepth(relativePath) {
  if (!relativePath) return 0;
  return relativePath.split(path.sep).filter(Boolean).length;
}

function safeReadDir(dirPath) {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (error) {
    return [];
  }
}

function safeStat(filePath) {
  try {
    return fs.statSync(filePath);
  } catch (error) {
    return null;
  }
}

function countLines(filePath, size) {
  if (size > 5 * 1024 * 1024) return null;
  try {
    const text = fs.readFileSync(filePath, "utf8");
    if (!text) return 0;
    return text.split(/\r\n|\r|\n/).length;
  } catch (error) {
    return null;
  }
}

function hashFile(filePath) {
  try {
    const content = fs.readFileSync(filePath);
    return crypto.createHash("sha1").update(content).digest("hex");
  } catch (error) {
    return null;
  }
}

function createFolderStats() {
  return {
    file_count: 0,
    folder_count: 0,
    size_bytes: 0,
    code_file_count: 0,
    line_count: 0
  };
}

function ensureFolder(folderStats, relativeDir) {
  const key = relativeDir || ".";
  if (!folderStats.has(key)) folderStats.set(key, createFolderStats());
  return folderStats.get(key);
}

function addFileToFolderStats(folderStats, relativeFile, fileInfo) {
  const parts = relativeFile.split(path.sep);

  const rootStats = ensureFolder(folderStats, ".");
  rootStats.file_count += 1;
  rootStats.size_bytes += fileInfo.size_bytes;
  if (fileInfo.lines !== null) {
    rootStats.code_file_count += 1;
    rootStats.line_count += fileInfo.lines;
  }

  for (let index = 0; index < parts.length - 1; index += 1) {
    const folder = parts.slice(0, index + 1).join(path.sep);
    const stats = ensureFolder(folderStats, folder);
    stats.file_count += 1;
    stats.size_bytes += fileInfo.size_bytes;
    if (fileInfo.lines !== null) {
      stats.code_file_count += 1;
      stats.line_count += fileInfo.lines;
    }
  }
}

function isPocLog(relativePath) {
  const normalized = toPosixPath(relativePath).toLowerCase();
  return normalized.startsWith("_poc/") && (
    normalized.includes("/logs/") ||
    normalized.endsWith(".log") ||
    normalized.endsWith(".ndjson")
  );
}

function isTestOutput(relativePath) {
  const normalized = toPosixPath(relativePath).toLowerCase();
  return normalized.startsWith("tests/") && (
    normalized.includes("/output/") ||
    normalized.includes("/outputs/") ||
    normalized.includes("/tmp/") ||
    normalized.includes("/temp/")
  );
}

function scanRepo() {
  const files = [];
  const folders = [];
  const folderStats = new Map();
  const largeFiles = [];
  const monoliths = [];
  const pocLogs = [];
  const testOutputs = [];
  const skippedDirs = [];

  function walk(absDir, relativeDir) {
    const entries = safeReadDir(absDir);
    for (const entry of entries) {
      const absPath = path.join(absDir, entry.name);
      const relPath = relativeDir ? path.join(relativeDir, entry.name) : entry.name;

      if (entry.isDirectory()) {
        const folderInfo = {
          path: toPosixPath(relPath),
          depth: getDepth(relPath)
        };
        folders.push(folderInfo);

        const parentStats = ensureFolder(folderStats, relativeDir || ".");
        parentStats.folder_count += 1;

        if (SKIP_DIR_NAMES.has(entry.name)) {
          skippedDirs.push(folderInfo);
          continue;
        }

        ensureFolder(folderStats, relPath);
        walk(absPath, relPath);
        continue;
      }

      if (!entry.isFile()) continue;

      const stat = safeStat(absPath);
      if (!stat) continue;

      const ext = path.extname(entry.name).toLowerCase();
      const lines = CODE_EXTENSIONS.has(ext) ? countLines(absPath, stat.size) : null;
      const fileInfo = {
        path: toPosixPath(relPath),
        size_bytes: stat.size,
        size_human: bytesToHuman(stat.size),
        depth: getDepth(relPath),
        extension: ext || null,
        lines
      };

      files.push(fileInfo);
      addFileToFolderStats(folderStats, relPath, fileInfo);

      if (stat.size >= LARGE_FILE_BYTES) largeFiles.push(fileInfo);
      if (stat.size >= MONOLITH_BYTES && CODE_EXTENSIONS.has(ext)) monoliths.push(fileInfo);
      if (isPocLog(relPath)) pocLogs.push(fileInfo);
      if (isTestOutput(relPath)) testOutputs.push(fileInfo);
    }
  }

  ensureFolder(folderStats, ".");
  walk(ROOT, "");

  const foldersBySize = Array.from(folderStats.entries())
    .map(([folderPath, stats]) => ({
      path: toPosixPath(folderPath),
      ...stats,
      size_human: bytesToHuman(stats.size_bytes)
    }))
    .sort((left, right) => right.size_bytes - left.size_bytes);

  return {
    files,
    folders,
    foldersBySize,
    largeFiles: largeFiles.sort((left, right) => right.size_bytes - left.size_bytes),
    monoliths: monoliths.sort((left, right) => right.size_bytes - left.size_bytes),
    pocLogs: pocLogs.sort((left, right) => right.size_bytes - left.size_bytes),
    testOutputs: testOutputs.sort((left, right) => right.size_bytes - left.size_bytes),
    skippedDirs
  };
}

function detectDuplicates(files) {
  const bySize = new Map();
  for (const file of files) {
    if (file.size_bytes < DUPLICATE_MIN_BYTES) continue;
    const list = bySize.get(file.size_bytes) || [];
    list.push(file);
    bySize.set(file.size_bytes, list);
  }

  const duplicates = [];
  for (const sameSizeFiles of bySize.values()) {
    if (sameSizeFiles.length < 2) continue;

    const byHash = new Map();
    for (const file of sameSizeFiles) {
      const hash = hashFile(path.join(ROOT, file.path));
      if (!hash) continue;
      const list = byHash.get(hash) || [];
      list.push(file.path);
      byHash.set(hash, list);
    }

    for (const [hash, paths] of byHash.entries()) {
      if (paths.length < 2) continue;
      duplicates.push({
        hash,
        size_bytes: sameSizeFiles[0].size_bytes,
        size_human: bytesToHuman(sameSizeFiles[0].size_bytes),
        paths
      });
    }
  }

  return duplicates.sort((left, right) => right.size_bytes - left.size_bytes);
}

function readPackageJson() {
  const packagePath = path.join(ROOT, "package.json");
  try {
    const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
    return {
      name: pkg.name || null,
      version: pkg.version || null,
      type: pkg.type || null,
      scripts: pkg.scripts || {},
      dependencies: pkg.dependencies || {},
      devDependencies: pkg.devDependencies || {}
    };
  } catch (error) {
    return {
      error: error.message,
      scripts: {},
      dependencies: {},
      devDependencies: {}
    };
  }
}

function buildIssues(report) {
  const issues = [];
  const scripts = report.package.scripts || {};

  if (report.poc_logs.count > 0) {
    issues.push(`POC log files detected: ${report.poc_logs.count} files (${report.poc_logs.total_size_human}).`);
  }

  if (report.test_outputs.count > 0) {
    issues.push(`Test output files detected: ${report.test_outputs.count} files (${report.test_outputs.total_size_human}).`);
  }

  if (report.monoliths.count > 0) {
    issues.push(`Monolith files over ${bytesToHuman(MONOLITH_BYTES)} detected: ${report.monoliths.count}.`);
  }

  if (report.large_files.count > 0) {
    issues.push(`Large files over ${bytesToHuman(LARGE_FILE_BYTES)} detected: ${report.large_files.count}.`);
  }

  if (report.duplicates.count > 0) {
    issues.push(`Duplicate files detected: ${report.duplicates.count} duplicate groups.`);
  }

  if (!scripts.test || /no test specified/i.test(scripts.test)) {
    issues.push("package.json test script is missing or still a placeholder.");
  }

  if (!scripts.lint) issues.push("package.json has no lint script.");
  if (!scripts.build) issues.push("package.json has no build script.");
  if (!scripts["validate:contracts"]) issues.push("package.json has no validate:contracts script.");

  return issues;
}

function sumSize(items) {
  return items.reduce((total, item) => total + item.size_bytes, 0);
}

function buildReport() {
  const scan = scanRepo();
  const duplicates = detectDuplicates(scan.files);
  const packageInfo = readPackageJson();
  const totalSize = sumSize(scan.files);
  const totalLines = scan.files.reduce((total, file) => total + (file.lines || 0), 0);

  const report = {
    report_id: "repo_health_v2",
    generated_at: new Date().toISOString(),
    root: ROOT,
    scan_policy: {
      skipped_dirs_by_name: Array.from(SKIP_DIR_NAMES),
      note: "This script is read-only. It writes only its own report files under out/repo_health."
    },
    summary: {
      total_files: scan.files.length,
      total_folders: scan.folders.length,
      total_size_bytes: totalSize,
      total_size_human: bytesToHuman(totalSize),
      total_code_lines: totalLines,
      max_depth: Math.max(0, ...scan.files.map((file) => file.depth), ...scan.folders.map((folder) => folder.depth))
    },
    package: packageInfo,
    folders_by_size: scan.foldersBySize,
    files_by_size: scan.files.slice().sort((left, right) => right.size_bytes - left.size_bytes),
    large_files: {
      threshold_bytes: LARGE_FILE_BYTES,
      threshold_human: bytesToHuman(LARGE_FILE_BYTES),
      count: scan.largeFiles.length,
      total_size_bytes: sumSize(scan.largeFiles),
      total_size_human: bytesToHuman(sumSize(scan.largeFiles)),
      items: scan.largeFiles
    },
    monoliths: {
      threshold_bytes: MONOLITH_BYTES,
      threshold_human: bytesToHuman(MONOLITH_BYTES),
      count: scan.monoliths.length,
      total_size_bytes: sumSize(scan.monoliths),
      total_size_human: bytesToHuman(sumSize(scan.monoliths)),
      items: scan.monoliths
    },
    poc_logs: {
      count: scan.pocLogs.length,
      total_size_bytes: sumSize(scan.pocLogs),
      total_size_human: bytesToHuman(sumSize(scan.pocLogs)),
      items: scan.pocLogs
    },
    test_outputs: {
      count: scan.testOutputs.length,
      total_size_bytes: sumSize(scan.testOutputs),
      total_size_human: bytesToHuman(sumSize(scan.testOutputs)),
      items: scan.testOutputs
    },
    duplicates: {
      count: duplicates.length,
      items: duplicates
    },
    skipped_dirs: scan.skippedDirs,
    structure: {
      folders: scan.folders,
      files: scan.files
    }
  };

  report.potential_issues = buildIssues(report);
  report.recommendations = [
    "Keep generated runtime output outside source review and continue ignoring out/.",
    "Review POC logs and test outputs before deciding whether they should be archived or regenerated.",
    "Add npm scripts for repo:health and validate:contracts when ready.",
    "Keep monolith detection visible so large UI/runtime files can be split only when there is a safe module boundary.",
    "Use this report as a baseline before adding CI."
  ];

  return report;
}

function topItems(items, limit) {
  return items.slice(0, limit).map((item) => {
    if (item.paths) return `- ${item.size_human}: ${item.paths.join(" | ")}`;
    return `- ${item.size_human || bytesToHuman(item.size_bytes)}: ${item.path}`;
  });
}

function buildTextReport(report) {
  const scripts = Object.keys(report.package.scripts || {});
  const deps = Object.keys(report.package.dependencies || {});
  const devDeps = Object.keys(report.package.devDependencies || {});

  return [
    "=== Repo Health Report v2 ===",
    "",
    "1. Summary",
    `- Root: ${report.root}`,
    `- Total files: ${report.summary.total_files}`,
    `- Total folders: ${report.summary.total_folders}`,
    `- Total size: ${report.summary.total_size_human}`,
    `- Total code lines: ${report.summary.total_code_lines}`,
    `- Max depth: ${report.summary.max_depth}`,
    `- Skipped dirs: ${report.scan_policy.skipped_dirs_by_name.join(", ")}`,
    "",
    "2. Package",
    `- Name: ${report.package.name || "N/A"}`,
    `- Version: ${report.package.version || "N/A"}`,
    `- Type: ${report.package.type || "N/A"}`,
    `- Scripts (${scripts.length}): ${scripts.join(", ") || "none"}`,
    `- Dependencies (${deps.length}): ${deps.join(", ") || "none"}`,
    `- DevDependencies (${devDeps.length}): ${devDeps.join(", ") || "none"}`,
    "",
    "3. Largest Folders",
    ...topItems(report.folders_by_size.slice(0, 15), 15),
    "",
    "4. Largest Files",
    ...topItems(report.files_by_size.slice(0, 15), 15),
    "",
    "5. Large Files",
    `- Threshold: ${report.large_files.threshold_human}`,
    `- Count: ${report.large_files.count}`,
    `- Total size: ${report.large_files.total_size_human}`,
    ...topItems(report.large_files.items.slice(0, 15), 15),
    "",
    "6. Monoliths",
    `- Threshold: ${report.monoliths.threshold_human}`,
    `- Count: ${report.monoliths.count}`,
    ...topItems(report.monoliths.items.slice(0, 15), 15),
    "",
    "7. POC Logs",
    `- Count: ${report.poc_logs.count}`,
    `- Total size: ${report.poc_logs.total_size_human}`,
    ...topItems(report.poc_logs.items.slice(0, 15), 15),
    "",
    "8. Test Outputs",
    `- Count: ${report.test_outputs.count}`,
    `- Total size: ${report.test_outputs.total_size_human}`,
    ...topItems(report.test_outputs.items.slice(0, 15), 15),
    "",
    "9. Duplicate Files",
    `- Duplicate groups: ${report.duplicates.count}`,
    ...topItems(report.duplicates.items.slice(0, 15), 15),
    "",
    "10. Potential Issues",
    ...(report.potential_issues.length ? report.potential_issues.map((issue) => `- ${issue}`) : ["- None detected."]),
    "",
    "11. Recommendations",
    ...report.recommendations.map((item) => `- ${item}`),
    ""
  ].join("\n");
}

function writeReports(report) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(report, null, 2) + "\n");
  fs.writeFileSync(OUTPUT_TXT, buildTextReport(report) + "\n");
}

function main() {
  try {
    const report = buildReport();
    writeReports(report);
    console.log(`Repo health report written to ${toPosixPath(path.relative(ROOT, OUTPUT_JSON))}`);
    console.log(`Human report written to ${toPosixPath(path.relative(ROOT, OUTPUT_TXT))}`);
  } catch (error) {
    console.error("Repo health report failed.");
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  }
}

main();
