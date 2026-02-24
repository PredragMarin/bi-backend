// _poc/erp_gateway_smoke/erp_smoke_select_min.js
// Minimalni smoke test kroz mini gateway contract

const fs = require("fs");
const path = require("path");
const { runAllowedQuery } = require("./erp_gateway_runner");

function pad2(n) {
  return String(n).padStart(2, "0");
}

function ymdUnderscore(d) {
  return `${d.getFullYear()}_${pad2(d.getMonth() + 1)}_${pad2(d.getDate())}`;
}

function csvEscape(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function rowsToCsv(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function makeRequestId() {
  const t = new Date();
  return `erp_smoke_${t.getTime()}`;
}

async function main() {
  const moduleId = String(process.env.ERP_MODULE_ID || "erp_gateway_poc").trim();
  const queryId = String(process.env.ERP_SMOKE_QUERY_ID || "SMOKE_HEALTH").trim().toUpperCase();
  const requestId = process.env.ERP_REQUEST_ID || makeRequestId();

  const outDir = path.join(process.cwd(), "out", "erp_smoke", ymdUnderscore(new Date()));
  fs.mkdirSync(outDir, { recursive: true });

  const csvPath = path.join(outDir, "smoke_result.csv");
  const manifestPath = path.join(outDir, "smoke_manifest.json");

  const res = await runAllowedQuery({
    moduleId,
    queryId,
    params: [],
    requestId
  });

  if (res.ok) {
    fs.writeFileSync(csvPath, rowsToCsv(res.rows), "utf8");
    const manifest = {
      ok: true,
      generated_at: new Date().toISOString(),
      output_csv: path.relative(process.cwd(), csvPath),
      ...res.audit
    };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
    console.log("SMOKE_OK", manifest);
    return;
  }

  const fail = {
    ok: false,
    generated_at: new Date().toISOString(),
    ...res.audit
  };
  fs.writeFileSync(manifestPath, JSON.stringify(fail, null, 2), "utf8");
  console.error("SMOKE_FAIL", fail);
  process.exitCode = 1;
}

main();
