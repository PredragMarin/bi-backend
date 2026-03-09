"use strict";

const { spawnSync } = require("child_process");
const path = require("path");
const { normalizeObjectStringsDeep } = require("../text/normalize");

function psLiteral(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

function tryLoadXlsx() {
  try {
    return require("xlsx");
  } catch (_err) {
    return null;
  }
}

function cellTextFromSheet(xlsx, ws, r0, c0) {
  const addr = xlsx.utils.encode_cell({ r: r0, c: c0 });
  const cell = ws[addr];
  if (!cell) return "";
  if (cell.w !== undefined && cell.w !== null) return String(cell.w).trim();
  if (cell.v === undefined || cell.v === null) return "";
  return String(cell.v).trim();
}

function extractWorkbookRowsViaNodeXlsx(filePath, opts = {}) {
  const xlsx = tryLoadXlsx();
  if (!xlsx) {
    throw new Error(
      `XLSX parser package is missing for ${filePath}. Install dependency: npm install xlsx`
    );
  }

  const {
    startRow = 2,
    includeEmptyKeyColumn = false,
    keyColumn = 1,
    columns = [
      { key: "c1", index: 1 },
      { key: "c2", index: 2 },
      { key: "c3", index: 3 },
      { key: "c4", index: 4 }
    ]
  } = opts;

  const wb = xlsx.readFile(filePath, { cellDates: false, cellNF: false, cellText: true });
  const rows = [];
  for (const sheetName of wb.SheetNames || []) {
    const ws = wb.Sheets[sheetName];
    if (!ws || !ws["!ref"]) continue;
    const range = xlsx.utils.decode_range(ws["!ref"]);
    for (let r = Math.max(Number(startRow) - 1, range.s.r); r <= range.e.r; r++) {
      const keyVal = cellTextFromSheet(xlsx, ws, r, Number(keyColumn) - 1);
      const allow = includeEmptyKeyColumn ? true : !!String(keyVal).trim();
      if (!allow) continue;
      const out = {};
      for (const c of columns) {
        out[c.key] = cellTextFromSheet(xlsx, ws, r, Number(c.index) - 1);
      }
      rows.push(out);
    }
  }
  return normalizeObjectStringsDeep(rows);
}

function extractHeaderRowViaNodeXlsx(filePath, opts = {}) {
  const xlsx = tryLoadXlsx();
  if (!xlsx) {
    throw new Error(
      `XLSX parser package is missing for ${filePath}. Install dependency: npm install xlsx`
    );
  }

  const { rowIndex = 1, maxCols = 16 } = opts;
  const wb = xlsx.readFile(filePath, { cellDates: false, cellNF: false, cellText: true });
  const firstSheetName = (wb.SheetNames || [])[0];
  if (!firstSheetName) return [];
  const ws = wb.Sheets[firstSheetName];
  if (!ws || !ws["!ref"]) return [];

  const out = [];
  const row0 = Math.max(0, Number(rowIndex) - 1);
  for (let c = 0; c < Number(maxCols); c++) {
    out.push(cellTextFromSheet(xlsx, ws, row0, c));
  }
  return normalizeObjectStringsDeep(out);
}

function extractWorkbookRowsViaPowerShell(filePath, opts = {}) {
  const ext = String(path.extname(String(filePath || ""))).toLowerCase();
  if (ext === ".xlsx") {
    return extractWorkbookRowsViaNodeXlsx(filePath, opts);
  }

  const {
    startRow = 2,
    includeEmptyKeyColumn = false,
    keyColumn = 1,
    columns = [
      { key: "c1", index: 1 },
      { key: "c2", index: 2 },
      { key: "c3", index: 3 },
      { key: "c4", index: 4 }
    ]
  } = opts;

  const projection = columns
    .map(c => `      ${c.key} = ([string]$ur.Cells.Item($r,${Number(c.index)}).Text).Trim()`)
    .join("\n");

  const script = [
    "$ErrorActionPreference='Stop'",
    "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
    "$OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
    `$path=${psLiteral(filePath)}`,
    "$excel = New-Object -ComObject Excel.Application",
    "$excel.Visible = $false",
    "$excel.DisplayAlerts = $false",
    "$wb = $excel.Workbooks.Open($path)",
    "$rows = @()",
    "foreach($ws in $wb.Worksheets){",
    "  $ur = $ws.UsedRange",
    `  for($r=${Number(startRow)}; $r -le $ur.Rows.Count; $r++){`,
    `    $keyVal = ([string]$ur.Cells.Item($r,${Number(keyColumn)}).Text).Trim()`,
    includeEmptyKeyColumn ? "    $allow = $true" : "    $allow = -not [string]::IsNullOrWhiteSpace($keyVal)",
    "    if(-not $allow){ continue }",
    "    $rows += [pscustomobject]@{",
    projection,
    "    }",
    "  }",
    "}",
    "$wb.Close($false)",
    "$excel.Quit()",
    "[System.Runtime.Interopservices.Marshal]::ReleaseComObject($wb) | Out-Null",
    "[System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null",
    "[GC]::Collect(); [GC]::WaitForPendingFinalizers()",
    "$rows | ConvertTo-Json -Compress -Depth 6"
  ].join("\n");

  const out = spawnSync("powershell.exe", ["-NoProfile", "-Command", script], {
    encoding: "utf8",
    maxBuffer: 30 * 1024 * 1024
  });

  if (out.status !== 0) {
    const stderr = (out.stderr || "").trim();
    throw new Error(`Excel extract failed for ${filePath}: ${stderr || `exit ${out.status}`}`);
  }

  const txt = String(out.stdout || "").trim();
  if (!txt) return [];
  const parsed = JSON.parse(txt);
  const arr = Array.isArray(parsed) ? parsed : [parsed];
  return normalizeObjectStringsDeep(arr);
}

function extractHeaderRowViaPowerShell(filePath, opts = {}) {
  const ext = String(path.extname(String(filePath || ""))).toLowerCase();
  if (ext === ".xlsx") {
    return extractHeaderRowViaNodeXlsx(filePath, opts);
  }

  const { rowIndex = 1, maxCols = 16 } = opts;
  const script = [
    "$ErrorActionPreference='Stop'",
    "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
    "$OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
    `$path=${psLiteral(filePath)}`,
    "$excel = New-Object -ComObject Excel.Application",
    "$excel.Visible = $false",
    "$excel.DisplayAlerts = $false",
    "$wb = $excel.Workbooks.Open($path)",
    "$ws = $wb.Worksheets.Item(1)",
    "$ur = $ws.UsedRange",
    "$vals = @()",
    `for($c=1; $c -le ${Number(maxCols)}; $c++){`,
    `  $vals += ([string]$ur.Cells.Item(${Number(rowIndex)},$c).Text).Trim()`,
    "}",
    "$wb.Close($false)",
    "$excel.Quit()",
    "[System.Runtime.Interopservices.Marshal]::ReleaseComObject($ur) | Out-Null",
    "[System.Runtime.Interopservices.Marshal]::ReleaseComObject($ws) | Out-Null",
    "[System.Runtime.Interopservices.Marshal]::ReleaseComObject($wb) | Out-Null",
    "[System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null",
    "[GC]::Collect(); [GC]::WaitForPendingFinalizers()",
    "$vals | ConvertTo-Json -Compress -Depth 2"
  ].join("\n");

  const out = spawnSync("powershell.exe", ["-NoProfile", "-Command", script], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024
  });
  if (out.status !== 0) {
    const stderr = (out.stderr || "").trim();
    throw new Error(`Excel header extract failed for ${filePath}: ${stderr || `exit ${out.status}`}`);
  }
  const txt = String(out.stdout || "").trim();
  if (!txt) return [];
  const parsed = JSON.parse(txt);
  const arr = Array.isArray(parsed) ? parsed : [parsed];
  return normalizeObjectStringsDeep(arr);
}

module.exports = {
  extractWorkbookRowsViaPowerShell,
  extractHeaderRowViaPowerShell
};
