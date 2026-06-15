"use strict";

const fs = require("fs/promises");
const path = require("path");
const { resolveSessionStorageKey } = require("../session/session_locator");

function defaultRoot() {
  return path.join("out", "mother_dxf_v1");
}

/**
 * Writes param set JSON for a session.
 * Output path must remain identical to legacy behavior:
 * out/mother_dxf_v1/sessions/<session_id>/param_set.json
 */
async function saveParamSet(sessionId, paramSetJson, rootDir) {
  const storageKey = await resolveSessionStorageKey(sessionId, rootDir);
  const dir = path.join(rootDir || defaultRoot(), "sessions", storageKey);

  const filePath = path.join(dir, "param_set.json");

  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(paramSetJson, null, 2), "utf8");

  return filePath;
}

module.exports = { saveParamSet };
