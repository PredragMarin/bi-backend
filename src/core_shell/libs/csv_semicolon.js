"use strict";

function stripBom(s) {
  if (!s) return s;
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function parseCsvSemicolon(text) {
  const s = stripBom(String(text || ""));
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];

    if (inQuotes) {
      if (ch === "\"") {
        const next = s[i + 1];
        if (next === "\"") {
          field += "\"";
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === "\"") { inQuotes = true; continue; }
    if (ch === ";") { row.push(field); field = ""; continue; }
    if (ch === "\n") { row.push(field); field = ""; rows.push(row); row = []; continue; }
    if (ch === "\r") continue;

    field += ch;
  }

  row.push(field);
  const isLastRowEmpty = row.length === 1 && row[0] === "" && rows.length > 0;
  if (!isLastRowEmpty) rows.push(row);

  while (rows.length && rows[rows.length - 1].every(v => String(v || "") === "")) rows.pop();
  if (!rows.length) return { headers: [], records: [] };

  const headers = rows[0].map(h => String(h || "").trim());
  const records = [];
  for (let r = 1; r < rows.length; r++) {
    const arr = rows[r];
    if (!arr || !arr.length) continue;
    const obj = {};
    for (let c = 0; c < headers.length; c++) obj[headers[c]] = arr[c] ?? "";
    records.push(obj);
  }
  return { headers, records };
}

module.exports = {
  stripBom,
  parseCsvSemicolon
};
