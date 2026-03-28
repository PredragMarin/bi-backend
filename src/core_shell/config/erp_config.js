"use strict";

function readEnv(name) {
  return String(process.env[name] || "").trim();
}

function resolveErpDsn(options = {}) {
  const override = String(options.dsnOverride || "").trim();
  if (override) return override;

  const envDsn = readEnv("ERP_DSN");
  if (envDsn) return envDsn;

  return String(options.defaultDsn || "ERP_POC_RO").trim();
}

function loadErpConnectionConfig() {
  return {
    connStr: readEnv("ERP_CONN_STR"),
    dsn: readEnv("ERP_DSN"),
    uid: readEnv("ERP_UID"),
    pwd: readEnv("ERP_PWD"),
    secretFilePath: readEnv("ERP_SECRET_FILE")
  };
}

module.exports = {
  resolveErpDsn,
  loadErpConnectionConfig
};
