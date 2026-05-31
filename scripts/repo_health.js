/**
 * Repo Health v3
 *
 * Aggregates Repo Discipline Layer checks into one JSON and text report.
 * This script is intentionally dependency-free and warning-friendly: it captures
 * checker results, writes reports, and always exits with code 0.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, "out", "repo_health");
const OUTPUT_JSON = path.join(OUTPUT_DIR, "report.json");
const OUTPUT_TXT = path.join(OUTPUT_DIR, "report.txt");

const CHECKS = [
  { key: "lint", command: ["npm", "run", "lint"] },
  { key: "contracts", command: ["npm", "run", "validate:contracts"] },
  { key: "schema", command: ["npm", "run", "validate:schema"] },
  { key: "deadcode", command: ["npm", "run", "validate:deadcode"] },
  { key: "boundaries", command: ["npm", "run", "validate:boundaries"] }
];

function toPosixPath(filePath) {
  return filePath.split(path.sep).join("/");
}

function nowIso() {
  return new Date().toISOString();
}

function ensureOutputDir() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function countMatches(text, pattern) {
  const matches = String(text || "").match(pattern);
  return matches ? matches.length : 0;
}

function extractCount(text, pattern) {
  const match = String(text || "").match(pattern);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function countWarnings(key, stdout, stderr) {
  const combined = [stdout, stderr].join("\n");
  const explicitCounts = {
    schema: extractCount(combined, /warnings:\s*(\d+)/i),
    deadcode: extractCount(combined, /potential dead files:\s*(\d+)/i),
    boundaries: extractCount(combined, /violations:\s*(\d+)/i)
  };

  if (Object.prototype.hasOwnProperty.call(explicitCounts, key) && explicitCounts[key] !== null) {
    return explicitCounts[key];
  }

  return countMatches(stdout, /\bWARN(?:ING)?\b|warning:/gi) +
    countMatches(stderr, /\bWARN(?:ING)?\b|warning:/gi);
}

function countErrors(stdout, stderr, exitCode) {
  const textErrors = countMatches(stdout, /\bERROR\b|error:/gi) +
    countMatches(stderr, /\bERROR\b|error:/gi);
  return exitCode === 0 ? textErrors : Math.max(1, textErrors);
}

function runCheck(check) {
  const startedAt = Date.now();
  const command = check.command[0];
  const args = check.command.slice(1);

  try {
    const result = spawnSync(command, args, {
      cwd: ROOT,
      encoding: "utf8",
      env: process.env,
      shell: false,
      maxBuffer: 20 * 1024 * 1024
    });

    const durationMs = Date.now() - startedAt;
    const stdout = result.stdout || "";
    const stderr = result.stderr || "";
    const exitCode = typeof result.status === "number"
      ? result.status
      : (result.error ? 1 : 0);

    return {
      key: check.key,
      command: check.command.join(" "),
      exit_code: exitCode,
      duration_ms: durationMs,
      stdout,
      stderr,
      warnings: countWarnings(check.key, stdout, stderr),
      errors: countErrors(stdout, stderr, exitCode),
      runner_error: result.error ? result.error.message : null
    };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    return {
      key: check.key,
      command: check.command.join(" "),
      exit_code: 1,
      duration_ms: durationMs,
      stdout: "",
      stderr: error && error.stack ? error.stack : String(error),
      warnings: 0,
      errors: 1,
      runner_error: error && error.message ? error.message : String(error)
    };
  }
}

function buildJsonReport(results) {
  const timestamp = nowIso();
  const summary = {};

  for (const result of results) {
    summary[result.key] = {
      command: result.command,
      exit_code: result.exit_code,
      duration_ms: result.duration_ms,
      warnings: result.warnings,
      errors: result.errors,
      stdout: result.stdout,
      stderr: result.stderr,
      runner_error: result.runner_error
    };
  }

  return {
    report_id: "repo_health_v3",
    timestamp,
    generated_at: timestamp,
    root: ROOT,
    output: {
      json: toPosixPath(path.relative(ROOT, OUTPUT_JSON)),
      text: toPosixPath(path.relative(ROOT, OUTPUT_TXT))
    },
    summary,
    note: "Exit code is always 0. Individual checker exit codes are captured in summary.*.exit_code."
  };
}

function buildTextReport(report) {
  const lines = [
    "=== Repo Health Report ===",
    "Timestamp: " + report.timestamp,
    "",
    "Root: " + report.root,
    "Exit policy: always 0; inspect per-check exit values below.",
    ""
  ];

  for (const check of CHECKS) {
    const result = report.summary[check.key];
    lines.push("[" + check.key + "]");
    lines.push("command: " + result.command);
    lines.push("exit: " + result.exit_code);
    lines.push("duration_ms: " + result.duration_ms);
    lines.push("warnings: " + result.warnings);
    lines.push("errors: " + result.errors);
    if (result.runner_error) lines.push("runner_error: " + result.runner_error);
    lines.push("");
  }

  lines.push("Report files:");
  lines.push("- " + report.output.json);
  lines.push("- " + report.output.text);
  lines.push("");

  return lines.join("\n");
}

function writeReports(report) {
  ensureOutputDir();
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(report, null, 2) + "\n");
  fs.writeFileSync(OUTPUT_TXT, buildTextReport(report) + "\n");
}

function main() {
  const results = [];

  for (const check of CHECKS) {
    console.log("Running " + check.command.join(" ") + " ...");
    const result = runCheck(check);
    results.push(result);
    console.log(
      " - " + check.key +
      ": exit=" + result.exit_code +
      ", warnings=" + result.warnings +
      ", errors=" + result.errors +
      ", duration_ms=" + result.duration_ms
    );
  }

  const report = buildJsonReport(results);
  writeReports(report);

  console.log("Repo health v3 report written to " + toPosixPath(path.relative(ROOT, OUTPUT_JSON)));
  console.log("Human report written to " + toPosixPath(path.relative(ROOT, OUTPUT_TXT)));
}

try {
  main();
} catch (error) {
  console.error("Repo health v3 failed unexpectedly.");
  console.error(error && error.stack ? error.stack : String(error));
  console.error("Exit code remains 0 by design.");
}

process.exitCode = 0;
