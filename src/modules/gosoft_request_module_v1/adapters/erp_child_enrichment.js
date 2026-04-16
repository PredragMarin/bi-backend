"use strict";

const { executeErpAllowedBatch } = require("../../../core_shell/services/erp_fetch_service");

function normalizePotrebaRow(row) {
  return {
    potrid: row.potrid,
    dnid: row.dnid,
    ident: row.ident,
    status: row.status,
    kolicina: row.kolicina,
    koltrn: row.koltrn,
    pozicija: row.pozicija,
    tehn: row.tehn,
    termin: row.termin,
    opombe: row.opombe,
    dnoprid: row.dnoprid,
    izmetkolnakos: row.izmetkolnakos,
    kolvhod: row.kolvhod,
    timecr: row.timecr,
    timemod: row.timemod,
    usercr: row.usercr,
    usermod: row.usermod,
    zamikvgr: row.zamikvgr,
    osebid: row.osebid,
    potrdil: row.potrdil,
    kontr_pod: row.kontr_pod
  };
}

async function enrichChildRows({ request, childRows }) {
  const targetArtids = [...new Set(childRows
    .map((row) => Number(row.ident) + 1)
    .filter((n) => Number.isFinite(n) && n > 0))];

  let artikelByArtid = new Map();
  if (targetArtids.length) {
    const artikelItems = targetArtids.map((artid) => ({
      key: `art_${artid}`,
      queryId: "ARTIKEL_BY_ARTID",
      params: [artid]
    }));
    const artikelResult = await executeErpAllowedBatch({
      moduleId: "gosoft_request_module_v1",
      requestId: `${request.request_id}_artikel`,
      items: artikelItems
    });
    if (!artikelResult.ok) {
      const msg = artikelResult.audit && artikelResult.audit.error ? artikelResult.audit.error : "ARTIKEL enrichment failed";
      throw new Error(msg);
    }
    artikelByArtid = new Map(targetArtids.map((artid) => [artid, (artikelResult.rowsByKey[`art_${artid}`] || [])[0] || null]));
  }

  const matchedArtids = [...new Set([...artikelByArtid.values()].filter(Boolean).map((row) => Number(row.artid)).filter(Number.isFinite))];
  let artklasByArtid = new Map();
  if (matchedArtids.length) {
    const artklasItems = matchedArtids.map((artid) => ({
      key: `artklas_${artid}`,
      queryId: "ARTKLAS_BY_ARTID",
      params: [artid]
    }));
    const artklasResult = await executeErpAllowedBatch({
      moduleId: "gosoft_request_module_v1",
      requestId: `${request.request_id}_artklas`,
      items: artklasItems
    });
    if (!artklasResult.ok) {
      const msg = artklasResult.audit && artklasResult.audit.error ? artklasResult.audit.error : "ARTKLAS enrichment failed";
      throw new Error(msg);
    }
    artklasByArtid = new Map(matchedArtids.map((artid) => [artid, artklasResult.rowsByKey[`artklas_${artid}`] || []]));
  }

  const warnings = [];
  const enrichedRows = childRows.map((row) => {
    const normalized = normalizePotrebaRow(row);
    const artikel = artikelByArtid.get(Number(row.ident) + 1) || null;
    const artklas = artikel ? (artklasByArtid.get(Number(artikel.artid)) || []) : [];
    const kljucevi = artklas
      .map((item) => String(item.kljuc || "").trim())
      .filter(Boolean)
      .join(";");

    if (!artikel) {
      warnings.push({
        code: "PARTIAL_ENRICHMENT",
        message: `Missing ARTIKEL enrichment for potrid=${row.potrid}`
      });
    }

    return {
      ...normalized,
      artikel_artid: artikel ? artikel.artid : null,
      artikel_artikel: artikel ? artikel.artikel : null,
      artikel_naziv1: artikel ? artikel.naziv1 : null,
      artikel_naziv2: artikel ? artikel.naziv2 : null,
      artikel_admid: artikel ? artikel.admid : null,
      artikel_barkoda: artikel ? artikel.barkoda : null,
      artikel_em: artikel ? artikel.em : null,
      artklas_kljucevi: kljucevi
    };
  });

  const dedupWarnings = [];
  const seen = new Set();
  for (const warning of warnings) {
    const key = `${warning.code}:${warning.message}`;
    if (!seen.has(key)) {
      seen.add(key);
      dedupWarnings.push(warning);
    }
  }

  return {
    rows: enrichedRows,
    warnings: dedupWarnings
  };
}

module.exports = {
  enrichChildRows
};
