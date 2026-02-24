"use strict";

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { analyzeBudgetFile } = require("../src/modules/eojn_v1/layer2_budget_scan");

function parseArgs(argv) {
  const out = {};
  for (const a of argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
    else if (a.startsWith("--")) out[a.slice(2)] = "1";
  }
  return out;
}

function toCsv(rows, headers) {
  const esc = (v) => {
    const s = String(v ?? "");
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, "\"\"")}"`;
    return s;
  };
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(headers.map((h) => esc(r[h])).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

async function pickFirstBudgetFile(dirPath) {
  const entries = await fsp.readdir(dirPath, { withFileTypes: true });
  const candidates = entries
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter((n) => /\.(xls|xlsx)$/i.test(n))
    .sort((a, b) => a.localeCompare(b));
  return candidates.length ? path.join(dirPath, candidates[0]) : null;
}

async function main() {
  const args = parseArgs(process.argv);
  const batchDir = path.resolve(args.batch_dir || "out/eojn_v1/_dev_budget_pw/2026_02_21");
  const keywordsPath = path.resolve(args.keywords_file || "src/modules/eojn_v1/keywords_l2_top24.json");

  if (!fs.existsSync(batchDir)) {
    throw new Error(`Batch dir not found: ${batchDir}`);
  }
  if (!fs.existsSync(keywordsPath)) {
    throw new Error(`Keywords file not found: ${keywordsPath}`);
  }

  const keywords = JSON.parse(fs.readFileSync(keywordsPath, "utf8").replace(/^\uFEFF/, ""));
  if (!Array.isArray(keywords) || !keywords.length) {
    throw new Error("keywords_file must be a non-empty JSON array");
  }

  const dirs = (await fsp.readdir(batchDir, { withFileTypes: true }))
    .filter((d) => d.isDirectory() && /^tender_\d+$/i.test(d.name))
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b));

  const results = [];

  for (const d of dirs) {
    const tenderId = Number(d.replace("tender_", ""));
    const tenderDir = path.join(batchDir, d);
    const file = await pickFirstBudgetFile(tenderDir);
    if (!file) {
      results.push({
        tender_id: tenderId,
        file: "",
        label: "NO_FILE",
        total_items: 0,
        hit_items: 0,
        incidence: 0,
        intensity: 0,
        max_sheet: "",
        max_sheet_incidence: 0
      });
      continue;
    }

    const a = await analyzeBudgetFile(file, { keywords });
    results.push({
      tender_id: tenderId,
      file: file,
      label: a.label,
      total_items: a.total_items,
      hit_items: a.hit_items,
      incidence: a.incidence,
      intensity: a.intensity,
      max_sheet: a.max_sheet,
      max_sheet_incidence: a.max_sheet_incidence
    });
  }

  const summary = {
    generated_at: new Date().toISOString(),
    batch_dir: batchDir,
    keywords_file: keywordsPath,
    keywords_count: keywords.length,
    processed_tenders: results.length,
    high_interest: results.filter((r) => r.label === "HIGH_INTEREST").length,
    review: results.filter((r) => r.label === "REVIEW").length,
    low_interest: results.filter((r) => r.label === "LOW_INTEREST").length,
    no_file: results.filter((r) => r.label === "NO_FILE").length,
    results
  };

  const jsonOut = path.join(batchDir, "l2_smoke_5fold_result.json");
  const csvOut = path.join(batchDir, "l2_smoke_5fold_result.csv");

  await fsp.writeFile(jsonOut, JSON.stringify(summary, null, 2), "utf8");
  await fsp.writeFile(
    csvOut,
    toCsv(results, [
      "tender_id",
      "file",
      "label",
      "total_items",
      "hit_items",
      "incidence",
      "intensity",
      "max_sheet",
      "max_sheet_incidence"
    ]),
    "utf8"
  );

  process.stdout.write(JSON.stringify({ ok: true, json: jsonOut, csv: csvOut, summary: {
    processed_tenders: summary.processed_tenders,
    high_interest: summary.high_interest,
    review: summary.review,
    low_interest: summary.low_interest,
    no_file: summary.no_file
  }}, null, 2) + "\n");
}

main().catch((e) => {
  console.error("[EOJN][L2_SMOKE][ERR]", e && e.stack ? e.stack : e);
  process.exit(1);
});
