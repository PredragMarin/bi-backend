"use strict";

// Placeholder adapter for the new Mother DXF I/O pipeline.
// This module MUST be used for all new durable parameter catalog I/O.
// Legacy I/O is disabled.

function loadParameterCatalog() {
  throw new Error("loadParameterCatalog() not implemented in new I/O pipeline.");
}

module.exports = { loadParameterCatalog };
