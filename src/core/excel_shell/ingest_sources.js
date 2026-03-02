"use strict";

const path = require("path");

const INGEST_SOURCES = {
  epr_hzzo: {
    module_key: "epr_hzzo",
    mode: "STRICT",
    period_type: "monthly",
    recursive: false,
    patterns: ["*.xls", "*.xlsx"],
    prefer_name_regex: "^PNR-I_",
    source_dir_template: process.env.EPR_HZZO_SOURCE_DIR || ""
  },
  eojn_budget: {
    module_key: "eojn_budget",
    mode: "LENIENT",
    period_type: "daily",
    recursive: true,
    patterns: ["*.xls", "*.xlsx"],
    prefer_name_regex: "",
    source_dir_template: process.env.EOJN_BUDGET_SOURCE_DIR || ""
  }
};

function pad2(n) {
  return String(n).padStart(2, "0");
}

function normalizeDateParts(dateLike) {
  const m = String(dateLike || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return {
    yyyy: m[1],
    mm: m[2],
    dd: m[3],
    yyyy_mm: `${m[1]}_${m[2]}`,
    yyyy_mm_dd: `${m[1]}_${m[2]}_${m[3]}`
  };
}

function renderTemplate(template, periodDateISO) {
  if (!template) return "";
  const p = normalizeDateParts(periodDateISO);
  if (!p) return template;
  return String(template)
    .replace(/\{YYYY\}/g, p.yyyy)
    .replace(/\{MM\}/g, p.mm)
    .replace(/\{DD\}/g, p.dd)
    .replace(/\{YYYY_MM\}/g, p.yyyy_mm)
    .replace(/\{YYYY_MM_DD\}/g, p.yyyy_mm_dd);
}

function normalizePath(p) {
  if (!p) return "";
  return path.normalize(String(p));
}

function resolveIngestSource({ moduleKey, sourceDirOverride = "", periodDateISO = "" }) {
  const base = INGEST_SOURCES[moduleKey];
  if (!base) {
    throw new Error(`Unknown ingest source module key: ${moduleKey}`);
  }
  const resolved = sourceDirOverride
    ? normalizePath(sourceDirOverride)
    : normalizePath(renderTemplate(base.source_dir_template, periodDateISO));

  return {
    ...base,
    resolved_source_dir: resolved
  };
}

function getIngestSources() {
  return JSON.parse(JSON.stringify(INGEST_SOURCES));
}

module.exports = {
  getIngestSources,
  resolveIngestSource
};

