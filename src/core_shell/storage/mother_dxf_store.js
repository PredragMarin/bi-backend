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

async function saveSession({ rootDir, session }) {
  const base = rootDir || defaultRoot();
  const filePath = sessionFile(base, session.session_id);
  await writeJsonAtomic(filePath, session);
  return { filePath };
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
  await ensureDir(path.dirname(filePath));
  await fsp.writeFile(filePath, String(dxfText || ""), "utf8");
  return { filePath };
}

async function saveChildExport({ rootDir, sessionId, dxfText, suffix }) {
  const base = rootDir || defaultRoot();
  const filePath = childExportFile(base, sessionId, suffix);
  await ensureDir(path.dirname(filePath));
  await fsp.writeFile(filePath, String(dxfText || ""), "utf8");
  return { filePath };
}

module.exports = {
  defaultRoot,
  saveSession,
  loadSession,
  listSessions,
  saveExport,
  saveChildExport
};
