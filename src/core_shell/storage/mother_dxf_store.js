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

function exportFile(rootDir, sessionId) {
  return path.join(rootDir, "exports", `${sessionId}_mother.dxf`);
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

async function saveExport({ rootDir, sessionId, dxfText }) {
  const base = rootDir || defaultRoot();
  const filePath = exportFile(base, sessionId);
  await ensureDir(path.dirname(filePath));
  await fsp.writeFile(filePath, String(dxfText || ""), "utf8");
  return { filePath };
}

module.exports = {
  defaultRoot,
  saveSession,
  loadSession,
  saveExport
};
