"use strict";

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");

function repoRootFromServiceDir() {
  return path.resolve(__dirname, "..", "..", "..");
}

function defaultOutRoot() {
  return path.join(repoRootFromServiceDir(), "out", "eojn_v1");
}

function runAuditFilePath(outRoot) {
  return path.join(outRoot, "_state", "run_audit.ndjson");
}

function ingestLedgerFilePath(outRoot) {
  return path.join(outRoot, "_state", "ingest_ledger.ndjson");
}

async function appendNdjson(filePath, rows) {
  const entries = Array.isArray(rows) ? rows.filter(Boolean) : [];
  if (!entries.length) return 0;
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const payload = entries.map((row) => JSON.stringify(row)).join("\n") + "\n";
  await fsp.appendFile(filePath, payload, "utf8");
  return entries.length;
}

async function appendRunAuditEntries({ outRoot, entries }) {
  const root = path.resolve(String(outRoot || defaultOutRoot()));
  return appendNdjson(runAuditFilePath(root), entries);
}

async function appendIngestLedgerEntries({ outRoot, entries }) {
  const root = path.resolve(String(outRoot || defaultOutRoot()));
  return appendNdjson(ingestLedgerFilePath(root), entries);
}

async function readNdjson(filePath) {
  try {
    const text = await fsp.readFile(filePath, "utf8");
    return String(text || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (_) {
    return [];
  }
}

async function loadRunAuditEntries({ outRoot } = {}) {
  const root = path.resolve(String(outRoot || defaultOutRoot()));
  return readNdjson(runAuditFilePath(root));
}

async function loadIngestLedgerEntries({ outRoot } = {}) {
  const root = path.resolve(String(outRoot || defaultOutRoot()));
  return readNdjson(ingestLedgerFilePath(root));
}

module.exports = {
  defaultOutRoot,
  appendRunAuditEntries,
  appendIngestLedgerEntries,
  loadRunAuditEntries,
  loadIngestLedgerEntries
};
