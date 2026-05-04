"use strict";

const { executeErpAllowedBatch } = require("../../../core_shell/services/erp_fetch_service");
const {
  extractCsv,
  validateChecksum,
  buildFunctionalPayloadFromVdnRow
} = require("../../../core_shell/services/dxf_ops_functional_payload_service");

const MODULE_ID = "dbr_v1";
const DEFAULT_DSN = "ERP_POC_RO";
const DEFAULT_QUERY_ID = "V_DN_BY_SIFRADN";

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

function buildErpFetchRequestFromSifradnList({
  sifradnList,
  dsn = DEFAULT_DSN,
  queryId = DEFAULT_QUERY_ID,
  requestId
} = {}) {
  const normalized = Array.isArray(sifradnList)
    ? sifradnList.map((item) => trimValue(item).replace(/\s+/g, "").toUpperCase()).filter(Boolean)
    : [];

  return {
    moduleId: MODULE_ID,
    requestId: requestId || `dbr_sifradn_import_${Date.now()}`,
    dsnOverride: dsn,
    items: normalized.map((sifradn, index) => ({
      key: `sifradn_${index}`,
      queryId,
      params: [sifradn]
    })),
    fetch_strategy: {
      kind: "allowlisted_single_sifradn_batch",
      query_id: queryId
    }
  };
}

function validateFetchedRow(row, sifradn, validation) {
  const statusSifra = trimValue(row.status_sifra).toUpperCase();
  const status = trimValue(row.status).toUpperCase();
  const quantity = Number(row.kolicina);
  const dnid = Number(row.dnid);

  if (statusSifra !== "LA" && status !== "LA") {
    pushError(validation, "STATUS_NOT_LA", `RN/SIFRADN ${sifradn} does not satisfy LA status gate.`, {
      sifradn,
      status,
      status_sifra: statusSifra
    });
  }
  if (statusSifra === "KO" || status === "KO") {
    pushError(validation, "STATUS_KO_FORBIDDEN", `RN/SIFRADN ${sifradn} has forbidden KO status.`, {
      sifradn,
      status,
      status_sifra: statusSifra
    });
  }
  if (quantity !== 1) {
    pushError(validation, "KOLICINA_NOT_ONE", `RN/SIFRADN ${sifradn} must have kolicina = 1.`, {
      sifradn,
      kolicina: row.kolicina
    });
  }
  if (!Number.isInteger(dnid) || dnid <= 0) {
    pushError(validation, "GOSOFT_DNID_MISSING", `ERP row for RN/SIFRADN ${sifradn} did not include a valid numeric DNID.`, {
      sifradn,
      dnid: row.dnid
    });
  }
}

function buildFetchedItemResult({ sifradn, rows }) {
  const validation = buildValidationBucket();
  const normalizedRows = Array.isArray(rows) ? rows.map(normalizeObjectKeys) : [];

  if (normalizedRows.length === 0) {
    pushError(validation, "SIFRADN_NOT_FOUND", `RN/SIFRADN ${sifradn} returned 0 rows from V_DN_BY_SIFRADN.`, {
      sifradn
    });
  }
  if (normalizedRows.length > 1) {
    pushError(validation, "SIFRADN_NOT_UNIQUE", `RN/SIFRADN ${sifradn} returned ${normalizedRows.length} ERP rows.`, {
      sifradn,
      row_count: normalizedRows.length
    });
  }

  const row = normalizedRows.length === 1 ? normalizedRows[0] : null;
  let csvString = null;
  let checksumValid = false;
  let functionalPayload = null;

  if (row) {
    validateFetchedRow(row, sifradn, validation);
    csvString = extractCsv(row.opombe);
    if (!csvString) {
      pushError(validation, "CONFIG_BLOCK_MISSING", `RN/SIFRADN ${sifradn} is missing a #...# config block in opombe.`, {
        sifradn
      });
    } else {
      checksumValid = validateChecksum(csvString);
      if (!checksumValid) {
        pushError(validation, "CHECKSUM_INVALID", `RN/SIFRADN ${sifradn} failed config checksum validation.`, {
          sifradn
        });
      }
      try {
        functionalPayload = buildFunctionalPayloadFromVdnRow(row);
      } catch (error) {
        pushError(validation, "CONFIG_PARSE_FAILED", `RN/SIFRADN ${sifradn} config parse failed: ${error.message}`, {
          sifradn
        });
      }
    }
  }

  return {
    sifradn,
    sourceRowCount: normalizedRows.length,
    status: validation.ok ? "READY" : "BLOCKED",
    gateOk: validation.ok,
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
    configPreview: {
      configFound: Boolean(csvString),
      checksumValid,
      workOrder: functionalPayload ? functionalPayload.workOrderCode : null,
      reference: functionalPayload ? functionalPayload.reference : null,
      validFlag: functionalPayload ? functionalPayload.validFlag : null
    },
    functionalPayload,
    validation
  };
}

async function fetchDbrOrdersBySifradnList({ sifradnList, dsn = DEFAULT_DSN } = {}) {
  const request = buildErpFetchRequestFromSifradnList({ sifradnList, dsn });
  const dbResult = await executeErpAllowedBatch(request);
  if (!dbResult.ok) {
    throw new Error(dbResult.audit && dbResult.audit.error ? dbResult.audit.error : "DBR ERP fetch failed");
  }

  const validation = buildValidationBucket();
  const items = (Array.isArray(sifradnList) ? sifradnList : []).map((sifradn, index) => {
    const item = buildFetchedItemResult({
      sifradn,
      rows: dbResult.rowsByKey[`sifradn_${index}`] || []
    });
    validation.errors.push(...item.validation.errors);
    validation.warnings.push(...item.validation.warnings);
    if (!item.validation.ok) validation.ok = false;
    return item;
  });

  return {
    requestId: request.requestId,
    dsn,
    queryId: DEFAULT_QUERY_ID,
    items,
    validation,
    fetchAudit: dbResult.audit || null
  };
}

// STUB - zamijeniti Gosoft API pozivom kasnije kroz Core Shell ERP fetch service.
function fetchStubSifradnRecords({ count = 20 } = {}) {
  const requestedCount = Number(count);
  const safeCount = Number.isInteger(requestedCount) && requestedCount > 0
    ? Math.min(requestedCount, 50)
    : 20;

  return Array.from({ length: safeCount }, (_, index) => {
    const sequence = String(index + 1).padStart(3, "0");
    return {
      sifradn: `SMOKE-DBR-${sequence}`,
      kit_code: "OPS_S4P4",
      quantity: 1,
      parameters: {
        VISINA_VRATA: 2100,
        SIRINA_VRATA: 900,
        MODEL_VRATA: "SMOKE",
        stub_record: true,
        stub_sequence: index + 1
      }
    };
  });
}

module.exports = {
  MODULE_ID,
  DEFAULT_DSN,
  DEFAULT_QUERY_ID,
  buildErpFetchRequestFromSifradnList,
  fetchDbrOrdersBySifradnList,
  fetchStubSifradnRecords
};
