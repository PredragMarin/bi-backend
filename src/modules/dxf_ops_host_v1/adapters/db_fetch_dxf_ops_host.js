"use strict";

const { executeErpAllowedBatch } = require("../../../core_shell/services/erp_fetch_service");
const {
  CSV_FIELD_NAMES,
  extractCsv,
  validateChecksum,
  parseDimension,
  parseRange,
  parseCsvToJson,
  buildFunctionalPayloadFromVdnRow
} = require("../../../core_shell/services/dxf_ops_functional_payload_service");

const MODULE_ID = "dxf_ops_host_v1";
const CONTRACT_VERSION = "0.2.0-prototype";
const DEFAULT_QUERY_ID = "V_DN_BY_SIFRADN";
const RN_HEADER = "RN";
const RN_TOKEN_RE = /^[A-Z0-9][A-Z0-9._/-]*$/;

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

function parseBooleanLike(str) {
  const text = trimValue(str).toUpperCase();
  if (text === "DA") return true;
  if (text === "NE") return false;
  return null;
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
        artifact = buildFunctionalPayloadFromVdnRow(row);
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
