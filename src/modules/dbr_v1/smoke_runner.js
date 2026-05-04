"use strict";

const { closeSharedPool } = require("../../core_shell/db/client/postgres_pool");
const {
  createProductionOrder,
  createKitBatch,
  createPartJobs,
  getBatchReport,
  deleteProductionOrder
} = require("./module_runtime");

function hasFlag(flag) {
  return process.argv.includes(flag);
}

async function main() {
  const cleanup = hasFlag("--cleanup");
  const smokeRunId = Date.now();
  const productCode = "PPV";
  const technologyProfile = "OPS_S4P4";
  const parameterSnapshot = {
    smoke: true,
    smokeRunId,
    productCode,
    technologyProfile
  };

  const productionOrder = await createProductionOrder({
    gosoftDnId: smokeRunId,
    gosoftDnKey: `DBR-SMOKE-${smokeRunId}`,
    parameterSnapshot,
    status: "imported"
  });

  const { batch, kitParts } = await createKitBatch(
    productionOrder.id,
    productCode,
    technologyProfile
  );

  const partJobs = await createPartJobs(batch.id, parameterSnapshot);
  const report = await getBatchReport(batch.id);
  const cleanupResult = cleanup
    ? await deleteProductionOrder(productionOrder.id)
    : null;

  console.log(JSON.stringify({
    smokeRunId,
    cleanup,
    productionOrder,
    batch,
    kitPartCount: kitParts.length,
    createdPartJobCount: partJobs.length,
    report,
    cleanupResult: cleanupResult
      ? {
          deletedProductionOrderId: cleanupResult.id,
          cascadedTables: ["dbr.dbr_kit_batch", "dbr.dbr_part_job"]
        }
      : null
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeSharedPool();
  });
