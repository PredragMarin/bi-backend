"use strict";

function makeBaseAudit(extra = {}) {
  return {
    enabled: true,
    files_total: 0,
    files_loaded: 0,
    rows_loaded: 0,
    files_failed: 0,
    file_errors: [],
    warnings: [],
    ...extra
  };
}

function addFileLoad(audit, rowCount = 0) {
  audit.files_loaded += 1;
  audit.rows_loaded += Number(rowCount || 0);
}

function addFileError(audit, file, error) {
  audit.files_failed += 1;
  audit.file_errors.push({
    file: String(file || ""),
    error: String(error || "Unknown error")
  });
}

module.exports = {
  makeBaseAudit,
  addFileLoad,
  addFileError
};

