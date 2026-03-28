"use strict";

const { executeAllowedBatch } = require("../../core/erp_gateway/client");

function executeErpAllowedBatch(request) {
  return executeAllowedBatch(request);
}

module.exports = {
  executeErpAllowedBatch
};
