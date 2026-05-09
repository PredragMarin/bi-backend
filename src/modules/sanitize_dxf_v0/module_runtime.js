"use strict";

const {
  sanitizeDocument,
  serializeDocument
} = require("../../core_shell/dxf");
const {
  buildSanitizeReview
} = require("../../core_shell/services/dxf_geometry_hygiene_service");

function runSanitizeCheck({ dxfText, sourceName }) {
  const document = sanitizeDocument(String(dxfText || ""));
  const review = buildSanitizeReview(document);
  return {
    ok: true,
    use_case: "sanitize_dxf_v0",
    source_name: String(sourceName || "sanitize_input.dxf"),
    artifact_state: "sanitized",
    sanitized_dxf_text: serializeDocument(document),
    review
  };
}

module.exports = {
  use_case: "sanitize_dxf_v0",
  runSanitizeCheck
};
