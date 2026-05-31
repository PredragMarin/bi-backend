/**
 * Minimal module-boundary checker.
 *
 * Dependency-free, warning-only repository discipline tool. It scans JavaScript
 * files in src/ and scripts/, resolves relative require/import specifiers, and
 * reports architecture boundary violations. Exit code is always 0.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SCAN_DIRS = ["src", "scripts"];
const REQUIRE_RE = /require\s*\(\s*["']([^"']+)["']\s*\)/g;
const IMPORT_FROM_RE = /import\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g;

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

function safeReadFile(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (error) {
    return "";
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

function collectAllJsFiles() {
  const files = [];
  for (const dir of SCAN_DIRS) {
    const absDir = path.join(ROOT, dir);
    if (fs.existsSync(absDir)) collectJsFiles(absDir, files);
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function isRelativeSpecifier(specifier) {
  return specifier.startsWith("./") || specifier.startsWith("../");
}

function extractSpecifiers(source) {
  const specifiers = [];
  let match;

  REQUIRE_RE.lastIndex = 0;
  while ((match = REQUIRE_RE.exec(source)) !== null) {
    specifiers.push(match[1]);
  }

  IMPORT_FROM_RE.lastIndex = 0;
  while ((match = IMPORT_FROM_RE.exec(source)) !== null) {
    specifiers.push(match[1]);
  }

  return specifiers;
}

function candidatePaths(basePath) {
  return [
    basePath,
    basePath + ".js",
    path.join(basePath, "index.js")
  ];
}

function resolveSpecifier(fromFile, specifier, fileSet) {
  if (!isRelativeSpecifier(specifier)) return null;

  const base = path.resolve(path.dirname(fromFile), specifier);
  for (const candidate of candidatePaths(base)) {
    if (fileSet.has(candidate)) return candidate;
  }

  return null;
}

function moduleName(relativePath) {
  const parts = relativePath.split("/");
  if (parts[0] === "src" && parts[1] === "modules" && parts[2]) return parts[2];
  return null;
}

function isModuleEntrypoint(relativePath) {
  return /^src\/modules\/[^/]+\/index\.js$/.test(relativePath);
}

function addViolation(violations, fromRel, toRel, reason) {
  violations.push({
    file: fromRel,
    import: toRel,
    reason
  });
}

function checkImport(fromFile, toFile, violations) {
  const fromRel = toPosix(path.relative(ROOT, fromFile));
  const toRel = toPosix(path.relative(ROOT, toFile));

  if (fromRel.startsWith("src/core/") && toRel.startsWith("src/modules/")) {
    addViolation(violations, fromRel, toRel, "src/core must not import src/modules");
    return;
  }

  if (fromRel.startsWith("src/core_shell/") && toRel.startsWith("src/modules/")) {
    addViolation(violations, fromRel, toRel, "src/core_shell must not import src/modules");
    return;
  }

  if (fromRel.startsWith("src/modules/") && toRel.startsWith("src/modules/")) {
    const fromModule = moduleName(fromRel);
    const toModule = moduleName(toRel);
    if (fromModule && toModule && fromModule !== toModule) {
      addViolation(violations, fromRel, toRel, "modules must not import other modules directly");
    }
    return;
  }

  if (fromRel.startsWith("src/api/") && toRel.startsWith("src/modules/") && !isModuleEntrypoint(toRel)) {
    addViolation(violations, fromRel, toRel, "src/api may import only module entrypoint files");
    return;
  }

  if (fromRel.startsWith("scripts/") && toRel.startsWith("src/modules/")) {
    addViolation(violations, fromRel, toRel, "scripts must not import module runtime files");
  }
}

function main() {
  const files = collectAllJsFiles();
  const fileSet = new Set(files);
  const violations = [];

  for (const file of files) {
    const source = safeReadFile(file);
    const specifiers = extractSpecifiers(source);

    for (const specifier of specifiers) {
      const resolved = resolveSpecifier(file, specifier, fileSet);
      if (!resolved) continue;
      checkImport(file, resolved, violations);
    }
  }

  console.log("Module-boundary checker summary");
  console.log("- scanned files: " + files.length);
  console.log("- violations: " + violations.length);
  console.log("- exit code: 0 (warnings only)");

  if (violations.length) {
    console.log("");
    for (const violation of violations) {
      console.log("Boundary violation:");
      console.log(" - File: " + violation.file);
      console.log(" - Imports forbidden module: " + violation.import);
      console.log(" - Reason: " + violation.reason);
    }
  } else {
    console.log("");
    console.log("No module-boundary violations found by this minimal checker.");
  }
}

try {
  main();
} catch (error) {
  console.error("Module-boundary checker failed unexpectedly.");
  console.error(error && error.stack ? error.stack : String(error));
  console.error("Exit code remains 0 by design.");
}

process.exitCode = 0;
