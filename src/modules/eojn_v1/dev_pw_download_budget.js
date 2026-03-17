"use strict";

const path = require("path");
const {
  downloadBudgetFilesForTenders
} = require("../../core_shell/services/eojn_budget_download_service");

function parseArgs(argv) {
  const out = {};
  for (const item of argv.slice(2)) {
    const match = item.match(/^--([^=]+)=(.*)$/);
    if (match) out[match[1]] = match[2];
    else if (item.startsWith("--")) out[item.slice(2)] = "1";
  }
  return out;
}

function parseTenderIds(args) {
  const raw = [];
  if (args.tender) raw.push(args.tender);
  if (args.tenders) raw.push(...String(args.tenders).split(/[;,\s]+/g));
  return Array.from(new Set(raw
    .map((value) => Number(String(value || "").trim()))
    .filter((value) => Number.isFinite(value) && value > 0)));
}

async function main() {
  const args = parseArgs(process.argv);
  const tenderIds = parseTenderIds(args);
  if (!tenderIds.length) {
    throw new Error("Missing tender IDs. Use --tender=<id> or --tenders=74455,74552,...");
  }

  const runDate = new Date();
  const runTag = `${runDate.getFullYear()}_${String(runDate.getMonth() + 1).padStart(2, "0")}_${String(runDate.getDate()).padStart(2, "0")}`;
  const outRoot = path.resolve(process.cwd(), "out", "eojn_v1", "_dev_budget_pw", runTag);
  const report = await downloadBudgetFilesForTenders({
    tenderIds,
    configPath: args.config || "",
    outRoot,
    fresh: args.fresh === "1",
    headed: args.headed === "1",
    onProgress: ({ stage, message }) => {
      if (!message) return;
      process.stdout.write(`[EOJN][PW][${String(stage || "INF").toUpperCase()}] ${message}\n`);
    }
  });

  process.stdout.write(JSON.stringify({
    ok: report.okCount,
    fail: report.failCount,
    reportPath: report.reportPath
  }, null, 2) + "\n");

  if (report.failCount > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("[EOJN][PW][ERR]", err && err.stack ? err.stack : err);
  process.exit(1);
});
