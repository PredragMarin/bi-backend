// src/api/routes/sms_approvals_v1.js
const express = require("express");
const path = require("path");
const fs = require("fs");
const fsp = fs.promises;

// --- validation helpers ---
function ensureSafePeriodFolder(period) {
  const p = String(period || "").trim();
  if (!p) throw new Error("Missing period");
  const norm = p.includes("-") ? p.replace("-", "_") : p;
  if (!/^\d{4}_\d{2}$/.test(norm)) throw new Error(`Invalid period '${period}'. Expected YYYY_MM.`);
  return norm;
}

function ensureSafeNamespace(ns) {
  const v = String(ns || "").trim();
  if (!v) return null;
  if (!/^[a-zA-Z0-9._-]+$/.test(v)) throw new Error(`Invalid namespace '${ns}'.`);
  return v;
}

function normalizeDecision(v) {
  const s = String(v || "").trim().toLowerCase();
  if (s === "approved" || s === "approve" || s === "1" || s === "true" || s === "yes") return "approved";
  if (s === "rejected" || s === "reject" || s === "0" || s === "false" || s === "no") return "rejected";
  return null;
}

// --- CSV helpers (;, BOM, quotes) ---
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

function csvEscapeField(value) {
  const v = value === null || value === undefined ? "" : String(value);
  const mustQuote = v.includes(";") || v.includes('"') || v.includes("\n") || v.includes("\r");
  if (!mustQuote) return v;
  return `"${v.replace(/"/g, '""')}"`;
}

function toCsvSemicolon(headers, records) {
  const lines = [];
  lines.push(headers.map(csvEscapeField).join(";"));
  for (const rec of records) lines.push(headers.map(h => csvEscapeField(rec[h])).join(";"));
  return "\ufeff" + lines.join("\r\n") + "\r\n";
}

async function readCsvFile(filePath) {
  const buf = await fsp.readFile(filePath);
  return parseCsvSemicolon(buf.toString("utf8"));
}

async function atomicWriteFile(filePath, content) {
  const dir = path.dirname(filePath);
  await fsp.mkdir(dir, { recursive: true });
  const tmp = filePath + ".tmp_" + process.pid + "_" + Date.now();
  await fsp.writeFile(tmp, content, "utf8");
  // Windows: rename doesn't overwrite => unlink first
  try { await fsp.unlink(filePath); } catch (_) {}
  await fsp.rename(tmp, filePath);
}

// --- paths ---
function getSmsPreviewPath(outRoot, periodFolder) {
  return path.join(outRoot, "epr_attendance", periodFolder, "sms_preview.csv");
}

function getSmsApprovalsPath(outRoot, periodFolder) {
  return path.join(outRoot, "_comm", "approvals", periodFolder, "sms_approvals.csv");
}

// --- router factory ---
module.exports = function createSmsApprovalsRouterV1({ outRoot }) {
  if (!outRoot) throw new Error("Missing outRoot");

  const router = express.Router();

  // GET /api/approvals/v1/sms/periods
  router.get("/sms/periods", async (req, res) => {
    try {
      ensureSafeNamespace(req.query?.namespace);

      const baseDir = path.join(outRoot, "epr_attendance");
      let entries = [];
      try {
        entries = await fsp.readdir(baseDir, { withFileTypes: true });
      } catch (_) {
        return res.json({ periods: [] });
      }

      const periods = entries
        .filter(d => d.isDirectory() && /^\d{4}_\d{2}$/.test(d.name))
        .map(d => d.name)
        .sort();

      res.json({ periods });
    } catch (err) {
      console.error(err);
      res.status(400).json({ error: "APPROVALS_PERIODS_FAILED", message: err.message });
    }
  });

  // GET /api/approvals/v1/sms/preview?period=YYYY_MM&namespace=...
  router.get("/sms/preview", async (req, res) => {
    try {
      const periodFolder = ensureSafePeriodFolder(req.query?.period);
      const namespace = ensureSafeNamespace(req.query?.namespace);

      const filePath = getSmsPreviewPath(outRoot, periodFolder);
      const { records } = await readCsvFile(filePath);

      const rows = namespace
        ? records.filter(r => String(r.sms_key || "").startsWith(namespace + "|"))
        : records;

      res.json({ period: periodFolder, namespace: namespace || null, count: rows.length, rows });
    } catch (err) {
      console.error(err);
      res.status(400).json({ error: "SMS_PREVIEW_LOAD_FAILED", message: err.message });
    }
  });

  // GET /api/approvals/v1/sms/approvals?period=YYYY_MM
  router.get("/sms/approvals", async (req, res) => {
    try {
      const periodFolder = ensureSafePeriodFolder(req.query?.period);
      const filePath = getSmsApprovalsPath(outRoot, periodFolder);

      let records = [];
      try {
        const parsed = await readCsvFile(filePath);
        records = parsed.records || [];
      } catch (_) {
        records = [];
      }

      res.json({ period: periodFolder, count: records.length, rows: records });
    } catch (err) {
      console.error(err);
      res.status(400).json({ error: "SMS_APPROVALS_LOAD_FAILED", message: err.message });
    }
  });

  // POST /api/approvals/v1/sms/approvals
  router.post("/sms/approvals", async (req, res) => {
    try {
      const periodFolder = ensureSafePeriodFolder(req.body?.period);
      const smsKey = String(req.body?.sms_key || "").trim();
      const decision = normalizeDecision(req.body?.approved);
      const approvedBy = String(req.body?.approved_by || "").trim();
      const note = String(req.body?.note || "").trim();

      if (!smsKey) return res.status(400).json({ error: "SMS_APPROVAL_UPSERT_FAILED", message: "Missing sms_key" });
      if (!decision) {
        return res.status(400).json({
          error: "SMS_APPROVAL_UPSERT_FAILED",
          message: "Invalid approved value. Use 'approved' or 'rejected'."
        });
      }
      if (!approvedBy) return res.status(400).json({ error: "SMS_APPROVAL_UPSERT_FAILED", message: "Missing approved_by" });

      const filePath = getSmsApprovalsPath(outRoot, periodFolder);

      let existing = [];
      try {
        const parsed = await readCsvFile(filePath);
        existing = parsed.records || [];
      } catch (_) {
        existing = [];
      }

      const map = new Map();
      for (const r of existing) {
        const k = String(r.sms_key || "").trim();
        if (!k) continue;
        map.set(k, {
          sms_key: k,
          approved: String(r.approved || "").trim(),
          approved_by: String(r.approved_by || "").trim(),
          approved_at: String(r.approved_at || "").trim(),
          note: String(r.note || "")
        });
      }

      const row = {
        sms_key: smsKey,
        approved: decision,
        approved_by: approvedBy,
        approved_at: new Date().toISOString(),
        note
      };
      map.set(smsKey, row);

      const rows = Array.from(map.values()).sort((a, b) => String(a.sms_key).localeCompare(String(b.sms_key)));
      const headers = ["sms_key", "approved", "approved_by", "approved_at", "note"];

      await atomicWriteFile(filePath, toCsvSemicolon(headers, rows));
      res.json({ ok: true, period: periodFolder, row });
    } catch (err) {
      console.error(err);
      res.status(400).json({ error: "SMS_APPROVAL_UPSERT_FAILED", message: err.message });
    }
  });

  return router;
};
