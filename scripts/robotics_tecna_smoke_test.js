"use strict";

const fs = require("fs");
const path = require("path");
const { loadDbConfig } = require("../src/core_shell/config/db_config");
const { createLogger } = require("../src/core_shell/logging/minimal_logger");
const { createDbPool, closeDbPool } = require("../src/core_shell/db/client/postgres_pool");
const { executeQuery } = require("../src/core_shell/db/helpers/query");
const { resolveMigrationFile, runSqlFile } = require("../src/core_shell/db/helpers/migration_runner");

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function loadJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function loadTecnaJobRequest({ jobKey, requestedAt }) {
  const template = loadJsonFile(path.resolve("fixtures", "robotics_tecna", "job_request.sample.json"));
  return {
    ...template,
    jobIdentity: {
      ...template.jobIdentity,
      jobKey
    },
    trace: {
      ...template.trace,
      requestedAt
    }
  };
}

function loadTecnaResultReport({ jobKey, resultKey, startedAt, finishedAt }) {
  const template = loadJsonFile(path.resolve("fixtures", "robotics_tecna", "result_report.sample.json"));
  return {
    ...template,
    jobIdentity: {
      ...template.jobIdentity,
      jobKey,
      resultKey
    },
    executionWindow: {
      ...template.executionWindow,
      startedAt,
      finishedAt
    },
    trace: {
      ...template.trace,
      reportedAt: finishedAt
    }
  };
}

async function main() {
  const logger = createLogger("robotics-tecna-smoke");
  let pool = null;

  try {
    const config = loadDbConfig();
    const cleanupSchema = hasFlag("--cleanup-schema");
    const jobKey = `tecna_job_${Date.now()}`;
    const resultKey = `${jobKey}_result`;
    const requestedAt = new Date().toISOString();
    const startedAt = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    const finishedAt = new Date().toISOString();
    const requestPayload = loadTecnaJobRequest({ jobKey, requestedAt });
    const resultPayload = loadTecnaResultReport({ jobKey, resultKey, startedAt, finishedAt });

    pool = createDbPool(config.connection);

    logger.info("Starting Robot Tecna dummy smoke test", {
      host: config.connection.host,
      port: config.connection.port,
      database: config.connection.database,
      user: config.connection.user
    });

    await executeQuery({
      executor: pool,
      text: "SELECT 1 AS ok",
      values: [],
      logger,
      label: "select-1"
    });

    await runSqlFile({
      executor: pool,
      filePath: resolveMigrationFile(
        "src/core_shell/migrations/robotics",
        "001_create_robotics_tecna_dummy.up.sql"
      ),
      logger,
      label: "robotics-migration-up"
    });

    const insertedJob = await executeQuery({
      executor: pool,
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
        RETURNING id, job_key
      `,
      values: [
        jobKey,
        "TECNA_01",
        "tecna_spot_weld",
        "queued",
        String(requestPayload.productionContext.workOrderRef || ""),
        JSON.stringify(requestPayload)
      ],
      logger,
      label: "insert-robot-job"
    });

    const jobId = insertedJob.rows[0].id;

    await executeQuery({
      executor: pool,
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
      `,
      values: [
        jobId,
        resultPayload.jobIdentity.resultKey,
        resultPayload.status,
        resultPayload.executionContext.operatorId,
        resultPayload.executionWindow.startedAt,
        resultPayload.executionWindow.finishedAt,
        JSON.stringify(resultPayload)
      ],
      logger,
      label: "insert-robot-result"
    });

    const readback = await executeQuery({
      executor: pool,
      text: `
        SELECT
          j.job_key,
          j.robot_code,
          j.job_type,
          j.status AS job_status,
          j.request_payload,
          r.status AS result_status,
          r.operator_id,
          r.result_payload
        FROM robotics.robot_jobs j
        JOIN robotics.robot_results r ON r.job_id = j.id
        WHERE j.job_key = $1
      `,
      values: [jobKey],
      logger,
      label: "readback-robot-job-and-result"
    });

    if (!readback.rows.length) {
      throw new Error("Robot Tecna smoke readback returned no rows.");
    }

    if (cleanupSchema) {
      await runSqlFile({
        executor: pool,
        filePath: resolveMigrationFile(
          "src/core_shell/migrations/robotics",
          "001_create_robotics_tecna_dummy.down.sql"
        ),
        logger,
        label: "robotics-migration-down"
      });
    } else {
      await executeQuery({
        executor: pool,
        text: "DELETE FROM robotics.robot_jobs WHERE job_key = $1",
        values: [jobKey],
        logger,
        label: "cleanup-robot-job"
      });
    }

    logger.info("Robot Tecna dummy smoke test completed", {
      cleanup_mode: cleanupSchema ? "schema" : "row",
      job_key: jobKey,
      result_key: resultPayload.jobIdentity.resultKey
    });
  } catch (error) {
    logger.error("Robot Tecna dummy smoke test failed", {
      message: error && error.message ? error.message : String(error),
      code: error && error.code ? error.code : ""
    });
    process.exitCode = 1;
  } finally {
    await closeDbPool(pool);
  }
}

main();
