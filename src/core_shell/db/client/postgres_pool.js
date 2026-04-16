"use strict";

const { Pool } = require("pg");

let _sharedPool = null;

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

function getSharedPool(connectionConfig) {
  if (_sharedPool) {
    return _sharedPool;
  }

  if (!connectionConfig) {
    throw new Error("connectionConfig is required when creating the shared pool.");
  }

  _sharedPool = createDbPool(connectionConfig);
  return _sharedPool;
}

async function closeSharedPool() {
  if (_sharedPool && typeof _sharedPool.end === "function") {
    await _sharedPool.end();
  }
  _sharedPool = null;
}

module.exports = {
  createDbPool,
  closeDbPool,
  getSharedPool,
  closeSharedPool
};
