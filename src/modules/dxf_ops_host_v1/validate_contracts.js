"use strict";

const fs = require("fs");
const path = require("path");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, relativePath), "utf8"));
}

function validateContract() {
  const contract = readJson("contracts/dxf_ops_batch_start_contract.json");
  const required = ["contract_id", "version", "status", "description", "required_top_level_fields"];
  const missing = required.filter((field) => !Object.prototype.hasOwnProperty.call(contract, field));
  return {
    ok: missing.length === 0,
    contract_id: contract.contract_id || null,
    missing
  };
}

if (require.main === module) {
  const result = validateContract();
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  process.exit(result.ok ? 0 : 1);
}

module.exports = { validateContract };
