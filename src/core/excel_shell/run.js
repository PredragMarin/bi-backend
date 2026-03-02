"use strict";

const { discoverExcelSources } = require("./discover");
const { makeBaseAudit, addFileLoad, addFileError, addFileRejected } = require("./audit");

function runExcelIngestShell({
  sourcePath,
  mode = "STRICT",
  recursive = false,
  preferNameRegex = "",
  extractRows,
  normalizeRows,
  validateFile
}) {
  if (typeof extractRows !== "function") {
    throw new Error("runExcelIngestShell: extractRows function is required.");
  }
  if (typeof normalizeRows !== "function") {
    throw new Error("runExcelIngestShell: normalizeRows function is required.");
  }

  const files = discoverExcelSources({ sourcePath, recursive, preferNameRegex });
  const audit = makeBaseAudit();
  audit.files_total = files.length;

  const normalized = [];
  for (const f of files) {
    if (typeof validateFile === "function") {
      const verdict = validateFile(f);
      if (!verdict || verdict.ok === false) {
        addFileRejected(audit, f.fullPath, verdict && verdict.reason ? verdict.reason : "Rejected by validateFile");
        continue;
      }
    }
    try {
      const rawRows = extractRows(f);
      const rows = normalizeRows(rawRows, f);
      normalized.push(...(Array.isArray(rows) ? rows : []));
      addFileLoad(audit, Array.isArray(rawRows) ? rawRows.length : 0);
    } catch (err) {
      addFileError(audit, f.fullPath, err && err.message ? err.message : String(err));
    }
  }

  const status = audit.files_failed > 0
    ? (String(mode).toUpperCase() === "STRICT" ? "FAIL" : "PARTIAL")
    : "OK";
  const canContinue = String(mode).toUpperCase() === "LENIENT" ? true : status === "OK";

  return {
    status,
    mode: String(mode).toUpperCase(),
    can_continue: canContinue,
    manual_review_required: status !== "OK",
    files,
    normalized_rows: normalized,
    audit
  };
}

module.exports = {
  runExcelIngestShell
};
