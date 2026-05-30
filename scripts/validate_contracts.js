"use strict";

/**
 * Minimal JSON contract validation.
 *
 * Validates JSON files in known contract/migration contract locations. This is
 * intentionally lightweight: parseability and non-empty content only.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const TARGETS = [
  { base: "src/modules", contractsOnly: true },
  { base: "src/core/contracts", contractsOnly: false },
  { base: "src/core_shell/migrations", contractsOnly: false }
];

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

function validateJsonFile(filePath) {
  const relative = toPosix(path.relative(ROOT, filePath));
  let raw;

  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    console.log("Validating " + relative + " ... ERROR");
    console.error("  Cannot read file: " + error.message);
    return false;
  }

  if (!raw.trim()) {
    console.log("Validating " + relative + " ... ERROR");
    console.error("  File is empty.");
    return false;
  }

  try {
    JSON.parse(raw);
    console.log("Validating " + relative + " ... OK");
    return true;
  } catch (error) {
    console.log("Validating " + relative + " ... ERROR");
    console.error("  Invalid JSON: " + error.message);
    return false;
  }
}

function main() {
  const files = collectTargets();

  if (!files.length) {
    console.log("No contract JSON files found for validation.");
    return 0;
  }

  let ok = true;
  for (const file of files) {
    if (!validateJsonFile(file)) ok = false;
  }

  return ok ? 0 : 1;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
}
