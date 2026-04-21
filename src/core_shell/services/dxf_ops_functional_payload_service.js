"use strict";

const CSV_FIELD_NAMES = [
  "MODEL_CODE",
  "MODEL_NAME",
  "WIDTH",
  "HEIGHT",
  "SKRACENJE",
  "VANJSKA_VRATA",
  "ELEKTROPRIHVATNIK",
  "SPIJUNKA",
  "STRANA",
  "DOVRATNIK",
  "DRZACI",
  "VANJSKI_PANEL",
  "UNUTARNJI_PANEL",
  "LETVICE_BOJA",
  "VANJSKE_LETVE",
  "BRAVA",
  "CILINDAR",
  "FUNKCIJA_OKOVA",
  "OKOV_VANJSKI",
  "OKOV_UNUTARNJI",
  "METLICA",
  "LIMITATOR",
  "TRECA_SPOJNICA",
  "ZATVARAC",
  "SEGMENT_SIRINE",
  "SEGMENT_VISINE",
  "REFERENCE",
  "NOTE",
  "WORK_ORDER",
  "IS_SUBFRAME",
  "VALID_FLAG",
  "CHECKSUM"
];

const OPTIONAL_CSV_FIELDS = new Set([
  "NOTE"
]);

function trimValue(value) {
  return String(value === null || value === undefined ? "" : value).trim();
}

function normalizeObjectKeys(row) {
  const out = {};
  if (!row || typeof row !== "object") return out;
  for (const [key, value] of Object.entries(row)) {
    out[String(key).trim().toLowerCase()] = value;
  }
  return out;
}

function extractCsv(opombe) {
  const source = String(opombe || "");
  const first = source.indexOf("#");
  const last = source.lastIndexOf("#");
  if (first < 0 || last <= first) return null;
  const inner = source.slice(first + 1, last).trim();
  return inner || null;
}

function validateChecksum(csvString) {
  const raw = trimValue(csvString);
  if (!raw) return false;
  const parts = raw.split(";");
  if (parts.length !== CSV_FIELD_NAMES.length) return false;
  const checksumField = trimValue(parts[parts.length - 1]);
  if (!/^\d{3}$/.test(checksumField)) return false;
  const body = parts.slice(0, -1).join(";");
  const sum = Array.from(body).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const expected = String(sum % 1000).padStart(3, "0");
  return expected === checksumField;
}

function parseDimension(str) {
  const text = trimValue(str).replace(/\s+/g, "");
  if (!text) return null;
  const mmMatch = /^(-?\d+(?:[.,]\d+)?)MM$/i.exec(text);
  if (mmMatch) return Math.round(Number(mmMatch[1].replace(",", ".")));
  const cmMatch = /^(-?\d+(?:[.,]\d+)?)CM$/i.exec(text);
  if (cmMatch) return Math.round(Number(cmMatch[1].replace(",", ".")) * 10);
  const num = Number(text.replace(",", "."));
  return Number.isFinite(num) ? Math.round(num) : null;
}

function parseRange(str) {
  const text = trimValue(str);
  if (!text) return null;
  const parts = text.split(/\s*-\s*/).map(trimValue).filter(Boolean);
  if (parts.length === 2) {
    const min = parseDimension(parts[0]);
    const max = parseDimension(parts[1]);
    if (Number.isFinite(min) && Number.isFinite(max)) {
      return { min, max };
    }
  }
  const single = parseDimension(text);
  if (Number.isFinite(single)) {
    return { min: single, max: single };
  }
  return null;
}

function parseBooleanLike(str) {
  const text = trimValue(str).toUpperCase();
  if (text === "DA") return true;
  if (text === "NE") return false;
  return null;
}

function parseCsvToJson(csvString) {
  const raw = trimValue(csvString);
  const parts = raw.split(";").map((part) => trimValue(part));
  if (parts.length !== CSV_FIELD_NAMES.length) {
    throw new Error(`Expected ${CSV_FIELD_NAMES.length} CSV fields, got ${parts.length}.`);
  }
  const data = {};
  CSV_FIELD_NAMES.forEach((name, index) => {
    data[name] = parts[index];
  });
  const emptyFields = CSV_FIELD_NAMES.filter((name) => !OPTIONAL_CSV_FIELDS.has(name) && !trimValue(data[name]));
  if (emptyFields.length) {
    throw new Error(`Empty CSV fields are not allowed: ${emptyFields.join(", ")}`);
  }
  return data;
}

