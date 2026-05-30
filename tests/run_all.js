"use strict";

/**
 * Minimal test runner.
 *
 * Discovers files under tests/ that end in _test.js and executes each as a
 * separate Node process. No test framework dependency is required.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const TEST_ROOT = path.join(ROOT, "tests");
const SKIP_DIRS = new Set(["output", "outputs", "fixtures", "node_modules"]);

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

function collectTests(dirPath, tests) {
  for (const entry of safeReadDir(dirPath)) {
    const absPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      collectTests(absPath, tests);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith("_test.js")) {
      tests.push(absPath);
    }
  }
}

function runTest(filePath) {
  const relative = toPosix(path.relative(ROOT, filePath));
  process.stdout.write("Running " + relative + " ... ");

  const result = spawnSync(process.execPath, [filePath], {
    cwd: ROOT,
    stdio: "pipe",
    encoding: "utf8",
    env: process.env
  });

  if (result.status === 0) {
    process.stdout.write("OK\n");
    if (result.stdout) process.stdout.write(result.stdout);
    return true;
  }

  process.stdout.write("ERROR\n");
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) console.error(result.error.message);
  return false;
}

function main() {
  const tests = [];
  if (fs.existsSync(TEST_ROOT)) collectTests(TEST_ROOT, tests);
  tests.sort((left, right) => left.localeCompare(right));

  if (!tests.length) {
    console.warn("Warning: no *_test.js files found under tests/. Nothing to run.");
    return 0;
  }

  let ok = true;
  for (const testFile of tests) {
    if (!runTest(testFile)) ok = false;
  }

  return ok ? 0 : 1;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
}
