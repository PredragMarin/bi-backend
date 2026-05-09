"use strict";

const fs = require("fs");
const path = require("path");

function readJson(relPath) {
  const absPath = path.join(__dirname, relPath);
  return JSON.parse(fs.readFileSync(absPath, "utf8"));
}

function validateContracts() {
  const contract = readJson("contracts/sanitize_report_contract_v0.json");
  if (!contract || typeof contract !== "object") {
    throw new Error("sanitize_report_contract_v0.json must be a JSON object.");
  }
  for (const field of ["contract_id", "version", "description", "top_level_fields", "review_fields", "geometry_hygiene_issue_types"]) {
    if (!(field in contract)) {
      throw new Error(`Missing required contract field: ${field}`);
    }
  }
  return {
    ok: true,
    contract
  };
}

if (require.main === module) {
  process.stdout.write(JSON.stringify(validateContracts(), null, 2) + "\n");
}

module.exports = {
  validateContracts
};
