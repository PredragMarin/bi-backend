// src/core/erp_gateway/query_allowlist.js

const QUERY_ALLOWLIST = {
  EPR_DATA_RANGE: {
    sql: `
      SELECT
        osebid,
        timevhod,
        timeizhod,
        tipvhod,
        tipizhod,
        opomba,
        lokizhod,
        timevhod_x,
        timeizhod_x,
        tipizhod_x,
        usermod,
        timemod
      FROM EprDATA
      WHERE timevhod >= ? AND timevhod < ?
      ORDER BY timevhod ASC;
    `,
    timeoutMs: 30000,
    maxRows: 300000
  },
  EPR_CAL_RANGE: {
    sql: `
      SELECT datum, dandelovni, tekst, praznik
      FROM KOLEDARDRZ
      WHERE datum >= ? AND datum < ?
      ORDER BY datum ASC;
    `,
    timeoutMs: 10000,
    maxRows: 10000
  },
  EPR_OSEBE_ACTIVE: {
    sql: `
      SELECT osebid, ime, priimek, aktiven, matst, e_mail, eprcode, tel_gsm, alt_id, skype_name
      FROM osebe
      WHERE aktiven = 2
        AND priimek NOT LIKE '%GOinfo%';
    `,
    timeoutMs: 15000,
    maxRows: 30000
  }
};

function getAllowedQuery(queryId) {
  const key = String(queryId || "").trim().toUpperCase();
  const q = QUERY_ALLOWLIST[key];
  if (!q) {
    throw new Error(`Query ID not allowed: ${queryId}`);
  }
  return q;
}

module.exports = {
  getAllowedQuery,
  QUERY_ALLOWLIST
};
