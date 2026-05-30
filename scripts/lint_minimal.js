"use strict";

/**
 * Minimal syntax lint for JavaScript files.
 *
 * This is intentionally not ESLint. It only runs Node's built-in syntax checker
 * over .js files in src/ and scripts/ so the repository has a dependency-free
 * first safety gate.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const SCAN_DIRS = ["src", "scripts"];

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

function collectJsFiles(dirPath, files) {
  for (const entry of safeReadDir(dirPath)) {
    const absPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      collectJsFiles(absPath, files);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(absPath);
    }
  }
}

function checkFile(filePath) {
  const relative = toPosix(path.relative(ROOT, filePath));
  const result = spawnSync(process.execPath, ["--check", filePath], {
    cwd: ROOT,
    encoding: "utf8"
  });

  if (result.status === 0) {
    console.log("Linting " + relative + " ... OK");
    return true;
  }

  console.log("Linting " + relative + " ... ERROR");
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return false;
}

function main() {
  const files = [];
  for (const dir of SCAN_DIRS) {
    const absDir = path.join(ROOT, dir);
    if (fs.existsSync(absDir)) collectJsFiles(absDir, files);
  }

  files.sort((left, right) => left.localeCompare(right));

  if (!files.length) {
    console.log("No JavaScript files found in src/ or scripts/.");
    return 0;
  }

  let ok = true;
  for (const file of files) {
    if (!checkFile(file)) ok = false;
  }

  return ok ? 0 : 1;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
}
