"use strict";

function readEnv(name) {
  return String(process.env[name] || "").trim();
}

function resolveSmsGatewayOutboxDir(options = {}) {
  const override = String(options.gatewayOutboxDir || "").trim();
  if (override) return override;

  const envValue = readEnv("BI_SMS_GATEWAY_OUTBOX");
  if (envValue) return envValue;

  return String(
    options.defaultDir || "C:\\Users\\Marin\\bi-backend\\out\\_comm\\gateway_outbox_fake"
  ).trim();
}

function resolveSmsLedgerRoot(options = {}) {
  const override = String(options.ledgerRoot || "").trim();
  if (override) return override;

  const envValue = readEnv("BI_SMS_LEDGER_ROOT");
  if (envValue) return envValue;

  return String(options.defaultRoot || "Z:\\014_Programi\\BI\\sms_ledger").trim();
}

function loadSmsContractConfig(options = {}) {
  const originId = readEnv("BI_SMS_ORIGIN_ID");
  const sourceSystem = readEnv("BI_SMS_SOURCE_SYSTEM");
  const sourceEnv = readEnv("BI_ENV");
  const schemaVersion = readEnv("BI_SMS_SCHEMA_VERSION");

  return {
    origin_id: String(options.origin_id || originId || sourceSystem || "bi_core_shell").trim(),
    source_env: String(options.source_env || sourceEnv || "prod").trim(),
    schema_version: String(options.schema_version || schemaVersion || "sms_outbox.v1").trim()
  };
}

module.exports = {
  resolveSmsGatewayOutboxDir,
  resolveSmsLedgerRoot,
  loadSmsContractConfig
};
