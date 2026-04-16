"use strict";

const fs = require("fs");
const path = require("path");
const { getGrmConfig } = require("../../src/modules/gosoft_request_module_v1/config/grm_config");
const { ensureBaseFolders } = require("../../src/modules/gosoft_request_module_v1/services/target_folder_service");
const { processRequestFile } = require("../../src/modules/gosoft_request_module_v1/runtime");

async function main() {
  const config = getGrmConfig();
  ensureBaseFolders(config);

  const request = {
    request_id: "aldo-poc_2026_04_15_001",
    module_id: "shopfloor_parts_lifecycle_v1",
    target_drop: "ALDO_POC",
    contract_version: "poc-v1",
    requested_at: "2026-04-15T10:00:00Z",
    fetch_mode: "date_window",
    params: {
      from: "2026-03-15",
      to: "2026-04-15",
      admctr: "P INOX"
    }
  };

  const requestFilePath = path.join(config.requestDir, `${request.request_id}.request.json`);
  fs.writeFileSync(requestFilePath, JSON.stringify(request, null, 2), "utf8");

  const result = await processRequestFile(requestFilePath);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
