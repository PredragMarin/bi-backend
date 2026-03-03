"use strict";

function normalizeText(value) {
  const s = String(value == null ? "" : value);
  // Canonical unicode form + stable whitespace for downstream matching.
  return s.normalize("NFC").replace(/\s+/g, " ").trim();
}

function foldText(value) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function normalizeObjectStringsDeep(input) {
  if (typeof input === "string") return normalizeText(input);
  if (Array.isArray(input)) return input.map(normalizeObjectStringsDeep);
  if (!input || typeof input !== "object") return input;
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    out[k] = normalizeObjectStringsDeep(v);
  }
  return out;
}

module.exports = {
  normalizeText,
  foldText,
  normalizeObjectStringsDeep
};
