"use strict";

if (process.env.MOTHER_IO_LEGACY_DISABLED === "1") {
  throw new Error(
    "Legacy Mother DXF I/O path is DISABLED. " +
    "All durable I/O MUST go through src/core_shell/io/mother_dxf/* adapters."
  );
}

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const { writeJsonAtomic } = require("./index");

function ensureDir(dirPath) {
  return fsp.mkdir(dirPath, { recursive: true });
}

function defaultRoot() {
  return path.resolve(process.cwd(), "out", "mother_dxf_v1");
}



async function ensurePhaseArtifactDirs(base) {
  await Promise.all([
    ensureDir(path.join(base, "artifacts", "raw")),
    ensureDir(path.join(base, "artifacts", "sanitized")),
    ensureDir(path.join(base, "artifacts", "mother"))
  ]);
}

async function writeJsonFile(filePath, payload) {
  await writeJsonAtomic(filePath, payload == null ? null : payload);
  return { filePath };
}

// Legacy artifact mapping removed - use registerArtifact() instead.

// Legacy session write removed - use saveSessionEnvelope() instead.

// Legacy session delete removed - use deleteSessionEnvelope() instead.

// Legacy session load removed - use loadSessionEnvelope() instead.

// Legacy session list removed - use listSessionEnvelopes() instead.

async function saveExport({ rootDir, sessionId, dxfText }) {
  const base = rootDir || defaultRoot();
  const filePath = path.join(base, "exports", `${sessionId}_mother.dxf`);
  const artifactPath = path.join(base, "artifacts", "mother", `${sessionId}_mother.dxf`);
  await ensureDir(path.dirname(filePath));
  await ensureDir(path.dirname(artifactPath));
  await fsp.writeFile(filePath, String(dxfText || ""), "utf8");
  await fsp.writeFile(artifactPath, String(dxfText || ""), "utf8");
  return { filePath, artifactPath };
}

async function saveChildExport({ rootDir, sessionId, dxfText, suffix }) {
  const base = rootDir || defaultRoot();
  const safeSuffix = String(suffix || "child").replace(/[^a-zA-Z0-9_-]/g, "_");
  const filePath = path.join(base, "children", `${sessionId}_${safeSuffix}.dxf`);
  await ensureDir(path.dirname(filePath));
  await fsp.writeFile(filePath, String(dxfText || ""), "utf8");
  return { filePath };
}

async function saveRawDxf(sessionId, dxfText, rootDir) {
  const base = rootDir || defaultRoot();
  await ensurePhaseArtifactDirs(base);
  const filePath = path.join(base, "artifacts", "raw", `${sessionId}_raw.dxf`);
  await fsp.writeFile(filePath, String(dxfText || ""), "utf8");
  return { filePath };
}

// Legacy Mother document snapshot write removed - use session_store.saveMotherJson() instead.

// Legacy param set write removed - use saveParamSet() instead.

async function saveRuleCatalogSnapshot(sessionId, ruleCatalog, rootDir) {
  const base = rootDir || defaultRoot();
  const filePath = path.join(base, "sessions", String(sessionId), "rule_catalog.json");
  await ensureDir(path.dirname(filePath));
  return writeJsonFile(filePath, ruleCatalog);
}

async function saveChildDxf(sessionId, suffix, dxfText, rootDir) {
  const base = rootDir || defaultRoot();
  const safeSuffix = String(suffix || "child").replace(/[^a-zA-Z0-9_-]/g, "_");
  const dirPath = path.join(base, "children", `${sessionId}_${safeSuffix}`);
  const filePath = path.join(dirPath, "child.dxf");
  await ensureDir(dirPath);
  await fsp.writeFile(filePath, String(dxfText || ""), "utf8");
  // Legacy child metadata write removed - use writeChildMetadata() instead.
  return { filePath };
}

// Legacy preview write removed - use savePreview() instead.

// Legacy event write removed - use event_stream.appendEvent() instead.

module.exports = {
  defaultRoot,
  saveExport,
  saveChildExport,
  saveRawDxf,
  saveRuleCatalogSnapshot,
  saveChildDxf
};
