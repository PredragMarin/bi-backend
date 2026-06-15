"use strict";

const fs = require("fs/promises");
const path = require("path");
const {
  saveSessionEnvelopeToDb
} = require("../db/db_adapter");
const {
  resolveSessionStorageKey,
  registerSessionStorageKey,
  unregisterSessionStorageKey
} = require("./session_locator");

const SESSION_ENVELOPE_VERSION = 1;
const PAYLOAD_REVISION_KEY = "__mother_dxf_session_revision";

function defaultRoot() {
  return path.join("out", "mother_dxf_v1");
}

async function sessionEnvelopePath(rootDir, sessionId) {
  const storageKey = await resolveSessionStorageKey(sessionId, rootDir);
  return path.join(rootDir || defaultRoot(), "sessions", storageKey + ".json");
}

async function sessionArtifactsDir(rootDir, sessionId) {
  const storageKey = await resolveSessionStorageKey(sessionId, rootDir);
  return path.join(rootDir || defaultRoot(), "sessions", storageKey);
}

function readPayloadRevision(payload) {
  if (!payload || typeof payload !== "object") return 0;
  const hiddenRevision = payload[PAYLOAD_REVISION_KEY];
  if (Number.isInteger(hiddenRevision)) return hiddenRevision;
  if (Number.isInteger(payload.revision)) return payload.revision;
  return 0;
}

function attachPayloadRevision(payload, revision) {
  if (!payload || typeof payload !== "object") return payload;
  Object.defineProperty(payload, PAYLOAD_REVISION_KEY, {
    value: Number.isInteger(revision) ? revision : 0,
    enumerable: false,
    configurable: true,
    writable: true
  });
  return payload;
}

function normalizeSessionEnvelope(sessionId, value) {
  const sid = String(sessionId);
  const now = new Date().toISOString();

  if (value && typeof value === "object" && value.envelope_version === SESSION_ENVELOPE_VERSION) {
    const payload = value.payload && typeof value.payload === "object" ? value.payload : {};
    const revision = Number.isInteger(value.revision) ? value.revision : 0;
    return {
      envelope_version: SESSION_ENVELOPE_VERSION,
      session_id: String(value.session_id || sid),
      created_at: value.created_at || payload.created_at || now,
      updated_at: value.updated_at || now,
      owner: value.owner ?? payload.owner ?? null,
      status: value.status || "active",
      revision,
      payload
    };
  }

  const payload = value && typeof value === "object" ? value : {};
  return {
    envelope_version: SESSION_ENVELOPE_VERSION,
    session_id: sid,
    created_at: payload.created_at || now,
    updated_at: payload.updated_at || now,
    owner: payload.owner ?? null,
    status: "active",
    revision: 0,
    payload
  };
}

function buildSessionEnvelope(sessionId, legacySessionJson, existingEnvelope) {
  const payload = legacySessionJson && typeof legacySessionJson === "object" ? legacySessionJson : {};
  const now = new Date().toISOString();
  const existing = existingEnvelope ? normalizeSessionEnvelope(sessionId, existingEnvelope) : null;
  const incomingRevision = readPayloadRevision(payload);
  const existingRevision = existing ? existing.revision : 0;
  const newRevision = Math.max(incomingRevision, existingRevision) + 1;

  return {
    envelope_version: SESSION_ENVELOPE_VERSION,
    session_id: String(sessionId),
    created_at: existing?.created_at ?? payload.created_at ?? now,
    updated_at: now,
    owner: payload.owner ?? existing?.owner ?? null,
    status: existing?.status ?? "active",
    revision: newRevision,
    payload
  };
}

function extractLegacySessionFromEnvelope(envelope) {
  if (!envelope || typeof envelope !== "object") return envelope;
  if (Object.prototype.hasOwnProperty.call(envelope, "payload")) {
    return attachPayloadRevision(envelope.payload, Number.isInteger(envelope.revision) ? envelope.revision : 0);
  }
  return attachPayloadRevision(envelope, 0);
}

async function atomicWriteJson(filePath, jsonObj) {
  const tmp = filePath + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(jsonObj, null, 2), "utf8");
  await fs.rename(tmp, filePath);
}

async function readExistingEnvelope(sessionId, filePath) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return normalizeSessionEnvelope(sessionId, JSON.parse(content));
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    throw err;
  }
}

/**
 * Writes the canonical session envelope while preserving the legacy session as payload.
 * Runtime/API callers continue to receive only the legacy payload on load.
 */
