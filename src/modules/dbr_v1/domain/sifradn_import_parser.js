"use strict";

const MAX_RECORDS = 50;
const RN_HEADER = "RN";
const RN_TOKEN_RE = /^[A-Z0-9][A-Z0-9._/-]*$/;

function asObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object.`);
  }
  return value;
}

function nonEmptyString(value, name) {
  const text = String(value === undefined || value === null ? "" : value).trim();
  if (!text) {
    throw new Error(`${name} is required.`);
  }
  return text;
}

function normalizeQuantity(value) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    throw new Error("quantity must be a positive integer.");
  }
  return numeric;
}

function normalizeOptionalPositiveInteger(value, name) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    throw new Error(`${name} must be a positive integer when supplied.`);
  }
  return numeric;
}

function buildValidationBucket() {
  return {
    ok: true,
    errors: [],
    warnings: []
  };
}

function pushWarning(bucket, code, detail, context) {
  bucket.warnings.push({
    code,
    detail,
    context: context || null
  });
}

function normalizeSifradnToken(value) {
  return nonEmptyString(value, "sifradn").replace(/\s+/g, "").toUpperCase();
}

function extractPaste(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }
  return input.sifradn_paste || input.rn_paste || input.paste || null;
}

function parseSifradnPasteInput(text, options = {}) {
  const validation = buildValidationBucket();
  const maxItems = Number.isFinite(Number(options.maxItems)) ? Number(options.maxItems) : MAX_RECORDS;
  const rawText = String(text || "");
  const lines = rawText.split(/\r?\n/);
  const normalized = [];
  const seen = new Set();
  const duplicates = [];
  const invalidLines = [];
  let headerHandled = false;
  let blankLineCount = 0;
  let firstDataLineSeen = false;

  lines.forEach((line, index) => {
    const trimmed = String(line || "").trim();
    if (!trimmed) {
      blankLineCount += 1;
      return;
    }
    if (!firstDataLineSeen && trimmed.toUpperCase() === RN_HEADER) {
      headerHandled = true;
      firstDataLineSeen = true;
      return;
    }

    firstDataLineSeen = true;
    const token = trimmed.replace(/\s+/g, "").toUpperCase();
    if (!RN_TOKEN_RE.test(token)) {
      invalidLines.push({
        line_number: index + 1,
        raw_value: trimmed,
        normalized_candidate: token
      });
      return;
    }
    if (seen.has(token)) {
      duplicates.push(token);
      return;
    }
    seen.add(token);
    normalized.push(token);
  });

  if (invalidLines.length) {
    pushWarning(
      validation,
      "SIFRADN_LINES_SKIPPED",
      `${invalidLines.length} input lines were skipped because they do not match the RN/SIFRADN token rule.`,
      { invalid_lines: invalidLines }
    );
  }
  if (duplicates.length) {
    pushWarning(
      validation,
      "SIFRADN_DUPLICATES_REMOVED",
      `${duplicates.length} duplicate RN/SIFRADN values were removed after normalization.`,
      { duplicates_removed: Array.from(new Set(duplicates)) }
    );
  }

  if (!normalized.length) {
    throw new Error("No valid RN/SIFRADN tokens were parsed from the paste input.");
  }
  if (normalized.length > maxItems) {
    throw new Error(`Parsed ${normalized.length} RN/SIFRADN values, maxItems is ${maxItems}.`);
  }

  return {
    inputMode: "sifradn_paste_multiline_v1",
    rawLineCount: lines.length,
    blankLineCount,
    headerHandled,
    headerValue: headerHandled ? RN_HEADER : null,
    normalizedSifradn: normalized,
    duplicatesRemoved: Array.from(new Set(duplicates)),
    invalidLines,
    recordCount: normalized.length,
    maxRecords: maxItems,
    validation
  };
}

function extractRecords(input) {
  if (Array.isArray(input)) {
    return input;
  }

  const payload = asObject(input, "payload");
  if (Array.isArray(payload.records)) {
    return payload.records;
  }
  if (Array.isArray(payload.items)) {
    return payload.items;
  }
  if (Array.isArray(payload.sifradn_list)) {
    return payload.sifradn_list;
  }
  if (Array.isArray(payload.sifradnList)) {
    return payload.sifradnList;
  }

  throw new Error("Request must be an array or contain records/items/sifradn_list.");
}

function normalizeRecord(record, index) {
  const source = asObject(record, `records[${index}]`);
  const sifradn = normalizeSifradnToken(source.sifradn || source.SIFRADN);
  const kitCode = nonEmptyString(
    source.kit_code || source.kitCode || source.technology_profile || source.technologyProfile,
    `records[${index}].kit_code`
  ).toUpperCase();
  const quantity = normalizeQuantity(source.quantity === undefined ? 1 : source.quantity);
  const parameters = source.parameters === undefined ? {} : asObject(source.parameters, `records[${index}].parameters`);
  const gosoftDnId = normalizeOptionalPositiveInteger(
    source.gosoftDnId || source.gosoft_dn_id || source.dnid || source.DNID,
    `records[${index}].gosoftDnId`
  );

  return {
    index,
    sifradn,
    kitCode,
    quantity,
    parameters,
    gosoftDnId,
    raw: source
  };
}

function parseSifradnImportPayload(input) {
  const paste = extractPaste(input);
  if (paste !== null && paste !== undefined) {
    return parseSifradnPasteInput(paste);
  }

  const records = extractRecords(input);
  if (!records.length) {
    throw new Error("At least one SIFRADN record is required.");
  }
  if (records.length > MAX_RECORDS) {
    throw new Error(`At most ${MAX_RECORDS} SIFRADN records are allowed per import.`);
  }

  const seen = new Set();
  const parsedRecords = records.map((record, index) => {
    const parsed = normalizeRecord(record, index);
    if (seen.has(parsed.sifradn)) {
      throw new Error(`Duplicate sifradn in import payload: ${parsed.sifradn}`);
    }
    seen.add(parsed.sifradn);
    return parsed;
  });

  return {
    inputMode: "sifradn_record_array_v1",
    records: parsedRecords,
    normalizedSifradn: parsedRecords.map((record) => record.sifradn),
    recordCount: parsedRecords.length,
    maxRecords: MAX_RECORDS,
    validation: buildValidationBucket()
  };
}

module.exports = {
  MAX_RECORDS,
  parseSifradnPasteInput,
  parseSifradnImportPayload
};
