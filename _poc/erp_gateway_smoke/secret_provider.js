// _poc/erp_gateway_smoke/secret_provider.js

const fs = require("fs");

function buildConnFromParts() {
  const dsn = process.env.ERP_DSN;
  const uid = process.env.ERP_UID;
  const pwd = process.env.ERP_PWD;
  if (!dsn || !uid || !pwd) return null;
  return `DSN=${dsn};Authentication=Database;UID=${uid};PWD=${pwd};`;
}

function readConnFromSecretFile() {
  const fp = process.env.ERP_SECRET_FILE;
  if (!fp) return null;
  const raw = fs.readFileSync(fp, "utf8");
  const json = JSON.parse(raw);

  if (json && typeof json.erp_conn_str === "string" && json.erp_conn_str.trim()) {
    return json.erp_conn_str.trim();
  }

  if (json && json.erp_dsn && json.erp_uid && json.erp_pwd) {
    return `DSN=${json.erp_dsn};Authentication=Database;UID=${json.erp_uid};PWD=${json.erp_pwd};`;
  }

  throw new Error("Invalid ERP secret file format. Expected erp_conn_str or (erp_dsn, erp_uid, erp_pwd).");
}

function resolveErpConnectionString() {
  const direct = process.env.ERP_CONN_STR;
  if (direct && direct.trim()) return direct.trim();

  const fromParts = buildConnFromParts();
  if (fromParts) return fromParts;

  const fromFile = readConnFromSecretFile();
  if (fromFile) return fromFile;

  throw new Error("Missing ERP credentials. Set ERP_CONN_STR, or ERP_DSN+ERP_UID+ERP_PWD, or ERP_SECRET_FILE.");
}

module.exports = {
  resolveErpConnectionString
};
