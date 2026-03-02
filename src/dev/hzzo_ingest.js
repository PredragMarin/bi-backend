"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { runExcelIngestShell } = require("../core/excel_shell/run");
const { extractWorkbookRowsViaPowerShell } = require("../core/excel_shell/extract");

function pad2(n) {
  return String(n).padStart(2, "0");
}

function toISODate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseHrDate(s) {
  const raw = String(s || "").trim();
  if (!raw) return null;

  // Excel serial fallback (rare, but possible in some exports).
  if (/^\d+(\.\d+)?$/.test(raw)) {
    const serial = Number(raw);
    if (Number.isFinite(serial) && serial > 20000 && serial < 70000) {
      const excelEpoch = new Date(Date.UTC(1899, 11, 30));
      const ms = Math.floor(serial * 24 * 60 * 60 * 1000);
      const d = new Date(excelEpoch.getTime() + ms);
      return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0);
    }
  }

  const x = raw.replace(/\.$/, "");
  let m = x.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) m = x.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) {
    const ymd = x.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (ymd) {
      const yyyy = Number(ymd[1]);
      const mm = Number(ymd[2]);
      const dd = Number(ymd[3]);
      const d = new Date(yyyy, mm - 1, dd, 0, 0, 0, 0);
      if (d.getFullYear() === yyyy && d.getMonth() === (mm - 1) && d.getDate() === dd) return d;
    }
    return null;
  }
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);
  if (!Number.isFinite(dd) || !Number.isFinite(mm) || !Number.isFinite(yyyy)) return null;
  const d = new Date(yyyy, mm - 1, dd, 0, 0, 0, 0);
  if (d.getFullYear() !== yyyy || d.getMonth() !== (mm - 1) || d.getDate() !== dd) return null;
  return d;
}

function listExcelFiles(dirAbs) {
  if (!dirAbs) return [];
  if (/\.(xlsx|xls)$/i.test(String(dirAbs))) {
    const filePath = String(dirAbs);
    const st = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
    if (st && st.isFile()) {
      return [{
        fullPath: filePath,
        name: path.basename(filePath),
        mtimeMs: st.mtimeMs
      }];
    }
    // Fallback for encoding/mapped-drive edge cases: locate by file name from drive root.
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
      maxBuffer: 10 * 1024 * 1024
    });
    if (outByName.status === 0) {
      const txt = String(outByName.stdout || "").trim();
      if (txt) {
        const obj = JSON.parse(txt);
        return [{
          fullPath: String(obj.fullPath || filePath),
          name: String(obj.name || baseName),
          mtimeMs: Number(obj.mtimeMs || 0)
        }];
      }
    }
  }
  let allExcel = [];
  let fromFs = false;
  if (fs.existsSync(dirAbs)) {
    allExcel = fs.readdirSync(dirAbs).filter(name => /\.(xlsx|xls)$/i.test(name));
    fromFs = true;
  } else {
    // Fallback for mapped/network drives not visible to Node fs in current context.
    const script = [
      "$ErrorActionPreference='Stop'",
      `$path=${psLiteral(dirAbs)}`,
      "$files = Get-ChildItem -Path $path -File -ErrorAction Stop -Recurse | Where-Object { $_.Name -match '\\.(xlsx|xls)$' } | Select-Object @{N='fullPath';E={$_.FullName}}, @{N='name';E={$_.Name}}, @{N='mtimeMs';E={[double]([DateTimeOffset]$_.LastWriteTimeUtc).ToUnixTimeMilliseconds()}}",
      "$files | ConvertTo-Json -Compress -Depth 3"
    ].join("\n");
    const out = spawnSync("powershell.exe", ["-NoProfile", "-Command", script], {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024
    });
    if (out.status !== 0) {
      const stderr = (out.stderr || "").trim();
      throw new Error(`HZZO folder not found or inaccessible: ${dirAbs}${stderr ? ` | ${stderr}` : ""}`);
    }
    const txt = String(out.stdout || "").trim();
    if (!txt) return [];
    const parsed = JSON.parse(txt);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    // We already have full entries from PowerShell.
    const pnrPS = arr.filter(x => /^PNR-I_/i.test(String(x.name || "")));
    const selectedPS = pnrPS.length > 0 ? pnrPS : arr;
    return selectedPS
      .map(x => ({
        fullPath: String(x.fullPath || ""),
        name: String(x.name || path.basename(String(x.fullPath || ""))),
        mtimeMs: Number(x.mtimeMs || 0)
      }))
      .sort((a, b) => a.mtimeMs - b.mtimeMs || a.name.localeCompare(b.name));
  }

  const pnr = allExcel.filter(name => /^PNR-I_/i.test(name));
  const selected = pnr.length > 0 ? pnr : allExcel;
  const files = (fromFs ? selected : [])
    .map(name => {
      const fullPath = path.join(dirAbs, name);
      const st = fs.statSync(fullPath);
      return { fullPath, name, mtimeMs: st.mtimeMs };
    })
    .sort((a, b) => a.mtimeMs - b.mtimeMs || a.name.localeCompare(b.name));
  return files;
}

