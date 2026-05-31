"use strict";

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

function sessionFile(rootDir, sessionId) {
  return path.join(rootDir, "sessions", `${sessionId}.json`);
}

function sessionsDir(rootDir) {
  return path.join(rootDir, "sessions");
}

function exportFile(rootDir, sessionId) {
  return path.join(rootDir, "exports", `${sessionId}_mother.dxf`);
}

function childExportFile(rootDir, sessionId, suffix) {
  const safeSuffix = String(suffix || "child").replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(rootDir, "children", `${sessionId}_${safeSuffix}.dxf`);
}

function rawDxfFile(rootDir, sessionId) {
  return path.join(rootDir, "artifacts", "raw", `${sessionId}_raw.dxf`);
}

function motherArtifactDxfFile(rootDir, sessionId) {
  return path.join(rootDir, "artifacts", "mother", `${sessionId}_mother.dxf`);
}

function sessionArtifactFile(rootDir, sessionId, fileName) {
  return path.join(rootDir, "sessions", String(sessionId), fileName);
}

function childArtifactDir(rootDir, sessionId, suffix) {
  const safeSuffix = String(suffix || "child").replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(rootDir, "children", `${sessionId}_${safeSuffix}`);
}

function previewArtifactDir(rootDir, previewId) {
  return path.join(rootDir, "previews", String(previewId));
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

async function saveSession({ rootDir, session }) {
  const base = rootDir || defaultRoot();
  const filePath = sessionFile(base, session.session_id);
  await writeJsonAtomic(filePath, session);
  return { filePath };
}

async function deleteSession({ rootDir, sessionId }) {
  const base = rootDir || defaultRoot();
  const filePath = sessionFile(base, sessionId);
  try {
    await fsp.unlink(filePath);
    return { filePath, deleted: true };
  } catch (err) {
    if (err && err.code === "ENOENT") {
      return { filePath, deleted: false };
    }
    throw err;
  }
}

async function loadSession({ rootDir, sessionId }) {
  const base = rootDir || defaultRoot();
  const filePath = sessionFile(base, sessionId);
  const text = await fsp.readFile(filePath, "utf8");
  return JSON.parse(text);
}

async function listSessions({ rootDir }) {
  const base = rootDir || defaultRoot();
  const dirPath = sessionsDir(base);
  await ensureDir(dirPath);
  const entries = await fsp.readdir(dirPath, { withFileTypes: true });
  const sessions = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const filePath = path.join(dirPath, entry.name);
    try {
      const text = await fsp.readFile(filePath, "utf8");
      const session = JSON.parse(text);
      sessions.push(session);
    } catch (err) {
      sessions.push({
        session_id: entry.name.replace(/\.json$/i, ""),
        status: "corrupt",
        source_name: entry.name,
        load_error: err && err.message ? err.message : String(err)
      });
    }
  }
  return sessions;
}

async function saveExport({ rootDir, sessionId, dxfText }) {
  const base = rootDir || defaultRoot();
  const filePath = exportFile(base, sessionId);
  const artifactPath = motherArtifactDxfFile(base, sessionId);
  await ensureDir(path.dirname(filePath));
  await ensureDir(path.dirname(artifactPath));
  await fsp.writeFile(filePath, String(dxfText || ""), "utf8");
  await fsp.writeFile(artifactPath, String(dxfText || ""), "utf8");
  return { filePath, artifactPath };
}

async function saveChildExport({ rootDir, sessionId, dxfText, suffix }) {
  const base = rootDir || defaultRoot();
  const filePath = childExportFile(base, sessionId, suffix);
  await ensureDir(path.dirname(filePath));
  await fsp.writeFile(filePath, String(dxfText || ""), "utf8");
  return { filePath };
}

async function saveRawDxf(sessionId, dxfText, rootDir) {
  const base = rootDir || defaultRoot();
  await ensurePhaseArtifactDirs(base);
  const filePath = rawDxfFile(base, sessionId);
  await fsp.writeFile(filePath, String(dxfText || ""), "utf8");
  return { filePath };
}

async function saveMotherJson(sessionId, motherJson, rootDir) {
  const base = rootDir || defaultRoot();
  const filePath = sessionArtifactFile(base, sessionId, "mother.json");
  await ensureDir(path.dirname(filePath));
  return writeJsonFile(filePath, motherJson);
}

async function saveParamSetSnapshot(sessionId, paramSet, rootDir) {
  const base = rootDir || defaultRoot();
  const filePath = sessionArtifactFile(base, sessionId, "param_set.json");
  await ensureDir(path.dirname(filePath));
  return writeJsonFile(filePath, paramSet);
}

async function saveRuleCatalogSnapshot(sessionId, ruleCatalog, rootDir) {
  const base = rootDir || defaultRoot();
  const filePath = sessionArtifactFile(base, sessionId, "rule_catalog.json");
  await ensureDir(path.dirname(filePath));
  return writeJsonFile(filePath, ruleCatalog);
}

async function saveChildDxf(sessionId, suffix, dxfText, rootDir) {
  const base = rootDir || defaultRoot();
  const dirPath = childArtifactDir(base, sessionId, suffix);
  const filePath = path.join(dirPath, "child.dxf");
  const metadataPath = path.join(dirPath, "child_metadata.json");
  const createdAt = new Date().toISOString();
  await ensureDir(dirPath);
  await fsp.writeFile(filePath, String(dxfText || ""), "utf8");
  await writeJsonAtomic(metadataPath, {
    session_id: String(sessionId),
    suffix: String(suffix || "child"),
    created_at: createdAt
  });
  return { filePath, metadataPath };
}

async function savePreviewArtifacts(previewId, previewJson, previewDxf, rootDir) {
  const base = rootDir || defaultRoot();
  const dirPath = previewArtifactDir(base, previewId);
  const jsonPath = path.join(dirPath, "preview.json");
  const dxfPath = path.join(dirPath, "preview.dxf");
  await ensureDir(dirPath);
  await writeJsonAtomic(jsonPath, previewJson == null ? null : previewJson);
  if (previewDxf !== undefined && previewDxf !== null) {
    await fsp.writeFile(dxfPath, String(previewDxf || ""), "utf8");
    return { jsonPath, dxfPath };
  }
  return { jsonPath, dxfPath: null };
}

async function appendEvent(sessionId, event, rootDir) {
  const base = rootDir || defaultRoot();
  const filePath = sessionArtifactFile(base, sessionId, "events.ndjson");
  await ensureDir(path.dirname(filePath));
  const entry = {
    ts: new Date().toISOString(),
    ...(event && typeof event === "object" ? event : { type: "event", details: {} })
  };
  if (!entry.ts) entry.ts = new Date().toISOString();
  await fsp.appendFile(filePath, `${JSON.stringify(entry)}\n`, "utf8");
  return { filePath };
}

module.exports = {
  defaultRoot,
  saveSession,
  deleteSession,
  loadSession,
  listSessions,
  saveExport,
  saveChildExport,
  saveRawDxf,
  saveMotherJson,
  saveParamSetSnapshot,
  saveRuleCatalogSnapshot,
  saveChildDxf,
  savePreviewArtifacts,
  appendEvent
};
