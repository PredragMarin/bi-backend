"use strict";

const { executeErpAllowedBatch } = require("../../../core_shell/services/erp_fetch_service");
const { WARNING_CODES } = require("../domain/warning_codes");

function nextDayISO(dateISO) {
  const [y, m, d] = String(dateISO).split("-").map((v) => parseInt(v, 10));
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

async function fetchParentRows({ request }) {
  if (request.fetch_mode === "sifradn_list") {
    const sifradnList = request.params.sifradn_list || [];
    const items = sifradnList.map((sifradn, index) => ({
      key: `sifradn_${index}`,
      queryId: "V_DN_BY_SIFRADN",
      params: [sifradn]
    }));
    const result = await executeErpAllowedBatch({
      moduleId: "gosoft_request_module_v1",
      requestId: request.request_id,
      items
    });
    if (!result.ok) {
      const msg = result.audit && result.audit.error ? result.audit.error : "V_DN fetch failed";
      throw new Error(msg);
    }

    const rows = [];
    const warnings = [];
    for (const [index, requestedSifradn] of sifradnList.entries()) {
      const matchedRows = (result.rowsByKey[`sifradn_${index}`] || []).filter((row) =>
        String(row.admctr || row.ADMCTR || "").trim() === request.params.admctr
      );
      if (!matchedRows.length) {
        warnings.push({
          code: WARNING_CODES.SIFRADN_NOT_FOUND,
          message: `SIFRADN ${requestedSifradn} was not found in V_DN for admctr=${request.params.admctr}`
        });
        continue;
      }
      rows.push(...matchedRows.map((row) => ({
        ...row,
        SIFRADN: row.SIFRADN || row.sifradn,
        DNID: row.DNID || row.dnid,
        KOLICINA: row.KOLICINA ?? row.kolicina,
        ADMCTR: row.ADMCTR || row.admctr
      })));
    }

    return {
      rows,
      warnings
    };
  }

  const result = await executeErpAllowedBatch({
    moduleId: "gosoft_request_module_v1",
    requestId: request.request_id,
    items: [
      {
        key: "v_dn",
        queryId: "V_DN_WINDOW",
        params: [request.params.from, nextDayISO(request.params.to)]
      }
    ]
  });

  if (!result.ok) {
    const msg = result.audit && result.audit.error ? result.audit.error : "V_DN fetch failed";
    throw new Error(msg);
  }

  return {
    rows: (result.rowsByKey.v_dn || []).filter((row) => String(row.ADMCTR || "").trim() === request.params.admctr),
    warnings: []
  };
}

module.exports = {
  fetchParentRows
};
