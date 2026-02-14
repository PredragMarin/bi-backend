// compute.js — STABLE as of 2025-12-27
// src/core/epr/compute.js
const { sha256Hex } = require("../hash");
const { parseDateTimeDMYHM, parseDateDMY, toISODate, toDMYHM } = require("../time");
const { buildRecapLines } = require("./recap");

const WORK_START_HH = 7, WORK_START_MM = 30;
const WORK_END_HH = 15, WORK_END_MM = 30;const MINUTES_PER_WORKDAY = 480;
const LATE_BUCKET_MIN = 30;
const LATE_NORMALIZE_GRACE_MAX = 30; // delta_start in [0..30] => normalized start to 07:30
const BIG_LATE_PLUS_MIN = 5;
const EXCESSIVE_DURATION_MIN = 16 * 60;
// Policy multipliers (configurable)
const LATE_DEBT_MULTIPLIER = 1; // sada 1:1, kasnije možete 2, 3...
// Early arrival overtime policy (configurable)
const EARLY_OVERTIME_THRESHOLD_MIN = 20; // cenzus: do 20 min ranije = priprema, ne overtime
const SPLIT_SHIFT_MIN_MINUTES = 15; // tipvhod=1 kraće od ovoga => needs_review (anti-gaming)
const EARLY_OVERTIME_DEDUCT_MIN = 5;     // oduzimanje (friction) kad early prelazi threshold
const RFID_IPS = new Set(["192.168.100.77", "192.168.100.41"]);

// tipizhod katalog (ERP): UVEDENO 03/02/2026
// 0=01 Redovan rad, 3=40 Bolovanje, 4=06 Godisnji odmor, 5=03 Blagdan, 6=01 Rad od kuce, 7=05 Blagdan Rad, 8=56 Porodiljni, 9=50 Bolovanje HZZO ,90=90 Pogresno skeniranje
const ALLOWED_TIPIZHOD = new Set([0, 3, 4, 5, 6, 7, 8, 9, 90]);

const ALLOWED_TIPVHOD  = new Set([0, 1]); // 0=default, 1=split shift

function minutesDiff(a, b) {
  // b - a (minutes)
  return Math.floor((b.getTime() - a.getTime()) / 60000);
}

function dayStartRef(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate(), WORK_START_HH, WORK_START_MM, 0, 0);
  return x;
}

function dayEndRef(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), WORK_END_HH, WORK_END_MM, 0, 0);
}

