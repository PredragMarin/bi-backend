"use strict";

// Placeholder adapter for the new Mother DXF I/O pipeline.
// This module MUST be used for all new durable batch/job I/O.
// Legacy I/O is disabled.

function createBatchManifest() {
  throw new Error("createBatchManifest() not implemented in new I/O pipeline.");
}

function createJobRecord() {
  throw new Error("createJobRecord() not implemented in new I/O pipeline.");
}

module.exports = { createBatchManifest, createJobRecord };
