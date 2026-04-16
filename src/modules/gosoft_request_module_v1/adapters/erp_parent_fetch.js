"use strict";

const { executeErpAllowedBatch } = require("../../../core_shell/services/erp_fetch_service");

function nextDayISO(dateISO) {
  const [y, m, d] = String(dateISO).split("-").map((v) => parseInt(v, 10));
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

async function fetchParentRows({ request }) {
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

  return (result.rowsByKey.v_dn || []).filter((row) => String(row.ADMCTR || "").trim() === request.params.admctr);
}

module.exports = {
  fetchParentRows
};
