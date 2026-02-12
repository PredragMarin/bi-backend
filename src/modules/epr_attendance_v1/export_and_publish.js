// src/modules/epr_attendance_v1/export_and_publish.js
const fs = require("fs");
const path = require("path");

// SMS ledger (core infra)
const { appendEvent, getLastEventType } = require("../../core/sms_ledger");

// SMS policy (module-level, isolated)
const smsPolicy = require("./sms_policy");
const {
  // basics
  sha256, norm, upper, isISODateStr, toISODateAny, isoToDmyDash,

  // keys/policy
  makeIssueKeyMissing, makeIssueKeyGeneric,
  makeSmsKeyForIssue,
  hasReasonCode,
  bundleMissingActions,

  // templates
  renderMissingWeekSmsText,
  renderSuspiciousShortSmsText
} = smsPolicy;

const DEFAULT_DELIM = ";";

// ---------------- CSV helpers (self-contained) ----------------
function csvEscape(value, delim) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  const mustQuote = s.includes(delim) || s.includes('"') || s.includes("\n") || s.includes("\r");
  return mustQuote ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildHeaderUnion(rows, preferredOrder = []) {
  const set = new Set();
  for (const r of rows) {
    if (r && typeof r === "object") Object.keys(r).forEach(k => set.add(k));
  }
  const all = Array.from(set);
  const pref = preferredOrder.filter(k => set.has(k));
  const rest = all.filter(k => !pref.includes(k)).sort((a, b) => a.localeCompare(b));
  return [...pref, ...rest];
}

function toCsv(rows, { delim = DEFAULT_DELIM, header = null } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return "\r\n";
  const hdr = header || buildHeaderUnion(rows);
  const lines = [];
  lines.push(hdr.map(k => csvEscape(k, delim)).join(delim));
  for (const r of rows) {
    lines.push(hdr.map(k => csvEscape(r?.[k], delim)).join(delim));
  }
  return lines.join("\r\n") + "\r\n";
}

function writeCsvExcel(filePath, csvText) {
  const normalized = String(csvText).replace(/\r?\n/g, "\r\n");
  // UTF-8 + BOM (Excel kompatibilno)
  fs.writeFileSync(filePath, "\uFEFF" + normalized, { encoding: "utf8" });
}

function minutesToHours2(min) {
  const x = Number(min || 0);
  const h = x / 60;
  return Number.isFinite(h) ? h.toFixed(2) : "0.00";
}

