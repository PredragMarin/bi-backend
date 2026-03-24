"use strict";

const { Pool } = require("pg");

function createDbPool(connectionConfig) {
  return new Pool({
    host: connectionConfig.host,
    port: connectionConfig.port,
    database: connectionConfig.database,
    user: connectionConfig.user,
    password: connectionConfig.password,
    ssl: connectionConfig.ssl ? { rejectUnauthorized: false } : false,
    max: connectionConfig.max,
    connectionTimeoutMillis: connectionConfig.connectionTimeoutMillis,
    idleTimeoutMillis: connectionConfig.idleTimeoutMillis
  });
}

async function closeDbPool(pool) {
  if (pool && typeof pool.end === "function") {
    await pool.end();
  }
}

module.exports = {
  createDbPool,
  closeDbPool
};
