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
  },
  SMOKE_DN_NALOG_DOK_20: {
    sql: `SELECT
  DN.*,

  NALOG.nalogid      AS nalog_nalogid,
  NALOG.nalog        AS nalog_nalog,
  NALOG.naziv        AS nalog_naziv,
  NALOG.opis         AS nalog_opis,
  NALOG.datum        AS nalog_datum,
  NALOG.koncan       AS nalog_koncan,
  NALOG.prioriteta   AS nalog_prioriteta,
  NALOG.sifrap       AS nalog_sifrap,
  NALOG.skupina      AS nalog_skupina,
  NALOG.timecr       AS nalog_timecr,
  NALOG.timemod      AS nalog_timemod,
  NALOG.usercr       AS nalog_usercr,
  NALOG.usermod      AS nalog_usermod,
  NALOG.datkonec     AS nalog_datkonec,
  NALOG.projektid    AS nalog_projektid,
  NALOG.osebid       AS nalog_osebid,
  NALOG.proracun     AS nalog_proracun,
  NALOG.prihodek     AS nalog_prihodek,
  NALOG.barva        AS nalog_barva,
  NALOG.status       AS nalog_status,

  DOK.dokid          AS dok_dokid,
  DOK.podjetje       AS dok_podjetje,
  DOK.vd             AS dok_vd,
  DOK.leto           AS dok_leto,
  DOK.sifradok       AS dok_sifradok,
  DOK.datdok         AS dok_datdok,
  DOK.datper         AS dok_datper,
  DOK.sifrap         AS dok_sifrap,
  DOK.tekst          AS dok_tekst,
  DOK.zunsifra       AS dok_zunsifra,
  DOK.status         AS dok_status,
  DOK.usercr         AS dok_usercr,
  DOK.timecr         AS dok_timecr,
  DOK.usermod        AS dok_usermod,
  DOK.timemod        AS dok_timemod,
  DOK.msdel          AS dok_msdel,
  DOK.zundat         AS dok_zundat,
  DOK.osebid         AS dok_osebid,
  DOK.tracsifra      AS dok_tracsifra,
  DOK.izpisano       AS dok_izpisano,
  DOK.potrosebid     AS dok_potrosebid,
  DOK.projektid      AS dok_projektid,
  DOK.casizpisano    AS dok_casizpisano

FROM DN
LEFT JOIN NALOG
  ON NALOG.nalogid = DN.nalogid
LEFT JOIN DOK
  ON DOK.sifradok = NALOG.nalog
 AND DOK.vd = 'P03'
WHERE DN.sifradn IN (
  '26T08V21','26T08V22','26T08V23','26T08V24','26T08V25',
  '26T08V26','26T08V27','26T08V28','26T08V29','26T08V30',
  '26T08V31','26T08V32','26T08V33','26T08V34','26T08V35',
  '26T08V36','26T08V37','26T08V38','26T08V39','26T08V40'
)`,
    timeoutMs: 20000,
    maxRows: 1000,
    allowParams: false,
    description: "DN + NALOG + DOK (P03) for fixed 20 sifradn values"
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
