// src/core/sms_outbox_contract.js
const crypto = require("crypto");

const E164_RE = /^\+[1-9]\d{7,14}$/;

function str(v) {
  return String(v ?? "").trim();
}

function isIsoDateTime(v) {
  const s = str(v);
  if (!s) return false;
  const d = new Date(s);
  return Number.isFinite(d.getTime()) && /^\d{4}-\d{2}-\d{2}T/.test(s);
}

function inferUseCase(previewRow, fallbackUseCase = "") {
  const explicit = str(previewRow?.use_case);
  if (explicit) return explicit;

  const smsKey = str(previewRow?.sms_key);
  if (smsKey.includes("|")) {
    const first = smsKey.split("|")[0];
    if (first) return first;
  }

  return str(fallbackUseCase);
}

function buildTxId(txKey, createdTs, prefix = "TX-BI") {
  const datePart = createdTs.slice(0, 10).replace(/-/g, "");
  const hash = crypto
    .createHash("sha256")
    .update(`${txKey}|${createdTs}`, "utf8")
    .digest("hex")
    .slice(0, 12)
    .toUpperCase();
  return `${prefix}-${datePart}-${hash}`;
}

function validateOutboxRecord(record) {
  const errors = [];
  const required = [
    "tx_id",
    "tx_key",
    "source_system",
    "source_module",
    "source_env",
    "use_case",
    "schema_version",
    "direction",
    "created_ts",
    "phone_e164",
    "text",
    "recipient"
  ];

  for (const f of required) {
    const v = record?.[f];
    if (v === undefined || v === null || v === "") errors.push({ field: f, code: "REQUIRED_MISSING" });
  }

  if (record?.direction !== "outbound") {
    errors.push({ field: "direction", code: "INVALID_DIRECTION", value: record?.direction });
  }

  if (!isIsoDateTime(record?.created_ts)) {
    errors.push({ field: "created_ts", code: "INVALID_ISO_DATETIME", value: record?.created_ts });
  }

  if (!E164_RE.test(str(record?.phone_e164))) {
    errors.push({ field: "phone_e164", code: "INVALID_E164", value: record?.phone_e164 });
  }

  if (!record?.recipient || typeof record.recipient !== "object") {
    errors.push({ field: "recipient", code: "INVALID_RECIPIENT" });
  } else {
    const kind = str(record.recipient.kind);
    const id = str(record.recipient.id);
    if (!kind) errors.push({ field: "recipient.kind", code: "REQUIRED_MISSING" });
    if (!id) errors.push({ field: "recipient.id", code: "REQUIRED_MISSING" });
  }

  return { ok: errors.length === 0, errors };
}

function buildOutboxRecord({ previewRow, approvalRow, options = {} }) {
  const sourceSystem = str(options.source_system || "bi_core_shell");
  const sourceEnv = str(options.source_env || process.env.BI_ENV || "prod");
  const schemaVersion = str(options.schema_version || "sms_outbox.v1");
  const recipientKind = str(options.recipient_kind || "employee");
  const fallbackUseCase = str(options.use_case || "");

  const txKey = str(previewRow?.sms_key);
  const useCase = inferUseCase(previewRow, fallbackUseCase);
  const sourceModule = str(options.source_module || useCase);
  const createdTs = str(approvalRow?.approved_at || new Date().toISOString());

  const normalizedPhone =
    typeof options.normalize_phone === "function"
      ? str(options.normalize_phone(previewRow?.tel_gsm))
      : str(previewRow?.phone_e164 || previewRow?.tel_gsm);

  const record = {
    tx_id: buildTxId(txKey, createdTs, str(options.tx_id_prefix || "TX-BI")),
    tx_key: txKey,
    source_system: sourceSystem,
    source_module: sourceModule,
    source_env: sourceEnv,
    use_case: useCase,
    schema_version: schemaVersion,
    direction: "outbound",
    created_ts: createdTs,
    phone_e164: normalizedPhone,
    text: str(previewRow?.sms_text),
    recipient: {
      kind: recipientKind,
      id: str(previewRow?.osebid || previewRow?.recipient_id || txKey)
    },
    approved_by: str(approvalRow?.approved_by),
    approved_at: str(approvalRow?.approved_at),
    issue_keys: str(previewRow?.issue_keys),
    correlation_id: str(previewRow?.sms_key)
  };

  const check = validateOutboxRecord(record);
  return { ok: check.ok, record, errors: check.errors };
}

function toNdjsonLine(record) {
  return `${JSON.stringify(record)}\n`;
}

module.exports = {
  E164_RE,
  buildTxId,
  inferUseCase,
  validateOutboxRecord,
  buildOutboxRecord,
  toNdjsonLine
};
