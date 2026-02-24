// src/core/sms_outbox_publisher.js
const fs = require("fs");
const path = require("path");

const { buildOutboxRecord, toNdjsonLine } = require("./sms_outbox_contract");
const { normalizePhoneE164 } = require("./validate");
const { appendEvent, getLastEventType } = require("./sms_ledger");

function stripBom(s) {
  if (!s) return s;
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function parseCsvSemicolon(text) {
  const s = stripBom(String(text || ""));
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];

    if (inQuotes) {
      if (ch === '"') {
        const next = s[i + 1];
        if (next === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ";") { row.push(field); field = ""; continue; }
    if (ch === "\n") { row.push(field); field = ""; rows.push(row); row = []; continue; }
    if (ch === "\r") continue;

    field += ch;
  }

  row.push(field);
  const isLastRowEmpty = row.length === 1 && row[0] === "" && rows.length > 0;
  if (!isLastRowEmpty) rows.push(row);

  while (rows.length && rows[rows.length - 1].every(v => String(v || "") === "")) rows.pop();
  if (!rows.length) return { headers: [], records: [] };

  const headers = rows[0].map(h => String(h || "").trim());
  const records = [];
  for (let r = 1; r < rows.length; r++) {
    const arr = rows[r];
    if (!arr || !arr.length) continue;
    const obj = {};
    for (let c = 0; c < headers.length; c++) obj[headers[c]] = arr[c] ?? "";
    records.push(obj);
  }
  return { headers, records };
}

function readCsvFile(filePath) {
  const buf = fs.readFileSync(filePath);
  return parseCsvSemicolon(buf.toString("utf8"));
}

function ensureSafePeriodFolder(period) {
  const p = String(period || "").trim();
  if (!p) throw new Error("Missing period");
  const norm = p.includes("-") ? p.replace("-", "_") : p;
  if (!/^\d{4}_\d{2}$/.test(norm)) throw new Error(`Invalid period '${period}'. Expected YYYY_MM.`);
  return norm;
}

function normalizeDecision(v) {
  const s = String(v || "").trim().toLowerCase();
  if (s === "approved" || s === "approve" || s === "1" || s === "true" || s === "yes") return "approved";
  if (s === "rejected" || s === "reject" || s === "0" || s === "false" || s === "no") return "rejected";
  return null;
}

function atomicWriteFile(filePath, content) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  const tmp = filePath + ".tmp_" + process.pid + "_" + Date.now();
  fs.writeFileSync(tmp, content, "utf8");

  try { fs.unlinkSync(filePath); } catch (_) {}
  fs.renameSync(tmp, filePath);
}

function defaultPreviewPath(outRoot, periodFolder) {
  return path.join(outRoot, "epr_attendance", periodFolder, "sms_preview.csv");
}

function defaultApprovalsPath(outRoot, periodFolder) {
  return path.join(outRoot, "_comm", "approvals", periodFolder, "sms_approvals.csv");
}

function safeAppendEvent(payload) {
  try {
    appendEvent(payload);
  } catch (_) {
    // Ledger errors must not break publish flow.
  }
}

function makeBatchId(tsIso = new Date().toISOString()) {
  const compact = tsIso.replace(/[-:TZ.]/g, "").slice(0, 14);
  const rand = Math.random().toString(16).slice(2, 8).toUpperCase();
  return `${compact}_${rand}`;
}

