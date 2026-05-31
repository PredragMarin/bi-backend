"use strict";

// Placeholder adapter for the new Mother DXF I/O pipeline.
// Future CLI commands MUST use the same I/O adapters as API/runtime orchestration.
// Legacy I/O is disabled.

function runMotherBatch() {
  throw new Error("runMotherBatch() not implemented in new I/O pipeline.");
}

function runMotherPreview() {
  throw new Error("runMotherPreview() not implemented in new I/O pipeline.");
}

function listSessions() {
  throw new Error("listSessions() not implemented in new I/O pipeline.");
}

module.exports = { runMotherBatch, runMotherPreview, listSessions };
