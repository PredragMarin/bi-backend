"use strict";

const fs = require("fs");
const path = require("path");

const CONTRACT_FILES = [
  "contracts/tender_latest_contract.json",
  "contracts/tender_notice_history_contract.json",
  "contracts/review_decision_history_contract.json",
  "contracts/worklist_view_config_contract.json",
  "contracts/procedure_type_catalog.json",
  "contracts/document_type_catalog.json",
  "contracts/layer2_use_case_profiles.json",
  "contracts/event_model_v1.json"
];

function readJsonObject(filePath) {
  const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  const data = JSON.parse(raw);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(`Contract must be a JSON object: ${filePath}`);
  }
  return data;
}

function assertArray(value, fieldName, filePath) {
  if (!Array.isArray(value)) {
    throw new Error(`Expected array ${fieldName} in ${filePath}`);
  }
}

function validateContract(filePath) {
  const data = readJsonObject(filePath);
  const base = path.basename(filePath);
  if (base === "procedure_type_catalog.json" || base === "document_type_catalog.json" || base === "layer2_use_case_profiles.json") {
    for (const field of ["version", "description", "items"]) {
      if (!Object.prototype.hasOwnProperty.call(data, field)) {
        throw new Error(`Missing ${field} in ${filePath}`);
      }
    }
    assertArray(data.items, "items", filePath);
    return {
      file: base,
      contract_id: data.catalog_id || base,
      version: data.version
    };
  }
  if (base === "event_model_v1.json") {
    for (const field of ["model_id", "version", "description", "latest_state_rules", "contracts"]) {
      if (!Object.prototype.hasOwnProperty.call(data, field)) {
        throw new Error(`Missing ${field} in ${filePath}`);
      }
    }
    return {
      file: base,
      contract_id: data.model_id,
      version: data.version
    };
  }
  for (const field of ["contract_id", "version", "description", "storage_model", "required_fields"]) {
    if (!Object.prototype.hasOwnProperty.call(data, field)) {
      throw new Error(`Missing ${field} in ${filePath}`);
    }
  }
  if (!data.storage_model || typeof data.storage_model !== "object") {
    throw new Error(`Invalid storage_model in ${filePath}`);
  }
  assertArray(data.required_fields, "required_fields", filePath);
  if (data.optional_fields !== undefined) assertArray(data.optional_fields, "optional_fields", filePath);
  return {
    file: path.basename(filePath),
    contract_id: data.contract_id,
    version: data.version
  };
}

function validateAllContracts(moduleDir) {
  return CONTRACT_FILES.map((rel) => validateContract(path.join(moduleDir, rel)));
}

if (require.main === module) {
  const moduleDir = __dirname;
  const results = validateAllContracts(moduleDir);
  process.stdout.write(JSON.stringify({ ok: true, contracts: results }, null, 2) + "\n");
}

module.exports = {
  validateAllContracts
};
