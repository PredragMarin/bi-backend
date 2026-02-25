"use strict";

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { spawnSync } = require("child_process");

const DEFAULT_KEYWORDS = [
  "inox",
  "aisi 304",
  "aisi304",
  "sudoper",
  "radni stol",
  "stol",
  "napa",
  "konvektomat",
  "perilica posuda",
  "perilica",
  "hladnjak",
  "zamrzivac",
  "zamrzivac",
  "rashladna komora",
  "hladnjaca",
  "hladnjaca",
  "stednjak",
  "stednjak",
  "rostilj",
  "rostilj",
  "kuhinjski",
  "gastro",
  "neutralni element",
  "regal inox"
];

const DEFAULT_UOM = [
  "kom", "kom.", "m", "m2", "m3", "kg", "set", "kompl", "kpl", "sat", "dan", "l", "lit", "par"
];

const DEFAULT_STOP = new Set([
  "i", "u", "na", "za", "od", "do", "sa", "po", "te", "ili", "se", "je", "su", "da", "iz", "uz",
  "stavka", "stavke", "opis", "ukupno", "rekapitulacija", "radovi", "materijal", "oprema"
]);

function parseArgs(argv) {
  const out = {};
  for (const a of argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
    else if (a.startsWith("--")) out[a.slice(2)] = "1";
  }
  return out;
}

function normalizeText(input) {
  if (!input) return "";
  return String(input)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/\s+/g, " ")
    .trim();
}

function isNumericLike(v) {
  if (!v) return false;
  const s = normalizeText(v).replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  return /^[-+]?\d+(\.\d+)?$/.test(s);
}

function hasLetters(v) {
  return /[a-z]/i.test(String(v || ""));
}

function uniq(arr) {
  return Array.from(new Set(arr));
}