async function saveSessionEnvelope(sessionId, sessionJson, rootDir) {
  const currentStorageKey = await resolveSessionStorageKey(sessionId, rootDir);
  const requestedStorageKey = String(sessionJson?.storage_key || currentStorageKey || sessionId);
  const storageKey = await registerSessionStorageKey(sessionId, requestedStorageKey, rootDir);
  const sessionsDir = path.join(rootDir || defaultRoot(), "sessions");
  const filePath = path.join(sessionsDir, storageKey + ".json");
  const previousFilePath = path.join(sessionsDir, currentStorageKey + ".json");
  await fs.mkdir(sessionsDir, { recursive: true });

  const existingEnvelope = await readExistingEnvelope(sessionId, previousFilePath);
  const incomingRevision = readPayloadRevision(sessionJson);
  const existingRevision = existingEnvelope ? existingEnvelope.revision : 0;

  if (existingEnvelope && incomingRevision < existingRevision) {
    return { conflict: true, expected: existingRevision, got: incomingRevision };
  }

  const envelope = buildSessionEnvelope(sessionId, sessionJson, existingEnvelope);
  await atomicWriteJson(filePath, envelope);
  if (previousFilePath !== filePath) {
    await fs.unlink(previousFilePath).catch((error) => {
      if (!error || error.code !== "ENOENT") throw error;
    });
    const previousDir = path.join(sessionsDir, currentStorageKey);
    const nextDir = path.join(sessionsDir, storageKey);
    await fs.rename(previousDir, nextDir).catch((error) => {
      if (!error || error.code !== "ENOENT") throw error;
    });
  }
  try {
    await saveSessionEnvelopeToDb(sessionId, envelope);
  } catch (_) {
    // FS remains canonical; DB sink is best-effort in A5.4.
  }
  attachPayloadRevision(sessionJson, envelope.revision);
  return { filePath, revision: envelope.revision, storageKey };
}

/**
 * Loads the canonical session envelope and returns the legacy payload for runtime compatibility.
 */
async function loadSessionEnvelope(sessionId, rootDir) {
  const filePath = await sessionEnvelopePath(rootDir, sessionId);
  const content = await fs.readFile(filePath, "utf8");
  const envelope = normalizeSessionEnvelope(sessionId, JSON.parse(content));
  return extractLegacySessionFromEnvelope(envelope);
}

async function loadRawSessionEnvelope(sessionId, rootDir) {
  const filePath = await sessionEnvelopePath(rootDir, sessionId);
  const content = await fs.readFile(filePath, "utf8");
  return normalizeSessionEnvelope(sessionId, JSON.parse(content));
}

async function deleteSessionEnvelope(sessionId, rootDir) {
  const filePath = await sessionEnvelopePath(rootDir, sessionId);
  try {
    await fs.unlink(filePath);
    await unregisterSessionStorageKey(sessionId, rootDir);
    return { filePath, deleted: true };
  } catch (err) {
    if (err && err.code === "ENOENT") {
      return { filePath, deleted: false };
    }
    throw err;
  }
}

async function listSessionEnvelopes(rootDir) {
  const dirPath = path.join(rootDir || defaultRoot(), "sessions");
  await fs.mkdir(dirPath, { recursive: true });
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const sessions = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const filePath = path.join(dirPath, entry.name);
    const fileStorageKey = entry.name.replace(/\.json$/i, "");
    try {
      const text = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(text);
      const sessionId = String(parsed?.session_id || parsed?.payload?.session_id || fileStorageKey);
      sessions.push(extractLegacySessionFromEnvelope(normalizeSessionEnvelope(sessionId, parsed)));
    } catch (err) {
      sessions.push({
        session_id: fileStorageKey,
        status: "corrupt",
        source_name: entry.name,
        load_error: err && err.message ? err.message : String(err)
      });
    }
  }

  return sessions;
}

/**
 * Writes the Mother document snapshot artifact.
 * Output path remains identical to current legacy artifact behavior:
 * out/mother_dxf_v1/sessions/<session_id>/mother.json
 */
async function saveMotherJson(sessionId, motherJson, rootDir) {
  const filePath = path.join(await sessionArtifactsDir(rootDir, sessionId), "mother.json");
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await atomicWriteJson(filePath, motherJson == null ? null : motherJson);
  return { filePath };
}

module.exports = {
  SESSION_ENVELOPE_VERSION,
  buildSessionEnvelope,
  extractLegacySessionFromEnvelope,
  saveSessionEnvelope,
  loadSessionEnvelope,
  loadRawSessionEnvelope,
  deleteSessionEnvelope,
  listSessionEnvelopes,
  saveMotherJson
};
