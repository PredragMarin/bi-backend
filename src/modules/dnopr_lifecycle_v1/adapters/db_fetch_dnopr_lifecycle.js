"use strict";

const { executeAllowedBatch } = require("../../../core/erp_gateway/client");

function normalizeRow(row) {
  const out = {};
  if (!row || typeof row !== "object") return out;
  for (const [key, value] of Object.entries(row)) {
    out[String(key).trim().toLowerCase()] = value;
  }
  return out;
}

function normalizeRows(rows) {
  return Array.isArray(rows) ? rows.map(normalizeRow) : [];
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function toIsoDate(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function todayLocal() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
}

function addDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, 0, 0, 0, 0);
}

function resolveWindow({ fromISO, toISO }) {
  const today = todayLocal();
  const from = fromISO ? new Date(`${fromISO}T00:00:00`) : addDays(today, -90);
  const to = toISO ? new Date(`${toISO}T00:00:00`) : addDays(today, 90);
  return {
    fromISO: toIsoDate(from),
    toISO: toIsoDate(to),
    toExclusiveISO: toIsoDate(addDays(to, 1))
  };
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function trimValue(value) {
  return String(value === null || value === undefined ? "" : value).trim();
}

function minString(values) {
  const arr = values.filter(Boolean).map(String).sort();
  return arr.length ? arr[0] : "";
}

function maxString(values) {
  const arr = values.filter(Boolean).map(String).sort();
  return arr.length ? arr[arr.length - 1] : "";
}

function buildArtikelMetaMap(rows) {
  const map = new Map();
  rows.forEach((row) => {
    const artikel = trimValue(row.artikel);
    if (!artikel) return;
    map.set(artikel, {
      artikel,
      naziv1: trimValue(row.naziv1),
      tehid: trimValue(row.tehid),
      em: trimValue(row.em)
    });
  });
  return map;
}

function buildTehOpsByTehid(rows) {
  const map = new Map();
  rows.forEach((row) => {
    const tehid = trimValue(row.tehid);
    if (!tehid) return;
    if (!map.has(tehid)) map.set(tehid, []);
    map.get(tehid).push(row);
  });
  return map;
}

function distinctTehRows(rows) {
  const out = [];
  const seen = new Set();
  (rows || []).forEach((row) => {
    const key = trimValue(row.tehoprid || row.tehoprvarid || row.oper);
    if (!key) {
      out.push(row);
      return;
    }
    if (seen.has(key)) return;
    seen.add(key);
    out.push(row);
  });
  return out;
}

function computeArtikelMinutes({ artikelMetaBySifraid, tehOpsByTehid, sifraid, kolicina }) {
  const artikelMeta = artikelMetaBySifraid.get(trimValue(sifraid));
  const tehid = trimValue(artikelMeta && artikelMeta.tehid);
  if (!tehid) return 0;
  const tehRows = distinctTehRows(tehOpsByTehid.get(tehid) || []);
  if (!tehRows.length) return 0;
  const qty = toNumber(kolicina);
  const totalSeconds = tehRows.reduce((sum, row) => {
    return sum + ((toNumber(row.casvar) + toNumber(row.casfix)) * qty);
  }, 0);
  return Number((totalSeconds / 60).toFixed(2));
}

function computeArtikelOpsCount({ artikelMetaBySifraid, tehOpsByTehid, sifraid }) {
  const artikelMeta = artikelMetaBySifraid.get(trimValue(sifraid));
  const tehid = trimValue(artikelMeta && artikelMeta.tehid);
  if (!tehid) return 0;
  const tehRows = distinctTehRows(tehOpsByTehid.get(tehid) || []);
  return tehRows.length;
}

function summarizeWindowRows({ vdnRows, vdnoprRows, feedbackRows, artikelMetaBySifraid, tehOpsByTehid, fromISO, toISO }) {
  const opsByDnid = new Map();
  const feedbackByDnid = new Map();

  for (const row of vdnoprRows) {
    const dnid = Number(row.dnid);
    if (!opsByDnid.has(dnid)) opsByDnid.set(dnid, []);
    opsByDnid.get(dnid).push(row);
  }

  for (const row of feedbackRows) {
    const dnid = Number(row.dnid);
    if (!feedbackByDnid.has(dnid)) feedbackByDnid.set(dnid, []);
    feedbackByDnid.get(dnid).push(row);
  }

  const workOrders = vdnRows.map((row) => {
    const dnid = Number(row.dnid);
    const ops = opsByDnid.get(dnid) || [];
    const feedback = feedbackByDnid.get(dnid) || [];
    const sifraid = trimValue(row.sifraid);
    const artikelMeta = artikelMetaBySifraid.get(sifraid);
    const artikelNaziv = trimValue(artikelMeta && artikelMeta.naziv1);
    const artikelJm = trimValue(artikelMeta && artikelMeta.em);
    const artikelMinutes = computeArtikelMinutes({
      artikelMetaBySifraid,
      tehOpsByTehid,
      sifraid,
      kolicina: row.kolicina
    });
    const artikelOps = computeArtikelOpsCount({
      artikelMetaBySifraid,
      tehOpsByTehid,
      sifraid
    });
    const plannedSeconds = ops.reduce((sum, item) => sum + toNumber(item.casvarskup || item.casvar), 0);
    const actualSeconds = feedback.reduce((sum, item) => sum + toNumber(item.casefektf || item.casefekt), 0);
    const realizedDnoprIds = new Set(feedback.map((item) => Number(item.dnoprid)).filter(Number.isFinite));
    const plannedMinutes = Number((plannedSeconds / 60).toFixed(2));
    const actualMinutes = Number((actualSeconds / 60).toFixed(2));

    return {
      dnid,
      sifradn: trimValue(row.sifradn),
      projekt: trimValue(row.nalog),
      admctr: trimValue(row.admctr),
      admctr_naziv: trimValue(row.admctr_naziv),
      status_sifra: trimValue(row.status_sifra),
      status_naziv: trimValue(row.status_naziv),
      termin_zac: trimValue(row.termin_zac),
      termin_kon: trimValue(row.termin_kon),
      dat_lans: trimValue(row.dat_lans),
      dat_konc: trimValue(row.dat_konc),
      artikel_sifra: sifraid,
      artikel_naziv: artikelNaziv,
      artikel_jm: artikelJm,
      artikel: sifraid,
      sifraid,
      naziv1: trimValue(row.nalog_naziv || row.naziv1),
      kolicina: toNumber(row.kolicina),
      artikel_min: artikelMinutes,
      artikel_ops: artikelOps,
      operation_count_window: ops.length,
      feedback_rows_window: feedback.length,
      realized_operation_count_window: realizedDnoprIds.size,
      planned_minutes_window: plannedMinutes,
      art_plan_variance_minutes: Number((plannedMinutes - artikelMinutes).toFixed(2)),
      actual_minutes_window: actualMinutes,
      variance_minutes_window: Number((actualMinutes - plannedMinutes).toFixed(2)),
      progress_pct_window: ops.length ? Number(((realizedDnoprIds.size / ops.length) * 100).toFixed(1)) : 0,
      first_feedback_at_window: minString(feedback.map((item) => trimValue(item.timecr))),
      last_feedback_at_window: maxString(feedback.map((item) => trimValue(item.timecr)))
    };
  });

  const statusCounts = new Map();
  const admctrCounts = new Map();
  const projektCounts = new Map();
  for (const row of workOrders) {
    const status = row.status_sifra || "(blank)";
    const admctr = row.admctr || "(blank)";
    const projekt = row.projekt || "(blank)";
    statusCounts.set(status, (statusCounts.get(status) || 0) + 1);
    admctrCounts.set(admctr, (admctrCounts.get(admctr) || 0) + 1);
    projektCounts.set(projekt, (projektCounts.get(projekt) || 0) + 1);
  }

  return {
    window: {
      from: fromISO,
      to: toISO
    },
    meta: {
      v_dn_rows: vdnRows.length,
      v_dnopr_rows: vdnoprRows.length,
      v_feedback_rows: feedbackRows.length
    },
    facets: {
      status_options: Array.from(statusCounts.entries()).map(([value, count]) => ({ value, count })).sort((a, b) => a.value.localeCompare(b.value)),
      admctr_options: Array.from(admctrCounts.entries()).map(([value, count]) => ({ value, count })).sort((a, b) => a.value.localeCompare(b.value)),
      projekt_options: Array.from(projektCounts.entries()).map(([value, count]) => ({ value, count })).sort((a, b) => a.value.localeCompare(b.value))
    },
    work_orders: workOrders.sort((a, b) => String(a.termin_zac).localeCompare(String(b.termin_zac)) || String(a.sifradn).localeCompare(String(b.sifradn)))
  };
}

async function fetchDnoprLifecycleWindow({ fromISO, toISO, dsn = "ERP_POC_RO" }) {
  const win = resolveWindow({ fromISO, toISO });
  const requestId = `dnopr_window_${Date.now()}`;
  const baseResult = await executeAllowedBatch({
    moduleId: "dnopr_lifecycle_v1",
    requestId,
    dsnOverride: dsn,
    items: [
      { key: "vdnRows", queryId: "V_DN_WINDOW", params: [win.fromISO, win.toExclusiveISO] },
      { key: "vdnoprRows", queryId: "V_DNOPR_WINDOW", params: [win.fromISO, win.toExclusiveISO] },
      { key: "feedbackRows", queryId: "V_FEEDBACK_WINDOW", params: [win.fromISO, win.toExclusiveISO] }
    ]
  });

  if (!baseResult.ok) {
    throw new Error(baseResult.audit && baseResult.audit.error ? baseResult.audit.error : "DNOPR lifecycle window fetch failed");
  }

  const vdnRows = normalizeRows(baseResult.rowsByKey.vdnRows);
  const vdnoprRows = normalizeRows(baseResult.rowsByKey.vdnoprRows);
  const feedbackRows = normalizeRows(baseResult.rowsByKey.feedbackRows);
  const sifraids = Array.from(new Set(vdnRows.map((row) => trimValue(row.sifraid)).filter(Boolean))).sort();

  let artikelRows = [];
  let artikelDurationMs = 0;
  let tehDurationMs = 0;
  let tehRows = [];
  if (sifraids.length) {
    const artikelResult = await executeAllowedBatch({
      moduleId: "dnopr_lifecycle_v1",
      requestId: `${requestId}_artikel`,
      dsnOverride: dsn,
      items: sifraids.map((sifraid, index) => ({
        key: `artikel_${index}`,
        queryId: "ARTIKEL_BY_ARTIKEL",
        params: [sifraid]
      }))
    });

    if (!artikelResult.ok) {
      throw new Error(artikelResult.audit && artikelResult.audit.error ? artikelResult.audit.error : "ARTIKEL fetch failed");
    }

    artikelDurationMs = Number(artikelResult.audit && artikelResult.audit.duration_ms) || 0;
    artikelRows = Object.values(artikelResult.rowsByKey || {}).flatMap((rows) => normalizeRows(rows));

    const artikelMetaBySifraid = buildArtikelMetaMap(artikelRows);
    const tehids = Array.from(new Set(Array.from(artikelMetaBySifraid.values()).map((item) => trimValue(item.tehid)).filter(Boolean))).sort();
    if (tehids.length) {
      const tehResult = await executeAllowedBatch({
        moduleId: "dnopr_lifecycle_v1",
        requestId: `${requestId}_tehopr`,
        dsnOverride: dsn,
        items: tehids.map((tehid, index) => ({
          key: `tehopr_${index}`,
          queryId: "V_TEHOPR_VAR_BY_TEHID",
          params: [tehid]
        }))
      });

      if (!tehResult.ok) {
        throw new Error(tehResult.audit && tehResult.audit.error ? tehResult.audit.error : "V_TehOpr_Var fetch failed");
      }

      tehDurationMs = Number(tehResult.audit && tehResult.audit.duration_ms) || 0;
      tehRows = Object.values(tehResult.rowsByKey || {}).flatMap((rows) => normalizeRows(rows));
    }
  }

  const artikelMetaBySifraid = buildArtikelMetaMap(artikelRows);
  const tehOpsByTehid = buildTehOpsByTehid(tehRows);

  const view = summarizeWindowRows({
    vdnRows,
    vdnoprRows,
    feedbackRows,
    artikelMetaBySifraid,
    tehOpsByTehid,
    fromISO: win.fromISO,
    toISO: win.toISO
  });

  return {
    ...view,
    audit: {
      request_id: requestId,
      duration_ms: (Number(baseResult.audit && baseResult.audit.duration_ms) || 0) + artikelDurationMs + tehDurationMs,
      status: baseResult.audit.status
    }
  };
}

async function fetchDnoprLifecycleOrderDetail({ dnid, dsn = "ERP_POC_RO" }) {
  const requestId = `dnopr_detail_${dnid}_${Date.now()}`;
  const dbResult = await executeAllowedBatch({
    moduleId: "dnopr_lifecycle_v1",
    requestId,
    dsnOverride: dsn,
    items: [
      { key: "vdnRows", queryId: "V_DN_BY_DNID", params: [dnid] },
      { key: "vdnoprRows", queryId: "V_DNOPR_BY_DNID", params: [dnid] },
      { key: "feedbackRows", queryId: "V_FEEDBACK_BY_DNID", params: [dnid] }
    ]
  });

  if (!dbResult.ok) {
    throw new Error(dbResult.audit && dbResult.audit.error ? dbResult.audit.error : "DNOPR lifecycle detail fetch failed");
  }

  const header = normalizeRows(dbResult.rowsByKey.vdnRows)[0] || null;
  const operations = normalizeRows(dbResult.rowsByKey.vdnoprRows);
  const feedback = normalizeRows(dbResult.rowsByKey.feedbackRows);
  const sifraid = trimValue(header && header.sifraid);
  let artikelNaziv = "";
  let artikelTehid = "";
  let artikelJm = "";
  let artikelMin = 0;

  if (sifraid) {
    const artikelResult = await executeAllowedBatch({
      moduleId: "dnopr_lifecycle_v1",
      requestId: `${requestId}_artikel`,
      dsnOverride: dsn,
      items: [
        { key: "artikel", queryId: "ARTIKEL_BY_ARTIKEL", params: [sifraid] }
      ]
    });

    if (!artikelResult.ok) {
      throw new Error(artikelResult.audit && artikelResult.audit.error ? artikelResult.audit.error : "ARTIKEL detail fetch failed");
    }

    const artikelRows = normalizeRows(artikelResult.rowsByKey.artikel);
    const artikelMeta = artikelRows[0] || null;
    artikelNaziv = trimValue(artikelMeta && artikelMeta.naziv1);
    artikelTehid = trimValue(artikelMeta && artikelMeta.tehid);
    artikelJm = trimValue(artikelMeta && artikelMeta.em);
  }

  if (artikelTehid && header) {
    const tehResult = await executeAllowedBatch({
      moduleId: "dnopr_lifecycle_v1",
      requestId: `${requestId}_tehopr`,
      dsnOverride: dsn,
      items: [
        { key: "tehopr", queryId: "V_TEHOPR_VAR_BY_TEHID", params: [artikelTehid] }
      ]
    });

    if (!tehResult.ok) {
      throw new Error(tehResult.audit && tehResult.audit.error ? tehResult.audit.error : "V_TehOpr_Var detail fetch failed");
    }

    const tehRows = distinctTehRows(normalizeRows(tehResult.rowsByKey.tehopr));
    artikelMin = Number((tehRows.reduce((sum, row) => {
      return sum + ((toNumber(row.casvar) + toNumber(row.casfix)) * toNumber(header.kolicina));
    }, 0) / 60).toFixed(2));
  }

  const enrichedHeader = header ? {
    ...header,
    artikel_sifra: sifraid,
    artikel_naziv: artikelNaziv,
    artikel_jm: artikelJm,
    artikel_tehid: artikelTehid,
    artikel_min: artikelMin
  } : null;
  const feedbackByDnoprid = new Map();
  for (const row of feedback) {
    const key = Number(row.dnoprid);
    if (!feedbackByDnoprid.has(key)) feedbackByDnoprid.set(key, []);
    feedbackByDnoprid.get(key).push(row);
  }

  const operation_rows = operations.map((row) => {
    const matches = feedbackByDnoprid.get(Number(row.dnoprid)) || [];
    const actualSeconds = matches.reduce((sum, item) => sum + toNumber(item.casefektf || item.casefekt), 0);
    const plannedSeconds = toNumber(row.casvarskup || row.casvar);
    return {
      dnoprid: Number(row.dnoprid),
      oper: toNumber(row.oper),
      tekst: trimValue(row.tekst),
      status: trimValue(row.status),
      stdoper: trimValue(row.stdoper),
      dm: trimValue(row.dm),
      datzac: trimValue(row.datzac),
      datkon: trimValue(row.datkon),
      artikel_minutes: null,
      planned_minutes: Number((plannedSeconds / 60).toFixed(2)),
      actual_minutes: Number((actualSeconds / 60).toFixed(2)),
      variance_minutes: Number(((actualSeconds - plannedSeconds) / 60).toFixed(2)),
      casefektf: matches.length ? actualSeconds : null,
      knjizeno: matches.reduce((sum, item) => sum + toNumber(item.knjizeno), 0),
      izdelano: matches.reduce((sum, item) => sum + toNumber(item.izdelano), 0),
      next_dnoprid: row.dnoprid_naslednja ? Number(row.dnoprid_naslednja) : null,
      prev_dnoprid: row.dnoprid_predhodna ? Number(row.dnoprid_predhodna) : null
    };
  });

  const timeline_rows = feedback
    .slice()
    .sort((a, b) => String(a.timecr || "").localeCompare(String(b.timecr || "")) || Number(a.oper || 0) - Number(b.oper || 0))
    .map((row) => ({
      dnoprfid: Number(row.dnoprfid || 0),
      dnoprid: Number(row.dnoprid || 0),
      timecr: trimValue(row.timecr),
      datum: trimValue(row.datum),
      oper: toNumber(row.oper),
      tekst: trimValue(row.tekst),
      statusop: trimValue(row.statusop),
      statusdn: trimValue(row.statusdn),
      casefstr: trimValue(row.casefstr),
      casefektf: toNumber(row.casefektf || row.casefekt),
      priimekime: trimValue(row.priimekime),
      dm: trimValue(row.dm),
      datzac: trimValue(row.datzac),
      datkon: trimValue(row.datkon),
      kolicinafd: toNumber(row.kolicinafd || row.kolicina)
    }));

  const totals = {
    artikel_minutes: Number(artikelMin.toFixed(2)),
    planned_minutes: Number(operation_rows.reduce((sum, row) => sum + toNumber(row.planned_minutes), 0).toFixed(2)),
    actual_minutes: Number(operation_rows.reduce((sum, row) => sum + toNumber(row.actual_minutes), 0).toFixed(2)),
    variance_minutes: Number(operation_rows.reduce((sum, row) => sum + toNumber(row.variance_minutes), 0).toFixed(2))
  };

  return {
    audit: {
      request_id: requestId,
      duration_ms: dbResult.audit.duration_ms,
      status: dbResult.audit.status
    },
    header: enrichedHeader,
    operation_rows,
    operation_totals: totals,
    timeline_rows
  };
}

module.exports = {
  fetchDnoprLifecycleWindow,
  fetchDnoprLifecycleOrderDetail,
  resolveWindow
};
