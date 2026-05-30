/**
 * Minimal JSON schema discipline validator.
 *
 * This is intentionally not a full JSON Schema validator and does not use
 * third-party dependencies. It checks repository contract JSON files for basic
 * parseability and a minimal shape hint. Findings are warnings only.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const TARGETS = [
  { base: "src/modules", contractsOnly: true },
  { base: "src/core/contracts", contractsOnly: false },
  { base: "src/core_shell/migrations", contractsOnly: false }
];
const SHAPE_KEYS = ["meta", "fields", "rules", "schema"];

function toPosix(filePath) {
  return filePath.split(path.sep).join("/");
}

function safeReadDir(dirPath) {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (error) {
    return [];
  }
}

function collectJsonFiles(dirPath, files) {
  for (const entry of safeReadDir(dirPath)) {
    const absPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      collectJsonFiles(absPath, files);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".json")) {
      files.push(absPath);
    }
  }
}

function isModuleContractFile(filePath) {
  const relative = toPosix(path.relative(ROOT, filePath));
  return /^src\/modules\/[^/]+\/contracts\/[^/]+\.json$/.test(relative);
}

function collectTargets() {
  const files = [];

  for (const target of TARGETS) {
    const absBase = path.join(ROOT, target.base);
    if (!fs.existsSync(absBase)) continue;

    const found = [];
    collectJsonFiles(absBase, found);

    for (const file of found) {
      if (target.contractsOnly && !isModuleContractFile(file)) continue;
      files.push(file);
    }
  }

  return Array.from(new Set(files)).sort((left, right) => left.localeCompare(right));
}

function validateFile(filePath) {
  const relative = toPosix(path.relative(ROOT, filePath));
  const warnings = [];
  let parsed = null;
  let raw = "";

  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    warnings.push("cannot read file: " + error.message);
    return warnings;
  }

  if (!raw.trim()) {
    warnings.push("file is empty");
    return warnings;
  }

  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    warnings.push("invalid JSON: " + error.message);
    return warnings;
  }

  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    warnings.push("top-level JSON value is not an object");
    return warnings;
  }

  const hasShapeKey = SHAPE_KEYS.some((key) => Object.prototype.hasOwnProperty.call(parsed, key));
  if (!hasShapeKey) {
    warnings.push("missing shape key: expected at least one of " + SHAPE_KEYS.join(", "));
  }

  if (!warnings.length) {
    console.log("Schema discipline " + relative + " ... OK");
  } else {
    console.log("Schema discipline " + relative + " ... WARN");
    for (const warning of warnings) {
      console.log("  - " + warning);
    }
  }

  return warnings;
}

function main() {
  const files = collectTargets();
  let warningCount = 0;

  if (!files.length) {
    console.log("No JSON contract files found for schema discipline validation.");
    return;
  }

  for (const file of files) {
    warningCount += validateFile(file).length;
  }

  console.log("");
  console.log("Schema discipline summary");
  console.log("- files checked: " + files.length);
  console.log("- warnings: " + warningCount);
  console.log("- exit code: 0 (warnings only)");
}

try {
  main();
} catch (error) {
  console.error("Schema discipline validator failed unexpectedly.");
  console.error(error && error.stack ? error.stack : String(error));
  console.error("Exit code remains 0 by design.");
}

process.exitCode = 0;
