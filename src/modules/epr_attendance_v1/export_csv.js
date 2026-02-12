// src/modules/epr_attendance_v1/export_csv.js
const fs = require("fs");
const path = require("path");

const { runUseCase } = require("../../core/runtime");

// Excel (HR/DE) često bolje radi sa ';' delimiterom
const DEFAULT_DELIM = ";";

// ---------- CSV helpers ----------
function bomUtf8(s) {
  // Excel often needs BOM to recognize UTF-8 correctly
  return "\uFEFF" + s;
}

function csvEscape(value, delim) {
  if (value === null || value === undefined) return "";
  const s = String(value);

  // escape if contains delimiter, quotes, or newline
  const mustQuote =
    s.includes(delim) || s.includes('"') || s.includes("\n") || s.includes("\r");

  if (!mustQuote) return s;

  // double quotes inside quoted string
  return `"${s.replace(/"/g, '""')}"`;
}

function buildHeaderUnion(rows, preferredOrder = []) {
  const set = new Set();
  for (const r of rows) {
    if (r && typeof r === "object") {
      Object.keys(r).forEach(k => set.add(k));
    }
  }
  const all = Array.from(set);

  // Keep preferred keys first (if they exist), then the rest sorted
  const pref = preferredOrder.filter(k => set.has(k));
  const rest = all.filter(k => !pref.includes(k)).sort((a, b) => a.localeCompare(b));
  return [...pref, ...rest];
}

function toCsv(rows, { delim = DEFAULT_DELIM, header = null } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return ";\n"; // minimal empty CSV
  }

  const hdr = header || buildHeaderUnion(rows);
  const lines = [];

  lines.push(hdr.map(k => csvEscape(k, delim)).join(delim));

  for (const r of rows) {
    const line = hdr.map(k => csvEscape(r?.[k], delim)).join(delim);
    lines.push(line);
  }

  return lines.join("\r\n") + "\r\n";
}

// ---------- recap_lines flattening ----------
function flattenRecapLines(recapLines) {
  if (!Array.isArray(recapLines)) return [];
  return recapLines.map((r, idx) => ({
    line_no: idx + 1,
    severity: r?.severity ?? "",
    text: r?.text ?? "",
    metric: r?.metrics_hint?.metric ?? "",
    value: r?.metrics_hint?.value ?? ""
  }));
}

// ---------- main ----------
async function main() {
  // usage:
  // node src/modules/epr_attendance_v1/export_csv.js --input <fixture.json> [--outdir <dir>] [--delim ,]
  const args = process.argv.slice(2);
  const getArg = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : null;
  };

  const input = getArg("--input");
  const outdirArg = getArg("--outdir");
  const delim = getArg("--delim") || DEFAULT_DELIM;

  if (!input) {
    console.error("Missing --input <path_to_fixture.json>");
    process.exit(1);
  }

  const absInput = path.resolve(process.cwd(), input);
  if (!fs.existsSync(absInput)) {
    console.error("Input file not found:", absInput);
    process.exit(1);
  }

  const outdir = outdirArg
    ? path.resolve(process.cwd(), outdirArg)
    : path.resolve(__dirname, "_csv");

  fs.mkdirSync(outdir, { recursive: true });

  const raw = fs.readFileSync(absInput, "utf8");
  const req = JSON.parse(raw);

  // runUseCase expects core contract-ish object; this is what your fixtures already are
  const result = await runUseCase(req);

  const daily = Array.isArray(result.daily_summary) ? result.daily_summary : [];
  const period = Array.isArray(result.period_summary) ? result.period_summary : [];
  const recap = flattenRecapLines(result.recap_lines);

  // Prefer stable/meaningful columns first (others will follow alphabetically)
  const dailyHeader = [
    "osebid", "work_date",
    "is_workday", "is_holiday",
    "interval_count",
    "total_presence_minutes_raw", "total_work_minutes", "overtime_work_minutes",
    "late_debt_minutes",
    "total_late_minutes_raw", "total_late_minutes_normalized",
    "total_early_leave_minutes_raw", "total_early_leave_minutes_normalized",
    "early_overtime_minutes", "after_shift_minutes",
    "has_kasnjenje_raniji_izlaz",
    "missing_attendance_day", "needs_action", "needs_review",
    "attendance_origin", "attendance_reason", "daily_notes"
  ];

  const periodHeader = [
    "osebid",
    "period_from", "period_to",
    "workdays_count",
    "total_presence_minutes_raw", "total_work_minutes", "total_overtime_work_minutes",
    "total_late_debt_minutes",
    "overtime_payable_150_minutes", "uncovered_debt_minutes",
    "total_late_minutes_raw", "total_late_minutes_normalized",
    "total_early_leave_minutes_raw", "total_early_leave_minutes_normalized",
    "days_with_kasnjenje_raniji_izlaz",
    "missing_attendance_days_count",
    "open_intervals_count",
    "needs_review_count",
    "period_notes"
  ];

  const recapHeader = ["line_no", "severity", "text", "metric", "value"];

  const baseName = path.basename(absInput, ".json");
  const dailyPath = path.join(outdir, `${baseName}.daily_summary.csv`);
  const periodPath = path.join(outdir, `${baseName}.period_summary.csv`);
  const recapPath = path.join(outdir, `${baseName}.recap_lines.csv`);

  fs.writeFileSync(dailyPath, bomUtf8(toCsv(daily, { delim, header: buildHeaderUnion(daily, dailyHeader) })), "utf8");
  fs.writeFileSync(periodPath, bomUtf8(toCsv(period, { delim, header: buildHeaderUnion(period, periodHeader) })), "utf8");
  fs.writeFileSync(recapPath, bomUtf8(toCsv(recap, { delim, header: recapHeader })), "utf8");

  console.log("WRITE", dailyPath);
  console.log("WRITE", periodPath);
  console.log("WRITE", recapPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
