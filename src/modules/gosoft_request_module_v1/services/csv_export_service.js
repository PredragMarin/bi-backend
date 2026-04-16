"use strict";

const fs = require("fs");
const path = require("path");

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r;]/.test(s)) {
    return `"${s.replace(/"/g, "\"\"")}"`;
  }
  return s;
}

function writeCsv({ rows, columns, outPath }) {
  const normalizedColumns = Array.isArray(columns) && columns.length
    ? columns
    : Object.keys((rows && rows[0]) || {});
  const csv = [
    normalizedColumns.join(","),
    ...rows.map((row) => normalizedColumns.map((col) => csvEscape(row[col])).join(","))
  ].join("\n");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, csv, "utf8");
  return outPath;
}

module.exports = {
  writeCsv
};
