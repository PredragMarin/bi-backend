"use strict";

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const {
  extractWorkbookMatrix,
  isSupportedWorkbookFile
} = require("../../core_shell/services/workbook_ingest_service");

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

function normalizeCompact(input) {
  return normalizeText(input).replace(/[^a-z0-9]/g, "");
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

function isUnitLike(raw, uomSet) {
  const norm = normalizeText(raw);
  const compact = normalizeCompact(raw);
  if (!norm) return false;
  if (uomSet.has(norm)) return true;

  const meterFamily =
    compact === "m" ||
    compact === "m1" ||
    compact.startsWith("met");
  if (meterFamily) return true;

  const squareMeterFamily =
    compact === "m2" ||
    compact === "mq" ||
    compact.startsWith("mkv");
  if (squareMeterFamily) return true;

  const cubicMeterFamily =
    compact === "m3" ||
    compact.startsWith("mkub");
  if (cubicMeterFamily) return true;

  const literFamily =
    compact === "l" ||
    compact === "lt" ||
    compact.startsWith("lit");
  if (literFamily) return true;

  const completeFamily =
    compact === "kpl" ||
    compact === "kmpl" ||
    compact.startsWith("komp") ||
    compact.startsWith("kompl") ||
    compact.startsWith("komplet");
  if (completeFamily) return true;

  if (/^m([.'l]|1)*$/.test(norm)) return true;
  if (/^m[.\s']*2$/.test(norm)) return true;
  if (/^m[.\s']*3$/.test(norm)) return true;
  if (/^m[.\s]*kv/.test(norm)) return true;
  if (/^m[.\s]*q$/.test(norm)) return true;
  if (/^lit(ar|ra)?$/.test(compact)) return true;
  if (/^komplet(a|i|no)?$/.test(compact)) return true;
  if (/^komp(l|let|leta)?$/.test(compact)) return true;
  return false;
}

function validateExtractData(data) {
  return !!(data && Array.isArray(data.sheets));
}

function extractWorkbookData(filePath, opts = {}) {
  const maxRows = Number(opts.maxRows || 6000);
  const maxCols = Number(opts.maxCols || 80);
  if (!isSupportedWorkbookFile(filePath)) {
    throw new Error(`Unsupported workbook format for Node ingest: ${path.extname(String(filePath || "")) || "(none)"}`);
  }
  return extractWorkbookMatrix({ filePath, maxRows, maxCols });
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

function detectUomColumn(rows, uomSet) {
  if (!rows || rows.length < 2) return null;
  const colCount = rows[0].length;
  let bestCol = null;
  let bestScore = -1e9;

  for (let c = 0; c < colCount; c++) {
    let uomHits = 0;
    let nonEmpty = 0;
    for (let r = 1; r < rows.length; r++) {
      const raw = String(rows[r][c] || "").trim();
      if (!raw) continue;
      nonEmpty += 1;
      if (isUnitLike(raw, uomSet)) uomHits += 1;
    }
    if (!nonEmpty) continue;
    const sparsityPenalty = Math.abs(nonEmpty - uomHits) * 0.2;
    const score = uomHits * 3 - sparsityPenalty;
    if (score > bestScore) {
      bestScore = score;
      bestCol = c;
    }
  }
  return bestCol;
}

function collectUomRows(rows, uomCol, uomSet) {
  const anchors = [];
  if (uomCol === null || uomCol === undefined) return anchors;
  for (let r = 1; r < rows.length; r++) {
    const raw = String(rows[r][uomCol] || "").trim();
    if (!raw) continue;
    if (isUnitLike(raw, uomSet)) anchors.push(r);
  }
  return uniq(anchors).sort((a, b) => a - b);
}

function hasNumericInRow(row) {
  return (row || []).some((cell) => isNumericLike(String(cell || "").trim()));
}

function detectDescriptionColumnForUomAnchors(rows, uomRows, uomCol) {
  if (!rows || rows.length < 2 || !uomRows.length) return null;
  const colCount = rows[0].length;
  let bestCol = null;
  let bestScore = -1e9;

  for (let c = 0; c < colCount; c++) {
    if (c === uomCol) continue;
    let textHits = 0;
    let textChars = 0;
    let numericPenalty = 0;

    for (const anchorRow of uomRows) {
      for (let offset = -2; offset <= 2; offset++) {
        const r = anchorRow + offset;
        if (r < 1 || r >= rows.length) continue;
        const v = String(rows[r][c] || "").trim();
        if (!v) continue;
        if (isNumericLike(v)) {
          numericPenalty += 2;
          continue;
        }
        if (hasLetters(v)) {
          const weight = offset === 0 ? 3 : (Math.abs(offset) === 1 ? 2 : 1);
          textHits += weight;
          textChars += Math.min(v.length, 120);
        }
      }
    }

    const score = textHits * 4 + textChars * 0.05 - numericPenalty;
    if (score > bestScore) {
      bestScore = score;
      bestCol = c;
    }
  }

  return bestCol;
}

function assignDescriptionRowsToAnchors(rows, descCol, uomRows) {
  const assigned = new Map();
  for (const anchor of uomRows) assigned.set(anchor, []);
  if (descCol === null || descCol === undefined) return assigned;
  if (!Array.isArray(uomRows) || uomRows.length === 0) return assigned;

  const edgeLimit = 10;
  const windows = uomRows.map((anchor, index) => {
    const prev = index > 0 ? uomRows[index - 1] : null;
    const next = index < uomRows.length - 1 ? uomRows[index + 1] : null;
    const start = prev === null ? Math.max(1, anchor - edgeLimit) : prev + 1;
    const end = next === null ? Math.min(rows.length - 1, anchor + edgeLimit) : next - 1;
    return { anchor, start, end };
  });

  for (let r = 1; r < rows.length; r++) {
    const text = String(rows[r][descCol] || "").trim();
    if (!text || isNumericLike(text) || text.length < 3) continue;
    for (const win of windows) {
      if (r >= win.start && r <= win.end) {
        assigned.get(win.anchor).push({ row: r, text });
        break;
      }
    }
  }

  for (const [anchor, arr] of assigned.entries()) {
    arr.sort((a, b) => a.row - b.row);
    assigned.set(anchor, arr);
  }
  return assigned;
}

function scanTerms(textNorm, termsNorm) {
  const matched = [];
  for (const term of termsNorm) {
    if (textNorm.includes(term)) matched.push(term);
  }
  return matched;
}

function extractCandidateTerms(blocks, excludedTermsNorm) {
  const counts = new Map();
  const excludedSet = new Set(excludedTermsNorm);
  for (const b of blocks) {
    const words = normalizeText(b.text)
      .split(/[^a-z0-9]+/g)
      .filter((w) => w && w.length >= 4 && !DEFAULT_STOP.has(w));
    for (const w of words) {
      if (excludedSet.has(w)) continue;
      counts.set(w, (counts.get(w) || 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([term, count]) => ({ term, count }));
}

function extractSheet(rows, sheetName, uomSet) {
  const uomCol = detectUomColumn(rows, uomSet);
  const uomRows = collectUomRows(rows, uomCol, uomSet);
  if (uomCol === null || uomRows.length < 2) {
    return {
      sheet: sheetName,
      mode: "non_bill_sheet",
      desc_col: null,
      anchor_col: null,
      blocks: [],
      anchor_rows: [],
      item_count: 0,
      candidate_terms_top: []
    };
  }

  const descCol = detectDescriptionColumnForUomAnchors(rows, uomRows, uomCol);
  if (descCol === null) {
    return {
      sheet: sheetName,
      mode: "uom_without_desc",
      desc_col: null,
      anchor_col: uomCol + 1,
      blocks: [],
      anchor_rows: [],
      item_count: 0,
      candidate_terms_top: []
    };
  }

  const assignedDesc = assignDescriptionRowsToAnchors(rows, descCol, uomRows);
  const blocks = [];
  const anchorRowsOut = [];

  for (const anchor of uomRows) {
    const descParts = assignedDesc.get(anchor) || [];
    const text = descParts.map((x) => x.text).join(" ").trim();
    if (!text || text.length < 3) continue;
    if (!hasNumericInRow(rows[anchor] || [])) continue;
    const startRow = descParts.length ? Math.min(anchor, descParts[0].row) : anchor;
    const endRow = descParts.length ? Math.max(anchor, descParts[descParts.length - 1].row) : anchor;
    anchorRowsOut.push({
      row: anchor + 1,
      uom: String(rows[anchor][uomCol] || "").trim(),
      start_row: startRow + 1,
      end_row: endRow + 1
    });
    blocks.push({ start_row: startRow + 1, end_row: endRow + 1, text });
  }

  return {
    sheet: sheetName,
    mode: "uom_anchor_rows_v2",
    desc_col: descCol + 1,
    anchor_col: uomCol + 1,
    blocks,
    item_count: blocks.length,
    anchor_rows: anchorRowsOut,
    candidate_terms_top: []
  };
}

function chooseLabel(globalIncidence, maxSheetIncidence, maxSheetHits, rules = {}) {
  const high = rules.high_interest || {};
  const review = rules.review || {};
  if (
    maxSheetIncidence >= Number(high.max_sheet_incidence_gte || 0.3) &&
    maxSheetHits >= Number(high.max_sheet_hits_gte || 8)
  ) return "HIGH_INTEREST";
  if (
    globalIncidence >= Number(review.global_incidence_gte || 0.15) ||
    maxSheetIncidence >= Number(review.max_sheet_incidence_gte || 0.15)
  ) return "REVIEW";
  return "LOW_INTEREST";
}

function loadUseCaseProfiles(moduleDir) {
  const p = path.join(moduleDir, "contracts", "layer2_use_case_profiles.json");
  if (!fs.existsSync(p)) return [];
  const json = JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
  const items = Array.isArray(json && json.items) ? json.items : [];
  return items.map((item) => ({
    id: String(item && item.id || "").trim(),
    label: String(item && item.label || "").trim(),
    scoring_mode: String(item && item.scoring_mode || "strong_only").trim(),
    strong_keywords: uniq((Array.isArray(item && item.strong_keywords) ? item.strong_keywords : []).map(normalizeText).filter(Boolean)),
    support_keywords: uniq((Array.isArray(item && item.support_keywords) ? item.support_keywords : []).map(normalizeText).filter(Boolean)),
    label_rules: item && item.label_rules ? item.label_rules : {}
  })).filter((item) => item.id && item.strong_keywords.length);
}

function evaluateBlocksForProfile(blocks, profile) {
  const strongTerms = Array.isArray(profile && profile.strong_keywords) ? profile.strong_keywords : [];
  const supportTerms = Array.isArray(profile && profile.support_keywords) ? profile.support_keywords : [];
  const excludedTerms = uniq([...strongTerms, ...supportTerms]);
  let itemCount = 0;
  let hitItems = 0;
  let totalHits = 0;
  const keywordFreq = {};
  for (const block of blocks || []) {
    const norm = normalizeText(block.text);
    if (!norm) continue;
    itemCount += 1;
    const strongMatched = scanTerms(norm, strongTerms);
    const supportMatched = scanTerms(norm, supportTerms);
    const matched = String(profile && profile.scoring_mode || "strong_only") === "strong_only"
      ? strongMatched
      : uniq([...strongMatched, ...supportMatched]);
    if (!matched.length) continue;
    hitItems += 1;
    totalHits += matched.length;
    for (const term of matched) keywordFreq[term] = (keywordFreq[term] || 0) + 1;
  }
  return {
    item_count: itemCount,
    hit_items: hitItems,
    incidence: itemCount > 0 ? Number((hitItems / itemCount).toFixed(4)) : 0,
    intensity: hitItems > 0 ? Number((totalHits / hitItems).toFixed(4)) : 0,
    total_keyword_hits: totalHits,
    keyword_frequency: keywordFreq,
    candidate_terms_top: extractCandidateTerms(blocks || [], excludedTerms)
  };
}

function analyzeWorkbookData(workbook, opts = {}) {
  const useCaseProfiles = Array.isArray(opts.use_case_profiles) && opts.use_case_profiles.length
    ? opts.use_case_profiles
    : [{
        id: "target_fitout",
        label: "Default target fitout",
        scoring_mode: "strong_only",
        strong_keywords: uniq(DEFAULT_KEYWORDS.map(normalizeText).filter(Boolean)),
        support_keywords: [],
        label_rules: {}
      }];
  const primaryProfileId = String(opts.primary_profile_id || useCaseProfiles[0].id || "target_fitout").trim();
  const uomSet = new Set((opts.uom || DEFAULT_UOM).map(normalizeText));
  const extractedSheets = workbook.sheets.map((s) => extractSheet(s.rows || [], s.name || "Sheet", uomSet));

  const profiles = useCaseProfiles.map((profile) => {
    const sheetResults = extractedSheets.map((sheet) => {
      const scored = evaluateBlocksForProfile(sheet.blocks || [], profile);
      return {
        sheet: sheet.sheet,
        mode: sheet.mode,
        desc_col: sheet.desc_col,
        anchor_col: sheet.anchor_col,
        item_count: scored.item_count,
        hit_items: scored.hit_items,
        incidence: scored.incidence,
        intensity: scored.intensity,
        total_keyword_hits: scored.total_keyword_hits,
        keyword_frequency: scored.keyword_frequency,
        anchor_rows: sheet.anchor_rows || [],
        candidate_terms_top: scored.candidate_terms_top
      };
    });
    const totalItems = sheetResults.reduce((acc, s) => acc + s.item_count, 0);
    const hitItems = sheetResults.reduce((acc, s) => acc + s.hit_items, 0);
    const totalKeywordHits = sheetResults.reduce((acc, s) => acc + s.total_keyword_hits, 0);
    const incidence = totalItems > 0 ? Number((hitItems / totalItems).toFixed(4)) : 0;
    const intensity = hitItems > 0 ? Number((totalKeywordHits / hitItems).toFixed(4)) : 0;
    const maxSheet = [...sheetResults].sort((a, b) => b.incidence - a.incidence)[0] || null;
    return {
      profile_id: profile.id,
      label_name: profile.label,
      total_items: totalItems,
      hit_items: hitItems,
      incidence,
      intensity,
      total_keyword_hits: totalKeywordHits,
      max_sheet: maxSheet ? maxSheet.sheet : null,
      max_sheet_incidence: maxSheet ? maxSheet.incidence : 0,
      label: chooseLabel(incidence, maxSheet ? maxSheet.incidence : 0, maxSheet ? maxSheet.hit_items : 0, profile.label_rules || {}),
      sheets: sheetResults.sort((a, b) => b.incidence - a.incidence)
    };
  });

  const primary = profiles.find((p) => p.profile_id === primaryProfileId) || profiles[0];
  return {
    model: "uom_anchor_items_v2",
    primary_profile_id: primary ? primary.profile_id : primaryProfileId,
    total_items: primary ? primary.total_items : 0,
    hit_items: primary ? primary.hit_items : 0,
    incidence: primary ? primary.incidence : 0,
    intensity: primary ? primary.intensity : 0,
    total_keyword_hits: primary ? primary.total_keyword_hits : 0,
    max_sheet: primary ? primary.max_sheet : null,
    max_sheet_incidence: primary ? primary.max_sheet_incidence : 0,
    label: primary ? primary.label : "LOW_INTEREST",
    sheets: primary ? primary.sheets : [],
    profiles
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
  let useCaseProfiles = loadUseCaseProfiles(moduleDir);
  if (!useCaseProfiles.length) {
    useCaseProfiles = [{
      id: "target_fitout",
      label: "Default target fitout",
      scoring_mode: "strong_only",
      strong_keywords: uniq(DEFAULT_KEYWORDS.map(normalizeText).filter(Boolean)),
      support_keywords: [],
      label_rules: {}
    }];
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
    {
      extracted,
      use_case_profiles: useCaseProfiles,
      primary_profile_id: String(args.primary_profile || "target_fitout")
    }
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