function psLiteral(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

function readWorkbookRowsViaPowerShell(filePath) {
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
    "  for($r=2; $r -le $ur.Rows.Count; $r++){",
    "    $oib = ([string]$ur.Cells.Item($r,3).Text).Trim()",
    "    if([string]::IsNullOrWhiteSpace($oib)){ continue }",
    "    $rows += [pscustomobject]@{",
    "      vrsta = ([string]$ur.Cells.Item($r,1).Text).Trim()",
    "      datum_evid = ([string]$ur.Cells.Item($r,2).Text).Trim()",
    "      oib = $oib",
    "      zaposlenik = ([string]$ur.Cells.Item($r,5).Text).Trim()",
    "      razlog = ([string]$ur.Cells.Item($r,6).Text).Trim()",
    "      datum_poc = ([string]$ur.Cells.Item($r,7).Text).Trim()",
    "      datum_kraj = ([string]$ur.Cells.Item($r,8).Text).Trim()",
    "    }",
    "  }",
    "}",
    "$wb.Close($false)",
    "$excel.Quit()",
    "[System.Runtime.Interopservices.Marshal]::ReleaseComObject($wb) | Out-Null",
    "[System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null",
    "[GC]::Collect(); [GC]::WaitForPendingFinalizers()",
    "$rows | ConvertTo-Json -Compress -Depth 4"
  ].join("\n");

  const out = spawnSync("powershell.exe", ["-NoProfile", "-Command", script], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024
  });

  if (out.status !== 0) {
    const stderr = (out.stderr || "").trim();
    throw new Error(`HZZO Excel read failed for ${filePath}: ${stderr || `exit ${out.status}`}`);
  }

  const txt = String(out.stdout || "").trim();
  if (!txt) return [];
  const parsed = JSON.parse(txt);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function mergeIntervals(intervals) {
  if (!intervals || intervals.length === 0) return [];
  const src = intervals
    .filter(x => x && x.start && x.end)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  if (src.length === 0) return [];

  const out = [];
  for (const cur of src) {
    const last = out[out.length - 1];
    if (!last) {
      out.push({ ...cur });
      continue;
    }
    const adjacent = cur.start.getTime() <= (last.end.getTime() + 24 * 60 * 60 * 1000);
    if (adjacent) {
      if (cur.end > last.end) last.end = cur.end;
    } else {
      out.push({ ...cur });
    }
  }
  return out;
}

function normalizeWorkbookRows(rows, fileName) {
  const out = [];
  for (const r of rows || []) {
    const vrsta = String(r.vrsta || "").trim();
    const oib = String(r.oib || "").replace(/\D+/g, "");
    if (!oib) continue;
    const datumEvid = parseHrDate(r.datum_evid);
    const start = parseHrDate(r.datum_poc);
    const end = parseHrDate(r.datum_kraj);

    out.push({
      file: fileName,
      vrsta,
      vrsta_norm: normalizeKind(vrsta),
      oib,
      ime_prezime: String(r.zaposlenik || "").trim(),
      razlog: String(r.razlog || "").trim(),
      datum_evid: datumEvid,
      start,
      end
    });
  }
  return out;
}

