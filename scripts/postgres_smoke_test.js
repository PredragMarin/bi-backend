"use strict";

const { loadDbConfig } = require("../src/core_shell/config/db_config");
const { createLogger } = require("../src/core_shell/logging/minimal_logger");
const { createDbPool, closeDbPool } = require("../src/core_shell/db/client/postgres_pool");
const { executeQuery } = require("../src/core_shell/db/helpers/query");
const { resolveMigrationFile, runSqlFile } = require("../src/core_shell/db/helpers/migration_runner");

function hasFlag(flag) {
  return process.argv.includes(flag);
}

async function main() {
  const logger = createLogger("postgres-smoke");
  let pool = null;

  try {
    const config = loadDbConfig();
    pool = createDbPool(config.connection);
    const smokeKey = `smoke_${Date.now()}`;
    const cleanupSchema = hasFlag("--cleanup-schema");

    logger.info("Starting PostgreSQL smoke test", {
      host: config.connection.host,
      port: config.connection.port,
      database: config.connection.database,
      user: config.connection.user,
      migrations_dir: config.smoke.migrationsDir,
      env_loaded: config.envState.loaded
    });

    await executeQuery({
      executor: pool,
      text: "SELECT current_database() AS database_name, current_user AS database_user, inet_server_addr()::text AS server_addr",
      values: [],
      logger,
      label: "authenticate"
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
      filePath: resolveMigrationFile(config.smoke.migrationsDir, "001_create_bi_smoke.up.sql"),
      logger,
      label: "migration-up"
    });

    await executeQuery({
      executor: pool,
      text: "SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1",
      values: [config.smoke.schema],
      logger,
      label: "schema-check"
    });

    await executeQuery({
      executor: pool,
      text: "INSERT INTO bi_smoke.connection_smoke (smoke_key, payload) VALUES ($1, $2::jsonb)",
      values: [
        smokeKey,
        JSON.stringify({
          check: "insert-readback",
          createdAt: new Date().toISOString()
        })
      ],
      logger,
      label: "insert-smoke-row"
    });

    const readback = await executeQuery({
      executor: pool,
      text: "SELECT smoke_key, payload, created_at FROM bi_smoke.connection_smoke WHERE smoke_key = $1",
      values: [smokeKey],
      logger,
      label: "readback-smoke-row"
    });

    if (!readback.rows.length) {
      throw new Error("Smoke row was inserted but not read back.");
    }

    if (cleanupSchema) {
      await runSqlFile({
        executor: pool,
        filePath: resolveMigrationFile(config.smoke.migrationsDir, "001_create_bi_smoke.down.sql"),
        logger,
        label: "migration-down"
      });
    } else {
      await executeQuery({
        executor: pool,
        text: "DELETE FROM bi_smoke.connection_smoke WHERE smoke_key = $1",
        values: [smokeKey],
        logger,
        label: "cleanup-smoke-row"
      });
    }

    logger.info("PostgreSQL smoke test completed", {
      cleanup_mode: cleanupSchema ? "schema" : "row",
      smoke_key: smokeKey
    });
  } catch (error) {
    logger.error("PostgreSQL smoke test failed", {
      message: error && error.message ? error.message : String(error),
      code: error && error.code ? error.code : ""
    });
    process.exitCode = 1;
  } finally {
    await closeDbPool(pool);
  }
}

main();
