"use strict";

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(label + " must be an object.");
  }
}

function assertId(value, label) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9_.:-]*$/i.test(value)) {
    throw new Error(label + " must be a stable string id.");
  }
}

function clonePlain(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function freezeDeep(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) {
    freezeDeep(child);
  }
  return value;
}

function versionKey(id, version) {
  assertId(id, "id");
  if (typeof version !== "string" || !version.trim()) {
    throw new Error("version must be a non-empty string.");
  }
  return id + "@" + version;
}

module.exports = {
  assertPlainObject,
  assertId,
  clonePlain,
  freezeDeep,
  versionKey
};

