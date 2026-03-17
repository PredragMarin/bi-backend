"use strict";

const path = require("path");
const XLSX = require("xlsx");

const SUPPORTED_WORKBOOK_EXTENSIONS = new Set([".xls", ".xlsx", ".ods"]);

function normalizeWorkbookExt(filePath) {
  return String(path.extname(String(filePath || ""))).toLowerCase();
}

function isSupportedWorkbookFile(filePath) {
  return SUPPORTED_WORKBOOK_EXTENSIONS.has(normalizeWorkbookExt(filePath));
}

function cellTextFromSheet(ws, r0, c0) {
  const addr = XLSX.utils.encode_cell({ r: r0, c: c0 });
  const cell = ws[addr];
  if (!cell) return "";
  if (cell.w !== undefined && cell.w !== null) return String(cell.w).trim();
  if (cell.v === undefined || cell.v === null) return "";
  return String(cell.v).trim();
}

function extractWorkbookMatrix({ filePath, maxRows = 6000, maxCols = 80 } = {}) {
  const resolvedPath = path.resolve(String(filePath || ""));
  if (!resolvedPath) throw new Error("Workbook path is required.");
  if (!isSupportedWorkbookFile(resolvedPath)) {
    throw new Error(`Unsupported workbook file type: ${path.extname(resolvedPath) || "(none)"}`);
  }

  const wb = XLSX.readFile(resolvedPath, { cellDates: false, cellNF: false, cellText: true });
  const sheets = [];
  for (const sheetName of wb.SheetNames || []) {
    const ws = wb.Sheets[sheetName];
    if (!ws || !ws["!ref"]) {
      sheets.push({
        name: sheetName,
        rows: [],
        row_count: 0,
        col_count: 0
      });
      continue;
    }

    const range = XLSX.utils.decode_range(ws["!ref"]);
    const rows = Math.min(Math.max(range.e.r - range.s.r + 1, 0), Number(maxRows) || 6000);
    const cols = Math.min(Math.max(range.e.c - range.s.c + 1, 0), Number(maxCols) || 80);
    const matrix = [];
    for (let r = 0; r < rows; r += 1) {
      const outRow = [];
      for (let c = 0; c < cols; c += 1) {
        outRow.push(cellTextFromSheet(ws, range.s.r + r, range.s.c + c));
      }
      matrix.push(outRow);
    }

    sheets.push({
      name: sheetName,
      rows: matrix,
      row_count: rows,
      col_count: cols
    });
  }

  return {
    source_file: resolvedPath,
    extracted_at: new Date().toISOString(),
    max_rows: Number(maxRows) || 6000,
    max_cols: Number(maxCols) || 80,
    sheets
  };
}

module.exports = {
  SUPPORTED_WORKBOOK_EXTENSIONS,
  isSupportedWorkbookFile,
  extractWorkbookMatrix
};
