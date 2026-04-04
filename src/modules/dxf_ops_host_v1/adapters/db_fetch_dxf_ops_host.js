"use strict";

const { executeErpAllowedBatch } = require("../../../core_shell/services/erp_fetch_service");

const MODULE_ID = "dxf_ops_host_v1";
const CONTRACT_VERSION = "0.2.0-prototype";
const DEFAULT_QUERY_ID = "V_DN_BY_SIFRADN";
const RN_HEADER = "RN";
const RN_TOKEN_RE = /^[A-Z0-9][A-Z0-9._/-]*$/;
const CSV_FIELD_NAMES = [
  "MODEL_CODE",
  "MODEL_NAME",
  "WIDTH",
  "HEIGHT",
  "SKRACENJE",
  "LIMITATOR",
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
  "VANJSKA_VRATA",
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

function normalizeRnToken(value) {
  return trimValue(value).replace(/\s+/g, "").toUpperCase();
}

function buildValidationBucket() {
  return {
    ok: true,
    errors: [],
    warnings: []
  };
}

function pushError(bucket, code, detail, context) {
  bucket.ok = false;
  bucket.errors.push({
    code,
    detail,
    context: context || null
  });
}

function pushWarning(bucket, code, detail, context) {
  bucket.warnings.push({
    code,
    detail,
    context: context || null
  });
}

function parseRnListInput(text, options = {}) {
  const validation = buildValidationBucket();
  const maxItems = Number.isFinite(Number(options.maxItems)) ? Number(options.maxItems) : 500;
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
    const trimmed = trimValue(line);
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
    const rn = normalizeRnToken(trimmed);
    if (!RN_TOKEN_RE.test(rn)) {
      invalidLines.push({
        line_number: index + 1,
        raw_value: trimmed,
        normalized_candidate: rn
      });
      return;
    }
    if (seen.has(rn)) {
      duplicates.push(rn);
      return;
    }
    seen.add(rn);
    normalized.push(rn);
  });

  if (!normalized.length) {
    pushError(validation, "EMPTY_RN_LIST", "No valid RN tokens were parsed from the input.");
  }
  if (normalized.length > maxItems) {
    pushError(validation, "RN_LIMIT_EXCEEDED", `Parsed ${normalized.length} RN values, maxItems is ${maxItems}.`);
  }
  if (invalidLines.length) {
    pushWarning(validation, "RN_LINES_SKIPPED", `${invalidLines.length} input lines were skipped because they do not match the current RN token rule.`);
  }
  if (duplicates.length) {
    pushWarning(validation, "RN_DUPLICATES_REMOVED", `${duplicates.length} duplicate RN values were removed after normalization.`);
  }

  return {
    input_format: "rn_paste_multiline_v1",
    raw_line_count: lines.length,
    blank_line_count: blankLineCount,
    header_handled: headerHandled,
    header_value: headerHandled ? RN_HEADER : null,
    normalized_rns: normalized,
    duplicates_removed: Array.from(new Set(duplicates)),
    invalid_lines: invalidLines,
    validation
  };
}

function buildErpFetchRequestFromRnList({ rnList, dsn = "ERP_POC_RO", queryId = DEFAULT_QUERY_ID, requestId } = {}) {
  const normalizedRns = Array.isArray(rnList) ? rnList.map(normalizeRnToken).filter(Boolean) : [];
  return {
    moduleId: MODULE_ID,
    requestId: requestId || `dxf_ops_host_${Date.now()}`,
    dsnOverride: dsn,
    items: normalizedRns.map((rn, index) => ({
      key: `rn_${index}`,
      queryId,
      params: [rn]
    })),
    fetch_strategy: {
      kind: "allowlisted_single_rn_batch",
      query_id: queryId
    }
  };
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
    MODEL_VRATA: parsedCsv.MODEL_CODE,
    MODEL_NAZIV: parsedCsv.MODEL_NAME,
    SIRINA_VRATA: width,
    VISINA_VRATA: height,
    SKRACENJE: parsedCsv.SKRACENJE,
    LIMITATOR: parsedCsv.LIMITATOR,
    ELEKTROPRIHVATNIK: parsedCsv.ELEKTROPRIHVATNIK,
    SPIJUNKA_VISINA: parseDimension(parsedCsv.SPIJUNKA),
    STRANA_OTVARANJA: parsedCsv.STRANA,
    BOJA_DOVRATNIKA: parsedCsv.DOVRATNIK,
    BOJA_METALNIH_DRZACA_PANELA: parsedCsv.DRZACI,
    VANJSKI_PANEL: parsedCsv.VANJSKI_PANEL,
    UNUTARNJI_PANEL: parsedCsv.UNUTARNJI_PANEL,
    UNUTARNJE_UKRASNE_LETVE: parsedCsv.LETVICE_BOJA,
    VANJSKE_UKRASNE_LETVE: parsedCsv.VANJSKE_LETVE,
    BRAVA: parsedCsv.BRAVA,
    CILINDAR: parsedCsv.CILINDAR,
    FUNKCIJA_OKOVA: parsedCsv.FUNKCIJA_OKOVA,
    BOJA_OKOVA_IZVANA: parsedCsv.OKOV_VANJSKI,
    BOJA_OKOVA_IZNUTRA: parsedCsv.OKOV_UNUTARNJI,
    METLICA: parsedCsv.METLICA,
    VANJSKA_VRATA: parsedCsv.VANJSKA_VRATA,
    TRECA_SPOJNICA: parsedCsv.TRECA_SPOJNICA,
    HIDRAULICKI_ZATVARAC: parsedCsv.ZATVARAC,
    SEGMENT_SIRINE: segmentWidth,
    SEGMENT_VISINE: segmentHeight
  };
}