function escapePsSingleQuoted(s) {
  return String(s).replace(/'/g, "''");
}

function runPowerShellWorkbookExtract(filePath, maxRows = 6000, maxCols = 80) {
  const safePath = escapePsSingleQuoted(filePath);
  const command = `
$ErrorActionPreference='Stop'
$path='${safePath}'
$maxRows=${Number(maxRows)}
$maxCols=${Number(maxCols)}
$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
$wb = $excel.Workbooks.Open($path, 0, $true)
$out = @()
foreach($ws in $wb.Worksheets){
  $used = $ws.UsedRange
  $rows = [Math]::Min([int]$used.Rows.Count, $maxRows)
  $cols = [Math]::Min([int]$used.Columns.Count, $maxCols)
  $sheetRows = @()
  for($r=1; $r -le $rows; $r++){
    $row = @()
    for($c=1; $c -le $cols; $c++){
      $row += [string]$ws.Cells.Item($r,$c).Text
    }
    $sheetRows += ,$row
  }
  $out += [PSCustomObject]@{
    name = $ws.Name
    rows = $sheetRows
    row_count = $rows
    col_count = $cols
  }
}
$wb.Close($false)
$excel.Quit()
[void][System.Runtime.Interopservices.Marshal]::ReleaseComObject($wb)
[void][System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel)
[gc]::Collect(); [gc]::WaitForPendingFinalizers()
@{ sheets = $out } | ConvertTo-Json -Depth 8 -Compress
`;
  const result = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], {
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024
  });
  if (result.status !== 0) {
    throw new Error(`PowerShell Excel extraction failed: ${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout.trim());
}

function validateExtractData(data) {
  return !!(data && Array.isArray(data.sheets));
}

function extractWorkbookData(filePath, opts = {}) {
  const maxRows = Number(opts.maxRows || 6000);
  const maxCols = Number(opts.maxCols || 80);
  const raw = runPowerShellWorkbookExtract(filePath, maxRows, maxCols);
  return {
    source_file: filePath,
    extracted_at: new Date().toISOString(),
    max_rows: maxRows,
    max_cols: maxCols,
    sheets: Array.isArray(raw.sheets) ? raw.sheets : []
  };
}

function detectDescriptionColumn(rows) {
  if (!rows || rows.length < 2) return null;
  const colCount = rows[0].length;
  let bestCol = null;
  let bestScore = -1e9;

  for (let c = 0; c < colCount; c++) {
    let textLike = 0;
    let numLike = 0;
    let nonEmpty = 0;
    let charSum = 0;
    for (let r = 1; r < rows.length; r++) {
      const v = String(rows[r][c] || "").trim();
      if (!v) continue;
      nonEmpty += 1;
      if (isNumericLike(v)) numLike += 1;
      else {
        textLike += 1;
        charSum += v.length;
      }
    }
    if (!nonEmpty) continue;
    const score = textLike * 3 + charSum - numLike * 2;
    if (score > bestScore) {
      bestScore = score;
      bestCol = c;
    }
  }
  return bestCol;
}

function detectAnchorColumn(rows, descCol, uomSet) {
  if (!rows || rows.length < 2) return null;
  const colCount = rows[0].length;
  let bestCol = null;
  let bestScore = -1e9;

  for (let c = 0; c < colCount; c++) {
    if (c === descCol) continue;
    let anchorLike = 0;
    let nonEmpty = 0;
    for (let r = 1; r < rows.length; r++) {
      const raw = String(rows[r][c] || "").trim();
      if (!raw) continue;
      nonEmpty += 1;
      const norm = normalizeText(raw);
      if (isNumericLike(raw) || uomSet.has(norm)) anchorLike += 1;
    }
    if (!nonEmpty) continue;
    const sparsityPenalty = Math.abs(nonEmpty - anchorLike) * 0.2;
    const score = anchorLike - sparsityPenalty;
    if (score > bestScore) {
      bestScore = score;
      bestCol = c;
    }
  }
  return bestCol;
}

function collectAnchorRows(rows, anchorCol, uomSet) {
  const anchors = [];
  for (let r = 1; r < rows.length; r++) {
    const raw = String(rows[r][anchorCol] || "").trim();
    if (!raw) continue;
    const norm = normalizeText(raw);
    if (isNumericLike(raw) || uomSet.has(norm)) anchors.push(r);
  }
  return uniq(anchors).sort((a, b) => a - b);
}

function scanBlockKeywords(textNorm, keywordsNorm) {
  let hit = 0;
  const matched = [];
  for (const kw of keywordsNorm) {
    if (textNorm.includes(kw)) {
      hit += 1;
      matched.push(kw);
    }
  }
  return { hit, matched };
}

function extractCandidateTerms(blocks, keywordsNorm) {
  const counts = new Map();
  const kwSet = new Set(keywordsNorm);
  for (const b of blocks) {
    const words = normalizeText(b.text)
      .split(/[^a-z0-9]+/g)
      .filter((w) => w && w.length >= 4 && !DEFAULT_STOP.has(w));
    for (const w of words) {
      if (kwSet.has(w)) continue;
      counts.set(w, (counts.get(w) || 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([term, count]) => ({ term, count }));
}

function analyzeSheet(rows, sheetName, keywordsNorm, uomSet) {
  const descCol = detectDescriptionColumn(rows);
  if (descCol === null) {
    return {
      sheet: sheetName,
      mode: "empty",
      desc_col: null,
      anchor_col: null,
      item_count: 0,
      hit_items: 0,
      incidence: 0,
      intensity: 0,
      total_keyword_hits: 0,
      keyword_frequency: {},
      candidate_terms_top: []
    };
  }

  const anchorCol = detectAnchorColumn(rows, descCol, uomSet);
  let anchors = [];
  if (anchorCol !== null) anchors = collectAnchorRows(rows, anchorCol, uomSet);

  const mode = anchors.length >= 2 ? "anchor_interval" : "row_fallback";
  const blocks = [];

  if (mode === "anchor_interval") {
    for (let i = 0; i < anchors.length; i++) {
      const start = anchors[i];
      const end = i < anchors.length - 1 ? anchors[i + 1] - 1 : rows.length - 1;
      if (end < start) continue;

      const parts = [];
      for (let r = start; r <= end; r++) {
        const v = String(rows[r][descCol] || "").trim();
        if (v) parts.push(v);
      }
      const text = parts.join(" ").trim();
      if (!text || text.length < 3) continue;
      blocks.push({ start_row: start + 1, end_row: end + 1, text });
    }
  } else {
    for (let r = 1; r < rows.length; r++) {
      const v = String(rows[r][descCol] || "").trim();
      if (!v || isNumericLike(v) || v.length < 3) continue;
      blocks.push({ start_row: r + 1, end_row: r + 1, text: v });
    }
  }

  let itemCount = 0;
  let hitItems = 0;
  let totalHits = 0;
  const keywordFreq = {};

  for (const b of blocks) {
    const norm = normalizeText(b.text);
    if (!norm) continue;
    itemCount += 1;
    const k = scanBlockKeywords(norm, keywordsNorm);
    if (k.hit > 0) {
      hitItems += 1;
      totalHits += k.hit;
      for (const w of k.matched) keywordFreq[w] = (keywordFreq[w] || 0) + 1;
    }
  }

  const incidence = itemCount > 0 ? Number((hitItems / itemCount).toFixed(4)) : 0;
  const intensity = hitItems > 0 ? Number((totalHits / hitItems).toFixed(4)) : 0;

  return {
    sheet: sheetName,
    mode,
    desc_col: descCol + 1,
    anchor_col: anchorCol === null ? null : anchorCol + 1,
    item_count: itemCount,
    hit_items: hitItems,
    incidence,
    intensity,
    total_keyword_hits: totalHits,
    keyword_frequency: keywordFreq,
    candidate_terms_top: extractCandidateTerms(blocks, keywordsNorm)
  };
}

function chooseLabel(globalIncidence, maxSheetIncidence, maxSheetHits) {
  if (maxSheetIncidence >= 0.3 && maxSheetHits >= 8) return "HIGH_INTEREST";
  if (globalIncidence >= 0.15 || maxSheetIncidence >= 0.15) return "REVIEW";
  return "LOW_INTEREST";
}

function mergeKeywordFiles(moduleDir) {
  const files = ["keywords_p1.json", "keywords_p2.json", "keywords_p3.json", "keywords_p4.json"];
  const merged = [];
  for (const f of files) {
    const p = path.join(moduleDir, f);
    if (!fs.existsSync(p)) continue;
    try {
      const arr = JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
      if (Array.isArray(arr)) merged.push(...arr.map((x) => String(x)));
    } catch {
      // Ignore malformed optional file.
    }
  }
  return uniq(merged);
}

function analyzeWorkbookData(workbook, opts = {}) {
  const rawKeywords = opts.keywords && opts.keywords.length ? opts.keywords : DEFAULT_KEYWORDS;
  const keywordsNorm = uniq(rawKeywords.map(normalizeText).filter(Boolean));
  const uomSet = new Set((opts.uom || DEFAULT_UOM).map(normalizeText));

  const sheetResults = workbook.sheets.map((s) =>
    analyzeSheet(s.rows || [], s.name || "Sheet", keywordsNorm, uomSet)
  );

  const totalItems = sheetResults.reduce((acc, s) => acc + s.item_count, 0);
  const hitItems = sheetResults.reduce((acc, s) => acc + s.hit_items, 0);
  const totalKeywordHits = sheetResults.reduce((acc, s) => acc + s.total_keyword_hits, 0);
  const incidence = totalItems > 0 ? Number((hitItems / totalItems).toFixed(4)) : 0;
  const intensity = hitItems > 0 ? Number((totalKeywordHits / hitItems).toFixed(4)) : 0;
  const maxSheet = [...sheetResults].sort((a, b) => b.incidence - a.incidence)[0] || null;

  const label = chooseLabel(incidence, maxSheet ? maxSheet.incidence : 0, maxSheet ? maxSheet.hit_items : 0);

  return {
    model: "anchor_interval_items_v1",
    total_items: totalItems,
    hit_items: hitItems,
    incidence,
    intensity,
    total_keyword_hits: totalKeywordHits,
    max_sheet: maxSheet ? maxSheet.sheet : null,
    max_sheet_incidence: maxSheet ? maxSheet.incidence : 0,
    label,
    sheets: sheetResults.sort((a, b) => b.incidence - a.incidence)
  };
}

async function appendFeedback(feedbackPath, record) {
  await fsp.mkdir(path.dirname(feedbackPath), { recursive: true });
  await fsp.appendFile(feedbackPath, JSON.stringify(record) + "\n", "utf8");
}

function buildSuggestionsFromFeedback(feedbackRows) {
  const termStats = new Map();
  for (const r of feedbackRows) {
    const decision = String(r.decision || "").toLowerCase();
    if (!Array.isArray(r.candidate_terms_top)) continue;
    for (const t of r.candidate_terms_top) {
      const term = normalizeText(t.term || "");
      if (!term) continue;
      const prev = termStats.get(term) || { watch: 0, discard: 0 };
      if (decision === "watch" || decision === "confirmed_watch") prev.watch += 1;
      if (decision === "discard" || decision === "confirmed_discard") prev.discard += 1;
      termStats.set(term, prev);
    }
  }
  return Array.from(termStats.entries())
    .map(([term, s]) => ({
      term,
      watch_count: s.watch,
      discard_count: s.discard,
      watch_ratio: s.watch + s.discard > 0 ? Number((s.watch / (s.watch + s.discard)).toFixed(3)) : 0
    }))
    .filter((x) => x.watch_count >= 2 && x.watch_ratio >= 0.7)
    .sort((a, b) => b.watch_count - a.watch_count)
    .slice(0, 20);
}

async function analyzeBudgetFile(filePath, opts = {}) {
  const wb = opts.extracted && validateExtractData(opts.extracted)
    ? opts.extracted
    : extractWorkbookData(filePath, opts);
  const result = analyzeWorkbookData(wb, opts);
  return {
    file: filePath,
    analyzed_at: new Date().toISOString(),
    extracted_at: wb.extracted_at || null,
    extraction_limits: {
      max_rows: wb.max_rows || null,
      max_cols: wb.max_cols || null
    },
    ...result
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const file = args.file ? path.resolve(String(args.file)) : null;
  const extractInPath = args.extract_in ? path.resolve(String(args.extract_in)) : null;
  const extractOutPath = args.extract_out ? path.resolve(String(args.extract_out)) : null;
  const extractOnly = args.extract_only === "1";

  if (!file && !extractInPath) {
    throw new Error("Provide --file=<path> or --extract_in=<path-to-extracted-json>");
  }
  if (file && !fs.existsSync(file)) {
    throw new Error(`File not found: ${file}`);
  }
  if (extractInPath && !fs.existsSync(extractInPath)) {
    throw new Error(`extract_in not found: ${extractInPath}`);
  }

  const moduleDir = __dirname;
  let keywords = mergeKeywordFiles(moduleDir);
  if (!keywords.length) keywords = DEFAULT_KEYWORDS;

  if (args.keywords_file) {
    const kPath = path.resolve(String(args.keywords_file));
    const fromFile = JSON.parse(fs.readFileSync(kPath, "utf8").replace(/^\uFEFF/, ""));
    if (!Array.isArray(fromFile) || !fromFile.length) throw new Error("keywords_file must be a non-empty JSON array");
    keywords = fromFile.map(String);
  }

  let extracted = null;
  if (extractInPath) {
    const fromFile = JSON.parse(fs.readFileSync(extractInPath, "utf8").replace(/^\uFEFF/, ""));
    if (!validateExtractData(fromFile)) {
      throw new Error("extract_in JSON is invalid: expected object with sheets[]");
    }
    extracted = fromFile;
  } else {
    extracted = extractWorkbookData(file, { maxRows: args.max_rows, maxCols: args.max_cols });
  }

  if (extractOutPath) {
    await fsp.mkdir(path.dirname(extractOutPath), { recursive: true });
    await fsp.writeFile(extractOutPath, JSON.stringify(extracted, null, 2), "utf8");
  }

  if (extractOnly) {
    const extractSummary = {
      ok: true,
      mode: "extract_only",
      source_file: extracted.source_file || file || null,
      extracted_at: extracted.extracted_at || null,
      sheets: Array.isArray(extracted.sheets) ? extracted.sheets.length : 0,
      extract_out: extractOutPath || null
    };
    process.stdout.write(JSON.stringify(extractSummary, null, 2) + "\n");
    return;
  }

  const analysis = await analyzeBudgetFile(
    file || extracted.source_file || "extract_input",
    { keywords, extracted }
  );

  if (args.out) {
    const outPath = path.resolve(String(args.out));
    await fsp.mkdir(path.dirname(outPath), { recursive: true });
    await fsp.writeFile(outPath, JSON.stringify(analysis, null, 2), "utf8");
  }

  if (args.feedback_out && args.decision) {
    const feedbackRecord = {
      ts: new Date().toISOString(),
      file: analysis.file,
      decision: String(args.decision),
      label: analysis.label,
      incidence: analysis.incidence,
      max_sheet_incidence: analysis.max_sheet_incidence,
      candidate_terms_top: (analysis.sheets[0] && analysis.sheets[0].candidate_terms_top) || []
    };
    await appendFeedback(path.resolve(String(args.feedback_out)), feedbackRecord);
  }

  if (args.suggest_from) {
    const p = path.resolve(String(args.suggest_from));
    const lines = fs.existsSync(p)
      ? fs.readFileSync(p, "utf8").split(/\r?\n/).filter(Boolean)
      : [];
    const rows = lines.map((x) => {
      try {
        return JSON.parse(x);
      } catch {
        return null;
      }
    }).filter(Boolean);
    analysis.keyword_suggestions = buildSuggestionsFromFeedback(rows);
  }

  process.stdout.write(JSON.stringify(analysis, null, 2) + "\n");
}

if (require.main === module) {
  main().catch((e) => {
    console.error("[EOJN][L2][ERR]", e && e.stack ? e.stack : e);
    process.exit(1);
  });
}

module.exports = {
  analyzeBudgetFile,
  analyzeWorkbookData,
  buildSuggestionsFromFeedback
};
