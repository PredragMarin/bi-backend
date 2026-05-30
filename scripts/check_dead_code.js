/**
 * Minimal dead-code checker.
 *
 * This is a dependency-free, warning-only repository discipline tool. It scans
 * src/ and scripts/ JavaScript files, builds a small static dependency graph
 * from require(...) and import ... from ... statements, and reports files that
 * are not entrypoints and are not imported by another scanned file.
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

function isEntrypoint(filePath) {
  const relative = toPosix(path.relative(ROOT, filePath));

  if (relative === "src/index.js") return true;
  if (/^src\/bootstrap\/[^/]+\.js$/.test(relative)) return true;
  if (/^scripts\/.+\.js$/.test(relative)) return true;

  return false;
}

function buildGraph(files) {
  const fileSet = new Set(files);
  const graph = new Map();
  const importedBy = new Map();

  for (const file of files) {
    graph.set(file, []);
    importedBy.set(file, []);
  }

  for (const file of files) {
    const source = safeReadFile(file);
    const specifiers = extractSpecifiers(source);

    for (const specifier of specifiers) {
      const resolved = resolveSpecifier(file, specifier, fileSet);
      if (!resolved) continue;

      graph.get(file).push(resolved);
      importedBy.get(resolved).push(file);
    }
  }

  return { graph, importedBy };
}

function main() {
  const files = collectAllJsFiles();
  const { importedBy } = buildGraph(files);
  const potentialDead = [];

  for (const file of files) {
    if (isEntrypoint(file)) continue;
    const importers = importedBy.get(file) || [];
    if (!importers.length) potentialDead.push(toPosix(path.relative(ROOT, file)));
  }

  console.log("Dead-code checker summary");
  console.log("- scanned files: " + files.length);
  console.log("- entrypoints: " + files.filter(isEntrypoint).length);
  console.log("- potential dead files: " + potentialDead.length);
  console.log("- exit code: 0 (warnings only)");

  if (potentialDead.length) {
    console.log("");
    console.log("Potential dead code:");
    for (const file of potentialDead) {
      console.log(" - " + file);
    }
  } else {
    console.log("");
    console.log("No potential dead code found by this minimal checker.");
  }
}

try {
  main();
} catch (error) {
  console.error("Dead-code checker failed unexpectedly.");
  console.error(error && error.stack ? error.stack : String(error));
  console.error("Exit code remains 0 by design.");
}

process.exitCode = 0;
