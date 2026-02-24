// _poc/erp_gateway_smoke/query_allowlist.js

const QUERY_ALLOWLIST = {
  SMOKE_HEALTH: {
    sql: "SELECT 1 AS smoke_ok",
    timeoutMs: 5000,
    maxRows: 10,
    allowParams: false,
    description: "Connectivity + auth health check"
  },
  SMOKE_OSEBE_TOP10: {
    sql: "SELECT TOP 10 osebid, ime, priimek FROM osebe WHERE aktiven = 2 ORDER BY osebid",
    timeoutMs: 10000,
    maxRows: 50,
    allowParams: false,
    description: "Simple read of ERP people sample"
  }
};

function getAllowedQuery(queryId) {
  const q = QUERY_ALLOWLIST[String(queryId || "").trim().toUpperCase()];
  if (!q) {
    const supported = Object.keys(QUERY_ALLOWLIST).join(", ");
    throw new Error(`Query ID not allowed: ${queryId}. Allowed: ${supported}`);
  }
  return q;
}

module.exports = {
  QUERY_ALLOWLIST,
  getAllowedQuery
};
