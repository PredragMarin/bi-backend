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
  },
  V_DN_WINDOW: {
    sql: `
      SELECT *
      FROM V_DN
      WHERE termin_zac >= ? AND termin_zac < ?
      ORDER BY termin_zac ASC, sifradn ASC;
    `,
    timeoutMs: 45000,
    maxRows: 50000
  },
  V_DN_BY_DNID: {
    sql: `
      SELECT *
      FROM V_DN
      WHERE dnid = ?;
    `,
    timeoutMs: 10000,
    maxRows: 20
  },
  V_DN_BY_SIFRADN: {
    sql: `
      SELECT opombe, dnid, nalogid, nalog, sifraid, kolicina, admctr, status, status_sifra, sifradn
      FROM V_DN
      WHERE sifradn = ?;
    `,
    timeoutMs: 10000,
    maxRows: 5
  },
  V_DNOPR_WINDOW: {
    sql: `
      SELECT *
      FROM V_DNOPR
      WHERE datzac >= ? AND datzac < ?
      ORDER BY datzac ASC, dnid ASC, oper ASC, dnoprid ASC;
    `,
    timeoutMs: 60000,
    maxRows: 250000
  },
  V_DNOPR_BY_DNID: {
    sql: `
      SELECT *
      FROM V_DNOPR
      WHERE dnid = ?
      ORDER BY datzac ASC, oper ASC, dnoprid ASC;
    `,
    timeoutMs: 20000,
    maxRows: 5000
  },
  V_FEEDBACK_WINDOW: {
    sql: `
      SELECT *
      FROM V_FEEDBACK
      WHERE datum >= ? AND datum < ?
      ORDER BY datum ASC, timecr ASC, dnid ASC, oper ASC;
    `,
    timeoutMs: 60000,
    maxRows: 250000
  },
  V_FEEDBACK_BY_DNID: {
    sql: `
      SELECT *
      FROM V_FEEDBACK
      WHERE dnid = ?
      ORDER BY timecr ASC, oper ASC, dnoprfid ASC;
    `,
    timeoutMs: 20000,
    maxRows: 10000
  },
  DNOPR_CAL_RANGE: {
    sql: `
      SELECT datum, dandelovni, tekst, praznik
      FROM KOLEDARDRZ
      WHERE datum >= ? AND datum < ?
      ORDER BY datum ASC;
    `,
    timeoutMs: 10000,
    maxRows: 10000
  },
  ARTIKEL_BY_ARTIKEL: {
    sql: `
      SELECT artikel, naziv1, tehid, em, artid
      FROM ARTIKEL
      WHERE artikel = ?;
    `,
    timeoutMs: 10000,
    maxRows: 5
  },
  ARTIKEL_BY_ARTID: {
    sql: `
      SELECT artid, artikel, naziv1, naziv2, admid, barkoda, em
      FROM ARTIKEL
      WHERE artid = ?;
    `,
    timeoutMs: 10000,
    maxRows: 5
  },
  ARTKLAS_BY_ARTID: {
    sql: `
      SELECT artid, kljuc
      FROM ARTKLAS
      WHERE artid = ?
      ORDER BY kljuc ASC;
    `,
    timeoutMs: 10000,
    maxRows: 50
  },
  POTREBA_BY_DNID: {
    sql: `
      SELECT
        potrid,
        dnid,
        ident,
        status,
        kolicina,
        koltrn,
        pozicija,
        tehn,
        termin,
        opombe,
        dnoprid,
        izmetkolnakos,
        kolvhod,
        timecr,
        timemod,
        usercr,
        usermod,
        zamikvgr,
        osebid,
        potrdil,
        kontr_pod
      FROM POTREBA
      WHERE dnid = ?
      ORDER BY potrid ASC;
    `,
    timeoutMs: 15000,
    maxRows: 10000
  },
  V_TEHOPR_VAR_BY_TEHID: {
    sql: `
      SELECT *
      FROM V_TehOpr_Var
      WHERE tehid = ?
      ORDER BY oper ASC;
    `,
    timeoutMs: 15000,
    maxRows: 200
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
