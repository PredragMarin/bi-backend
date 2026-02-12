// src/core/hash.js
const crypto = require("crypto");

function sha256Hex(s) {
  return crypto.createHash("sha256").update(s, "utf-8").digest("hex");
}

module.exports = { sha256Hex };