function foldText(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function normalizeKind(vrsta) {
  const v = foldText(vrsta);
  if (v.startsWith("izvjes")) return "IZVJESCE";
  if (v.startsWith("obavijest-storn")) return "OBAVIJEST_STORNIRANA";
  if (v.startsWith("obavijest")) return "OBAVIJEST";
  return "OTHER";
}

function buildAggregateState(allRows) {
  const byOib = new Map();
  const unresolvedOpen = [];
  const unresolvedStorno = [];

  for (const r of allRows) {
    if (!byOib.has(r.oib)) {
      byOib.set(r.oib, { oib: r.oib, ime_prezime: r.ime_prezime || "", intervals: [] });
    }
    const bag = byOib.get(r.oib);
    if (!bag.ime_prezime && r.ime_prezime) bag.ime_prezime = r.ime_prezime;

    if (r.start && r.end) {
      bag.intervals.push({ start: r.start, end: r.end, razlog: r.razlog });
      continue;
    }

    if (r.vrsta_norm === "OBAVIJEST" && r.datum_evid) {
      unresolvedOpen.push({
        oib: r.oib,
        ime_prezime: r.ime_prezime,
        openDate: r.datum_evid,
        razlog: r.razlog
      });
      continue;
    }

    if (r.vrsta_norm === "OBAVIJEST_STORNIRANA" && r.datum_evid) {
      unresolvedStorno.push({
        oib: r.oib,
        stornoDate: r.datum_evid
      });
    }
  }

  // Merge confirmed intervals per OIB.
  for (const state of byOib.values()) {
    state.intervals = mergeIntervals(state.intervals);
  }

  // Simple storno: remove open entries with same OIB and same date if storned.
  const stornoSet = new Set(unresolvedStorno.map(x => `${x.oib}|${toISODate(x.stornoDate)}`));
  const openSignals = unresolvedOpen.filter(x => !stornoSet.has(`${x.oib}|${toISODate(x.openDate)}`));

  return { byOib, openSignals };
}

function isWeekday(dateObj) {
  const wd = dateObj.getDay();
  return wd >= 1 && wd <= 5;
}

function isCollectiveLeaveText(s) {
  if (!s) return false;
  return String(s).trim().toLowerCase() === "kolektivni go";
}

function buildCalendarByISO(calendarRows) {
  const map = new Map();
  for (const c of calendarRows || []) {
    const dmy = String(c.datum || "").trim();
    const m = dmy.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) continue;
    const iso = `${m[3]}-${m[2]}-${m[1]}`;
    map.set(iso, {
      dandelovni: Number(c.dandelovni || 0),
      praznik: Number(c.praznik || 0),
      tekst: String(c.tekst || "")
    });
  }
  return map;
}

function buildOibToOsebid(osebeRaw) {
  const map = new Map();
  for (const p of osebeRaw || []) {
    const osebid = Number(p.osebid);
    if (!Number.isFinite(osebid)) continue;

    const candidates = [
      p.oib,
      p.davcna,
      p.alt_id,
      p.matst,
      p.eprcode
    ];
    for (const raw of candidates) {
      const oib = String(raw || "").replace(/\D+/g, "");
      if (/^\d{11}$/.test(oib) && !map.has(oib)) {
        map.set(oib, osebid);
      }
    }
  }
  return map;
}

