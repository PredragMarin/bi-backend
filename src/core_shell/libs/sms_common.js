"use strict";

function ensureSafePeriodFolder(period) {
  const p = String(period || "").trim();
  if (!p) throw new Error("Missing period");
  const norm = p.includes("-") ? p.replace("-", "_") : p;
  if (!/^\d{4}_\d{2}$/.test(norm)) throw new Error(`Invalid period '${period}'. Expected YYYY_MM.`);
  return norm;
}

function normalizeDecision(v) {
  const s = String(v || "").trim().toLowerCase();
  if (s === "approved" || s === "approve" || s === "1" || s === "true" || s === "yes") return "approved";
  if (s === "rejected" || s === "reject" || s === "0" || s === "false" || s === "no") return "rejected";
  return null;
}

module.exports = {
  ensureSafePeriodFolder,
  normalizeDecision
};