function isCollectiveLeaveText(s) {
  if (!s) return false;
  return String(s).trim().toLowerCase() === "kolektivni go";
}
function isWeekdayISO(isoDate) {
  // isoDate: "YYYY-MM-DD"
  if (!isoDate) return false;
  const [y, m, d] = String(isoDate).split("-").map(n => parseInt(n, 10));
  if (!y || !m || !d) return false;
  const dt = new Date(y, m - 1, d);
  const day = dt.getDay(); // 0=Sun ... 6=Sat
  return day >= 1 && day <= 5; // Mon..Fri
}
// doddana normalizacija ISO CRO datuma 26/01/2026 da join radi
function toISODateAny(work_date) {
  const t = String(work_date || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return t;
}
function dayKey(osebid, work_date) {
  return `${Number(osebid)}|${toISODateAny(work_date)}`;
}
function dayTypeFromCalendarRow(calRow) {
  const dandelovni = Number(calRow?.dandelovni || 0);
  const praznik = Number(calRow?.praznik || 0);
  const tekst = String(calRow?.tekst || "");

  if (praznik === 1) return "HOLIDAY";
  if (isCollectiveLeaveText(tekst)) return "COLLECTIVE_LEAVE";
  if (dandelovni === 1) return "WORKDAY_BILLABLE";
  return "NON_WORKDAY";
}
//helper za RadOdKuce 
function isWFHNote(s) {
  const x = String(s ?? "")
    .replace(/\u00A0/g, " ")   // NBSP
    .replace(/\s+/g, " ")     // collapse whitespace (tabs/newlines)
    .trim();
  return /^001_RadOdKuce$/i.test(x);
}

function eventKey(row) {
  const material = [
    String(row.osebid ?? ""),
    String(row.timevhod ?? ""),
    String(row.timeizhod ?? ""),
    String(row.tipizhod ?? ""),
    String(row.opomba ?? "")
  ].join("|");
  return sha256Hex(material);
}

function computeInterval(row, calendarByISODate) {
  const flags = {
    late_arrival: false,
    early_leave: false,
    kasnjenje_raniji_izlaz: false,
    open_interval: false,
    duplicate: false,
    conflict: false,
    needs_review: false
  };

  const osebid = Number(row.osebid);
  const tv = parseDateTimeDMYHM(String(row.timevhod || ""));
  const ti = row.timeizhod ? parseDateTimeDMYHM(String(row.timeizhod)) : null;

  if (!tv) {
    // fatal parsing should have been in rejects; but keep safe
    flags.needs_review = true;
  }

  const work_date = tv ? toISODate(tv) : null;

  const cal = calendarByISODate.get(work_date) || null;
  const is_workday = cal ? Number(cal.dandelovni) === 1 : false;
  const is_holiday = cal ? Number(cal.praznik) === 1 : false;
  const is_collective_leave = cal ? isCollectiveLeaveText(cal.tekst) : false;
   // --- TIP DIMENSIONS (define early; used later in duration & discipline rules) ---
  const tipizhod = Number(row.tipizhod);
  const tipvhod  = Number(row.tipvhod);

  const is_split_shift = (tipvhod === 1);

  // notes + WFH: opomba OR tipizhod=6
  const notes = String(row.opomba ?? "");
  const is_wfh = isWFHNote(notes) || (tipizhod === 6);
  // tipizhod=90 => pogrešno skeniranje (ignorirati u izračunima; ostaje u raw/interval_results)
  const is_ignored = (tipizhod === 90);

  const lokizhod = row.lokizhod ? String(row.lokizhod).trim() : "";
  if (is_wfh && lokizhod && RFID_IPS.has(lokizhod)) {
    flags.needs_review = true;
    flags.conflict = true; // opcionalno
  }

 // duration
 let duration_minutes_raw = 0;
 let duration_minutes_effective = 0;

 let open_interval = false;
 if (!ti) {
  open_interval = true;
  flags.open_interval = true;
  flags.needs_review = true;
 } else if (tv && ti && ti.getTime() < tv.getTime()) {
  flags.needs_review = true; // negative_duration
 } else if (tv && ti) {
  // RAW trajanje uvijek iz stvarnog intervala
  duration_minutes_raw = minutesDiff(tv, ti);
    // Anti-gaming / sanity: split shift interval prekratak => needs_review
  if (is_split_shift && duration_minutes_raw > 0 && duration_minutes_raw < SPLIT_SHIFT_MIN_MINUTES) {
    flags.needs_review = true;
  }

  // EFFECTIVE trajanje: na workday računamo od normalized start (RULES 11.2)
  if (is_workday && !is_wfh) {
    const startRefLocal = dayStartRef(tv);
    const delta_start = minutesDiff(startRefLocal, tv); // tv - 07:30

    // normalized start za efektivni rad
    let effectiveStart = startRefLocal;

    if (delta_start <= 30) {
      // raniji dolazak i dolazak do +30 min -> efektivno od 07:30
      effectiveStart = startRefLocal;
    } else {
      // >30 min -> efektivno od timevhod + 5 min (vaše pravilo)
      effectiveStart = new Date(tv.getTime() + BIG_LATE_PLUS_MIN * 60000);
    }

    if (effectiveStart.getTime() > ti.getTime()) {
      duration_minutes_effective = 0;
      flags.needs_review = true;
    } else {
      duration_minutes_effective = minutesDiff(effectiveStart, ti);
    }
  } else {
    // neradni dan: zasad effective = raw (policy možete kasnije definirati)
    duration_minutes_effective = duration_minutes_raw;
  }

  if (duration_minutes_raw === 0) flags.needs_review = true;
  if (duration_minutes_raw > EXCESSIVE_DURATION_MIN) flags.needs_review = true;
 }


  // Normalizacija dolaska (RULES 11.2/11.4)
  const startRef = tv ? dayStartRef(tv) : null;
  let timevhod_normalized = row.timevhod;
  let late_minutes_raw = 0;
  let late_minutes_normalized = 0;

  if (tv && startRef && is_workday && !is_wfh) {
    const delta_start = minutesDiff(startRef, tv); // tv - 07:30
    if (delta_start <= 0) {
      timevhod_normalized = toDMYHM(startRef);
      late_minutes_raw = 0;
      late_minutes_normalized = 0;
    } else if (delta_start >= 0 && delta_start <= LATE_NORMALIZE_GRACE_MAX) {
      timevhod_normalized = toDMYHM(startRef);
      late_minutes_raw = delta_start;
      late_minutes_normalized = LATE_BUCKET_MIN; // 0..30 => 30
    } else {
      // >30 min
      const normalized = new Date(tv.getTime() + BIG_LATE_PLUS_MIN * 60000);
      timevhod_normalized = toDMYHM(normalized);
      late_minutes_raw = delta_start;
      late_minutes_normalized = delta_start;
    }
  }

  // Odlazak (ne normalizira se)
  let early_leave_minutes_raw = 0;
  let early_leave_minutes_normalized = 0;
  if (tv && ti && is_workday && !is_wfh) {
    const endRef = dayEndRef(tv);
    if (ti.getTime() < endRef.getTime()) {
      early_leave_minutes_raw = minutesDiff(ti, endRef); // 15:30 - ti
      early_leave_minutes_normalized = early_leave_minutes_raw;
    }
  }

  const late_arrival = late_minutes_raw > 0;
  const early_leave = early_leave_minutes_raw > 0;
  flags.late_arrival = late_arrival;
  flags.early_leave = early_leave;
  flags.kasnjenje_raniji_izlaz = late_arrival || early_leave;

if (Number.isFinite(tipizhod) && !ALLOWED_TIPIZHOD.has(tipizhod)) {
  flags.needs_review = true;
}
if (Number.isFinite(tipvhod) && !ALLOWED_TIPVHOD.has(tipvhod)) {
  flags.needs_review = true;
}

  // Split shift (tipvhod=1): ne generira disciplinu ni normalizacije; računa se kao raw
  if (is_split_shift) {
    late_minutes_raw = 0;
    late_minutes_normalized = 0;
    early_leave_minutes_raw = 0;
    early_leave_minutes_normalized = 0;

    flags.late_arrival = false;
    flags.early_leave = false;
    flags.kasnjenje_raniji_izlaz = false;

    timevhod_normalized = row.timevhod;          // bez shift-a
    duration_minutes_effective = duration_minutes_raw; // raw kao effective
  }

  return {
    event_key: eventKey(row),
    osebid,
    work_date,
    calendar_flags: { is_workday, is_holiday, is_collective_leave },
    timevhod_raw: row.timevhod,
    timevhod_normalized,
    timeizhod_raw: row.timeizhod ?? null,
    duration_minutes_raw,
    duration_minutes_effective,
    late_minutes_raw: Math.max(0, late_minutes_raw),
    late_minutes_normalized: Math.max(0, late_minutes_normalized),
    early_leave_minutes_raw: Math.max(0, early_leave_minutes_raw),
    early_leave_minutes_normalized: Math.max(0, early_leave_minutes_normalized),
        // NEW
    tipvhod: Number(row.tipvhod),
    tipizhod: Number(row.tipizhod),
    is_split_shift,
    is_wfh,
    is_ignored,
    lokizhod,
    flags,
    notes
  };
}

function computeEprOutputs({ manifest, period, period_label, datasets, validation }) {
  const eprRows = Array.isArray(datasets.epr_data) ? datasets.epr_data : [];
  /////-------//
console.log("EPR INPUT ROWS:", eprRows.length);
if (eprRows.length > 0) {
  console.log("EPR FIRST ROW KEYS:", Object.keys(eprRows[0]));
}
  //////------//
  const calRows = Array.isArray(datasets.calendar) ? datasets.calendar : [];
  const rejects_count = (validation && Array.isArray(validation.errors))
  ? validation.errors.length
  : 0;
// <<< DODAJ OVO TOČNO OVDJE >>>
if (validation && Array.isArray(validation.errors) && validation.errors.length > 0) {
  console.log("VALIDATION errors sample (first 5):");
  console.dir(validation.errors.slice(0, 5), { depth: null });
}

  const calendarByISODate = new Map();
  for (const r of calRows) {
    const d = parseDateDMY(String(r.datum || ""));
    if (!d) continue;
    calendarByISODate.set(toISODate(d), r);
  }
 // === DEBUG: calendar sanity (RUN-LEVEL, once) ===
if (process.env.DEBUG_CALENDAR === "1") {
  let calHoliday = 0, calCL = 0, calWork = 0, calNonWork = 0;
  const calHolidayDates = [];
  const calCLDates = [];

  for (const [iso, cal] of calendarByISODate.entries()) {
    const isWorkday = Number(cal.dandelovni) === 1;
    const isHoliday = Number(cal.praznik) === 1;
    const isCL = isCollectiveLeaveText(cal.tekst);

    if (isHoliday) { calHoliday++; calHolidayDates.push(iso); }
    else if (isCL) { calCL++; calCLDates.push(iso); }
    else if (isWorkday) calWork++;
    else calNonWork++;
  }

  console.log("CALENDAR COUNTS:", { calWork, calHoliday, calCL, calNonWork });
  console.log("CALENDAR HOLIDAY DATES:", calHolidayDates);
  console.log("CALENDAR COLLECTIVE LEAVE DATES:", calCLDates);

  const probeDates = [
    "2025-12-24","2025-12-25","2025-12-26",
    "2025-12-29","2025-12-30","2025-12-31"
  ];
  for (const dt of probeDates) {
    const cal = calendarByISODate.get(dt);
    console.log("CAL PROBE", dt, cal
      ? { datum: cal.datum, dandelovni: cal.dandelovni, praznik: cal.praznik, tekst: cal.tekst }
      : "MISSING"
    );
  }
}
// === END DEBUG ===

// Build interval results + dedup + conflict detection
// Dedup signature IGNORIRA notes/opomba, ali conflict postavlja ako se notes razlikuju.
const seenSig = new Map(); // sig -> firstRec
const interval_results = [];

for (const row of eprRows) {
  const rec = computeInterval(row, calendarByISODate);

  // signature key MUST ignore opomba/notes
  const sig = [
    rec.osebid,
    rec.work_date,
    rec.timevhod_raw || "",
    rec.timeizhod_raw || "",
    String(row.tipizhod ?? "")
  ].join("|");

  const prev = seenSig.get(sig);
  if (prev) {
    // duplicate by signature
    rec.flags.duplicate = true;
    rec.flags.needs_review = true;

    // conflict if notes differ (including empty vs non-empty)
    const prevNotes = String(prev.notes ?? "");
    const recNotes = String(rec.notes ?? "");
    if (prevNotes !== recNotes) {
      rec.flags.conflict = true;
      prev.flags.conflict = true;
      prev.flags.needs_review = true;
    }
  } else {
    seenSig.set(sig, rec);
  }

  interval_results.push(rec);
}


// Daily aggregation: key osebid|work_date
const dailyMap = new Map();
function dailyKey(osebid, work_date) { return `${osebid}|${work_date}`; }
////////////////////////////
function makeDailyRow({ osebid, isoDate, cal, origin = "auto" }) {
  const isWorkday = cal ? Number(cal.dandelovni) === 1 : false;
  const isHoliday = cal ? Number(cal.praznik) === 1 : false;
 

  return {
    osebid,
    work_date: isoDate,

    is_workday: isWorkday,
    is_holiday: isHoliday,

    // interval accumulators
    total_presence_minutes_raw: 0,
    total_late_minutes_raw: 0,
    total_late_minutes_normalized: 0,
    total_early_leave_minutes_raw: 0,
    total_early_leave_minutes_normalized: 0,

    early_overtime_minutes: 0,
    after_shift_minutes: 0,
    late_debt_minutes: 0,

    total_work_minutes: 0,
    overtime_work_minutes: 0,

    interval_count: 0,
    has_kasnjenje_raniji_izlaz: false,
    needs_review: false,

    // classification/action
    missing_attendance_day: false,
    needs_action: false,
    attendance_origin: origin,
    attendance_reason: "NONE",
    is_paid_non_work_attendance: false,

    // payroll buckets
    day_type: "UNKNOWN",
    paid_holiday_100_minutes: 0,
    paid_collective_leave_100_minutes: 0,

    paid_sick_70_minutes: 0,
    paid_sick_hzzo_70_minutes: 0,
    paid_sick_hzzo_100_minutes: 0,
    paid_injury_hzzo_100_minutes: 0,
    paid_preg_comp_100_minutes: 0,

    overtime_150_minutes: 0,
    work_on_holiday_150_minutes: 0,
        // ---- PAYROLL BUCKETS (minute) ----
    pay_001_regular_on_site_minutes: 0,   // 001_Redovan_rad
    pay_001_wfh_minutes: 0,               // 001_RadOdKuce
    pay_002_overtime_minutes: 0,          // 002_Prekovremeni_rad (PV+ nakon kompenzacije)
    pay_003_holiday_minutes: 0,           // 003_Blagdan (100%)
    pay_005_work_on_holiday_minutes: 0,   // 005_Rad_na_Blagdan (150%)
    pay_006_collective_leave_minutes: 0,  // 006_Godisnji_Odmor (kolektivni GO 100%)

    pay_040_bo_70_minutes: 0,
    pay_040_bo_hzzo_70_minutes: 0,
    pay_050_bo_hzzo_100_minutes: 0,
    pay_050_ozljeda_hzzo_100_minutes: 0,
    pay_056_komp_trudnoca_minutes: 0,

    //NEW 08/02
   presence_on_site_minutes_raw: 0,          // tv->ti (raw, audit)
   presence_on_site_minutes_effective: 0,    // normalized-start->ti (payroll basis for WORKDAY)
   work_from_home_minutes: 0,

    
   // NEW: state za overlap-kontrolu (runtime-only)
   _last_end_on_site: null,
   _last_end_wfh: null,

    // helpers
    is_present_on_site: false,
    lateness_day: false,
    

    daily_notes: ""
  };
}

//////////////////// people lookup
const peopleRows = Array.isArray(datasets.osebe_raw) ? datasets.osebe_raw : [];
const peopleByOsebid = new Map(
  peopleRows
    .filter(p => p && p.osebid !== undefined && p.osebid !== null)
    .map(p => [
      Number(p.osebid),
      {
        osebid: Number(p.osebid),
        ime: p.ime ?? "",
        priimek: p.priimek ?? "",
        tel_gsm: p.tel_gsm ?? "",
        e_mail: p.e_mail ?? "",
        alt_id: p.alt_id ?? "",
        group_code: (p.group_code ?? "").trim().toUpperCase() || "UNKNOWN",
        mode: String(p.mode ?? "FULL").trim().toUpperCase()
      }
    ])
);
// ---- ENRICH interval_results with person fields (ime/priimek/group_code) ----
for (const rec of interval_results) {
  const person = peopleByOsebid.get(Number(rec.osebid)) || {};
  rec.group_code = person.group_code || "UNKNOWN";
  rec.priimek = person.priimek || "";
  rec.ime = person.ime || "";
  rec.mode = person.mode || "FULL";
}
// ---- PARTIAL SKELETON: add rows for HOLIDAY + COLLECTIVE_LEAVE for all people ----
const personIds = Array.from(peopleByOsebid.keys()).filter(id => {
  const p = peopleByOsebid.get(Number(id)) || {};
  return String(p.mode || "FULL").toUpperCase() !== "SLIM";
});

for (const [isoDate, cal] of calendarByISODate.entries()) {
  const isHoliday = Number(cal.praznik) === 1;
  const isCollectiveLeave = isCollectiveLeaveText(cal.tekst);

  if (!isHoliday && !isCollectiveLeave) continue;

  for (const osebid of personIds) {
    const key = dailyKey(osebid, isoDate);
    if (dailyMap.has(key)) continue;

    const row = makeDailyRow({ osebid, isoDate, cal, origin: "calendar_auto" });
dailyMap.set(key, row);
  }
}

///////////////// interval loop 
for (const rec of interval_results) {
  const key = dailyKey(rec.osebid, rec.work_date);

  if (!dailyMap.has(key)) {
    const cal = calendarByISODate.get(rec.work_date) || null;
 dailyMap.set(key, makeDailyRow({ osebid: rec.osebid, isoDate: rec.work_date, cal, origin: "auto" }));

   
  }

  const d = dailyMap.get(key);
  d.interval_count += 1; // audit: count all intervals, including duplicates

  // daily needs_review should reflect ANY suspicious interval (duplicate/conflict/open/parse issues, etc.)
   if (rec.is_ignored !== true && (rec.flags?.needs_review || rec.flags?.duplicate || rec.flags?.conflict)) {
    d.needs_review = true;
  }

  if (rec.flags?.kasnjenje_raniji_izlaz) d.has_kasnjenje_raniji_izlaz = true;

  const isDup = rec.flags?.duplicate === true;

  // Payroll rule: duplicates do NOT count into totals
  if (isDup) continue;
    // tipizhod=90 (pogrešno skeniranje): ignorirati u svim obračunima (minute, debt, overtime, PT)
  if (rec.is_ignored === true) {
    // po želji: ako hoćete da se ipak vidi u UI da postoji "ignored scan",
    // možete u daily_notes nešto upisati, ali bez needs_review.
    // d.daily_notes = (d.daily_notes ? d.daily_notes + " | " : "") + "Ignored scan (tipizhod=90)";
    continue;
  }
    // -----------------------------
  // EXCUSED ABSENCE: tipizhod=3 (Bolovanje)
  // Konvencija: voditelj upisuje 07:30–15:30; tretira se kao 8h plaćeno (040_BO_70),
  // ne ulazi u redovan rad (pay_001) i ne ulazi u disciplinu/overtime.
  // -----------------------------
  if (Number(rec.tipizhod) === 3) {
    const raw = Number(rec.duration_minutes_raw);
    const paidMin = (Number.isFinite(raw) && raw > 0)
      ? Math.min(MINUTES_PER_WORKDAY, raw)
      : MINUTES_PER_WORKDAY;

    d.paid_sick_70_minutes = (d.paid_sick_70_minutes || 0) + paidMin;
    d.pay_040_bo_70_minutes = (d.pay_040_bo_70_minutes || 0) + paidMin;

    d.is_paid_non_work_attendance = true;
    d.attendance_origin = d.attendance_origin || "manual_standardized";
    d.attendance_reason = "SICK_LEAVE";

    // NE računati u on-site/WFH minute, NE računati lateness/early leave/overtime:
    continue;
  }
  // dodano 07/02-----------------------------
// EXCUSED ABSENCE: tipizhod=9 (Bolovanje HZZO 100%)
// Konvencija: voditelj upisuje 07:30–15:30; tretira se kao 8h plaćeno (050_BO_HZZO_100),
// ne ulazi u pay_001 i ne ulazi u disciplinu/overtime.
// -----------------------------
if (Number(rec.tipizhod) === 9) {
  const raw = Number(rec.duration_minutes_raw);
  const paidMin = (Number.isFinite(raw) && raw > 0)
    ? Math.min(MINUTES_PER_WORKDAY, raw)
    : MINUTES_PER_WORKDAY;

  d.paid_sick_hzzo_100_minutes = (d.paid_sick_hzzo_100_minutes || 0) + paidMin;
  d.pay_050_bo_hzzo_100_minutes = (d.pay_050_bo_hzzo_100_minutes || 0) + paidMin;

  d.is_paid_non_work_attendance = true;
  d.attendance_origin = d.attendance_origin || "manual_standardized";
  d.attendance_reason = "SICK_LEAVE_HZZO_100";

  // NE računati u on-site/WFH minute, NE računati lateness/early leave/overtime:
  continue;
}
 // kraj dodano 07/02-----
   // -----------------------------
  // WORK ON HOLIDAY / SUNDAY: tipizhod=7 (05 Blagdan Rad)
  // Policy:
  //  - puni 150% bucket: work_on_holiday_150_minutes + pay_005_work_on_holiday_minutes
  //  - NE ulazi u disciplinu (lateness/early leave debt)
  //  - NE ulazi u workday overtime signal (after/early overtime)
  //  - i dalje ostaje vidljiv kao presence (kroz on-site bucket ispod)
  // -----------------------------
  const isHolidayWork150 = (Number(rec.tipizhod) === 7);

  if (isHolidayWork150) {
    const raw = Number(rec.duration_minutes_raw);
    const paidMin = (Number.isFinite(raw) && raw > 0) ? raw : 0;

    d.work_on_holiday_150_minutes = (d.work_on_holiday_150_minutes || 0) + paidMin;
    d.pay_005_work_on_holiday_minutes = (d.pay_005_work_on_holiday_minutes || 0) + paidMin;

    // audit/meta
    d.is_paid_non_work_attendance = true;
    d.attendance_origin = d.attendance_origin || "auto";
    d.attendance_reason = "WORK_ON_HOLIDAY_150";
  }

  // WFH / ON-SITE minute buckets (with simple overlap guard)
  // -----------------------------
  const tvLocal = parseDateTimeDMYHM(rec.timevhod_raw);
  const tiLocal = rec.timeizhod_raw ? parseDateTimeDMYHM(rec.timeizhod_raw) : null;

  // za minute-bucket računamo samo zatvorene intervale s valjanim vremenima
  if (tvLocal && tiLocal && tiLocal.getTime() >= tvLocal.getTime()) {
    const startMs = tvLocal.getTime();
    const endMs   = tiLocal.getTime();

    if (rec.is_wfh) {
      // WFH: zbrajamo samo neto ne-preklapajuće minute (guard)
      const lastEnd = d._last_end_wfh ? Number(d._last_end_wfh) : null;
      const effStartMs = (lastEnd && startMs < lastEnd) ? lastEnd : startMs;

      if (effStartMs < endMs) {
  // POLICY: na WORKDAY (on-site) ne smijemo plaćati minute prije normaliziranog starta
  // Koristimo istu logiku kao computeInterval.duration_minutes_effective:
  let startMsForPay = effStartMs;

  if (rec.calendar_flags?.is_workday && !rec.is_wfh) {
    const tv = tvLocal; // već imate
    const startRef = dayStartRef(tv).getTime(); // 07:30

    const deltaStartMin = Math.floor((tv.getTime() - startRef) / 60000);

    if (deltaStartMin <= 30) {
      // rano ili do +30 min -> plaćeno od 07:30
      startMsForPay = Math.max(effStartMs, startRef);
    } else {
      // >30 min -> plaćeno od timevhod + 5 min
      startMsForPay = Math.max(effStartMs, tv.getTime() + BIG_LATE_PLUS_MIN * 60000);
    }
  }
// izmjena 14/02 
 if (startMsForPay < endMs) {
  const addMin = Math.floor((endMs - startMsForPay) / 60000);
  d.presence_on_site_minutes_raw = (d.presence_on_site_minutes_raw || 0) + addMin;

  // tipizhod=7 => Rad na blagdan/nedjelju (premium 150%) ide u 005 bez obzira na kalendar
  if (Number(rec.tipizhod) === 7) {
    d.work_on_holiday_150_minutes = (d.work_on_holiday_150_minutes || 0) + addMin;
  }

} else {
  d.needs_review = true;
}
} else {
  d.needs_review = true;
}
//kraj izmjena 14/02
      d._last_end_wfh = Math.max(lastEnd || 0, endMs);

      // WFH nije prisutnost na lokaciji (PT) i nema lateness/overtime policy
      d.is_present_on_site = false;

    } else {
  // promjenjeno 08/02 ON-SITE: računamo i RAW i EFFECTIVE minute
  const lastEnd = d._last_end_on_site ? Number(d._last_end_on_site) : null;

  // RAW start (audit)
  const rawStartMs = (lastEnd && startMs < lastEnd) ? lastEnd : startMs;

  // EFFECTIVE start (payroll basis):
  // - za WORKDAY on-site (ne WFH, ne split) koristimo timevhod_normalized (07:30 ili tv+5)
  // - inače fallback na raw start
  let payrollStartMs = startMs;
  if (d.is_workday && !rec.is_wfh && !rec.is_split_shift) {
    const tn = parseDateTimeDMYHM(rec.timevhod_normalized);
    if (tn) payrollStartMs = tn.getTime();
  }
  const effStartMs = (lastEnd && payrollStartMs < lastEnd) ? lastEnd : payrollStartMs;

  // RAW add
  if (rawStartMs < endMs) {
    const addRaw = Math.floor((endMs - rawStartMs) / 60000);
    d.presence_on_site_minutes_raw = (d.presence_on_site_minutes_raw || 0) + addRaw;
  } else {
    d.needs_review = true;
  }

  // EFFECTIVE add (samo ako ima smisla)
  if (effStartMs < endMs) {
    const addEff = Math.floor((endMs - effStartMs) / 60000);
    d.presence_on_site_minutes_effective = (d.presence_on_site_minutes_effective || 0) + addEff;
  } else {
    // ako efektivni start “preskoči” end, to je anomalija
    d.needs_review = true;
  }

  d._last_end_on_site = Math.max(lastEnd || 0, endMs);

  // ON-SITE znači prisutan za PT
  d.is_present_on_site = true;
}
// kraj promjenjeno 08/02
  }
  // ---- totals from non-duplicate only ----
  d.total_presence_minutes_raw += (rec.duration_minutes_raw || 0);
// zamjenjeno 14/02
if (!rec.is_wfh && !rec.is_split_shift && Number(rec.tipizhod) !== 7) {
  d.total_late_minutes_raw += (rec.late_minutes_raw || 0);
  d.total_late_minutes_normalized += (rec.late_minutes_normalized || 0);

  d.total_early_leave_minutes_raw += (rec.early_leave_minutes_raw || 0);
  d.total_early_leave_minutes_normalized += (rec.early_leave_minutes_normalized || 0);

  d.late_debt_minutes +=
    ((rec.late_minutes_normalized || 0) + (rec.early_leave_minutes_raw || 0)) * LATE_DEBT_MULTIPLIER;
}

 // kraj zamjenjeno 14/02

  // ---- overtime components (non-duplicate only, workday only) ----
   if (d.is_workday && rec.timeizhod_raw && !rec.is_wfh && !rec.is_split_shift && Number(rec.tipizhod) !== 7) {


    const tvLocal = parseDateTimeDMYHM(rec.timevhod_raw);
    const tiLocal = parseDateTimeDMYHM(rec.timeizhod_raw);

    if (tvLocal && tiLocal) {
      const startRef = dayStartRef(tvLocal); // 07:30
      const endRef = dayEndRef(tvLocal);     // 15:30

      // early arrival minutes = 07:30 - timevhod  (positive if came before start)
      const earlyArrival = Math.max(0, minutesDiff(tvLocal, startRef)); // startRef - tvLocal

      let earlyOT = 0;
      if (earlyArrival > EARLY_OVERTIME_THRESHOLD_MIN) {
        earlyOT = Math.max(0, earlyArrival - EARLY_OVERTIME_DEDUCT_MIN);
      }

      // after shift minutes = timeizhod - 15:30 (positive if left after end)
      const afterShift = Math.max(0, minutesDiff(endRef, tiLocal)); // tiLocal - endRef

      d.early_overtime_minutes += earlyOT;
      d.after_shift_minutes += afterShift;
    }
  }
}

// Derived per day - 07/02/2026 RAW buckets only (NO payroll allocation here)
for (const d of dailyMap.values()) {
  // ON-SITE: imamo dva izvora:
  // - RAW (audit): stvarni interval tv->ti
  // - EFFECTIVE (payroll basis za WORKDAY): normalized start -> ti
  const onSiteRaw = Math.max(0, Number(d.presence_on_site_minutes_raw || 0));
  const onSiteEff = Math.max(0, Number(d.presence_on_site_minutes_effective || 0));

  // WFH trenutno je RAW (nema normalizacije dolaska u vašim pravilima)
  const wfh = Math.max(0, Number(d.work_from_home_minutes || 0));

  // MONTHLY reconcile input:
  // - WORKDAY: koristimo EFFECTIVE da minute prije 07:30 ne ulaze u višak
  // - NON_WORKDAY: koristimo RAW (svaki rad je 150%)
  d.raw_on_site_minutes = d.is_workday ? onSiteEff : onSiteRaw;
  d.raw_wfh_minutes = wfh;

  // Informativno (nije payroll istina): daily KPI cap 480
  const workdayEff = Math.min(MINUTES_PER_WORKDAY, (d.raw_on_site_minutes || 0) + (d.raw_wfh_minutes || 0));
  d.total_work_minutes = workdayEff;

  // Informativno: overtime signal (after shift + early eligible) — payroll overtime se računa mjesečno
  d.overtime_work_minutes = Math.max(
    0,
    Number(d.after_shift_minutes || 0) + Number(d.early_overtime_minutes || 0)
  );
}

// sanity
for (const d of dailyMap.values()) {
  if (!Number.isFinite(d.total_presence_minutes_raw)) throw new Error("NaN presence");
  if (!Number.isFinite(d.total_work_minutes)) throw new Error("NaN work");
  if (!Number.isFinite(d.overtime_work_minutes)) throw new Error("NaN overtime");
  if (!Number.isFinite(d.late_debt_minutes)) throw new Error("NaN debt");
}

// Missing attendance days: for every workday in calendar, for every person
// Persons universe: prefer osebe_raw (backend authoritative), fallback to epr_data
const osebeRows = (datasets && Array.isArray(datasets.osebe_raw)) ? datasets.osebe_raw : [];
const personsFromOsebe = osebeRows.map(r => Number(r.osebid)).filter(Number.isFinite);

const personsFromEpr = Array.isArray(eprRows)
  ? eprRows.map(r => Number(r.osebid)).filter(Number.isFinite)
  : [];

const persons = Array.from(new Set(
  (personsFromOsebe.length > 0 ? personsFromOsebe : personsFromEpr)
));

// iterate calendar days in period range based on calendar rows (authoritative)
for (const [iso, cal] of calendarByISODate.entries()) {
  const isWorkday = Number(cal.dandelovni) === 1;
  const isHoliday = Number(cal.praznik) === 1;
  const isCollectiveLeave = isCollectiveLeaveText(cal.tekst);

  // billable workday = workday AND not holiday AND not collective leave
  if (!(isWorkday && !isHoliday && !isCollectiveLeave)) continue;


  for (const osebid of persons) {
    const person = peopleByOsebid.get(Number(osebid)) || {};
    const mode = String(person.mode || "FULL").toUpperCase();
    if (mode === "SLIM") continue;
    const key = dailyKey(osebid, iso);

    if (!dailyMap.has(key)) {
     const row = makeDailyRow({ osebid, isoDate: iso, cal, origin: "auto" });
     row.missing_attendance_day = true;
     row.needs_action = true;
     dailyMap.set(key, row);
     ;
    }
  }
}

const daily_summary = Array.from(dailyMap.values())
  .sort((a, b) => (a.osebid - b.osebid) || a.work_date.localeCompare(b.work_date));
//////////////////////////////$$$$$$$$$$$$$

///////////////////////////$$$$$$$$$$$$$$$$$$$******* */
for (const d of daily_summary) {
  const cal = calendarByISODate.get(d.work_date);
  if (!cal) continue; // KOLEDARDRZ pokriva sve, ali safety

  const isWorkday = Number(cal.dandelovni) === 1;
  const isHoliday = Number(cal.praznik) === 1;
  const isCollectiveLeave = isCollectiveLeaveText(cal.tekst);
  const person = peopleByOsebid.get(Number(d.osebid)) || {};
  const mode = String(person.mode || "FULL").toUpperCase();

  // Weekday check (Mon..Fri) from ISO date "YYYY-MM-DD"
  const [yy, mm, dd] = String(d.work_date || "").split("-").map(n => parseInt(n, 10));
  const wd = (yy && mm && dd) ? new Date(yy, mm - 1, dd).getDay() : -1; // 0=Sun..6=Sat
  const isWeekday = wd >= 1 && wd <= 5;

  // Day type (deterministički)
  d.day_type =
    isHoliday ? "HOLIDAY" :
    isCollectiveLeave ? "COLLECTIVE_LEAVE" :
    isWorkday ? "WORKDAY" :
    "NON_WORKDAY";

  const hasIntervals = (d.interval_count || 0) > 0;
///////////////////////+
// deterministički reset (svaki run iz nule)
// init (NE reset): ne smije pregaziti vrijednosti koje su već zbrojene u interval loopu
d.paid_holiday_100_minutes          = Number(d.paid_holiday_100_minutes ?? 0);
d.paid_collective_leave_100_minutes = Number(d.paid_collective_leave_100_minutes ?? 0);
d.overtime_150_minutes              = Number(d.overtime_150_minutes ?? 0);
d.work_on_holiday_150_minutes       = Number(d.work_on_holiday_150_minutes ?? 0);

d.paid_sick_70_minutes              = Number(d.paid_sick_70_minutes ?? 0);
d.paid_sick_hzzo_70_minutes         = Number(d.paid_sick_hzzo_70_minutes ?? 0);
d.paid_sick_hzzo_100_minutes        = Number(d.paid_sick_hzzo_100_minutes ?? 0);
d.pay_050_bo_hzzo_100_minutes       = Number(d.pay_050_bo_hzzo_100_minutes ?? 0);

d.paid_injury_hzzo_100_minutes      = Number(d.paid_injury_hzzo_100_minutes ?? 0);
d.paid_preg_comp_100_minutes        = Number(d.paid_preg_comp_100_minutes ?? 0);

d.missing_attendance_day            = Boolean(d.missing_attendance_day ?? false);
d.needs_action                      = Boolean(d.needs_action ?? false);

// needs_review se ne resetira ovdje jer dolazi iz interval_results; ali missing/needs_action da.

//////////////////////+
  // 1) is_present_on_site: ako ima intervale -> true
  // (kasnije možete razlikovati "RadOdKuce" kroz opomba/attendance_origin)
  d.is_present_on_site = (d.presence_on_site_minutes_raw || 0) > 0;

  // 2) lateness_day: brojimo dane s kašnjenjem/ranijim izlazom (workday only)
  d.lateness_day = Boolean(isWorkday && d.has_kasnjenje_raniji_izlaz);

  //  const isWeekday = isWeekdayISO(d.work_date);

  // HOLIDAY: plaća se 8h samo ako je pon–pet (bez obzira na dandelovni)
  if (mode !== "SLIM" && isHoliday && isWeekday) {
    d.paid_holiday_100_minutes = 480;
    d.pay_003_holiday_minutes = 480;
    d.is_paid_non_work_attendance = true;
    d.attendance_origin = d.attendance_origin || "calendar_auto";
    d.attendance_reason = "HOLIDAY_100";
  } else {
    d.paid_holiday_100_minutes = 0;
    d.pay_003_holiday_minutes = 0;
  }

  // COLLECTIVE LEAVE: u praksi je samo pon–pet, ali guard je isti
 if (mode !== "SLIM" && isCollectiveLeave && isWeekday) {
    d.paid_collective_leave_100_minutes = 480;
    d.pay_006_collective_leave_minutes = 480;
    d.is_paid_non_work_attendance = true;
    d.attendance_origin = d.attendance_origin || "calendar_auto";
    d.attendance_reason = "COLLECTIVE_LEAVE_100";
  } else {
    d.paid_collective_leave_100_minutes = 0;
    d.pay_006_collective_leave_minutes = 0;
  }
  // 07/02/2026 Sprijeci da NON_WORKDAY/WFH ulazi u regular fond
  if (!isWorkday && hasIntervals) {
  const workRaw = Math.max(0, (d.raw_on_site_minutes || 0) + (d.raw_wfh_minutes || 0));

  d.overtime_150_minutes += workRaw;

  if (isHoliday || isCollectiveLeave) {
    d.work_on_holiday_150_minutes += workRaw;
  }
}
d.pay_005_work_on_holiday_minutes = Math.max(0, d.work_on_holiday_150_minutes || 0);

  // 5) WORKDAY bez intervala: anomaly (MISSING_ATTENDANCE_DAY)
  // Ali samo za billable radni dan (nije holiday/CL)
 if (mode !== "SLIM" && isWorkday && !isHoliday && !isCollectiveLeave && !hasIntervals) {
    d.missing_attendance_day = true;
    d.needs_action = true;
    d.attendance_reason = d.attendance_reason || "UNKNOWN_ABSENCE";
    d.daily_notes = d.daily_notes || "Radni dan bez evidencije – potrebna odluka voditelja";
  }
}
/////////////////////////////********++++++++/
// --- PATCH: drop NON_WORKDAY rows with no activity (keep exceptions) ---
const daily_summary_out = daily_summary.filter(d => {
 

  const hasIntervals = (d.interval_count || 0) > 0;

  const person = peopleByOsebid.get(Number(d.osebid)) || {};
  const mode = String(person.mode || d.mode || "FULL").toUpperCase();

  // SLIM: zadrži samo stvarnu prisutnost ili tehničke flagove (review/action)
  if (mode === "SLIM") {
    const hasIntervals = (d.interval_count || 0) > 0;
    const hasFlags = !!d.needs_review || !!d.needs_action;
    return hasIntervals || hasFlags;
  }

  // FULL: keep all non-NON_WORKDAY
  if (d.day_type !== "NON_WORKDAY") return true;


  // NON_WORKDAY: keep only if something meaningful exists
  const hasPaidBuckets =
    (d.paid_holiday_100_minutes || 0) > 0 ||
    (d.paid_collective_leave_100_minutes || 0) > 0 ||
    (d.paid_sick_70_minutes || 0) > 0 ||
    (d.paid_sick_hzzo_70_minutes || 0) > 0 ||
    (d.paid_sick_hzzo_100_minutes || 0) > 0 ||
    (d.paid_injury_hzzo_100_minutes || 0) > 0 ||
    (d.paid_preg_comp_100_minutes || 0) > 0;

  const hasOvertime =
    (d.overtime_150_minutes || 0) > 0 ||
    (d.work_on_holiday_150_minutes || 0) > 0;

  const hasFlags = !!d.needs_review || !!d.needs_action;

  return hasIntervals || hasPaidBuckets || hasOvertime || hasFlags;
});
 // ---- ENRICH daily_summary_out with person fields ----
for (const d of daily_summary_out) {
  const person = peopleByOsebid.get(Number(d.osebid)) || {};
  d.group_code = person.group_code || "";
  d.mode = person.mode || "FULL"
  d.priimek = person.priimek || "";
  d.ime = person.ime || "";
}
// 07/02 run_facts must exist BEFORE period_summary monthly reconcile
const run_facts = computeRunFacts({ period, period_label, calendarByISODate, daily_summary: daily_summary_out });

// ---- dodano 25/01/2025 ----
// ---------------- reason_codes (v1) ----------------
// Deterministički: day-level anomalije iz interval_results + daily metrika.
// Output:
//  - d.reason_codes (union)
//  - d.review_reason_codes (actionable / data-quality / anti-gaming)
//  - d.info_reason_codes (disciplinary/info; ne mora nužno ići u actions_queue)

const REASON_ORDER = [
  // Missing
  "MISSING_DAY",

  // Integrity
  "OPEN_INTERVAL",
  "NEGATIVE_DURATION",
  "EXCESSIVE_DURATION",
  "UNKNOWN_TIPVhod",
  "UNKNOWN_TIPIzhod",
  "DUPLICATE_INTERVAL",
  "CONFLICTING_INTERVAL",

  // Policy / markers
  "SPLIT_SHIFT_SHORT",
  "WFH_CONFLICT",

  // Anti-gaming
  "SUSPICIOUS_SHORT_INTERVAL",

  // Disciplinary/info
  "LATE_ARRIVAL",
  "EARLY_LEAVE",
  "WORKTIME_DEFICIT"
];
// FINAL needs_review_count = broj DANA s needs_review (jedna istina)ngth;
let needs_review_count = daily_summary_out.filter(d => d.needs_review).length;
 
  // Period summary per person
const periodMap = new Map();
for (const d of daily_summary_out) {
  const person = peopleByOsebid.get(Number(d.osebid)) || {};
   if (!periodMap.has(d.osebid)) {
  periodMap.set(d.osebid, {
    osebid: d.osebid,

    group_code: person.group_code ?? "UNKNOWN",
    mode: person.mode ?? "FULL",          // <<< DODANO
    priimek: person.priimek ?? "",
    ime: person.ime ?? "",
    alt_id: person.alt_id ?? "",          // <<< PREPORUČENO (treba za payroll OIB)

    period_from: period.date_from,
    period_to: period.date_to,

      workdays_count: 0,

      // NEW: monthly totals
      total_presence_minutes_raw: 0,
      total_work_minutes: 0,                 // regular payable (sum dnevnih min(presence,480))
      total_overtime_work_minutes: 0,         // overtime CREDIT (sum dnevnih max(presence-480,0))
      total_late_debt_minutes: 0,             // sum debt
      overtime_payable_150_minutes: 0,        // AFTER compensation (računa se kasnije)
      uncovered_debt_minutes: 0,  
        // --- monthly reconcile facts dodano 07/02---
      billable_days_count: 0,
      payable_days_count: 0,
      raw_on_site_minutes_sum: 0,
      raw_wfh_minutes_sum: 0,
            // if debt > credit (računa se kasnije)
      // ---- PAYROLL TOTALS (minute) ----
      pay_001_regular_on_site_minutes: 0,
      pay_001_wfh_minutes: 0,
      pay_002_overtime_minutes: 0,
      pay_003_holiday_minutes: 0,
      pay_005_work_on_holiday_minutes: 0,
      pay_006_collective_leave_minutes: 0,

      pay_040_bo_70_minutes: 0,
      pay_040_bo_hzzo_70_minutes: 0,
      pay_050_bo_hzzo_100_minutes: 0,
      pay_050_ozljeda_hzzo_100_minutes: 0,
      pay_056_komp_trudnoca_minutes: 0,

      total_late_minutes_raw: 0,
      total_late_minutes_normalized: 0,
      total_early_leave_minutes_raw: 0,
      total_early_leave_minutes_normalized: 0,

      days_with_kasnjenje_raniji_izlaz: 0,

      missing_attendance_days_count: 0,
      manual_standardized_days_count: 0,
      sick_leave_days_count: 0,
      approved_leave_days_count: 0,

      open_intervals_count: 0,
      needs_review_count: 0,
      presence_days_count: 0,    // Prisutnost_Dana (PT eligibility)
      lateness_days_count: 0,    // Kasnjenja_Broj (broj dana s lateness/early leave)
      // --- Monthly settlement audit dodano 07/02 (deterministički) ---
      expected_paid_minutes: 0,
      total_paid_minutes_base: 0,
      paid_excess_minutes: 0,
      paid_shortage_minutes: 0,
      settlement_applied: false,
      overtime_policy: "",
      // kraj dodano 07/02
      period_notes: ""
    });
  }

  const p = periodMap.get(d.osebid);

 if (d.is_workday) p.workdays_count += 1;

// billable day = WORKDAY (nije HOLIDAY niti COLLECTIVE_LEAVE)
if (d.day_type === "WORKDAY") p.billable_days_count += 1;

// NEW: payable day = WORKDAY + HOLIDAY_100 + COLLECTIVE_LEAVE_100 (svaki vrijedi 1 dan)
if (d.day_type === "WORKDAY") p.payable_days_count += 1;
if ((d.pay_003_holiday_minutes || 0) > 0) p.payable_days_count += 1;
if ((d.pay_006_collective_leave_minutes || 0) > 0) p.payable_days_count += 1;

// 07/02 monthly raw facts (WORKDAY only) — critical: prevent pay_005 work from leaking into WORKDAY excess
if (d.day_type === "WORKDAY") {
  p.raw_on_site_minutes_sum += Math.max(0, d.raw_on_site_minutes || 0);
  p.raw_wfh_minutes_sum     += Math.max(0, d.raw_wfh_minutes || 0);
}

  // kraj 07/02 monthly raw facts  
  p.total_presence_minutes_raw += (d.total_presence_minutes_raw || 0);

  p.total_work_minutes += d.total_work_minutes;
  p.total_overtime_work_minutes += d.overtime_work_minutes;

  p.total_late_debt_minutes += (d.late_debt_minutes || 0);
  // ---- PAYROLL bucket aggregation (minute) ----
  p.pay_001_regular_on_site_minutes += (d.pay_001_regular_on_site_minutes || 0);
  p.pay_001_wfh_minutes += (d.pay_001_wfh_minutes || 0);

  p.pay_003_holiday_minutes += (d.pay_003_holiday_minutes || 0);
  p.pay_006_collective_leave_minutes += (d.pay_006_collective_leave_minutes || 0);

  p.pay_005_work_on_holiday_minutes += (d.pay_005_work_on_holiday_minutes || 0);

  // bolovanja (kad uvedete logiku, ova polja će se puniti)
  p.pay_040_bo_70_minutes += (d.pay_040_bo_70_minutes || 0);
  p.pay_040_bo_hzzo_70_minutes += (d.pay_040_bo_hzzo_70_minutes || 0);
  p.pay_050_bo_hzzo_100_minutes += (d.pay_050_bo_hzzo_100_minutes || 0);
  p.pay_050_ozljeda_hzzo_100_minutes += (d.pay_050_ozljeda_hzzo_100_minutes || 0);
  p.pay_056_komp_trudnoca_minutes += (d.pay_056_komp_trudnoca_minutes || 0);

  p.total_late_minutes_raw += d.total_late_minutes_raw;
  p.total_late_minutes_normalized += d.total_late_minutes_normalized;

  p.total_early_leave_minutes_raw += d.total_early_leave_minutes_raw;
  p.total_early_leave_minutes_normalized += d.total_early_leave_minutes_normalized;

  if (d.has_kasnjenje_raniji_izlaz) p.days_with_kasnjenje_raniji_izlaz += 1;
  if (d.missing_attendance_day) p.missing_attendance_days_count += 1;

  if (d.attendance_origin === "manual_standardized") p.manual_standardized_days_count += 1;
  if (d.attendance_reason === "SICK_LEAVE") p.sick_leave_days_count += 1;
  if (d.attendance_reason === "APPROVED_LEAVE") p.approved_leave_days_count += 1;

  // open intervals nisu u daily_summary direktno; ostavljamo 0 dok ne dodate dnevni agregat
  if (d.needs_review) p.needs_review_count += 1;
  // NEW: Prisutnost_Dana (PT) -> broj dana gdje je radnik bio prisutan na lokaciji (ima intervale)
  if (d.is_present_on_site) p.presence_days_count += 1;

  // NEW: Kasnjenja_Broj -> broj dana s kašnjenjem / ranijim odlaskom (vi ste već izračunali lateness_day)
  if (d.lateness_day) p.lateness_days_count += 1;

}
  // Open intervals & needs_review from interval_results****
  for (const rec of interval_results) {
    const p = periodMap.get(rec.osebid);
    if (!p) continue;
    if (rec.flags.open_interval) p.open_intervals_count += 1;
    // needs_review_count već dolazi iz daily, ali ovdje ostavljamo daily-driven kao “po danu”
  }
  // 08/02 zamjena bloka 
  // ===== FIX TDZ: period_summary must exist BEFORE monthly reconcile & recap =====
const period_summary = Array.from(periodMap.values())
  .sort((a, b) => a.osebid - b.osebid);
// --- MONTHLY RECONCILE 14/02(v4: 005 always stays 150%; no reclass into 001; debt hits only 002) ---
for (const p of period_summary) {
  // 1) FUND = payable days * 480
  const payableDays = Math.max(0, Number(p.payable_days_count || 0));
  const fund = payableDays * MINUTES_PER_WORKDAY;

  // 2) RAW WORKDAY minutes (only work performed on WORKDAY)
  const rawOnSite = Math.max(0, Number(p.raw_on_site_minutes_sum || 0));
  const rawWfh    = Math.max(0, Number(p.raw_wfh_minutes_sum || 0));
  const rawWorkday = rawOnSite + rawWfh;

  // 3) Non-work paid buckets that fill the fund
  const nonworkPaid =
    Number(p.pay_003_holiday_minutes || 0) +
    Number(p.pay_006_collective_leave_minutes || 0) +
    Number(p.pay_040_bo_70_minutes || 0) +
    Number(p.pay_040_bo_hzzo_70_minutes || 0) +
    Number(p.pay_050_bo_hzzo_100_minutes || 0) +
    Number(p.pay_050_ozljeda_hzzo_100_minutes || 0) +
    Number(p.pay_056_komp_trudnoca_minutes || 0);

  // 4) Regular cap for WORKDAY work (pay_001) = fund - nonworkPaid
  const regularCapWorkday = Math.max(0, fund - nonworkPaid);

  // 5) pay_001 from RAW WORKDAY minutes (split: on-site then WFH)
  const regTotal = Math.min(rawWorkday, regularCapWorkday);
  const regOnSite = Math.min(rawOnSite, regTotal);
  const regWfh    = Math.min(rawWfh, Math.max(0, regTotal - regOnSite));

  p.pay_001_regular_on_site_minutes = regOnSite;
  p.pay_001_wfh_minutes = regWfh;

  // 6) WORKDAY excess beyond regularCapWorkday is 150% candidate (pay_002), then debt coverage
  const workdayExcess = Math.max(0, rawWorkday - regularCapWorkday);
  const debt = Math.max(0, Number(p.total_late_debt_minutes || 0));

  // Debt reduces ONLY pay_002. 005 stays intact.
  p.pay_002_overtime_minutes = Math.max(0, workdayExcess - debt);
  p.uncovered_debt_minutes = Math.max(0, debt - workdayExcess);

  // 7) Totals / audit
  const pay005 = Math.max(0, Number(p.pay_005_work_on_holiday_minutes || 0));
  const pay002 = Math.max(0, Number(p.pay_002_overtime_minutes || 0));

  p.overtime_payable_150_minutes = pay005 + pay002;

  p.expected_paid_minutes = fund;

  // "Base" paid minutes that fill fund (does NOT include 005)
  p.total_paid_minutes_base =
    Number(p.pay_001_regular_on_site_minutes || 0) +
    Number(p.pay_001_wfh_minutes || 0) +
    nonworkPaid;

  p.paid_excess_minutes = Math.max(0, p.total_paid_minutes_base - fund);
  p.paid_shortage_minutes = Math.max(0, fund - p.total_paid_minutes_base);

  // No reclass in v4
  p.reclass_150_to_100_minutes = 0;

  p.overtime_policy =
    "MONTHLY v4: fund=payable*480; pay001<=fund-nonwork; pay005 always premium 150%; pay002=max(workdayExcess-debt,0); debt hits only 002";
}
// kraj 14/02
// run_facts + recap_lines (v1.0.1)  — AFTER period_summary exists
const recap_lines = buildRecapLines({
  run_facts,
  daily_summary: daily_summary_out,
  period_summary,
  config: {
    top_n: 5,
    minutes_per_workday: MINUTES_PER_WORKDAY
  }
});
// ===== END FIX TDZ =====
  // zamjena 08/02 kraj  bloka 
   const needs_action_count = daily_summary_out.filter(d => d.needs_action).length;

// helper: stable add + stable join
function addReason(set, code) {
  if (!code) return;
  set.add(code);
}
// zamjenjeno 26/01 sa robusnijom verzijom
function joinReasons(set) {
  const arr = Array.from(set);
  const idx = (x) => {
    const i = REASON_ORDER.indexOf(x);
    return i >= 0 ? i : 999;
  };
  arr.sort((a, b) => idx(a) - idx(b) || String(a).localeCompare(String(b)));
  return arr.join("|");
}
// PROMJENA 03/02/2026
function isUnknownTipvhod(t) { return !ALLOWED_TIPVHOD.has(Number(t)); }
function isUnknownTipizhod(t) { return !ALLOWED_TIPIZHOD.has(Number(t)); }


// Build day-level reasons from interval_results
const dayReasonMap = new Map();          // key -> Set(reason)
const dayMinDurMap = new Map();          // key -> min duration raw (for suspicious short)
const dayHasOnSiteMap = new Map();       // key -> boolean (has on-site interval)

//slijedeća funkcija izmjenjena 26/01/2026 , ne oslanja se na flags.negative...
for (const rec of interval_results) {
  if (!rec) continue;

  const k = dayKey(rec.osebid, rec.work_date);
  if (!dayReasonMap.has(k)) dayReasonMap.set(k, new Set());
  const set = dayReasonMap.get(k);

  const flags = rec.flags || {};
  // tipizhod=90: ignorirati u reason code derivaciji (posebno suspicious-short)
  if (Number(rec.tipizhod) === 90 || rec.is_ignored === true) {
    continue;
  }

  // Integrity flags that actually exist in interval_results.flags
  if (flags.open_interval) addReason(set, "OPEN_INTERVAL");
  if (flags.duplicate) addReason(set, "DUPLICATE_INTERVAL");
  if (flags.conflict) addReason(set, "CONFLICTING_INTERVAL");

  // duration: do not default to 0 (avoid false positives)
  const rawDur = rec.duration_minutes_raw;
  const hasDurValue = rawDur !== null && rawDur !== undefined && rawDur !== "";
  const dur = hasDurValue ? Number(rawDur) : NaN;

  // Negative / excessive derived deterministically from duration
  if (Number.isFinite(dur) && dur < 0) addReason(set, "NEGATIVE_DURATION");
  if (Number.isFinite(dur) && dur > EXCESSIVE_DURATION_MIN) addReason(set, "EXCESSIVE_DURATION");

  // Unknown tip values (allowlist)
  if (isUnknownTipvhod(Number(rec.tipvhod))) addReason(set, "UNKNOWN_TIPVhod");
  if (isUnknownTipizhod(Number(rec.tipizhod))) addReason(set, "UNKNOWN_TIPIzhod");

  // Split short (anti-gaming guard)
  if (rec.is_split_shift && Number.isFinite(dur) && dur > 0 && dur < SPLIT_SHIFT_MIN_MINUTES) {
    addReason(set, "SPLIT_SHIFT_SHORT");
  }

  // WFH conflict (deterministic): WFH marked but coming from RFID reader IP
  if (rec.is_wfh && rec.lokizhod && RFID_IPS.has(String(rec.lokizhod))) {
    addReason(set, "WFH_CONFLICT");
  }

  // For suspicious short interval detection: track min raw duration (only if duration is a real number)
  if (Number.isFinite(dur)) {
    const prev = dayMinDurMap.get(k);
    if (prev === undefined || dur < prev) dayMinDurMap.set(k, dur);
  }

  // On-site marker (tipizhod 0)
  if (Number(rec.tipizhod) === 0) {
    dayHasOnSiteMap.set(k, true);
  }
}
// Enrich daily_summary_out with reason codes
const SUSPICIOUS_SHORT_MAX_MIN = 2; // prag u minutama (v1); po potrebi podešavati

for (const d of daily_summary_out) {
  if (!d) continue;

  const all = new Set();
  const review = new Set();
  const info = new Set();

  const k = dayKey(d.osebid, d.work_date);
  const daySet = dayReasonMap.get(k);

  // Missing day (FULL discipline)
  if (d.missing_attendance_day) {
    addReason(all, "MISSING_DAY");
    addReason(review, "MISSING_DAY");
  }

  // Interval-derived review reasons
  if (daySet) {
    for (const code of daySet) {
      addReason(all, code);
      // sve osim disciplinary spada u review
      if (code !== "LATE_ARRIVAL" && code !== "EARLY_LEAVE" && code !== "WORKTIME_DEFICIT") {
        addReason(review, code);
      }
    }
  }

  // Disciplinary/info (ne mora u actions_queue, ali želite nomenklaturu)
  if (Number(d.total_late_minutes_raw || 0) > 0) {
    addReason(all, "LATE_ARRIVAL");
    addReason(info, "LATE_ARRIVAL");
  }
  if (Number(d.total_early_leave_minutes_raw || 0) > 0) {
    addReason(all, "EARLY_LEAVE");
    addReason(info, "EARLY_LEAVE");
  }
  if (Number(d.late_debt_minutes || 0) > 0) {
    addReason(all, "WORKTIME_DEFICIT");
    addReason(info, "WORKTIME_DEFICIT");
  }

  // Suspicious short interval (anti-gaming)
  // Ideja: ima intervala, nije missing, on-site je prisutan, ali min duration je ekstremno mala.
  // (Ovo hvata 15:30:00–15:30:25 i slične)
  const hasIntervals = (d.interval_count || 0) > 0;
const minDur = dayMinDurMap.get(k);
const hasOnSite = !!dayHasOnSiteMap.get(k);
const hasOpenInterval = daySet ? daySet.has("OPEN_INTERVAL") : false;

if (
  hasIntervals &&
  !d.missing_attendance_day &&
  hasOnSite &&
  !hasOpenInterval &&
  Number.isFinite(minDur) &&
  minDur >= 0 &&
  minDur <= SUSPICIOUS_SHORT_MAX_MIN
) {
  addReason(all, "SUSPICIOUS_SHORT_INTERVAL");
  addReason(review, "SUSPICIOUS_SHORT_INTERVAL");
  d.needs_review = true;
}
  d.reason_codes = joinReasons(all);
  d.review_reason_codes = joinReasons(review);
  d.info_reason_codes = joinReasons(info);
}

// ---- actions_queue ----
const actions_queue = [];

for (const d of daily_summary_out) {
  if (!d) continue;

  if (d.missing_attendance_day) {
    const person = peopleByOsebid.get(Number(d.osebid)) || {};

    actions_queue.push({
      action_id: `MISS_${d.osebid}_${d.work_date}`,
      action_type: "MISSING_ATTENDANCE_DAY",
      severity: "ACTION",

      osebid: d.osebid,
      group_code: person.group_code || "",   // <<< DODAJ OVDJE
      ime: person.ime || "",
      priimek: person.priimek || "",
      tel_gsm: person.tel_gsm || "",
      reason_codes: "MISSING_DAY",// dodano 25/01/2026
      work_date: d.work_date,
      summary: "Nema evidentiranog rada za radni dan",
      suggested_fix: "Unijeti bolovanje / GO ili ručno evidentirati rad",
      source: "daily_summary.missing_attendance_day",
      sms_candidate: person.tel_gsm ? 1 : 0,
      sms_candidate_type: person.tel_gsm ? "MISSING_WEEK" : "",
      status: "OPEN"
    });
  }

  // primjer druge grane: needs_review ili invalid scan (ako imate)
 if (d.needs_review === true) {
  const person = peopleByOsebid.get(Number(d.osebid)) || {};

  const rc = String(d.review_reason_codes || d.reason_codes || "");
  const willSms = !!person.tel_gsm && rc.split("|").map(s => s.trim()).includes("SUSPICIOUS_SHORT_INTERVAL");

  actions_queue.push({
    action_id: `REV_${d.osebid}_${d.work_date}`,
    action_type: "NEEDS_REVIEW",
    severity: "WARN",

    osebid: d.osebid,
    ime: person.ime || "",
    group_code: person.group_code || "",
    priimek: person.priimek || "",
    tel_gsm: person.tel_gsm || "",

    work_date: d.work_date,
    reason_codes: rc || "NEEDS_REVIEW",

    // NEW: UI signal (thin)
    sms_candidate: willSms ? 1 : 0,
    sms_candidate_type: willSms ? "SUSPICIOUS_SHORT_INTERVAL" : "",

    summary: "Potrebna provjera evidencije",
    suggested_fix: "Provjeriti intervale i ispraviti unos",
    source: "daily_summary.needs_review",
    status: "OPEN"
  });
}
}
////////////////////////////
  // run metadata skeleton (core će dopuniti run_id etc)
  const run_metadata = {
    run_id: "TO_BE_SET_BY_CORE",
    use_case: "epr_attendance_v1",
    contract_version: manifest.identity.contract_version,
    rules_version: "1.0.0",
    input_hash: "TO_BE_SET_BY_CORE",
    run_status: "DRAFT",
    generated_at: "TO_BE_SET_BY_CORE",
    rejects_count,
    needs_review_count,
    needs_action_count,

  };
/////////////////////////////
console.log("interval_results len =", Array.isArray(interval_results) ? interval_results.length : "NOT_ARRAY");
console.log("rejects_count =", rejects_count);
console.log("eprRows len =", eprRows.length);
console.log("interval_results len BEFORE return =", interval_results?.length);

//////////////////////////
// --- Final ISO normalization (defensive) 26/01
 for (const r of interval_results) {
  if (r && r.work_date) r.work_date = toISODateAny(r.work_date);
}
for (const d of daily_summary_out) {
  if (d && d.work_date) d.work_date = toISODateAny(d.work_date);
}
for (const a of actions_queue) {
  if (a && a.work_date) a.work_date = toISODateAny(a.work_date);
}
console.log("DEBUG period_summary len:", Array.isArray(period_summary) ? period_summary.length : "NOT_DEFINED");

  return {
    run_metadata,
    run_facts,
    recap_lines,
    interval_results,
    daily_summary: daily_summary_out,
    period_summary,
    actions_queue
  };
}

function computeRunFacts({ period, period_label, calendarByISODate, daily_summary }) {
  let workdays_count = 0;
  let holiday_days_count = 0;
  let collective_leave_days_count = 0;

  for (const cal of calendarByISODate.values()) {
    const isWorkday = Number(cal.dandelovni) === 1;
    const isHoliday = Number(cal.praznik) === 1;
    const isCL = isCollectiveLeaveText(cal.tekst);

    if (isWorkday) workdays_count++;
    if (isHoliday) holiday_days_count++;
    if (isCL) collective_leave_days_count++;
  }

  const billable_days_count = Array.from(calendarByISODate.values()).filter(cal => {
    const isWorkday = Number(cal.dandelovni) === 1;
    const isHoliday = Number(cal.praznik) === 1;
    const isCL = isCollectiveLeaveText(cal.tekst);
    return isWorkday && !isHoliday && !isCL;
  }).length;

 const expected_presence_days_count = billable_days_count;
const expected_effective_presence_minutes = expected_presence_days_count * MINUTES_PER_WORKDAY;
// umetnuto 07/02 PAYABLE days = weekdays (Mon-Fri) that are either WORKDAY or HOLIDAY or COLLECTIVE_LEAVE
// (ovo je "mjesečni fond" koji koristite za payroll očekivanje)
const payable_days_count = Array.from(calendarByISODate.entries()).filter(([iso, cal]) => {
  const isWeekday = isWeekdayISO(iso);
  if (!isWeekday) return false;

  const isWorkday = Number(cal.dandelovni) === 1;
  const isHoliday = Number(cal.praznik) === 1;
  const isCL = isCollectiveLeaveText(cal.tekst);

  return isWorkday || isHoliday || isCL;
}).length;

const expected_paid_minutes_month = payable_days_count * MINUTES_PER_WORKDAY;
const expected_paid_minutes_policy = "PAYABLE_DAYS(Mon-Fri: workday|holiday|collective_leave)*480";
// umetnuto 07/02 kraj 
// --- monthly payroll detector (deterministički) ---
function isFullMonthPayrollPeriod(p) {
  const from = String(p?.date_from || "");
  const to = String(p?.date_to || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return false;

  const [fy, fm, fd] = from.split("-").map(n => parseInt(n, 10));
  const [ty, tm, td] = to.split("-").map(n => parseInt(n, 10));
  if (!(fy && fm && fd && ty && tm && td)) return false;
  if (fy !== ty || fm !== tm) return false;     // isti mjesec
  if (fd !== 1) return false;                   // mora početi 1.

  // zadnji dan u mjesecu:
  const lastDay = new Date(fy, fm, 0).getDate(); // 0 => zadnji dan prethodnog mjeseca, ali fm je 1..12 => OK
  return td === lastDay;
}

const is_monthly_payroll = isFullMonthPayrollPeriod(period);

  const collective_leave_minutes = collective_leave_days_count * 480;
  const holiday_minutes = holiday_days_count * 480;

  const effective_presence_minutes = daily_summary.reduce((acc, d) => acc + (d.total_work_minutes || 0), 0);

 // zamjena 07/02
   return {
    period_from: period.date_from,
    period_to: period.date_to,
    period_label,

    workdays_count,
    collective_leave_days_count,
    holiday_days_count,

    expected_presence_days_count,
    expected_effective_presence_minutes,
    payable_days_count,
    expected_paid_minutes_month,
    expected_paid_minutes_policy,


    // NEW (audit)
    is_monthly_payroll,
    expected_paid_minutes_month,
    expected_paid_minutes_policy,

    collective_leave_minutes,
    holiday_minutes,
    effective_presence_minutes
  };
}
module.exports = { computeEprOutputs };