function dateRangeInclusive(fromDate, toDate) {
  const out = [];
  let d = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate(), 0, 0, 0, 0);
  const stop = new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate(), 0, 0, 0, 0);
  while (d <= stop) {
    out.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

function normalizePeriodDate(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
}

function hasAnyAttendanceOnDate(eprRows, osebid, isoDate) {
  for (const r of eprRows || []) {
    if (Number(r.osebid) !== Number(osebid)) continue;
    const tv = String(r.timevhod || "");
    const m = tv.match(/^(\d{2})\/(\d{2})\/(\d{4})\s/);
    if (!m) continue;
    const iso = `${m[3]}-${m[2]}-${m[1]}`;
    if (iso === isoDate) return true;
  }
  return false;
}

function buildSyntheticRowsFromHzzo(opts) {
  const {
    fromISO,
    toISO,
    eprRows,
    calendar,
    osebeRaw,
    hzzoDir,
    asOfISO
  } = opts;

  const shell = runExcelIngestShell({
    sourcePath: hzzoDir,
    mode: "STRICT",
    recursive: true,
    preferNameRegex: "^PNR-I_",
    extractRows: (f) => extractWorkbookRowsViaPowerShell(f.fullPath, {
      startRow: 2,
      includeEmptyKeyColumn: false,
      keyColumn: 3,
      columns: [
        { key: "vrsta", index: 1 },
        { key: "datum_evid", index: 2 },
        { key: "oib", index: 3 },
        { key: "zaposlenik", index: 5 },
        { key: "razlog", index: 6 },
        { key: "datum_poc", index: 7 },
        { key: "datum_kraj", index: 8 }
      ]
    }),
    normalizeRows: (rows, f) => normalizeWorkbookRows(rows, f.name)
  });

  const allRows = shell.normalized_rows || [];

  const { byOib, openSignals } = buildAggregateState(allRows);
  const oibToOsebid = buildOibToOsebid(osebeRaw);
  const calByISO = buildCalendarByISO(calendar);
  const fromDate = normalizePeriodDate(fromISO);
  const toDate = normalizePeriodDate(toISO);
  const asOfDate = normalizePeriodDate(asOfISO || toISO) || toDate;
  if (!fromDate || !toDate) {
    throw new Error("Invalid period for HZZO ingestion.");
  }

  const synthesized = [];
  const unmatched = new Set();

  // Confirmed intervals.
  for (const [oib, state] of byOib.entries()) {
    const osebid = oibToOsebid.get(oib);
    if (!osebid) {
      unmatched.add(oib);
      continue;
    }
    for (const iv of state.intervals) {
      const clipStart = iv.start < fromDate ? fromDate : iv.start;
      const clipEnd = iv.end > toDate ? toDate : iv.end;
      if (clipStart > clipEnd) continue;

      for (const d of dateRangeInclusive(clipStart, clipEnd)) {
        const iso = toISODate(d);
        const cal = calByISO.get(iso);
        const isWorkday = !!cal && Number(cal.dandelovni) === 1;
        const isHoliday = !!cal && Number(cal.praznik) === 1;
        const isCL = !!cal && isCollectiveLeaveText(cal.tekst);
        if (!isWorkday || isHoliday || isCL || !isWeekday(d)) continue;
        if (hasAnyAttendanceOnDate(eprRows, osebid, iso)) continue;

        synthesized.push({
          osebid,
          timevhod: `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)} 07:30`,
          timeizhod: `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)} 15:30`,
          tipvhod: 0,
          tipizhod: 9,
          opomba: "HZZO_AUTO_FROM_XLS"
        });
      }
    }
  }

  // Open signals are used only if date is not already covered by confirmed interval and up to asOfDate.
  for (const sig of openSignals) {
    const osebid = oibToOsebid.get(sig.oib);
    if (!osebid) {
      unmatched.add(sig.oib);
      continue;
    }
    if (sig.openDate > asOfDate) continue;

    const state = byOib.get(sig.oib);
    const covered = (state?.intervals || []).some(iv => sig.openDate >= iv.start && sig.openDate <= iv.end);
    if (covered) continue;

    const clipStart = sig.openDate < fromDate ? fromDate : sig.openDate;
    const clipEnd = asOfDate > toDate ? toDate : asOfDate;
    if (clipStart > clipEnd) continue;

    for (const d of dateRangeInclusive(clipStart, clipEnd)) {
      const iso = toISODate(d);
      const cal = calByISO.get(iso);
      const isWorkday = !!cal && Number(cal.dandelovni) === 1;
      const isHoliday = !!cal && Number(cal.praznik) === 1;
      const isCL = !!cal && isCollectiveLeaveText(cal.tekst);
      if (!isWorkday || isHoliday || isCL || !isWeekday(d)) continue;
      if (hasAnyAttendanceOnDate(eprRows, osebid, iso)) continue;

      synthesized.push({
        osebid,
        timevhod: `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)} 07:30`,
        timeizhod: `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)} 15:30`,
        tipvhod: 0,
        tipizhod: 9,
        opomba: "HZZO_AUTO_FROM_XLS_OPEN"
      });
    }
  }

  // Final de-dup against itself and existing rows.
  const existing = new Set(
    (eprRows || []).map(r => `${Number(r.osebid)}|${String(r.timevhod)}|${String(r.timeizhod)}|${Number(r.tipizhod)}|${String(r.opomba || "")}`)
  );
  const uniq = new Map();
  for (const r of synthesized) {
    const key = `${Number(r.osebid)}|${r.timevhod}|${r.timeizhod}|${Number(r.tipizhod)}|${r.opomba}`;
    if (existing.has(key)) continue;
    if (!uniq.has(key)) uniq.set(key, r);
  }

  return {
    rows: Array.from(uniq.values()),
    audit: {
      enabled: true,
      files_total: shell.audit.files_total,
      files_loaded: shell.audit.files_loaded,
      rows_loaded: allRows.length,
      intervals_confirmed: Array.from(byOib.values()).reduce((s, x) => s + (x.intervals?.length || 0), 0),
      open_signals: openSignals.length,
      days_synthesized: uniq.size,
      unmatched_oib_count: unmatched.size,
      files_failed: shell.audit.files_failed,
      file_errors: shell.audit.file_errors || []
    }
  };
}

module.exports = {
  buildSyntheticRowsFromHzzo
};