function isoToCroDate(iso) {
  // "YYYY-MM-DD" -> "DD.MM.YYYY" (display only)
  if (typeof iso !== "string") return "";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

// ---------------- Period inference (robust) ----------------
function inferPeriodYYYYMM(runData) {
  // 1) period.date_from
  const d1 = runData?.period?.date_from;
  if (typeof d1 === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d1)) return d1.slice(0, 7);

  // 2) first period_summary row: period_from
  const p0 = Array.isArray(runData?.period_summary) ? runData.period_summary[0] : null;
  const d2 = p0?.period_from;
  if (typeof d2 === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d2)) return d2.slice(0, 7);

  // 3) recap_lines text parse: first YYYY-MM found
  const recap = Array.isArray(runData?.recap_lines) ? runData.recap_lines : [];
  for (const r of recap) {
    const t = String(r?.text || "");
    const m = t.match(/(\d{4})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}`;
  }

  // 4) daily_summary first work_date
  const d0 = Array.isArray(runData?.daily_summary) ? runData.daily_summary[0] : null;
  const d4 = d0?.work_date;
  if (typeof d4 === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d4)) return d4.slice(0, 7);

  return null;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function severityRank(sev) {
  const s = String(sev || "").toUpperCase();
  if (s === "ACTION") return 1;
  if (s === "WARN") return 2;
  return 3; // INFO / other
}

function buildActionHint(actionType) {
  const t = String(actionType || "").toUpperCase();
  if (t === "MISSING_ATTENDANCE_DAY") return "Nema evidencije za radni dan";
  if (t === "NEEDS_REVIEW") return "Potrebna provjera evidencije";
  return "Potrebna obrada";
}

function buildManagerNextStep(actionType) {
  const t = String(actionType || "").toUpperCase();
  if (t === "MISSING_ATTENDANCE_DAY") {
    return "Provjeri u ERP-u: bolovanje/GO ili ručni unos. Ako je rad bio stvaran, dopuniti evidenciju.";
  }
  if (t === "NEEDS_REVIEW") {
    return "Otvori interval_results za taj datum, provjeri duplikate/konflikte i late/early leave. Ako je potrebno, ispraviti u ERP-u.";
  }
  return "Provjeri detalje i uskladi evidenciju u ERP-u.";
}

function buildEmployeeMessage({ actionType, ime, priimek, workDateIso, lateRawMin, earlyLeaveRawMin, intervalCount }) {
  const dt = isoToCroDate(workDateIso);
  const fullName = `${ime || ""} ${priimek || ""}`.trim() || "zaposleniče/zaposlenice";

  const t = String(actionType || "").toUpperCase();

  if (t === "MISSING_ATTENDANCE_DAY") {
    return `Poštovani/Poštovana ${fullName}, za datum ${dt} nemamo evidentiran ulaz/izlaz. Molimo javite radi li se o bolovanju/GO ili je potrebno ručno evidentirati rad. Hvala.`;
  }

  if (t === "NEEDS_REVIEW") {
    const parts = [];
    if (Number(lateRawMin || 0) > 0) parts.push(`kašnjenje ${lateRawMin} min`);
    if (Number(earlyLeaveRawMin || 0) > 0) parts.push(`raniji izlazak ${earlyLeaveRawMin} min`);
    const facts = parts.length ? parts.join(", ") : `evidencija zahtijeva provjeru`;
    const iv = Number(intervalCount || 0) > 0 ? ` (broj intervala: ${intervalCount})` : "";
    return `Poštovani/Poštovana ${fullName}, za datum ${dt} evidentirano je: ${facts}${iv}. Molimo pošaljite kratko objašnjenje ili potvrdu vremena dolaska/odlaska. Hvala.`;
  }

  return `Poštovani/Poštovana ${fullName}, za datum ${dt} evidencija rada zahtijeva provjeru. Molimo pošaljite kratko objašnjenje. Hvala.`;
}

// ---------------- Main export ----------------
function exportAndPublish(runData) {
  const delim = DEFAULT_DELIM;

  const periodYYYYMM = inferPeriodYYYYMM(runData);
  if (!periodYYYYMM) {
    return {
      ok: false,
      error: "MISSING_PERIOD_CONTEXT",
      message:
        "Cannot infer period (YYYY-MM) from runData. Expected runData.period.date_from or period_summary[0].period_from or recap_lines text.",
    };
  }

  const periodFolder = periodYYYYMM.replace("-", "_"); // YYYY_MM

  // Output to PROJECT ROOT: out/epr_attendance/YYYY_MM
  const outDirAbs = path.resolve(process.cwd(), "out", "epr_attendance", periodFolder);
  ensureDir(outDirAbs);

  const daily = Array.isArray(runData?.daily_summary) ? runData.daily_summary : [];
  const periodRows = Array.isArray(runData?.period_summary) ? runData.period_summary : [];
  const recapLines = Array.isArray(runData?.recap_lines) ? runData.recap_lines : [];
  const actionsQueue = Array.isArray(runData?.actions_queue) ? runData.actions_queue : [];
  const intervals = Array.isArray(runData?.interval_results) ? runData.interval_results : [];

  const runMetadata =
    runData && typeof runData.run_metadata === "object" && runData.run_metadata ? runData.run_metadata : {};

  // Daily lookup: osebid|work_date -> lateness/early leave/interval count
  const dailyByKey = new Map();
  for (const d of daily) {
    const osebid = Number(d?.osebid);
    const wd = String(d?.work_date || "");
    if (!Number.isFinite(osebid) || !/^\d{4}-\d{2}-\d{2}$/.test(wd)) continue;

    dailyByKey.set(`${osebid}|${wd}`, {
      total_late_minutes_raw: Number(d?.total_late_minutes_raw || 0),
      total_early_leave_minutes_raw: Number(d?.total_early_leave_minutes_raw || 0),
      interval_count: Number(d?.interval_count || 0),
    });
  }

  // ---- Build recap flatten ----
  const recap = recapLines.map((r, i) => ({
    line_no: i + 1,
    severity: r?.severity ?? "",
    text: r?.text ?? "",
    metric: r?.metrics_hint?.metric ?? "",
    value: r?.metrics_hint?.value ?? ""
  }));

  // ---- Standard CSV headers (stable-ish) ----
  const dailyHeader = buildHeaderUnion(daily, [
    "osebid","work_date",
    "group_code","priimek","ime",
    "is_workday","is_holiday",
    "interval_count",
    "total_presence_minutes_raw","total_work_minutes","overtime_work_minutes",
    "late_debt_minutes",
    "missing_attendance_day","needs_action","needs_review",
    "attendance_origin","attendance_reason","daily_notes"
  ]);

  const periodHeader = buildHeaderUnion(periodRows, [
    "osebid",
    "group_code","priimek","ime",
    "period_from","period_to",
    "workdays_count",
    "total_work_minutes","total_overtime_work_minutes",
    "total_late_debt_minutes",
    "overtime_payable_150_minutes","uncovered_debt_minutes",
    "presence_days_count","lateness_days_count",
    "missing_attendance_days_count",
    "needs_review_count"
  ]);

  // ---- interval_results.csv ----
const intervalHeader = buildHeaderUnion(intervals, [
  "osebid", "group_code", "priimek", "ime",
  "work_date",
  "timevhod_raw", "timevhod_normalized", "timeizhod_raw",
  "duration_minutes_raw", "duration_minutes_effective",
  "late_minutes_raw", "late_minutes_normalized",
  "early_leave_minutes_raw", "early_leave_minutes_normalized",
  "is_wfh", "lokizhod",
  "notes",
  "event_key"
]);

const intervalCsv = toCsv(intervals, { delim, header: intervalHeader });
writeCsvExcel(path.join(outDirAbs, "interval_results.csv"), intervalCsv);


  const recapHeader = ["line_no","severity","text","metric","value"];

  // ---- Write standard exports ----
  const dailyCsv = toCsv(daily, { delim, header: dailyHeader });
  const periodCsv = toCsv(periodRows, { delim, header: periodHeader });
  const recapCsv = toCsv(recap, { delim, header: recapHeader });

  writeCsvExcel(path.join(outDirAbs, "daily_summary.csv"), dailyCsv);
  writeCsvExcel(path.join(outDirAbs, "period_summary.csv"), periodCsv);
  writeCsvExcel(path.join(outDirAbs, "recap_lines.csv"), recapCsv);

    // ---- Payroll-friendly CSV (FIXED SCHEMA + fixed name) ----
  // Tražena shema: sati (decimalno) + fiksni headeri
  const payrollHeader = [
    "Prezime i ime(priimek +ime)",
    "OIB(alt_id)",   
    "001_Redovan_rad",
    "001_RadOdKuce",
    "002_Prekovremeni_rad",
    "003_Blagdan",
    "005_Rad_na_Blagdan",
    "006_Godisnji_Odmor",
    "040_BO_70",
    "040_BO_HZZO_70",
    "050_BO_HZZO_100",
    "050_Ozljeda_Na_Radu_HZZO_100",
    "056_Komp_Trudnoca",
    "Ozljeda_Na_Radu_HZZO_100",
    "Prisutnost_Dana",
    "Kasnjenja_Broj",
    "PV_Minus",
    "PV_Plus"
  ];

  const payrollRows = periodRows.map(r => {
    const fullName = `${r.priimek || ""} ${r.ime || ""}`.trim();

    // minute izvori (ako neko polje još ne postoji, default = 0)
    const m_001_on_site = Number(r.pay_001_regular_on_site_minutes || 0);
    const m_001_wfh     = Number(r.pay_001_wfh_minutes || 0);

    // 002: preferiraj pay_002_overtime_minutes; fallback na overtime_payable_150_minutes
    const m_002_ot = Number(
      (r.pay_002_overtime_minutes !== undefined ? r.pay_002_overtime_minutes : r.overtime_payable_150_minutes) || 0
    );

    const m_003_hol = Number(r.pay_003_holiday_minutes || 0);
    const m_005_hol_work = Number(r.pay_005_work_on_holiday_minutes || 0);
    const m_006_go = Number(r.pay_006_collective_leave_minutes || 0);

    const m_040_bo70 = Number(r.pay_040_bo_70_minutes || 0);
    const m_040_hzzo70 = Number(r.pay_040_bo_hzzo_70_minutes || 0);

    const m_050_hzzo100 = Number(r.pay_050_bo_hzzo_100_minutes || 0);
    const m_050_ozljeda = Number(r.pay_050_ozljeda_hzzo_100_minutes || 0);

    const m_056_trud = Number(r.pay_056_komp_trudnoca_minutes || 0);

    const pv_minus = Number(r.uncovered_debt_minutes || 0);
    const pv_plus  = Number(r.overtime_payable_150_minutes || 0);

    return {
      "Prezime i ime(priimek +ime)": fullName,
      "OIB(alt_id)": r.alt_id || "",
      "001_Redovan_rad": minutesToHours2(m_001_on_site),
      "001_RadOdKuce": minutesToHours2(m_001_wfh),
      "002_Prekovremeni_rad": minutesToHours2(m_002_ot),

      "003_Blagdan": minutesToHours2(m_003_hol),
      "005_Rad_na_Blagdan": minutesToHours2(m_005_hol_work),
      "006_Godisnji_Odmor": minutesToHours2(m_006_go),

      "040_BO_70": minutesToHours2(m_040_bo70),
      "040_BO_HZZO_70": minutesToHours2(m_040_hzzo70),

      "050_BO_HZZO_100": minutesToHours2(m_050_hzzo100),
      "050_Ozljeda_Na_Radu_HZZO_100": minutesToHours2(m_050_ozljeda),

      "056_Komp_Trudnoca": minutesToHours2(m_056_trud),

      // imate oba naziva u zahtjevu; punimo istom vrijednošću da payroll SW dobije što treba
      "Ozljeda_Na_Radu_HZZO_100": minutesToHours2(m_050_ozljeda),

      "Prisutnost_Dana": Number(r.presence_days_count || 0),
      "Kasnjenja_Broj": Number(r.lateness_days_count || 0),

      "PV_Minus": minutesToHours2(pv_minus),
      "PV_Plus": minutesToHours2(pv_plus)
    };
  });

  // Sort: group_code (diskriminanta), zatim priimek; group_code nije u CSV-u, ali se koristi za redoslijed
  payrollRows.sort((a, b) => {
    const ra = periodRows.find(x => String(x.alt_id || "") === String(a["OIB(alt_id)"] || "") && String(x.priimek || "") === String((a["Prezime i ime(priimek +ime)"] || "").split(" ")[0] || ""));
    const rb = periodRows.find(x => String(x.alt_id || "") === String(b["OIB(alt_id)"] || "") && String(x.priimek || "") === String((b["Prezime i ime(priimek +ime)"] || "").split(" ")[0] || ""));
    const ga = String(ra?.group_code || "");
    const gb = String(rb?.group_code || "");
    if (ga !== gb) return ga.localeCompare(gb, "hr", { sensitivity: "base" });

    // prezime je prvi token u "Prezime i ime"
    const pa = String(a["Prezime i ime(priimek +ime)"] || "").split(" ")[0] || "";
    const pb = String(b["Prezime i ime(priimek +ime)"] || "").split(" ")[0] || "";
    return pa.localeCompare(pb, "hr", { sensitivity: "base" });
  });

  const payrollCsv = toCsv(payrollRows, { delim, header: payrollHeader });
  const payrollFileName = `payroll_${periodFolder}.csv`;
  writeCsvExcel(path.join(outDirAbs, payrollFileName), payrollCsv);


  // ---- Actions queue CSV (enriched) ----
  let actionsRows = actionsQueue.map(a => {
    const osebid = Number(a?.osebid);
    const wd = String(a?.work_date || "");
    const k = `${osebid}|${wd}`;
    const dd = dailyByKey.get(k) || {};

    const lateRaw = Number(dd.total_late_minutes_raw || 0);
    const earlyRaw = Number(dd.total_early_leave_minutes_raw || 0);
    const ivCount = Number(dd.interval_count || 0);

    const actType = a?.action_type || "";
    const sev = a?.severity || "";

    return {
      // enrichment columns first
      severity_rank: severityRank(sev),
      action_hint: buildActionHint(actType),
      evidence: `late_raw=${lateRaw}; early_leave_raw=${earlyRaw}; intervals=${ivCount}`,
      employee_message: buildEmployeeMessage({
        actionType: actType,
        ime: a?.ime || "",
        priimek: a?.priimek || "",
        workDateIso: wd,
        lateRawMin: lateRaw,
        earlyLeaveRawMin: earlyRaw,
        intervalCount: ivCount
      }),
      manager_next_step: buildManagerNextStep(actType),

      // keep originals
      ...a
    };
  });
  // -dodano 26/01/2026
    // --- SMS v1: issue_key + missing bundling + sms_preview + ledger OUTBOX_CREATED ---
   const nowTs = new Date().toISOString();
   const ctx = {
    use_case: runMetadata?.use_case || "epr_attendance_v1",
    contract_version: runMetadata?.contract_version || "",
    rules_version: runMetadata?.rules_version || "",
    sms_template_version: "v1"
   };

   // Ensure issue_key for missing + suspicious (v1)
actionsRows = (actionsRows || []).map(a => {
  const at = upper(a.action_type);
  const wdIso = toISODateAny(a.work_date);

  if (at === "MISSING_ATTENDANCE_DAY" && isISODateStr(wdIso)) {
    return { ...a, work_date: wdIso, issue_key: a.issue_key || makeIssueKeyMissing(a, ctx) };
  }

  // suspicious short interval -> single message per day
  if (at === "NEEDS_REVIEW" && hasReasonCode(a, "SUSPICIOUS_SHORT_INTERVAL") && isISODateStr(wdIso)) {
    return { ...a, work_date: wdIso, issue_key: a.issue_key || makeIssueKeyGeneric(a, ctx, "SUSPICIOUS_SHORT_INTERVAL") };
  }

  // normalize work_date if it is CRO format
  if (isISODateStr(wdIso) && wdIso !== a.work_date) return { ...a, work_date: wdIso };

  return { ...a };
 });

 // Map from issue_key -> sms bundle data so we can enrich actions_queue for UI review
const issueToSms = new Map();

// NEW: define bundles in this scope
const bundles = bundleMissingActions(actionsRows, ctx);

const smsPreviewRows = [];
for (const b of bundles) {
  if (!b.tel_gsm) continue; // no phone => no outbox preview
  const workDatesCsv = b.work_dates.join(",");
  const sms_text = renderMissingWeekSmsText(b);
  const sms_hash = sha256(sms_text);

  const smsRow = {
    period_yyyy_mm: periodYYYYMM,
    publish_ts: nowTs,
    group_code: b.group_code,
    osebid: b.osebid,
    priimek: b.priimek,
    ime: b.ime,
    tel_gsm: b.tel_gsm,
    bundle_type: "MISSING_WEEK",
    week_key: b.week_key,
    work_dates: workDatesCsv,
    issue_keys: b.issue_keys.join("|"),
    sms_key: b.sms_key,
    sms_hash,
    sms_severity: "urgent",
    sms_status: "pending",
    sms_text
  };

  smsPreviewRows.push(smsRow);

  for (const ik of b.issue_keys) {
    issueToSms.set(ik, {
      sms_key: b.sms_key,
      sms_text,
      sms_status: "pending",
      sms_enabled: 1,
      reason_codes: "MISSING_DAY"
    });
  }
}
// --- ADD: SUSPICIOUS_SHORT_INTERVAL (single per day, no bundling) ---
for (const a of actionsRows) {
  const at = upper(a.action_type);
  if (at !== "NEEDS_REVIEW") continue;
  if (!hasReasonCode(a, "SUSPICIOUS_SHORT_INTERVAL")) continue;
  if (!a.tel_gsm) continue;
  if (!a.issue_key) continue; // ensured above

  const sms_text = renderSuspiciousShortSmsText(a);
  const sms_hash = sha256(sms_text);
  const sms_key = makeSmsKeyForIssue(a.osebid, a.work_date, "SUSPICIOUS_SHORT_INTERVAL", ctx);

  const smsRow = {
    period_yyyy_mm: periodYYYYMM,
    publish_ts: nowTs,
    group_code: a.group_code,
    osebid: a.osebid,
    priimek: a.priimek,
    ime: a.ime,
    tel_gsm: a.tel_gsm,
    bundle_type: "SUSPICIOUS_SHORT_INTERVAL",
    work_date: a.work_date,
    issue_keys: a.issue_key,
    sms_key,
    sms_hash,
    sms_severity: "warn",
    sms_status: "pending",
    sms_text
  };

  smsPreviewRows.push(smsRow);

  // map issue -> sms fields so actions_queue shows the sms_text
  issueToSms.set(a.issue_key, {
    sms_key,
    sms_text,
    sms_status: "pending",
    sms_enabled: 1,
    reason_codes: "SUSPICIOUS_SHORT_INTERVAL"
  });
}

  // Enrich actionsRows so viewer can see sms_text per action (same text for all issues in bundle)
  actionsRows = actionsRows.map(a => {
    const ik = a.issue_key;
    if (ik && issueToSms.has(ik)) {
      const s = issueToSms.get(ik);
      return { ...a, ...s };
    }
    return { ...a, sms_enabled: 0, sms_key: "", sms_text: "", sms_status: "", reason_codes: "" };
  });

  // Write sms_preview.csv (always write; empty is OK)
  const smsHeader = buildHeaderUnion(smsPreviewRows, [
    "period_yyyy_mm",
    "publish_ts",
    "group_code",
    "osebid",
    "priimek",
    "ime",
    "tel_gsm",
    "bundle_type",
    "work_date",
    "range_start",
    "range_end",
    "work_dates",
    "issue_keys",
    "sms_key",
    "sms_hash",
    "sms_severity",
    "sms_status",
    "sms_text"
  ]);
  const smsCsv = toCsv(smsPreviewRows, { delim, header: smsHeader });
  writeCsvExcel(path.join(outDirAbs, "sms_preview.csv"), smsCsv);

  // Append OUTBOX_CREATED events to ledger with simple rolling-window dedup
  for (const m of smsPreviewRows) {
    const last = getLastEventType({
      use_case: ctx.use_case,
      sms_key: m.sms_key,
      now_ts: nowTs,
      monthsBack: 2
    });

    // If we already created/sent this sms_key recently, do not create again
    if (last === "OUTBOX_CREATED" || last === "SENT" || last === "DELIVERED" || last === "REPLIED") {
      continue;
    }

    appendEvent({
      use_case: ctx.use_case,
      ts: nowTs, // ledger file partition by event time
      event: {
        ts: nowTs,
        event_type: "OUTBOX_CREATED",
        use_case: ctx.use_case,
        period_yyyy_mm: periodYYYYMM,
        sms_key: m.sms_key,
        issue_keys: m.issue_keys,
        phone: m.tel_gsm,
        sms_hash: m.sms_hash,
        group_code: m.group_code,
        osebid: m.osebid
      }
    });
  }

  actionsRows.sort((x, y) =>
    (Number(x.severity_rank || 999) - Number(y.severity_rank || 999)) ||
    String(x.Klas || x.group_code || "").localeCompare(String(y.Klas || y.group_code || ""), "hr", { sensitivity: "base" }) ||
    String(x.priimek || "").localeCompare(String(y.priimek || ""), "hr", { sensitivity: "base" }) ||
    String(x.work_date || "").localeCompare(String(y.work_date || ""))
  );

  const actionsHeader = buildHeaderUnion(actionsRows, [
    "severity_rank",
    "action_id",
    "action_type",
    "severity",
    "osebid",
    "group_code",
    "ime",
    "priimek",
    "tel_gsm",
    "work_date",
    "summary",
    "suggested_fix",
    "source",
    "status",
    "action_hint",
    "evidence",
    "employee_message",
    "manager_next_step",
    "issue_key",
    "reason_codes",
    "sms_enabled",
    "sms_key",
    "sms_text",
    "sms_status"

  ]);

  const actionsCsv = toCsv(actionsRows, { delim, header: actionsHeader });
  writeCsvExcel(path.join(outDirAbs, "actions_queue.csv"), actionsCsv);

  // ---- Manifest ----
  const manifest = {
    ...runMetadata,
    run_status: "PUBLISHED",
    published_at: new Date().toISOString(),
    period_yyyy_mm: periodYYYYMM,
    export_dir_abs: outDirAbs,
    files: [
      "daily_summary.csv",
      "period_summary.csv",
      "recap_lines.csv",
      "interval_results.csv",   // <<< DODANO
      "actions_queue.csv",
      "sms_preview.csv", // <<< DODANO 26/01/2026
      payrollFileName,
      "manifest.json"
    ]
  };
  fs.writeFileSync(path.join(outDirAbs, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

  return {
    ok: true,
    message: `Export & publish complete for period ${periodFolder}`,
    period: periodYYYYMM,
    folder: periodFolder,
    export_dir_abs: outDirAbs,
    files: manifest.files,
    rows: {
      period: periodRows.length,
      daily: daily.length,
      recap: recap.length,
      payroll: payrollRows.length,
      actions: actionsRows.length
    }
  };
}

module.exports = { exportAndPublish };
