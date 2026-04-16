"use strict";

function buildManifest({
  request,
  processedAt,
  files,
  vDnRows,
  potrebaRows,
  warnings
}) {
  const uniqueDnid = new Set(vDnRows.map((row) => String(row.DNID ?? row.dnid ?? ""))).size;
  const uniquePotrid = new Set(potrebaRows.map((row) => String(row.potrid ?? row.POTRID ?? ""))).size;
  const safeWarnings = Array.isArray(warnings) ? warnings : [];
  return {
    request_id: request.request_id,
    module_id: request.module_id,
    contract_version: request.contract_version,
    status: safeWarnings.length ? "completed_with_warnings" : "completed",
    requested_at: request.requested_at,
    processed_at: processedAt,
    fetch_mode: request.fetch_mode,
    params: request.params,
    files,
    counts: {
      v_dn_rows: vDnRows.length,
      potreba_rows: potrebaRows.length,
      unique_dnid: uniqueDnid,
      unique_potrid: uniquePotrid,
      warning_count: safeWarnings.length
    },
    warnings: safeWarnings,
    lineage: {
      source_system: "gosoft",
      parent_source: "V_DN",
      child_source: "POTREBA",
      child_enrichment_sources: ["ARTIKEL", "ARTKLAS"]
    }
  };
}

module.exports = {
  buildManifest
};
