"use strict";

const fs = require("fs");
const path = require("path");
const { loadDbConfig } = require("../config/db_config");
const { createDbPool } = require("../db/client/postgres_pool");
const { executeQuery } = require("../db/helpers/query");
const { resolveMigrationFile, runSqlFile } = require("../db/helpers/migration_runner");
const { createLogger } = require("../logging/minimal_logger");

const logger = createLogger("robotics-tecna-db");
let pool = null;
let ensureReadyPromise = null;

function getPool() {
  if (!pool) {
    const config = loadDbConfig();
    pool = createDbPool(config.connection);
  }
  return pool;
}

function loadJsonTemplate(fileName) {
  const filePath = path.resolve(process.cwd(), "fixtures", "robotics_tecna", fileName);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function deepMerge(baseValue, patchValue) {
  if (Array.isArray(baseValue) || Array.isArray(patchValue)) {
    return patchValue === undefined ? baseValue : patchValue;
  }

  if (isPlainObject(baseValue) && isPlainObject(patchValue)) {
    const merged = { ...baseValue };
    for (const key of Object.keys(patchValue)) {
      merged[key] = deepMerge(baseValue[key], patchValue[key]);
    }
    return merged;
  }

  return patchValue === undefined ? baseValue : patchValue;
}

async function ensureRoboticsReady() {
  if (!ensureReadyPromise) {
    ensureReadyPromise = runSqlFile({
      executor: getPool(),
      filePath: resolveMigrationFile(
        path.join("src", "core_shell", "migrations", "robotics"),
        "001_create_robotics_tecna_dummy.up.sql"
      ),
      logger,
      label: "ensure-robotics-schema"
    }).catch((error) => {
      ensureReadyPromise = null;
      throw error;
    });
  }

  await ensureReadyPromise;
}

function createJobKey() {
  return `tecna_ui_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

function buildDefaultJobPayload(overrides = {}) {
  const jobKey = String(overrides.jobIdentity && overrides.jobIdentity.jobKey || createJobKey());
  const template = loadJsonTemplate("job_request.sample.json");
  return deepMerge(template, {
    jobIdentity: {
      jobKey
    },
    trace: {
      requestedAt: new Date().toISOString()
    },
    ...overrides
  });
}

function buildDefaultResultPayload(jobPayload, overrides = {}) {
  const jobKey = String(jobPayload && jobPayload.jobIdentity && jobPayload.jobIdentity.jobKey || createJobKey());
  const resultKey = String(overrides.jobIdentity && overrides.jobIdentity.resultKey || `${jobKey}_result_${Date.now()}`);
  const startedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const finishedAt = new Date().toISOString();
  const template = loadJsonTemplate("result_report.sample.json");

  return deepMerge(template, {
    jobIdentity: {
      jobKey,
      resultKey,
      jobType: jobPayload && jobPayload.jobIdentity ? jobPayload.jobIdentity.jobType : "tecna_spot_weld",
      robotCode: jobPayload && jobPayload.jobIdentity ? jobPayload.jobIdentity.robotCode : "TECNA_01"
    },
    executionContext: {
      workOrderRef: jobPayload && jobPayload.productionContext ? jobPayload.productionContext.workOrderRef : "RN-TECNA-DEMO-001",
      productRef: jobPayload && jobPayload.productionContext ? jobPayload.productionContext.productRef : "KRILO-TECNA-DEMO-001"
    },
    executionWindow: {
      startedAt,
      finishedAt
    },
    trace: {
      reportedAt: finishedAt
    },
    ...overrides
  });
}

function mapJobRow(row) {
  return {
    id: Number(row.id),
    jobKey: String(row.job_key),
    robotCode: String(row.robot_code),
    jobType: String(row.job_type),
    status: String(row.status),
    externalProductRef: String(row.external_product_ref),
    requestedAt: row.requested_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    requestPayload: row.request_payload
  };
}

function mapResultRow(row) {
  return row ? {
    id: Number(row.result_id),
    resultKey: String(row.result_key),
    status: String(row.result_status),
    operatorId: String(row.operator_id),
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.result_created_at,
    resultPayload: row.result_payload
  } : null;
}

async function createTecnaJob({ payload, status }) {
  await ensureRoboticsReady();
  const jobPayload = buildDefaultJobPayload(payload || {});
  const jobStatus = String(status || "queued");
  const result = await executeQuery({
    executor: getPool(),
    text: `
      INSERT INTO robotics.robot_jobs (
        job_key,
        robot_code,
        job_type,
        status,
        external_product_ref,
        request_payload
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)
      RETURNING *
    `,
    values: [
      String(jobPayload.jobIdentity.jobKey || ""),
      String(jobPayload.jobIdentity.robotCode || "TECNA_01"),
      String(jobPayload.jobIdentity.jobType || "tecna_spot_weld"),
      jobStatus,
      String(jobPayload.productionContext && jobPayload.productionContext.workOrderRef || ""),
      JSON.stringify(jobPayload)
    ],
    logger,
    label: "create-tecna-job"
  });

  return mapJobRow(result.rows[0]);
}

async function createTecnaResult({ jobKey, payload, status }) {
  await ensureRoboticsReady();

  const existing = await executeQuery({
    executor: getPool(),
    text: "SELECT * FROM robotics.robot_jobs WHERE job_key = $1",
    values: [String(jobKey || "")],
    logger,
    label: "load-tecna-job-for-result"
  });

  if (!existing.rows.length) {
    const error = new Error(`Robot job not found for jobKey=${jobKey}`);
    error.statusCode = 404;
    throw error;
  }

  const jobRow = existing.rows[0];
  const resultPayload = buildDefaultResultPayload(jobRow.request_payload || {}, payload || {});
  const resultStatus = String(status || resultPayload.status || "completed");

  const insertedResult = await executeQuery({
    executor: getPool(),
    text: `
      INSERT INTO robotics.robot_results (
        job_id,
        result_key,
        status,
        operator_id,
        started_at,
        finished_at,
        result_payload
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
      ON CONFLICT (job_id)
      DO UPDATE SET
        result_key = EXCLUDED.result_key,
        status = EXCLUDED.status,
        operator_id = EXCLUDED.operator_id,
        started_at = EXCLUDED.started_at,
        finished_at = EXCLUDED.finished_at,
        result_payload = EXCLUDED.result_payload
      RETURNING
        id AS result_id,
        result_key,
        status AS result_status,
        operator_id,
        started_at,
        finished_at,
        created_at AS result_created_at,
        result_payload
    `,
    values: [
      Number(jobRow.id),
      String(resultPayload.jobIdentity.resultKey || ""),
      resultStatus,
      String(resultPayload.executionContext && resultPayload.executionContext.operatorId || "OP-TECNA-01"),
      resultPayload.executionWindow.startedAt,
      resultPayload.executionWindow.finishedAt,
      JSON.stringify(resultPayload)
    ],
    logger,
    label: "create-tecna-result"
  });

  await executeQuery({
    executor: getPool(),
    text: "UPDATE robotics.robot_jobs SET status = $1, updated_at = NOW() WHERE id = $2",
    values: [resultStatus, Number(jobRow.id)],
    logger,
    label: "update-tecna-job-status"
  });

  return {
    job: {
      ...mapJobRow({
        ...jobRow,
        status: resultStatus,
        updated_at: new Date().toISOString()
      })
    },
    result: mapResultRow(insertedResult.rows[0])
  };
}

async function listTecnaJobs({ limit }) {
  await ensureRoboticsReady();
  const cappedLimit = Math.max(1, Math.min(Number(limit) || 20, 100));
  const result = await executeQuery({
    executor: getPool(),
    text: `
      SELECT
        j.*,
        r.id AS result_id,
        r.result_key,
        r.status AS result_status,
        r.operator_id,
        r.started_at,
        r.finished_at,
        r.created_at AS result_created_at,
        r.result_payload
      FROM robotics.robot_jobs j
      LEFT JOIN robotics.robot_results r ON r.job_id = j.id
      ORDER BY j.created_at DESC
      LIMIT $1
    `,
    values: [cappedLimit],
    logger,
    label: "list-tecna-jobs"
  });

  return result.rows.map((row) => ({
    job: mapJobRow(row),
    result: row.result_id ? mapResultRow(row) : null
  }));
}

async function getTecnaJob(jobKey) {
  await ensureRoboticsReady();
  const result = await executeQuery({
    executor: getPool(),
    text: `
      SELECT
        j.*,
        r.id AS result_id,
        r.result_key,
        r.status AS result_status,
        r.operator_id,
        r.started_at,
        r.finished_at,
        r.created_at AS result_created_at,
        r.result_payload
      FROM robotics.robot_jobs j
      LEFT JOIN robotics.robot_results r ON r.job_id = j.id
      WHERE j.job_key = $1
    `,
    values: [String(jobKey || "")],
    logger,
    label: "get-tecna-job"
  });

  if (!result.rows.length) {
    const error = new Error(`Robot job not found for jobKey=${jobKey}`);
    error.statusCode = 404;
    throw error;
  }

  const row = result.rows[0];
  return {
    job: mapJobRow(row),
    result: row.result_id ? mapResultRow(row) : null
  };
}

module.exports = {
  ensureRoboticsReady,
  createTecnaJob,
  createTecnaResult,
  listTecnaJobs,
  getTecnaJob
};