function buildConfiguratorData(parsedCsv) {
  const width = parseDimension(parsedCsv.WIDTH);
  const height = parseDimension(parsedCsv.HEIGHT);
  const segmentWidth = parseRange(parsedCsv.SEGMENT_SIRINE);
  const segmentHeight = parseRange(parsedCsv.SEGMENT_VISINE);

  if (!Number.isFinite(width)) throw new Error(`Invalid WIDTH: ${parsedCsv.WIDTH}`);
  if (!Number.isFinite(height)) throw new Error(`Invalid HEIGHT: ${parsedCsv.HEIGHT}`);
  if (!segmentWidth) throw new Error(`Invalid SEGMENT_SIRINE: ${parsedCsv.SEGMENT_SIRINE}`);
  if (!segmentHeight) throw new Error(`Invalid SEGMENT_VISINE: ${parsedCsv.SEGMENT_VISINE}`);

  return {
    SIRINA_VRATA: width,
    SKRACENJE: parseDimension(parsedCsv.SKRACENJE) ?? parsedCsv.SKRACENJE,
    VANJSKI_PANEL: parsedCsv.VANJSKI_PANEL,
    MODEL_VRATA: parsedCsv.MODEL_CODE,
    TIP_VRATA: parsedCsv.MODEL_NAME,
    STRANA_OTVARANJA: parsedCsv.STRANA,
    BRAVA: parsedCsv.BRAVA,
    UNUTARNJI_PANEL: parsedCsv.UNUTARNJI_PANEL,
    BOJA_DOVRATNIKA: parsedCsv.DOVRATNIK,
    BOJA_METALNIH_DRZACA_PANELA: parsedCsv.DRZACI,
    CILINDAR: parsedCsv.CILINDAR,
    FUNKCIJA_OKOVA: parsedCsv.FUNKCIJA_OKOVA,
    VANJSKE_UKRASNE_LETVE: parsedCsv.VANJSKE_LETVE,
    UNUTARNJE_UKRASNE_LETVE: parsedCsv.LETVICE_BOJA,
    SPIJUNKA_VISINA: parseDimension(parsedCsv.SPIJUNKA),
    LIMITATOR: parsedCsv.LIMITATOR,
    ELEKTROPRIHVATNIK: parsedCsv.ELEKTROPRIHVATNIK,
    HIDRAULICKI_ZATVARAC: parsedCsv.ZATVARAC,
    METLICA: parsedCsv.METLICA,
    BOJA_OKOVA_IZNUTRA: parsedCsv.OKOV_UNUTARNJI,
    BOJA_OKOVA_IZVANA: parsedCsv.OKOV_VANJSKI,
    TRECA_SPOJNICA: parsedCsv.TRECA_SPOJNICA,
    VANJSKA_VRATA: parsedCsv.VANJSKA_VRATA,
    SEGMENT_SIRINE: segmentWidth,
    SEGMENT_VISINE: segmentHeight,
    VISINA_VRATA: height
  };
}

function buildFunctionalPayloadFromVdnRow(row) {
  const normalizedRow = normalizeObjectKeys(row);
  const csvString = extractCsv(normalizedRow.opombe);
  const checksumValid = validateChecksum(csvString || "");
  const parsedCsv = parseCsvToJson(csvString || "");
  const configuratorData = buildConfiguratorData(parsedCsv);

  return {
    dnid: Number(normalizedRow.dnid),
    nalogid: Number(normalizedRow.nalogid),
    nalog: trimValue(normalizedRow.nalog),
    sifraid: trimValue(normalizedRow.sifraid),
    kolicina: Number(normalizedRow.kolicina),
    admctr: trimValue(normalizedRow.admctr),
    status: trimValue(normalizedRow.status),
    status_sifra: trimValue(normalizedRow.status_sifra),
    reference: parsedCsv.REFERENCE,
    note: parsedCsv.NOTE,
    workOrderCode: parsedCsv.WORK_ORDER,
    isDoorSubframe: parseBooleanLike(parsedCsv.IS_SUBFRAME),
    validFlag: parseBooleanLike(parsedCsv.VALID_FLAG),
    checksum: parsedCsv.CHECKSUM,
    checksumValid,
    rawConfigString: csvString,
    configuratorData
  };
}

module.exports = {
  CSV_FIELD_NAMES,
  extractCsv,
  validateChecksum,
  parseDimension,
  parseRange,
  parseCsvToJson,
  buildFunctionalPayloadFromVdnRow
};
