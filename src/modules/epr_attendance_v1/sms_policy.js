// src/modules/epr_attendance_v1/sms_policy.js
const crypto = require("crypto");

function sha256(s) {
  return crypto.createHash("sha256").update(String(s || ""), "utf8").digest("hex");
}

function norm(s) { return String(s || "").trim(); }
function upper(s) { return norm(s).toUpperCase(); }
function isISODateStr(s) { return /^\d{4}-\d{2}-\d{2}$/.test(norm(s)); }

function toISODateAny(work_date) {
  const t = String(work_date || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  const m2 = t.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (m2) return `${m2[3]}-${m2[2]}-${m2[1]}`;
  return t;
}

function isoToDmyDash(iso) {
  const x = toISODateAny(iso);
  const m = x.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return x;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function isoToHrDayLabel(iso) {
  // "Pon 12-01-2026"
  const x = toISODateAny(iso);
  const d = new Date(x + "T00:00:00");
  const dow = d.getDay(); // 0=Sun ... 6=Sat
  const map = ["Ned", "Pon", "Uto", "Sri", "Čet", "Pet", "Sub"];
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${map[dow]} ${dd}-${mm}-${yyyy}`;
}

function isoWeekKey(isoDate) {
  // ISO week in UTC
  const x = toISODateAny(isoDate);
  const d = new Date(x + "T00:00:00Z");
  const dayNum = (d.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // Thursday
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const weekNo = 1 + Math.round((d - firstThursday) / (7 * 24 * 3600 * 1000));
  const year = d.getUTCFullYear();
  return `${year}-W${String(weekNo).padStart(2, "0")}`;
}

// --- keys ---
function makeIssueKeyMissing(a, ctx) {
  const useCase = ctx.use_case || "epr_attendance_v1";
  const osebid = norm(a.osebid);
  const workDate = toISODateAny(a.work_date);
  const actionType = upper(a.action_type);
  const reason = "MISSING_DAY";
  const rules = ctx.rules_version || ctx.contract_version || "v";
  return `${useCase}|${osebid}|${workDate}|${actionType}|${reason}|${rules}`;
}

function makeIssueKeyGeneric(a, ctx, reasonCode) {
  const useCase = ctx.use_case || "epr_attendance_v1";
  const osebid = norm(a.osebid);
  const workDate = toISODateAny(a.work_date);
  const actionType = upper(a.action_type);
  const reason = String(reasonCode || "").trim() || "REVIEW";
  const rules = ctx.rules_version || ctx.contract_version || "v";
  return `${useCase}|${osebid}|${workDate}|${actionType}|${reason}|${rules}`;
}

function makeSmsKeyForWeek(osebid, weekKey, ctx) {
  const useCase = ctx.use_case || "epr_attendance_v1";
  const templateV = ctx.sms_template_version || "v1";
  const rules = ctx.rules_version || ctx.contract_version || "v";
  return `${useCase}|${osebid}|MISSING_WEEK|${weekKey}|${templateV}|${rules}`;
}

function makeSmsKeyForIssue(osebid, workDateIso, code, ctx) {
  const useCase = ctx.use_case || "epr_attendance_v1";
  const templateV = ctx.sms_template_version || "v1";
  const rules = ctx.rules_version || ctx.contract_version || "v";
  const dt = toISODateAny(workDateIso);
  return `${useCase}|${osebid}|${code}|${dt}|${templateV}|${rules}`;
}

// --- templates ---
function renderMissingWeekSmsText(bundle) {
  const fullName = `${norm(bundle.priimek)} ${norm(bundle.ime)}`.trim() || "zaposleniče/zaposlenice";
  const daysList = (bundle.work_dates || []).map(isoToHrDayLabel).join(", ");

  return (
    `Poštovani/a ${fullName}, u ${daysList} niste imali registraciju ulaza/izlaza. ` +
    `Molimo vaše objašnjenje (Bolovanje, Rad od kuće, Godišnji odmor) u odgovoru na ovu poruku. ` +
    `Poruka je automatski generirana u Marin Expert BI EPR.`
  );
}

function renderSuspiciousShortSmsText(a) {
  const fullName = `${norm(a.priimek)} ${norm(a.ime)}`.trim() || "zaposleniče/zaposlenice";
  const dt = isoToDmyDash(a.work_date);

  return (
    `Poštovani/a ${fullName}, za ${dt} evidentiran je vrlo kratak zapis ulaza/izlaza. ` +
    `Molimo kratko pojašnjenje u odgovoru (npr. "scan nije očitan ujutro", "zaboravio evidentirati", "rad od kuće", "drugo"). ` +
    `Poruka je automatski generirana u Marin Expert BI EPR.`
  );
}

function hasReasonCode(a, code) {
  const rc = String(a?.reason_codes || "");
  return rc.split("|").map(s => s.trim()).includes(code);
}

// --- bundling (missing only, per ISO week) ---
function bundleMissingActions(actionsRows, ctx) {
  const miss = (actionsRows || []).filter(a => upper(a.action_type) === "MISSING_ATTENDANCE_DAY");

  const bundlesByKey = new Map(); // osebid|weekKey -> bundle

  for (const a of miss) {
    const osebid = norm(a.osebid);
    const wd = toISODateAny(a.work_date);
    if (!osebid || !isISODateStr(wd)) continue;

    const issue_key = a.issue_key || makeIssueKeyMissing(a, ctx);
    const weekKey = isoWeekKey(wd);
    const key = `${osebid}|${weekKey}`;

    if (!bundlesByKey.has(key)) {
      bundlesByKey.set(key, {
        osebid,
        week_key: weekKey,
        group_code: norm(a.group_code),
        priimek: norm(a.priimek),
        ime: norm(a.ime),
        tel_gsm: norm(a.tel_gsm),
        work_dates: [],
        issue_keys: []
      });
    }

    const b = bundlesByKey.get(key);
    b.work_dates.push(wd);
    b.issue_keys.push(issue_key);

    if (!b.tel_gsm) b.tel_gsm = norm(a.tel_gsm);
    if (!b.group_code) b.group_code = norm(a.group_code);
    if (!b.ime) b.ime = norm(a.ime);
    if (!b.priimek) b.priimek = norm(a.priimek);
  }

  const bundles = Array.from(bundlesByKey.values());
  for (const b of bundles) {
    b.work_dates.sort((x, y) => x.localeCompare(y));
    b.issue_keys = Array.from(new Set(b.issue_keys));
    b.sms_key = makeSmsKeyForWeek(b.osebid, b.week_key, ctx);
  }

  bundles.sort((a, b) =>
    String(a.group_code || "").localeCompare(String(b.group_code || ""), "hr", { sensitivity: "base" }) ||
    Number(a.osebid || 0) - Number(b.osebid || 0) ||
    String(a.week_key || "").localeCompare(String(b.week_key || ""))
  );

  return bundles;
}

module.exports = {
  // basic
  sha256, norm, upper, isISODateStr, toISODateAny, isoToDmyDash,

  // keys + policy
  makeIssueKeyMissing, makeIssueKeyGeneric,
  makeSmsKeyForWeek, makeSmsKeyForIssue,
  hasReasonCode,

  // templates
  renderMissingWeekSmsText, renderSuspiciousShortSmsText,

  // bundling
  bundleMissingActions
};
