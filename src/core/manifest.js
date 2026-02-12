// src/core/manifest.js
const fs = require("fs");
const path = require("path");

function loadManifest(use_case) {
  const p = path.resolve(__dirname, "..", "modules", use_case, "module_manifest.json");
  if (!fs.existsSync(p)) throw new Error(`Missing module manifest: ${p}`);
  const raw = fs.readFileSync(p, "utf-8");
  return JSON.parse(raw);
}

module.exports = { loadManifest };
