// src/core/sms_ledger.js
const fs = require("fs");
const path = require("path");

const DEFAULT_LEDGER_ROOT =
  process.env.BI_SMS_LEDGER_ROOT || "Z:\\014_Programi\\BI\\sms_ledger";

// --- helpers ---
function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function isoYYYYMM(tsIso) {
  const d = new Date(tsIso);
  if (!Number.isFinite(d.getTime())) throw new Error("Invalid ts for ledger: " + tsIso);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return { yyyy: String(yyyy), yyyymm: `${yyyy}_${mm}` };
}

function ledgerDirFor(useCase, tsIso) {
  const { yyyy, yyyymm } = isoYYYYMM(tsIso);
  return path.join(DEFAULT_LEDGER_ROOT, useCase, yyyy, yyyymm);
}

function ledgerFileFor(useCase, tsIso) {
  return path.join(ledgerDirFor(useCase, tsIso), "events.ndjson");
}

function sleepMs(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {}
}

// Simple lock file to avoid concurrent append collisions (best effort).
function withFileLock(lockPath, fn, { retries = 40, backoffMs = 25 } = {}) {
  for (let i = 0; i < retries; i++) {
    try {
      const fd = fs.openSync(lockPath, "wx");
      try {
        return fn();
      } finally {
        try { fs.closeSync(fd); } catch {}
        try { fs.unlinkSync(lockPath); } catch {}
      }
    } catch (e) {
      // lock exists
      sleepMs(backoffMs);
    }
  }
  throw new Error("Ledger lock timeout: " + lockPath);
}

function appendEvent({ use_case, ts, event }) {
  if (!use_case) throw new Error("appendEvent: use_case required");
  if (!ts) throw new Error("appendEvent: ts required");
  if (!event || typeof event !== "object") throw new Error("appendEvent: event object required");

  const dir = ledgerDirFor(use_case, ts);
  ensureDir(dir);

  const file = path.join(dir, "events.ndjson");
  const lock = file + ".lock";

  const line = JSON.stringify(event) + "\n";
  withFileLock(lock, () => {
    fs.appendFileSync(file, line, "utf8");
  });

  return { ok: true, file };
}

// --- Rolling lookup (minimal) ---
// Read only a small rolling window: current month + previous N months.
function listMonthsBack(tsIso, monthsBack) {
  const d = new Date(tsIso);
  const out = [];
  for (let i = 0; i <= monthsBack; i++) {
    const dd = new Date(d.getTime());
    dd.setMonth(dd.getMonth() - i);
    const yyyy = dd.getFullYear();
    const mm = String(dd.getMonth() + 1).padStart(2, "0");
    out.push({ yyyy: String(yyyy), yyyymm: `${yyyy}_${mm}` });
  }
  return out;
}

function readNdjsonFileSafe(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const txt = fs.readFileSync(filePath, "utf8");
  const lines = txt.split(/\r?\n/).filter(Boolean);
  const out = [];
  for (const ln of lines) {
    try { out.push(JSON.parse(ln)); } catch {}
  }
  return out;
}

// Returns last known event_type for given sms_key, searching rolling window.
function getLastEventType({ use_case, sms_key, now_ts = new Date().toISOString(), monthsBack = 2 }) {
  if (!use_case || !sms_key) return null;

  const months = listMonthsBack(now_ts, monthsBack);
  let last = null;

  for (const m of months) {
    const file = path.join(DEFAULT_LEDGER_ROOT, use_case, m.yyyy, m.yyyymm, "events.ndjson");
    const events = readNdjsonFileSafe(file);
    for (const ev of events) {
      if (ev && ev.sms_key === sms_key) last = ev.event_type || last;
    }
  }
  return last;
}

module.exports = {
  DEFAULT_LEDGER_ROOT,
  ledgerFileFor,
  appendEvent,
  getLastEventType
};
