"use strict";

const path = require("path");

const INTEGRATION_ROOT = "/mnt/nas/004_Konstrukcija/010_BI_File_Drop";
const REQUEST_DIR = path.join(INTEGRATION_ROOT, "REQUEST");
const TARGET_DROPS = {
  ALDO_POC: path.join(INTEGRATION_ROOT, "ALDO_POC"),
  BOJAN_POC: path.join(INTEGRATION_ROOT, "BOJAN_POC"),
  ANTONIJA_POC: path.join(INTEGRATION_ROOT, "ANTONIJA_POC"),
  ZORAN_POC: path.join(INTEGRATION_ROOT, "ZORAN_POC"),
  DXF_MANIPULATION: path.join(INTEGRATION_ROOT, "DXF_MANIPULATION")
};
const TARGET_SUBDIRS = ["responses", "errors", "archive_processed", "archive_failed"];

function getGrmConfig() {
  return {
    integrationRoot: INTEGRATION_ROOT,
    requestDir: REQUEST_DIR,
    targetDrops: { ...TARGET_DROPS },
    targetSubdirs: [...TARGET_SUBDIRS],
    contractVersion: "poc-v1"
  };
}

module.exports = {
  getGrmConfig
};
