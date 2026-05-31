"use strict";

const fs = require("fs/promises");
const path = require("path");

function defaultRoot() {
  return path.join("out", "mother_dxf_v1");
}

/**
 * Writes preview JSON and optional preview DXF.
 * Output path remains identical to current legacy behavior:
 * out/mother_dxf_v1/previews/<preview_id>/preview.json
 * out/mother_dxf_v1/previews/<preview_id>/preview.dxf (optional)
 */
async function savePreview(sessionId, previewId, previewJson, previewDxfText = null, rootDir) {
  const dir = path.join(
    rootDir || defaultRoot(),
    "previews",
    String(previewId)
  );

  await fs.mkdir(dir, { recursive: true });

  const jsonPath = path.join(dir, "preview.json");
  await fs.writeFile(jsonPath, JSON.stringify(previewJson == null ? null : previewJson, null, 2), "utf8");

  let dxfPath = null;
  if (previewDxfText !== undefined && previewDxfText !== null) {
    dxfPath = path.join(dir, "preview.dxf");
    await fs.writeFile(dxfPath, String(previewDxfText || ""), "utf8");
  }

  return { dir, jsonPath, dxfPath, sessionId: String(sessionId || "") };
}

module.exports = { savePreview };
