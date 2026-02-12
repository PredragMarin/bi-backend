// src/core/validate.js
// NOTE: Existing dataset schema/FK validation is preserved (validateDatasets).
// Added: transformDataset(type, rows) with a small registry for tag/transform validators.

const fs = require("fs");
const path = require("path");

const { parseDateDMY, parseDateTimeDMYHM } = require("./time");

// -------------------- existing helpers --------------------
function isInt(v) {
  return Number.isInteger(v) || (typeof v === "string" && v.trim() !== "" && Number.isInteger(Number(v)));
}

function normalizeInt(v) {
  return typeof v === "number" ? v : Number(v);
}

function validateRow(colSpec, value, colName, datasetName, errors) {
  const required = !!colSpec.required;
  if (value === undefined || value === null || value === "") {
    if (required) errors.push({ dataset: datasetName, column: colName, code: "REQUIRED_MISSING" });
    return;
  }

  const t = colSpec.type;
  if (t === "int") {
    if (!isInt(value)) {
      errors.push({ dataset: datasetName, column: colName, code: "INVALID_INT" });
      return;
    }
    const iv = normalizeInt(value);
    if (colName === "osebid" && iv <= 0) errors.push({ dataset: datasetName, column: colName, code: "OSEBID_NOT_POSITIVE" });
    if (colSpec.enum && !colSpec.enum.includes(iv)) errors.push({ dataset: datasetName, column: colName, code: "ENUM_VIOLATION" });
  } else if (t === "string") {
    if (typeof value !== "string") errors.push({ dataset: datasetName, column: colName, code: "INVALID_STRING" });
  } else if (t === "date") {
    const ok = !!parseDateDMY(String(value));
    if (!ok) errors.push({ dataset: datasetName, column: colName, code: "INVALID_DATE_FORMAT" });
  } else if (t === "datetime") {
    const ok = !!parseDateTimeDMYHM(String(value));
    if (!ok) errors.push({ dataset: datasetName, column: colName, code: "INVALID_DATETIME_FORMAT" });
  }
}

// -------------------- existing main validator (unchanged) --------------------
function validateDatasets({ manifest, datasets, period, timezone }) {
  const errors = [];
  const warnings = [];

  const defs = manifest.inputs?.datasets || [];
  for (const d of defs) {
    const name = d.name;
    const required = !!d.required;

    const data = datasets[name];
    if ((data === undefined || data === null) && required) {
      errors.push({ dataset: name, code: "DATASET_MISSING" });
      continue;
    }
    if (data === undefined || data === null) continue;

    if (!Array.isArray(data)) {
      errors.push({ dataset: name, code: "DATASET_NOT_ARRAY" });
      continue;
    }

    if (d.columns) {
      for (let i = 0; i < data.length; i++) {
        const row = data[i];
        for (const [colName, colSpec] of Object.entries(d.columns)) {
          validateRow(colSpec, row[colName], colName, name, errors);
        }

        // RULES: timeizhod >= timevhod if exists, else flag needs_review (warning)
        if (name === "epr_data") {
          const tv = row.timevhod;
          const ti = row.timeizhod;
          if (tv) {
            const dtv = require("./time").parseDateTimeDMYHM(String(tv));
            if (ti) {
              const dti = require("./time").parseDateTimeDMYHM(String(ti));
              if (dtv && dti && dti.getTime() < dtv.getTime()) {
                warnings.push({ dataset: name, row: i, code: "NEGATIVE_DURATION" });
              }
            } else {
              warnings.push({ dataset: name, row: i, code: "OPEN_INTERVAL" });
            }
          }
        }
      }
    }
  }

  // FK validation: epr_data.osebid must exist in osebe_raw (backend-only)
  const epr = datasets.epr_data || [];
  const osebe = datasets.osebe_raw || [];
  if (Array.isArray(epr) && Array.isArray(osebe) && osebe.length > 0) {
    const set = new Set(osebe.map(o => Number(o.osebid)));
    for (let i = 0; i < epr.length; i++) {
      const id = Number(epr[i].osebid);
      if (!set.has(id)) errors.push({ dataset: "epr_data", row: i, code: "FK_OSEBID_NOT_FOUND" });
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    timezone,
    period
  };
}

// -------------------- NEW: transform / tag validator runner --------------------
// Registry: type -> { contractPath, loader() }
// Lazy-load keeps startup light and avoids cycles.
const TRANSFORM_REGISTRY = {
  employee_tags: {
    contractPath: path.join(__dirname, "contracts", "employee_tags_contract.json"),
    loader: () => require("./validators/employee_tags").validateEmployeeTags
  }
};

function loadJson(absPath) {
  return JSON.parse(fs.readFileSync(absPath, "utf8"));
}

/**
 * transformDataset(type, rows)
 * - rows: input array (e.g. ERP osebe rows)
 * - returns:
 *   { rows: normalizedRows, warnings: [], errors: [], facts: {} }
 *
 * This function does NOT replace validateDatasets(); it complements it.
 */
function transformDataset(type, rows) {
  const entry = TRANSFORM_REGISTRY[type];
  const inputRows = Array.isArray(rows) ? rows : [];

  if (!entry) {
    return {
      rows: inputRows,
      warnings: [{ type: "UNKNOWN_TRANSFORMER", value: type }],
      errors: [],
      facts: { input_rows: inputRows.length, out_rows: inputRows.length }
    };
  }

  let contract;
  try {
    contract = loadJson(entry.contractPath);
  } catch (e) {
    return {
      rows: inputRows,
      warnings: [],
      errors: [{ type: "CONTRACT_LOAD_FAILED", value: type, message: e.message }],
      facts: { input_rows: inputRows.length, out_rows: inputRows.length }
    };
  }

  let fn;
  try {
    fn = entry.loader();
  } catch (e) {
    return {
      rows: inputRows,
      warnings: [],
      errors: [{ type: "TRANSFORMER_LOAD_FAILED", value: type, message: e.message }],
      facts: { input_rows: inputRows.length, out_rows: inputRows.length }
    };
  }

  const res = fn(inputRows, contract) || {};
  return {
    rows: Array.isArray(res.normalized) ? res.normalized : inputRows,
    warnings: Array.isArray(res.warnings) ? res.warnings : [],
    errors: Array.isArray(res.errors) ? res.errors : [],
    facts: res.facts && typeof res.facts === "object" ? res.facts : { input_rows: inputRows.length, out_rows: inputRows.length }
  };
}

module.exports = { validateDatasets, transformDataset };
