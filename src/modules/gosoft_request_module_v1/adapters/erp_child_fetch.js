"use strict";

const { executeErpAllowedBatch } = require("../../../core_shell/services/erp_fetch_service");

async function fetchChildRows({ request, parentRows }) {
  const dnids = [...new Set(parentRows.map((row) => Number(row.DNID)).filter((n) => Number.isFinite(n)))];
  if (!dnids.length) {
    return {
      rows: [],
      warnings: []
    };
  }

  const items = dnids.map((dnid) => ({
    key: `dnid_${dnid}`,
    queryId: "POTREBA_BY_DNID",
    params: [dnid]
  }));

  const result = await executeErpAllowedBatch({
    moduleId: "gosoft_request_module_v1",
    requestId: `${request.request_id}_potreba`,
    items
  });

  if (!result.ok) {
    const msg = result.audit && result.audit.error ? result.audit.error : "POTREBA fetch failed";
    throw new Error(msg);
  }

  const out = [];
  for (const dnid of dnids) {
    const rows = result.rowsByKey[`dnid_${dnid}`] || [];
    out.push(...rows);
  }
  return {
    rows: out,
    warnings: []
  };
}

module.exports = {
  fetchChildRows
};
