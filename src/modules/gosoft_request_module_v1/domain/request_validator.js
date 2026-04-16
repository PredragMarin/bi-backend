"use strict";

function assertString(value, name) {
  if (!String(value || "").trim()) {
    throw new Error(`Missing required field: ${name}`);
  }
}

function assertISODate(value, name) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) {
    throw new Error(`Invalid ${name}; expected YYYY-MM-DD`);
  }
}

function validateRequest({ request, config }) {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new Error("Request payload must be a JSON object.");
  }

  assertString(request.request_id, "request_id");
  assertString(request.module_id, "module_id");
  assertString(request.target_drop, "target_drop");
  assertString(request.contract_version, "contract_version");
  assertString(request.requested_at, "requested_at");
  assertString(request.fetch_mode, "fetch_mode");

  if (request.contract_version !== config.contractVersion) {
    throw new Error(`Unsupported contract_version: ${request.contract_version}`);
  }

  if (!config.targetDrops[request.target_drop]) {
    throw new Error(`Unsupported target_drop: ${request.target_drop}`);
  }

  if (request.fetch_mode !== "date_window") {
    throw new Error(`Unsupported fetch_mode for poc-v1: ${request.fetch_mode}`);
  }

  const params = request.params || {};
  assertISODate(params.from, "params.from");
  assertISODate(params.to, "params.to");
  assertString(params.admctr, "params.admctr");

  return {
    request_id: String(request.request_id).trim(),
    module_id: String(request.module_id).trim(),
    target_drop: String(request.target_drop).trim(),
    contract_version: String(request.contract_version).trim(),
    requested_at: String(request.requested_at).trim(),
    fetch_mode: "date_window",
    params: {
      from: String(params.from).trim(),
      to: String(params.to).trim(),
      admctr: String(params.admctr).trim()
    }
  };
}

module.exports = {
  validateRequest
};