function publishApprovedSmsOutbox({
  outRoot,
  period,
  namespace = null,
  gatewayOutboxDir = "\\\\192.168.100.95\\SMS_Gateway\\outbox",
  previewPathResolver = defaultPreviewPath,
  approvalsPathResolver = defaultApprovalsPath,
  contractOptions = {},
  dedupMonthsBack = 2
}) {
  if (!outRoot) throw new Error("publishApprovedSmsOutbox: outRoot required");

  const periodFolder = ensureSafePeriodFolder(period);
  const previewPath = previewPathResolver(outRoot, periodFolder);
  const approvalsPath = approvalsPathResolver(outRoot, periodFolder);

  const preview = readCsvFile(previewPath).records || [];
  const approvals = fs.existsSync(approvalsPath) ? (readCsvFile(approvalsPath).records || []) : [];

  const approvalsByKey = new Map();
  for (const a of approvals) {
    const key = String(a.sms_key || "").trim();
    if (!key) continue;
    approvalsByKey.set(key, a);
  }

  const nowTs = new Date().toISOString();
  const filteredPreview = namespace
    ? preview.filter(r => String(r.sms_key || "").startsWith(String(namespace) + "|"))
    : preview;

  const outRecords = [];
  const skipped = [];
  let alreadyPublished = 0;

  for (const row of filteredPreview) {
    const smsKey = String(row.sms_key || "").trim();
    if (!smsKey) {
      skipped.push({ sms_key: "", code: "MISSING_SMS_KEY" });
      continue;
    }

    const approval = approvalsByKey.get(smsKey);
    const decision = normalizeDecision(approval?.approved);
    if (decision !== "approved") continue;

    const useCase = String((row.use_case || "") || (smsKey.includes("|") ? smsKey.split("|")[0] : "")).trim();
    const last = getLastEventType({
      use_case: useCase,
      sms_key: smsKey,
      now_ts: nowTs,
      monthsBack: dedupMonthsBack
    });

    if (last === "OUTBOX_FILE_DROPPED" || last === "SENT" || last === "SENT_OK" || last === "DELIVERED") {
      alreadyPublished++;
      continue;
    }

    const built = buildOutboxRecord({
      previewRow: row,
      approvalRow: approval,
      options: {
        ...contractOptions,
        normalize_phone: v => normalizePhoneE164(v)
      }
    });

    if (!built.ok) {
      skipped.push({ sms_key: smsKey, code: "CONTRACT_INVALID", errors: built.errors });
      safeAppendEvent({
        use_case: useCase || "unknown",
        ts: nowTs,
        event: {
          ts: nowTs,
          event_type: "OUTBOX_LINE_SKIPPED",
          sms_key: smsKey,
          reason: "CONTRACT_INVALID",
          errors: built.errors
        }
      });
      continue;
    }

    outRecords.push(built.record);
    safeAppendEvent({
      use_case: built.record.use_case,
      ts: nowTs,
      event: {
        ts: nowTs,
        event_type: "OUTBOX_LINE_VALIDATED",
        sms_key: smsKey,
        tx_key: built.record.tx_key,
        tx_id: built.record.tx_id
      }
    });
  }

  if (!outRecords.length) {
    return {
      ok: true,
      period: periodFolder,
      namespace: namespace || null,
      dropped: 0,
      skipped: skipped.length,
      already_published: alreadyPublished,
      file: null,
      message: "No approved records ready for outbox publish."
    };
  }

  const batchId = makeBatchId(nowTs);
  const prefix = String(namespace || outRecords[0].use_case || "sms").replace(/[^a-zA-Z0-9._-]/g, "_");
  const fileName = `${prefix}_${periodFolder}_${batchId}.ndjson`;
  const targetFile = path.join(gatewayOutboxDir, fileName);

  const ndjson = outRecords.map(toNdjsonLine).join("");
  atomicWriteFile(targetFile, ndjson);

  const useCases = Array.from(new Set(outRecords.map(r => String(r.use_case || "").trim()).filter(Boolean)));
  for (const uc of useCases) {
    safeAppendEvent({
      use_case: uc,
      ts: nowTs,
      event: {
        ts: nowTs,
        event_type: "OUTBOX_FILE_DROPPED",
        period: periodFolder,
        namespace: namespace || null,
        file_name: fileName,
        file_path: targetFile,
        records: outRecords.length,
        batch_id: batchId
      }
    });
  }

  return {
    ok: true,
    period: periodFolder,
    namespace: namespace || null,
    dropped: outRecords.length,
    skipped: skipped.length,
    already_published: alreadyPublished,
    file: {
      name: fileName,
      path: targetFile,
      batch_id: batchId
    },
    skipped_rows: skipped
  };
}

module.exports = {
  publishApprovedSmsOutbox,
  parseCsvSemicolon,
  ensureSafePeriodFolder,
  normalizeDecision,
  defaultPreviewPath,
  defaultApprovalsPath
};
