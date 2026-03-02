"use strict";

const { spawnSync } = require("child_process");

function psLiteral(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

function extractWorkbookRowsViaPowerShell(filePath, opts = {}) {
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
  return Array.isArray(parsed) ? parsed : [parsed];
}

module.exports = {
  extractWorkbookRowsViaPowerShell
};

