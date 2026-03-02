"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function psLiteral(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

function normalizeDiscoveredEntry(x) {
  return {
    fullPath: String(x.fullPath || ""),
    name: String(x.name || path.basename(String(x.fullPath || ""))),
    mtimeMs: Number(x.mtimeMs || 0)
  };
}

function discoverWithPowerShell(dirAbs, recursive) {
  const recurseSwitch = recursive ? "-Recurse" : "";
  const script = [
    "$ErrorActionPreference='Stop'",
    `$path=${psLiteral(dirAbs)}`,
    `$files = Get-ChildItem -Path $path -File ${recurseSwitch} -ErrorAction Stop | Where-Object { $_.Name -match '\\.(xlsx|xls)$' } | Select-Object @{N='fullPath';E={$_.FullName}}, @{N='name';E={$_.Name}}, @{N='mtimeMs';E={[double]([DateTimeOffset]$_.LastWriteTimeUtc).ToUnixTimeMilliseconds()}}`,
    "$files | ConvertTo-Json -Compress -Depth 3"
  ].join("\n");
  const out = spawnSync("powershell.exe", ["-NoProfile", "-Command", script], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024
  });
  if (out.status !== 0) {
    const stderr = (out.stderr || "").trim();
    throw new Error(`Excel discover failed for ${dirAbs}${stderr ? ` | ${stderr}` : ""}`);
  }
  const txt = String(out.stdout || "").trim();
  if (!txt) return [];
  const parsed = JSON.parse(txt);
  const arr = Array.isArray(parsed) ? parsed : [parsed];
  return arr.map(normalizeDiscoveredEntry);
}

function discoverBySingleFilePath(filePath) {
  if (fs.existsSync(filePath)) {
    const st = fs.statSync(filePath);
    if (st.isFile()) {
      return [{
        fullPath: String(filePath),
        name: path.basename(String(filePath)),
        mtimeMs: Number(st.mtimeMs || 0)
      }];
    }
  }

  const baseName = path.basename(filePath);
  const driveRoot = path.parse(filePath).root || "Z:\\";
  const scriptFindByName = [
    "$ErrorActionPreference='Stop'",
    `$root=${psLiteral(driveRoot)}`,
    `$base=${psLiteral(baseName)}`,
    "$it = Get-ChildItem -Path $root -File -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.Name -ieq $base } | Select-Object -First 1",
    "if ($it) { [pscustomobject]@{ fullPath=$it.FullName; name=$it.Name; mtimeMs=[double]([DateTimeOffset]$it.LastWriteTimeUtc).ToUnixTimeMilliseconds() } | ConvertTo-Json -Compress -Depth 3 }"
  ].join("\n");
  const outByName = spawnSync("powershell.exe", ["-NoProfile", "-Command", scriptFindByName], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024
  });
  if (outByName.status !== 0) return [];
  const txt = String(outByName.stdout || "").trim();
  if (!txt) return [];
  const obj = JSON.parse(txt);
  return [normalizeDiscoveredEntry(obj)];
}

function applySelectionRules(files, { preferNameRegex = "" } = {}) {
  let selected = Array.isArray(files) ? files.slice() : [];
  if (preferNameRegex) {
    const rx = new RegExp(preferNameRegex, "i");
    const preferred = selected.filter(f => rx.test(String(f.name || "")));
    if (preferred.length > 0) selected = preferred;
  }
  return selected.sort((a, b) => a.mtimeMs - b.mtimeMs || String(a.name).localeCompare(String(b.name)));
}

function discoverExcelSources({
  sourcePath,
  recursive = false,
  preferNameRegex = "^PNR-I_"
}) {
  if (!sourcePath) return [];

  let files = [];
  const src = String(sourcePath);
  if (/\.(xlsx|xls)$/i.test(src)) {
    files = discoverBySingleFilePath(src);
  } else if (fs.existsSync(src)) {
    const names = fs.readdirSync(src).filter(n => /\.(xlsx|xls)$/i.test(n));
    files = names.map(name => {
      const fullPath = path.join(src, name);
      const st = fs.statSync(fullPath);
      return { fullPath, name, mtimeMs: st.mtimeMs };
    });
  } else {
    files = discoverWithPowerShell(src, recursive);
  }

  return applySelectionRules(files, { preferNameRegex });
}

module.exports = {
  discoverExcelSources
};

