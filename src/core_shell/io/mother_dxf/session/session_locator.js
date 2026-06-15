"use strict";

const fs = require("fs/promises");
const path = require("path");

const locatorCache = new Map();

function defaultRoot() {
  return path.join("out", "mother_dxf_v1");
}

function normalizeStorageSegment(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "");
}

function shortSessionId(sessionId) {
  const compact = String(sessionId || "").replace(/[^A-Za-z0-9]/g, "");
  return (compact.slice(0, 8) || "session").padEnd(8, "0");
}

function buildSessionStorageKey(title, sessionId) {
  const suffix = shortSessionId(sessionId);
  const maxTitleLength = 72 - suffix.length - 2;
  const titlePart = normalizeStorageSegment(title).slice(0, maxTitleLength) || "mother_dxf_session";
  return titlePart + "__" + suffix;
}

function normalizeStorageKey(value, sessionId) {
  return normalizeStorageSegment(value) || String(sessionId || "");
}

function cacheKey(rootDir, sessionId) {
  return path.resolve(rootDir || defaultRoot()) + "::" + String(sessionId || "");
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (_) {
    return false;
  }
}

async function resolveSessionStorageKey(sessionId, rootDir) {
  const id = String(sessionId || "");
  const key = cacheKey(rootDir, id);
  if (locatorCache.has(key)) return locatorCache.get(key);

  const sessionsDir = path.join(rootDir || defaultRoot(), "sessions");
  const legacyPath = path.join(sessionsDir, id + ".json");
  if (await fileExists(legacyPath)) {
    locatorCache.set(key, id);
    return id;
  }

  let entries = [];
  try {
    entries = await fs.readdir(sessionsDir, { withFileTypes: true });
  } catch (error) {
    if (!error || error.code !== "ENOENT") throw error;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const filePath = path.join(sessionsDir, entry.name);
    try {
      const parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
      const envelopeSessionId = String(parsed?.session_id || parsed?.payload?.session_id || "");
      if (envelopeSessionId !== id) continue;
      const storageKey = entry.name.replace(/\.json$/i, "");
      locatorCache.set(key, storageKey);
      return storageKey;
    } catch (_) {
      // Corrupt or unrelated JSON files are reported by session listing, not locator lookup.
    }
  }

  locatorCache.set(key, id);
  return id;
}

async function registerSessionStorageKey(sessionId, storageKey, rootDir) {
  const id = String(sessionId || "");
  const normalized = normalizeStorageKey(storageKey, id);
  locatorCache.set(cacheKey(rootDir, id), normalized);
  return normalized;
}

async function unregisterSessionStorageKey(sessionId, rootDir) {
  return locatorCache.delete(cacheKey(rootDir, sessionId));
}

module.exports = {
  buildSessionStorageKey,
  resolveSessionStorageKey,
  registerSessionStorageKey,
  unregisterSessionStorageKey
};
