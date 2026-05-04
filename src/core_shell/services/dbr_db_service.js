"use strict";

const path = require("path");
const { loadDbConfig } = require("../config/db_config");
const { getSharedPool } = require("../db/client/postgres_pool");
const { executeQuery } = require("../db/helpers/query");
const { resolveMigrationFile, runSqlFile } = require("../db/helpers/migration_runner");
const { createLogger } = require("../logging/minimal_logger");

const logger = createLogger("dbr-db");
let ensureReadyPromise = null;

function getPool() {
  return getSharedPool(loadDbConfig().connection);
}

async function runMigration(folder, fileName) {
  await runSqlFile({
    executor: getPool(),
    filePath: resolveMigrationFile(path.join("src", "core_shell", "migrations", folder), fileName),
    logger,
    label: `ensure-${folder}-schema`
  });
}

async function ensureDbrReady() {
  if (!ensureReadyPromise) {
    ensureReadyPromise = (async () => {
      await runMigration("dcm", "001_create_dcm_foundation.up.sql");
      await runMigration("dbr", "001_create_dbr_foundation.up.sql");
    })().catch((error) => {
      ensureReadyPromise = null;
      throw error;
    });
  }

  await ensureReadyPromise;
}

function mapProductionOrderRow(row) {
  return {
    id: Number(row.id),
    gosoftDnId: Number(row.gosoft_dn_id),
    gosoftDnKey: row.gosoft_dn_key,
    parameterSnapshot: row.parameter_snapshot,
    status: String(row.status),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapKitBatchRow(row) {
  return {
    id: Number(row.id),
    productionOrderId: Number(row.production_order_id),
    batchKey: String(row.batch_key),
    productCode: String(row.product_code),
    technologyProfile: String(row.technology_profile),
    kitVersion: String(row.kit_version),
    status: String(row.status),
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    summary: row.summary
  };
}

function mapPartJobRow(row) {
  return {
    id: Number(row.id),
    kitBatchId: Number(row.kit_batch_id),
    partCode: String(row.part_code),
    partSequence: Number(row.part_sequence),
    motherArtifactId: row.mother_artifact_id === null ? null : Number(row.mother_artifact_id),
    parameterSnapshot: row.parameter_snapshot,
    childArtifactPath: row.child_artifact_path,
    childArtifactHash: row.child_artifact_hash,
    status: String(row.status),
    generationSummary: row.generation_summary,
    warnings: row.warnings,
    errors: row.errors,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    idempotencyKey: String(row.idempotency_key)
  };
}

async function upsertProductionOrder({ gosoftDnId, gosoftDnKey, parameterSnapshot, status = "imported" }) {
  await ensureDbrReady();
  const result = await executeQuery({
    executor: getPool(),
    text: `
      INSERT INTO dbr.dbr_production_order (
        gosoft_dn_id,
        gosoft_dn_key,
        parameter_snapshot,
        status,
        updated_at
      )
      VALUES ($1, $2, $3::jsonb, $4, NOW())
      ON CONFLICT (gosoft_dn_id) DO UPDATE SET
        gosoft_dn_key = EXCLUDED.gosoft_dn_key,
        parameter_snapshot = EXCLUDED.parameter_snapshot,
        status = EXCLUDED.status,
        updated_at = NOW()
      RETURNING *
    `,
    values: [
      Number(gosoftDnId),
      gosoftDnKey === undefined ? null : String(gosoftDnKey),
      JSON.stringify(parameterSnapshot || {}),
      String(status)
    ],
    logger,
    label: "upsert-dbr-production-order"
  });

  return mapProductionOrderRow(result.rows[0]);
}

async function getProductionOrderByGosoftDnId(gosoftDnId) {
  await ensureDbrReady();
  const result = await executeQuery({
    executor: getPool(),
    text: "SELECT * FROM dbr.dbr_production_order WHERE gosoft_dn_id = $1",
    values: [Number(gosoftDnId)],
    logger,
    label: "get-production-order-by-gosoft-dn-id"
  });

  return result.rows.length ? mapProductionOrderRow(result.rows[0]) : null;
}

async function deleteProductionOrder(productionOrderId) {
  await ensureDbrReady();
  const result = await executeQuery({
    executor: getPool(),
    text: "DELETE FROM dbr.dbr_production_order WHERE id = $1 RETURNING *",
    values: [Number(productionOrderId)],
    logger,
    label: "delete-dbr-production-order"
  });

  return result.rows.length ? mapProductionOrderRow(result.rows[0]) : null;
}

async function createKitBatch({
  productionOrderId,
  batchKey,
  productCode,
  technologyProfile,
  kitVersion,
  status = "planned",
  summary = null
}) {
  await ensureDbrReady();
  const result = await executeQuery({
    executor: getPool(),
    text: `
      INSERT INTO dbr.dbr_kit_batch (
        production_order_id,
        batch_key,
        product_code,
        technology_profile,
        kit_version,
        status,
        summary
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
      ON CONFLICT (batch_key) DO UPDATE SET
        status = EXCLUDED.status,
        summary = EXCLUDED.summary
      RETURNING *
    `,
    values: [
      Number(productionOrderId),
      String(batchKey || ""),
      String(productCode || ""),
      String(technologyProfile || ""),
      String(kitVersion || ""),
      String(status),
      summary ? JSON.stringify(summary) : null
    ],
    logger,
    label: "create-dbr-kit-batch"
  });

  return mapKitBatchRow(result.rows[0]);
}

async function createKitBatchWithPartJobs({
  productionOrderId,
  batchKey,
  productCode,
  technologyProfile,
  kitVersion,
  kitParts,
  parameterSnapshot,
  status = "planned",
  summary = null
}) {
  await ensureDbrReady();
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const batchResult = await executeQuery({
      executor: client,
      text: `
        INSERT INTO dbr.dbr_kit_batch (
          production_order_id,
          batch_key,
          product_code,
          technology_profile,
          kit_version,
          status,
          summary
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
        ON CONFLICT (batch_key) DO UPDATE SET
          status = EXCLUDED.status,
          summary = EXCLUDED.summary
        RETURNING *
      `,
      values: [
        Number(productionOrderId),
        String(batchKey || ""),
        String(productCode || ""),
        String(technologyProfile || ""),
        String(kitVersion || ""),
        String(status),
        summary ? JSON.stringify(summary) : null
      ],
      logger,
      label: "create-dbr-kit-batch-atomic"
    });
    const batch = mapKitBatchRow(batchResult.rows[0]);
    const partJobs = [];

    for (const kitPart of Array.isArray(kitParts) ? kitParts : []) {
      const partJobResult = await executeQuery({
        executor: client,
        text: `
          INSERT INTO dbr.dbr_part_job (
            kit_batch_id,
            part_code,
            part_sequence,
            mother_artifact_id,
            parameter_snapshot,
            idempotency_key,
            status
          )
          VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
          ON CONFLICT (idempotency_key) DO UPDATE SET
            mother_artifact_id = EXCLUDED.mother_artifact_id,
            parameter_snapshot = EXCLUDED.parameter_snapshot,
            status = EXCLUDED.status
          RETURNING *
        `,
        values: [
          batch.id,
          String(kitPart.partCode || ""),
          Number(kitPart.partSequence),
          kitPart.motherArtifactId === null || kitPart.motherArtifactId === undefined
            ? null
            : Number(kitPart.motherArtifactId),
          JSON.stringify(parameterSnapshot || {}),
          String(kitPart.idempotencyKey || ""),
          String(kitPart.status || "queued")
        ],
        logger,
        label: "create-dbr-part-job-atomic"
      });
      partJobs.push(mapPartJobRow(partJobResult.rows[0]));
    }

    await client.query("COMMIT");
    return {
      batch,
      partJobs
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function createBulkProductionOrdersWithBatchesAndJobs({ orders }) {
  await ensureDbrReady();
  const pool = getPool();
  const client = await pool.connect();
  const createdOrders = [];
  const createdBatches = [];
  const createdJobs = [];

  try {
    await client.query("BEGIN");

    for (const orderInput of Array.isArray(orders) ? orders : []) {
      const productionOrderResult = await executeQuery({
        executor: client,
        text: `
          INSERT INTO dbr.dbr_production_order (
            gosoft_dn_id,
            gosoft_dn_key,
            parameter_snapshot,
            status,
            updated_at
          )
          VALUES ($1, $2, $3::jsonb, $4, NOW())
          ON CONFLICT (gosoft_dn_id) DO UPDATE SET
            gosoft_dn_key = EXCLUDED.gosoft_dn_key,
            parameter_snapshot = EXCLUDED.parameter_snapshot,
            status = EXCLUDED.status,
            updated_at = NOW()
          RETURNING *
        `,
        values: [
          Number(orderInput.gosoftDnId),
          orderInput.gosoftDnKey === undefined ? null : String(orderInput.gosoftDnKey),
          JSON.stringify(orderInput.parameterSnapshot || {}),
          String(orderInput.status || "frozen")
        ],
        logger,
        label: "bulk-upsert-dbr-production-order"
      });
      const productionOrder = mapProductionOrderRow(productionOrderResult.rows[0]);
      createdOrders.push(productionOrder);

      const batchKey = String(
        orderInput.batchKey ||
        [
          "dbr",
          "bulk-kit",
          productionOrder.id,
          orderInput.productCode,
          orderInput.technologyProfile,
          orderInput.kitVersion
        ].join(":")
      );
      const batchResult = await executeQuery({
        executor: client,
        text: `
          INSERT INTO dbr.dbr_kit_batch (
            production_order_id,
            batch_key,
            product_code,
            technology_profile,
            kit_version,
            status,
            summary
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
          ON CONFLICT (batch_key) DO UPDATE SET
            status = EXCLUDED.status,
            summary = EXCLUDED.summary
          RETURNING *
        `,
        values: [
          productionOrder.id,
          batchKey,
          String(orderInput.productCode || ""),
          String(orderInput.technologyProfile || ""),
          String(orderInput.kitVersion || ""),
          String(orderInput.batchStatus || "planned"),
          orderInput.summary ? JSON.stringify(orderInput.summary) : null
        ],
        logger,
        label: "bulk-create-dbr-kit-batch"
      });
      const batch = mapKitBatchRow(batchResult.rows[0]);
      createdBatches.push(batch);

      for (const kitPart of Array.isArray(orderInput.kitParts) ? orderInput.kitParts : []) {
        const idempotencyKey = String(
          kitPart.idempotencyKey ||
          ["dbr", "bulk_part_job", batch.batchKey, kitPart.partCode].join(":")
        );
        const partJobResult = await executeQuery({
          executor: client,
          text: `
            INSERT INTO dbr.dbr_part_job (
              kit_batch_id,
              part_code,
              part_sequence,
              mother_artifact_id,
              parameter_snapshot,
              idempotency_key,
              status
            )
            VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
            ON CONFLICT (idempotency_key) DO UPDATE SET
              mother_artifact_id = EXCLUDED.mother_artifact_id,
              parameter_snapshot = EXCLUDED.parameter_snapshot,
              status = EXCLUDED.status
            RETURNING *
          `,
          values: [
            batch.id,
            String(kitPart.partCode || ""),
            Number(kitPart.partSequence),
            kitPart.motherArtifactId === null || kitPart.motherArtifactId === undefined
              ? null
              : Number(kitPart.motherArtifactId),
            JSON.stringify(orderInput.parameterSnapshot || {}),
            idempotencyKey,
            String(kitPart.status || "queued")
          ],
          logger,
          label: "bulk-create-dbr-part-job"
        });
        createdJobs.push(mapPartJobRow(partJobResult.rows[0]));
      }
    }

    await client.query("COMMIT");
    return {
      orders: createdOrders,
      batches: createdBatches,
      jobs: createdJobs
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getKitBatch(kitBatchId) {
  await ensureDbrReady();
  const result = await executeQuery({
    executor: getPool(),
    text: "SELECT * FROM dbr.dbr_kit_batch WHERE id = $1",
    values: [Number(kitBatchId)],
    logger,
    label: "get-dbr-kit-batch"
  });

  return result.rows.length ? mapKitBatchRow(result.rows[0]) : null;
}

async function createPartJob({
  kitBatchId,
  partCode,
  partSequence,
  motherArtifactId = null,
  parameterSnapshot,
  idempotencyKey,
  status = "queued"
}) {
  await ensureDbrReady();
  const result = await executeQuery({
    executor: getPool(),
    text: `
      INSERT INTO dbr.dbr_part_job (
        kit_batch_id,
        part_code,
        part_sequence,
        mother_artifact_id,
        parameter_snapshot,
        idempotency_key,
        status
      )
      VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
      ON CONFLICT (idempotency_key) DO UPDATE SET
        mother_artifact_id = EXCLUDED.mother_artifact_id,
        parameter_snapshot = EXCLUDED.parameter_snapshot,
        status = EXCLUDED.status
      RETURNING *
    `,
    values: [
      Number(kitBatchId),
      String(partCode || ""),
      Number(partSequence),
      motherArtifactId === null || motherArtifactId === undefined ? null : Number(motherArtifactId),
      JSON.stringify(parameterSnapshot || {}),
      String(idempotencyKey || ""),
      String(status)
    ],
    logger,
    label: "create-dbr-part-job"
  });

  return mapPartJobRow(result.rows[0]);
}

async function getPartJob(partJobId) {
  await ensureDbrReady();
  const result = await executeQuery({
    executor: getPool(),
    text: "SELECT * FROM dbr.dbr_part_job WHERE id = $1",
    values: [Number(partJobId)],
    logger,
    label: "get-dbr-part-job"
  });

  return result.rows.length ? mapPartJobRow(result.rows[0]) : null;
}

async function listPartJobsForBatch(kitBatchId) {
  await ensureDbrReady();
  const result = await executeQuery({
    executor: getPool(),
    text: `
      SELECT *
      FROM dbr.dbr_part_job
      WHERE kit_batch_id = $1
      ORDER BY part_sequence ASC, part_code ASC
    `,
    values: [Number(kitBatchId)],
    logger,
    label: "list-dbr-part-jobs-for-batch"
  });

  return result.rows.map(mapPartJobRow);
}

async function updatePartJobStatus({
  idempotencyKey,
  status,
  childArtifactPath = null,
  childArtifactHash = null,
  generationSummary = null,
  warnings = null,
  errors = null,
  finishedAt = null
}) {
  await ensureDbrReady();
  const result = await executeQuery({
    executor: getPool(),
    text: `
      UPDATE dbr.dbr_part_job
      SET
        status = $2,
        child_artifact_path = $3,
        child_artifact_hash = $4,
        generation_summary = $5::jsonb,
        warnings = $6::jsonb,
        errors = $7::jsonb,
        finished_at = $8
      WHERE idempotency_key = $1
      RETURNING *
    `,
    values: [
      String(idempotencyKey || ""),
      String(status || ""),
      childArtifactPath === undefined ? null : childArtifactPath,
      childArtifactHash === undefined ? null : childArtifactHash,
      generationSummary ? JSON.stringify(generationSummary) : null,
      warnings ? JSON.stringify(warnings) : null,
      errors ? JSON.stringify(errors) : null,
      finishedAt || null
    ],
    logger,
    label: "update-dbr-part-job-status"
  });

  return result.rows.length ? mapPartJobRow(result.rows[0]) : null;
}

function mapMotherArtifactRow(row) {
  return {
    id: Number(row.id),
    productCode: String(row.product_code),
    partCode: String(row.part_code),
    technologyProfile: String(row.technology_profile),
    motherSessionId: row.mother_session_id,
    artifactPath: String(row.artifact_path),
    artifactHash: row.artifact_hash,
    approvalStatus: String(row.approval_status),
    approvedAt: row.approved_at,
    approvedBy: row.approved_by,
    documentSem: row.document_sem,
    metadataSummary: row.metadata_summary,
    createdAt: row.created_at
  };
}

async function createMotherArtifactRegistryEntry({
  productCode,
  partCode,
  technologyProfile,
  motherSessionId = null,
  artifactPath,
  artifactHash = null,
  approvalStatus = "approved",
  approvedAt = null,
  approvedBy = null,
  documentSem = null,
  metadataSummary = null
}) {
  await ensureDbrReady();
  const result = await executeQuery({
    executor: getPool(),
    text: `
      INSERT INTO dcm.mother_artifact_registry (
        product_code,
        part_code,
        technology_profile,
        mother_session_id,
        artifact_path,
        artifact_hash,
        approval_status,
        approved_at,
        approved_by,
        document_sem,
        metadata_summary
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9, $10::jsonb, $11::jsonb)
      RETURNING *
    `,
    values: [
      String(productCode || ""),
      String(partCode || ""),
      String(technologyProfile || ""),
      motherSessionId === undefined ? null : motherSessionId,
      String(artifactPath || ""),
      artifactHash === undefined ? null : artifactHash,
      String(approvalStatus || "approved"),
      approvedAt || null,
      approvedBy === undefined ? null : approvedBy,
      documentSem ? JSON.stringify(documentSem) : null,
      metadataSummary ? JSON.stringify(metadataSummary) : null
    ],
    logger,
    label: "create-mother-artifact-registry-entry"
  });

  return mapMotherArtifactRow(result.rows[0]);
}

module.exports = {
  ensureDbrReady,
  upsertProductionOrder,
  getProductionOrderByGosoftDnId,
  deleteProductionOrder,
  createKitBatch,
  createKitBatchWithPartJobs,
  createBulkProductionOrdersWithBatchesAndJobs,
  getKitBatch,
  createPartJob,
  getPartJob,
  listPartJobsForBatch,
  updatePartJobStatus,
  createMotherArtifactRegistryEntry
};
