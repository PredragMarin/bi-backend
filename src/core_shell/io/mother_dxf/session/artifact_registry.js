"use strict";

const fs = require("fs/promises");
const path = require("path");
const {
  saveArtifactRegistryToDb
} = require("../db/db_adapter");
const { resolveSessionStorageKey } = require("./session_locator");

const ARTIFACT_REGISTRY_VERSION = 1;

function defaultRoot() {
  return path.join("out", "mother_dxf_v1");
}

async function registryFilePath(rootDir, sessionId) {
  const storageKey = await resolveSessionStorageKey(sessionId, rootDir);
  return path.join(rootDir || defaultRoot(), "sessions", storageKey, "artifact_registry.json");
}

function buildEmptyRegistry(sessionId) {
  return {
    registry_version: ARTIFACT_REGISTRY_VERSION,
    session_id: String(sessionId),
    registry_revision: 0,
    artifacts: {}
  };
}

function normalizeArtifactRecord(value) {
  if (value && typeof value === "object" && !Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, "path")) {
    return {
      path: String(value.path || ""),
      created_at: value.created_at || new Date().toISOString(),
      status: value.status || "valid",
      checksum: value.checksum ?? null,
      size_bytes: value.size_bytes ?? null,
      artifact_revision: Number.isInteger(value.artifact_revision) ? value.artifact_revision : 0
    };
  }

  return {
    path: String(value || ""),
    created_at: new Date().toISOString(),
    status: "valid",
    checksum: null,
    size_bytes: null,
    artifact_revision: 0
  };
}

function normalizeRegistryShape(sessionId, registry) {
  if (!registry || typeof registry !== "object" || Array.isArray(registry)) {
    return buildEmptyRegistry(sessionId);
  }

  if (registry.registry_version === ARTIFACT_REGISTRY_VERSION) {
    const normalized = buildEmptyRegistry(registry.session_id || sessionId);
    normalized.registry_revision = Number.isInteger(registry.registry_revision) ? registry.registry_revision : 0;
    const artifacts = registry.artifacts && typeof registry.artifacts === "object" ? registry.artifacts : {};
    for (const [artifactType, byId] of Object.entries(artifacts)) {
      if (!byId || typeof byId !== "object" || Array.isArray(byId)) continue;
      normalized.artifacts[artifactType] = {};
      for (const [artifactId, record] of Object.entries(byId)) {
        normalized.artifacts[artifactType][artifactId] = normalizeArtifactRecord(record);
      }
    }
    return normalized;
  }

  const normalized = buildEmptyRegistry(sessionId);
  for (const [artifactType, byId] of Object.entries(registry)) {
    if (!byId || typeof byId !== "object" || Array.isArray(byId)) continue;
    normalized.artifacts[artifactType] = {};
    for (const [artifactId, artifactPath] of Object.entries(byId)) {
      normalized.artifacts[artifactType][artifactId] = normalizeArtifactRecord(artifactPath);
    }
  }
  return normalized;
}

async function atomicWriteJson(filePath, jsonObj) {
  const tmp = filePath + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(jsonObj, null, 2), "utf8");
  await fs.rename(tmp, filePath);
}

/**
 * Registers an artifact path for a session.
 * Output path:
 * out/mother_dxf_v1/sessions/<session_id>/artifact_registry.json
 */
async function registerArtifact(sessionId, artifactType, artifactId, artifactPath, rootDir) {
  const registryPath = await registryFilePath(rootDir, sessionId);

  await fs.mkdir(path.dirname(registryPath), { recursive: true });

  let registry = buildEmptyRegistry(sessionId);
  try {
    const content = await fs.readFile(registryPath, "utf8");
    registry = normalizeRegistryShape(sessionId, JSON.parse(content));
  } catch (_) {
    registry = buildEmptyRegistry(sessionId);
  }

  const type = String(artifactType || "artifact");
  const id = String(artifactId || "artifact");
  if (!registry.artifacts[type]) {
    registry.artifacts[type] = {};
  }

  const existingArtifact = registry.artifacts[type][id];
  registry.registry_revision = (Number.isInteger(registry.registry_revision) ? registry.registry_revision : 0) + 1;
  registry.artifacts[type][id] = {
    path: String(artifactPath || ""),
    created_at: new Date().toISOString(),
    status: "valid",
    checksum: null,
    size_bytes: null,
    artifact_revision: ((existingArtifact && Number.isInteger(existingArtifact.artifact_revision)) ? existingArtifact.artifact_revision : 0) + 1
  };

  await atomicWriteJson(registryPath, registry);
  try {
    await saveArtifactRegistryToDb(sessionId, registry);
  } catch (_) {
    // FS remains canonical; DB sink is best-effort in A5.4.
  }

  return registryPath;
}

/**
 * Loads the artifact registry for a session.
 */
async function loadArtifactRegistry(sessionId, rootDir) {
  const registryPath = await registryFilePath(rootDir, sessionId);
  const content = await fs.readFile(registryPath, "utf8");
  return normalizeRegistryShape(sessionId, JSON.parse(content));
}

/**
 * Resolves an artifact path from the registry.
 */
async function resolveArtifactPath(sessionId, artifactType, artifactId, rootDir) {
  const registry = await loadArtifactRegistry(sessionId, rootDir);
  return registry.artifacts?.[artifactType]?.[artifactId]?.path ?? null;
}

module.exports = {
  ARTIFACT_REGISTRY_VERSION,
  buildEmptyRegistry,
  registerArtifact,
  loadArtifactRegistry,
  resolveArtifactPath
};
