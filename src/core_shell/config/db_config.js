"use strict";

const path = require("path");
const { loadEnvFile } = require("./load_env");

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function requireEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function loadDbConfig(options = {}) {
  const explicitEnvFilePath = options.envFilePath || process.env.BI_DB_ENV_FILE;
  const envState = loadEnvFile(explicitEnvFilePath);

  const host = requireEnv("BI_DB_HOST");
  const port = parseInteger(process.env.BI_DB_PORT, 5432);
  const database = requireEnv("BI_DB_NAME");
  const user = requireEnv("BI_DB_USER");
  const password = requireEnv("BI_DB_PASSWORD");
  const ssl = parseBoolean(process.env.BI_DB_SSL, false);
  const poolMax = parseInteger(process.env.BI_DB_POOL_MAX, 5);
  const connectionTimeoutMillis = parseInteger(process.env.BI_DB_CONNECTION_TIMEOUT_MS, 5000);
  const idleTimeoutMillis = parseInteger(process.env.BI_DB_IDLE_TIMEOUT_MS, 10000);
  const smokeSchema = String(process.env.BI_DB_SCHEMA_SMOKE || "bi_smoke").trim();
  const migrationsDir = path.resolve(
    process.env.BI_DB_MIGRATIONS_DIR || path.join("src", "core_shell", "migrations", "smoke")
  );

  return {
    envState,
    connection: {
      host,
      port,
      database,
      user,
      password,
      ssl,
      max: poolMax,
      connectionTimeoutMillis,
      idleTimeoutMillis
    },
    smoke: {
      schema: smokeSchema,
      migrationsDir
    }
  };
}

module.exports = {
  loadDbConfig
};
