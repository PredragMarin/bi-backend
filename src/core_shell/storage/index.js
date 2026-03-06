"use strict";

const path = require("path");
const { createFsStorage } = require("./fs_store");

function normalizeBackendName(name) {
  const v = String(name || "fs").trim().toLowerCase();
  if (v === "filesystem") return "fs";
  return v;
}

function createStorage(options = {}) {
  const backend = normalizeBackendName(options.backend || process.env.BI_CORE_STORE_BACKEND || "fs");

  if (backend === "fs") {
    return createFsStorage(options);
  }

  throw new Error(`Unsupported BI core store backend: ${backend}`);
}

function resolveStoreRoot(storeRoot) {
  const v = String(storeRoot || "").trim();
  if (!v) {
    throw new Error("Missing storeRoot");
  }
  return path.resolve(v);
}

module.exports = {
  createStorage,
  resolveStoreRoot
};
