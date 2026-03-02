// src/dev/db_fetch_epr.js
const { transformDataset } = require("../core/validate");
const { executeAllowedBatch } = require("../core/erp_gateway/client");
const { buildSyntheticRowsFromHzzo } = require("./hzzo_ingest");
const { resolveIngestSource } = require("../core/excel_shell/ingest_sources");

// Feature flag:
// - default = LEGACY (sacuvaj postojecu funkcionalnost)
// - set EMPLOYEE_TAGS_V1=1 da ukljucis novi transformer put
const USE_EMPLOYEE_TAGS = true;

// -------------------- helpers --------------------
function assertISODate(s, name) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) {
    throw new Error(`Invalid ${name} (expected YYYY-MM-DD): ${s}`);
  }
}
function pad2(n) { return String(n).padStart(2, "0"); }

function toDMYHM(dbDateTimeStr) {
  if (!dbDateTimeStr) return null;
  const s = String(dbDateTimeStr).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return null;
  const [, yyyy, mm, dd, HH, MM] = m;
  return `${dd}/${mm}/${yyyy} ${HH}:${MM}`;
}

function toDMY(dbDateStr) {
  if (!dbDateStr) return null;
  const s = String(dbDateStr).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const [, yyyy, mm, dd] = m;
  return `${dd}/${mm}/${yyyy}`;
}

