"use strict";

const fs = require("fs");
const path = require("path");

function parseEnvText(text) {
  const values = {};
  const lines = String(text || "").split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separator = line.indexOf("=");
    if (separator <= 0) continue;

    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1).trim();
    const unquoted = rawValue.replace(/^(['"])(.*)\1$/, "$2");

    if (key && process.env[key] === undefined) {
      values[key] = unquoted;
      process.env[key] = unquoted;
    }
  }

  return values;
}

function loadEnvFile(envFilePath) {
  const filePath = path.resolve(envFilePath || path.join(process.cwd(), ".env"));
  if (!fs.existsSync(filePath)) {
    return { filePath, loaded: false, values: {} };
  }

  const text = fs.readFileSync(filePath, "utf8");
  return {
    filePath,
    loaded: true,
    values: parseEnvText(text)
  };
}

module.exports = {
  loadEnvFile,
  parseEnvText
};
