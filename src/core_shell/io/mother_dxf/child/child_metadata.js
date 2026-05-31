"use strict";

const fs = require("fs/promises");
const path = require("path");

function defaultRoot() {
  return path.join("out", "mother_dxf_v1");
}

/**
 * Writes child metadata JSON for a generated child DXF.
 * Output path must remain identical to legacy behavior:
 * out/mother_dxf_v1/children/<session_id>_<suffix>/child_metadata.json
 */
async function writeChildMetadata(sessionId, suffix, metadata, rootDir) {
  const dir = path.join(
    rootDir || defaultRoot(),
    "children",
    String(sessionId) + "_" + String(suffix)
  );

  const filePath = path.join(dir, "child_metadata.json");

  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(metadata, null, 2), "utf8");

  return filePath;
}

module.exports = { writeChildMetadata };