function buildArtifactFromRow(row) {
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

function validateRowGate(row, rn, validation) {
  const statusSifra = trimValue(row.status_sifra).toUpperCase();
  const status = trimValue(row.status).toUpperCase();
  const qty = Number(row.kolicina);

  if (statusSifra !== "LA" && status !== "LA") {
    pushError(validation, "STATUS_NOT_LA", `RN ${rn} does not satisfy LA status gate.`, { rn, status, status_sifra: statusSifra });
  }
  if (statusSifra === "KO" || status === "KO") {
    pushError(validation, "STATUS_KO_FORBIDDEN", `RN ${rn} has forbidden KO status.`, { rn, status, status_sifra: statusSifra });
  }
  if (qty !== 1) {
    pushError(validation, "KOLICINA_NOT_ONE", `RN ${rn} must have kolicina = 1.`, { rn, kolicina: row.kolicina });
  }
}

function buildItemResult({ rn, rows, validation }) {
  const itemValidation = buildValidationBucket();
  const normalizedRows = Array.isArray(rows) ? rows.map(normalizeObjectKeys) : [];
  if (normalizedRows.length === 0) {
    pushError(itemValidation, "RN_NOT_FOUND", `RN ${rn} returned 0 rows from V_DN.`, { rn });
  }
  if (normalizedRows.length > 1) {
    pushError(itemValidation, "RN_NOT_UNIQUE", `RN ${rn} returned ${normalizedRows.length} rows from V_DN.`, { rn, row_count: normalizedRows.length });
  }

  const row = normalizedRows.length === 1 ? normalizedRows[0] : null;
  if (row) {
    validateRowGate(row, rn, itemValidation);
  }

  let csvString = null;
  let checksumValid = false;
  let artifact = null;
  if (row) {
    csvString = extractCsv(row.opombe);
    if (!csvString) {
      pushError(itemValidation, "CONFIG_BLOCK_MISSING", `RN ${rn} is missing a #...# config block in opombe.`, { rn });
    } else {
      checksumValid = validateChecksum(csvString);
      if (!checksumValid) {
        pushError(itemValidation, "CHECKSUM_INVALID", `RN ${rn} failed checksum validation.`, { rn, csv_string: csvString });
      }
      try {
        artifact = buildArtifactFromRow(row);
      } catch (err) {
        pushError(itemValidation, "CONFIG_PARSE_FAILED", `RN ${rn} parse failed: ${err.message}`, { rn });
      }
    }
  }

  validation.errors.push(...itemValidation.errors);
  validation.warnings.push(...itemValidation.warnings);
  if (!itemValidation.ok) validation.ok = false;

  return {
    rn,
    source_row_count: normalizedRows.length,
    status: itemValidation.ok ? "READY" : "BLOCKED",
    gate_ok: itemValidation.ok,
    row: row ? {
      dnid: Number(row.dnid),
      nalogid: Number(row.nalogid),
      nalog: trimValue(row.nalog),
      sifraid: trimValue(row.sifraid),
      kolicina: Number(row.kolicina),
      admctr: trimValue(row.admctr),
      status: trimValue(row.status),
      status_sifra: trimValue(row.status_sifra),
      opombe: trimValue(row.opombe)
    } : null,
    config_preview: {
      config_found: Boolean(csvString),
      checksum_valid: checksumValid,
      work_order: artifact ? artifact.workOrderCode : null,
      reference: artifact ? artifact.reference : null,
      valid_flag: artifact ? artifact.validFlag : null
    },
    artifact,
    validation: itemValidation
  };
}

function buildBatchPayload({ parsedInput, itemResults, requestId, dsn, fetchAudit }) {
  const validation = buildValidationBucket();
  const admctrs = new Set();
  const readyArtifacts = [];

  itemResults.forEach((item) => {
    validation.errors.push(...item.validation.errors);
    validation.warnings.push(...item.validation.warnings);
    if (!item.validation.ok) validation.ok = false;
    if (item.row && trimValue(item.row.admctr)) admctrs.add(trimValue(item.row.admctr));
    if (item.artifact && item.validation.ok) readyArtifacts.push(item.artifact);
  });

  if (readyArtifacts.length !== parsedInput.normalized_rns.length) {
    pushError(validation, "COUNT_MISMATCH", `Parsed artifact count ${readyArtifacts.length}/${parsedInput.normalized_rns.length} must match the source RN count.`, {
      source_count: parsedInput.normalized_rns.length,
      artifact_count: readyArtifacts.length
    });
  }
  if (admctrs.size > 1) {
    pushError(validation, "ADMCTR_MISMATCH", "All fetched work orders must have the same admctr.", {
      admctrs: Array.from(admctrs.values())
    });
  }

  return {
    schema_version: "dxf_ops.host_batch_start.v1",
    contract_version: CONTRACT_VERSION,
    batch: {
      host_module_id: MODULE_ID,
      request_id: requestId,
      source_system: "ERP (Gosoft SAP ASE)",
      input_mode: parsedInput.input_format,
      dsn_requested: dsn,
      erp_query_id: DEFAULT_QUERY_ID,
      source_rn_count: parsedInput.normalized_rns.length,
      parsed_payload_count: readyArtifacts.length,
      count_gate: `${readyArtifacts.length}/${parsedInput.normalized_rns.length}`,
      admctr: admctrs.size === 1 ? Array.from(admctrs.values())[0] : null,
      ready_for_handoff: validation.ok
    },
    rn_list: parsedInput.normalized_rns,
    items: itemResults,
    payload_items: readyArtifacts,
    black_box_input: {
      package_target: "zoran_dxf_ops_package",
      contract_status: "HOST_READY_PREVIEW_ONLY",
      handoff_status: "NOT_IMPLEMENTED_YET"
    },
    fetch_context: {
      rn_input: {
        raw_line_count: parsedInput.raw_line_count,
        blank_line_count: parsedInput.blank_line_count,
        header_handled: parsedInput.header_handled,
        duplicates_removed: parsedInput.duplicates_removed,
        invalid_lines: parsedInput.invalid_lines
      },
      fetch_audit: fetchAudit
    },
    validation
  };
}

async function prepareDxfOpsBatchPreview({ rnPaste, dsn = "ERP_POC_RO" } = {}) {
  const parsedInput = parseRnListInput(rnPaste || "");
  if (!parsedInput.validation.ok) {
    return {
      schema_version: "dxf_ops.host_batch_start.v1",
      contract_version: CONTRACT_VERSION,
      batch: {
        host_module_id: MODULE_ID,
        request_id: `dxf_ops_host_${Date.now()}`,
        source_system: "ERP (Gosoft SAP ASE)",
        input_mode: parsedInput.input_format,
        dsn_requested: dsn,
        erp_query_id: DEFAULT_QUERY_ID,
        source_rn_count: parsedInput.normalized_rns.length,
        parsed_payload_count: 0,
        count_gate: `0/${parsedInput.normalized_rns.length}`,
        admctr: null,
        ready_for_handoff: false
      },
      rn_list: parsedInput.normalized_rns,
      items: [],
      payload_items: [],
      black_box_input: {
        package_target: "zoran_dxf_ops_package",
        contract_status: "HOST_READY_PREVIEW_ONLY",
        handoff_status: "NOT_IMPLEMENTED_YET"
      },
      fetch_context: {
        rn_input: {
          raw_line_count: parsedInput.raw_line_count,
          blank_line_count: parsedInput.blank_line_count,
          header_handled: parsedInput.header_handled,
          duplicates_removed: parsedInput.duplicates_removed,
          invalid_lines: parsedInput.invalid_lines
        },
        fetch_audit: null
      },
      validation: parsedInput.validation
    };
  }

  const request = buildErpFetchRequestFromRnList({
    rnList: parsedInput.normalized_rns,
    dsn
  });
  const dbResult = await executeErpAllowedBatch(request);
  if (!dbResult.ok) {
    throw new Error(dbResult.audit && dbResult.audit.error ? dbResult.audit.error : "DXF OPS host fetch failed");
  }

  const itemResults = parsedInput.normalized_rns.map((rn, index) => {
    const rows = dbResult.rowsByKey[`rn_${index}`] || [];
    return buildItemResult({
      rn,
      rows,
      validation: buildValidationBucket()
    });
  });

  return buildBatchPayload({
    parsedInput,
    itemResults,
    requestId: request.requestId,
    dsn,
    fetchAudit: dbResult.audit || null
  });
}

module.exports = {
  MODULE_ID,
  CONTRACT_VERSION,
  DEFAULT_QUERY_ID,
  CSV_FIELD_NAMES,
  parseRnListInput,
  buildErpFetchRequestFromRnList,
  extractCsv,
  validateChecksum,
  parseDimension,
  parseRange,
  parseCsvToJson,
  prepareDxfOpsBatchPreview
};
