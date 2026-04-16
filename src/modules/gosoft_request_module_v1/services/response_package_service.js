"use strict";

const fs = require("fs");
const path = require("path");
const { writeCsv } = require("./csv_export_service");

function writeJson(outPath, value) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(value, null, 2), "utf8");
  return outPath;
}

function writeCsvBundle({
  responsePackageDir,
  requestId,
  vDnRows,
  vDnColumns,
  potrebaRows,
  potrebaColumns
}) {
  const vDnName = `${requestId}.v_dn.csv`;
  const potrebaName = `${requestId}.potreba.csv`;
  const vDnPath = path.join(responsePackageDir, vDnName);
  const potrebaPath = path.join(responsePackageDir, potrebaName);

  writeCsv({ rows: vDnRows, columns: vDnColumns, outPath: vDnPath });
  writeCsv({ rows: potrebaRows, columns: potrebaColumns, outPath: potrebaPath });

  return {
    files: {
      v_dn: vDnName,
      potreba: potrebaName
    },
    paths: {
      v_dn_path: vDnPath,
      potreba_path: potrebaPath
    }
  };
}

function writeJsonPayloadPackage({ responsePackageDir, requestId, payload }) {
  const payloadName = `${requestId}.payload.json`;
  const payloadPath = path.join(responsePackageDir, payloadName);
  writeJson(payloadPath, payload);
  return {
    files: {
      payload: payloadName
    },
    paths: {
      payload_path: payloadPath
    }
  };
}

module.exports = {
  writeJson,
  writeCsvBundle,
  writeJsonPayloadPackage
};