function toInt(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

// -------------------- legacy fallback (kept to avoid breaking existing behavior) --------------------
const LEGACY_ALLOWED_GROUPS = new Set(["INOX", "MXD", "ADM", "WHL"]);
function legacyNormalizeGroupCode(skypeName) {
  const gc = String(skypeName ?? "").trim().toUpperCase();
  return LEGACY_ALLOWED_GROUPS.has(gc) ? gc : ""; // "" => osoba je OUT of scope
}

// -------------------- main fetch --------------------
async function fetchEprDatasets({
  fromISO,
  toISO,
  dsn = "ERP_POC_RO",
  hzzoEnabled = false,
  hzzoDir = "",
  hzzoAsOfDate = ""
}) {
  assertISODate(fromISO, "from");
  assertISODate(toISO, "to");

  // endExclusive = day after toISO (YYYY-MM-DD)
  const [ty, tm, td] = toISO.split("-").map(x => parseInt(x, 10));
  const endExclusive = new Date(ty, tm - 1, td + 1, 0, 0, 0, 0);
  const endExISO = `${endExclusive.getFullYear()}-${pad2(endExclusive.getMonth() + 1)}-${pad2(endExclusive.getDate())}`;

  const requestId = `epr_fetch_${Date.now()}`;
  const dbResult = await executeAllowedBatch({
    moduleId: "epr_attendance_v1",
    requestId,
    dsnOverride: dsn,
    items: [
      { key: "eprRows", queryId: "EPR_DATA_RANGE", params: [fromISO, endExISO] },
      { key: "calRows", queryId: "EPR_CAL_RANGE", params: [fromISO, endExISO] },
      { key: "osebeRows", queryId: "EPR_OSEBE_ACTIVE", params: [] }
    ]
  });

  if (!dbResult.ok) {
    const m = dbResult.audit && dbResult.audit.error ? dbResult.audit.error : "ERP batch fetch failed";
    throw new Error(m);
  }

  const eprRows = dbResult.rowsByKey.eprRows || [];
  const calRows = dbResult.rowsByKey.calRows || [];
  const osebeRows = dbResult.rowsByKey.osebeRows || [];

  const epr_data_all = eprRows.map(r => ({
    osebid: toInt(r.osebid),
    timevhod: toDMYHM(r.timevhod),
    timeizhod: r.timeizhod ? toDMYHM(r.timeizhod) : null,
    tipvhod: toInt(r.tipvhod),
    tipizhod: toInt(r.tipizhod),
    opomba: r.opomba ?? "",

    // extra (backend-only / audit)
    timevhod_x: r.timevhod_x ?? null,
    timeizhod_x: r.timeizhod_x ?? null,
    tipizhod_x: r.tipizhod_x ?? null,
    usermod: r.usermod ?? null,
    timemod: r.timemod ?? null,
    lokizhod: r.lokizhod ?? null,
  }));

  const calendar = calRows.map(r => ({
    datum: toDMY(r.datum),
    dandelovni: toInt(r.dandelovni),
    tekst: r.tekst ?? "",
    praznik: toInt(r.praznik),
  }));

  // -------------------- EMPLOYEE TAGS TRANSFORM (GRP/MODE) --------------------
  // Default behavior is LEGACY unless feature flag is enabled.
  let t = { rows: osebeRows, warnings: [], errors: [], facts: {} };
  let transformerOk = false;

  if (USE_EMPLOYEE_TAGS) {
    t = transformDataset("employee_tags", osebeRows);
    transformerOk = Array.isArray(t.errors) ? t.errors.length === 0 : true;
  }

  let osebe_raw;

  if (USE_EMPLOYEE_TAGS && transformerOk) {
    // Universe osoba = samo klasificirani (group_code != "")
    osebe_raw = (t.rows || [])
      .map(r => ({
        osebid: toInt(r.osebid),
        ime: r.ime ?? "",
        priimek: r.priimek ?? "",
        matst: r.matst ?? "",
        e_mail: r.e_mail ?? "",
        aktiven: toInt(r.aktiven),
        eprcode: r.eprcode ?? "",
        tel_gsm: r.tel_gsm ?? "",
        alt_id: r.alt_id ?? "",

        // canonical outputs from transformer
        group_code: String(r.group_code ?? "").trim().toUpperCase(),
        mode: String(r.mode ?? "FULL").trim().toUpperCase(),

        // audit (optional)
        tags_raw: r.tags_raw ?? "",
        tags: (r.tags && typeof r.tags === "object") ? r.tags : {},
        tags_warnings: Array.isArray(r.tags_warnings) ? r.tags_warnings : []
      }))
      .filter(p => !!p.group_code);
  } else {
    // Legacy behavior (previous stable scope)
    osebe_raw = osebeRows
      .map(r => ({
        osebid: toInt(r.osebid),
        ime: r.ime ?? "",
        priimek: r.priimek ?? "",
        matst: r.matst ?? "",
        e_mail: r.e_mail ?? "",
        aktiven: toInt(r.aktiven),
        eprcode: r.eprcode ?? "",
        tel_gsm: r.tel_gsm ?? "",
        alt_id: r.alt_id ?? "",
        group_code: legacyNormalizeGroupCode(r.skype_name),
        mode: "FULL",

        // audit fields (keep shape stable for downstream)
        tags_raw: r.skype_name ?? "",
        tags: {},
        tags_warnings: USE_EMPLOYEE_TAGS ? ["TRANSFORM_FALLBACK"] : []
      }))
      .filter(p => !!p.group_code);
  }

  // Scope epr_data to same universe (avoid FK noise)
  const allowedOsebid = new Set(osebe_raw.map(p => p.osebid));
  const epr_data = epr_data_all.filter(r => allowedOsebid.has(r.osebid));

  // Optional: enrich epr_data with HZZO-derived synthetic sick-leave rows.
  // This reduces false "missing attendance day" signals during the month.
  let hzzoAudit = {
    enabled: false,
    files_total: 0,
    files_loaded: 0,
    rows_loaded: 0,
    intervals_confirmed: 0,
    open_signals: 0,
    days_synthesized: 0,
    unmatched_oib_count: 0
  };
  let epr_data_merged = epr_data;
  if (hzzoEnabled) {
    const sourceCfg = resolveIngestSource({
      moduleKey: "epr_hzzo",
      sourceDirOverride: hzzoDir,
      periodDateISO: toISO
    });
    if (!sourceCfg.resolved_source_dir) {
      throw new Error("HZZO ingest enabled, but no source_dir resolved. Provide hzzo_dir or set EPR_HZZO_SOURCE_DIR.");
    }
    const hzzo = buildSyntheticRowsFromHzzo({
      fromISO,
      toISO,
      asOfISO: hzzoAsOfDate || toISO,
      eprRows: epr_data,
      calendar,
      osebeRaw: osebe_raw,
      hzzoDir: sourceCfg.resolved_source_dir
    });
    hzzoAudit = hzzo.audit || hzzoAudit;
    hzzoAudit.resolved_source_dir = sourceCfg.resolved_source_dir;
    hzzoAudit.module_key = sourceCfg.module_key;
    hzzoAudit.mode = sourceCfg.mode;
    if (Array.isArray(hzzo.rows) && hzzo.rows.length > 0) {
      epr_data_merged = epr_data.concat(hzzo.rows);
    }
  }

  return {
    epr_data: epr_data_merged,
    calendar,
    osebe_raw,
    meta: {
      eprRows: epr_data_merged.length,
      eprRows_base: epr_data.length,
      calRows: calendar.length,
      osebeRows: osebe_raw.length,
      erp_gateway: {
        request_id: requestId,
        duration_ms: dbResult.audit.duration_ms,
        status: dbResult.audit.status
      },

      // transform audit (helps debugging; safe to expose)
      employee_tags: {
        enabled: USE_EMPLOYEE_TAGS,
        ok: USE_EMPLOYEE_TAGS ? transformerOk : null,
        warnings: USE_EMPLOYEE_TAGS && Array.isArray(t.warnings) ? t.warnings.length : 0,
        errors: USE_EMPLOYEE_TAGS && Array.isArray(t.errors) ? t.errors.length : 0,
        facts: USE_EMPLOYEE_TAGS ? (t.facts || {}) : {}
      },
      hzzo: hzzoAudit
    }
  };
}

module.exports = { fetchEprDatasets };
