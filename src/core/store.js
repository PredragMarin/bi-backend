"use strict";

const { createStorage, resolveStoreRoot } = require("../core_shell/storage");

function getStorage() {
  return createStorage({ backend: process.env.BI_CORE_STORE_BACKEND || "fs" });
}

async function writeRunArtifacts({ storeRoot, period, run_id, run_ts, run_status, manifest, datasets, output, validation }) {
  const storage = getStorage();
  return storage.writeRunArtifacts({
    storeRoot: resolveStoreRoot(storeRoot),
    period,
    run_id,
    run_ts,
    run_status,
    manifest,
    datasets,
    output,
    validation
  });
}

async function updateCurrentPointer({ storeRoot, period, storeInfo, use_case }) {
  const storage = getStorage();
  return storage.updateCurrentPointer({
    storeRoot: resolveStoreRoot(storeRoot),
    period,
    storeInfo,
    use_case
  });
}

module.exports = {
  writeRunArtifacts,
  updateCurrentPointer
};
