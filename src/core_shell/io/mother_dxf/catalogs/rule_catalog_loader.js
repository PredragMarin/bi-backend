"use strict";

// Placeholder adapter for the new Mother DXF I/O pipeline.
// This module MUST be used for all new durable rule catalog I/O.
// Legacy I/O is disabled.

function loadRuleCatalog() {
  throw new Error("loadRuleCatalog() not implemented in new I/O pipeline.");
}

module.exports = { loadRuleCatalog };
