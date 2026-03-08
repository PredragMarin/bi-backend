"use strict";

const fs = require("fs");
const path = require("path");

function fileExists(p) {
  try {
    return !!(p && fs.existsSync(p) && fs.statSync(p).isFile());
  } catch (_) {
    return false;
  }
}

function parseSecretFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const json = JSON.parse(raw);
  const user = String((json && json.eojnUser) || "").trim();
  const pass = String((json && json.eojnPass) || "").trim();
  if (!user || !pass) {
    throw new Error("Invalid EOJN secret file format. Expected eojnUser and eojnPass.");
  }
  return json;
}

function candidateDefaultSecretPath() {
  const home = process.env.USERPROFILE || process.env.HOME || "";
  if (!home) return "";
  return path.join(home, ".secrets", "eojn_secret.json");
}

function resolveEojnConfigPath({ configPathOverride } = {}) {
  const explicit = String(configPathOverride || "").trim();
  if (explicit) {
    if (!fileExists(explicit)) throw new Error(`EOJN config file not found: ${explicit}`);
    parseSecretFile(explicit);
    return explicit;
  }

  const fromConfigEnv = String(process.env.EOJN_CONFIG_PATH || "").trim();
  if (fromConfigEnv) {
    if (!fileExists(fromConfigEnv)) throw new Error(`EOJN_CONFIG_PATH file not found: ${fromConfigEnv}`);
    parseSecretFile(fromConfigEnv);
    return fromConfigEnv;
  }

  const fromSecretEnv = String(process.env.EOJN_SECRET_FILE || "").trim();
  if (fromSecretEnv) {
    if (!fileExists(fromSecretEnv)) throw new Error(`EOJN_SECRET_FILE not found: ${fromSecretEnv}`);
    parseSecretFile(fromSecretEnv);
    return fromSecretEnv;
  }

  const fallback = candidateDefaultSecretPath();
  if (fileExists(fallback)) {
    parseSecretFile(fallback);
    return fallback;
  }

  throw new Error("Missing EOJN credentials file. Set EOJN_SECRET_FILE or EOJN_CONFIG_PATH.");
}

module.exports = {
  resolveEojnConfigPath
};
