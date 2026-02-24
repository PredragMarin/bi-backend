// src/core/erp_gateway/client.js
const odbc = require("odbc");
const { getAllowedQuery } = require("./query_allowlist");
const { resolveErpConnectionString } = require("./secret_provider");

function withTimeout(promise, timeoutMs, code) {
  let timer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`Timeout after ${timeoutMs} ms`);
      err.code = code || "TIMEOUT";
      reject(err);
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function sanitizeErrorMessage(err) {
  const msg = err && err.message ? String(err.message) : String(err);
  return msg
    .replace(/PWD\s*=\s*[^;\s]+/ig, "PWD=***")
    .replace(/password\s*=\s*[^;\s]+/ig, "password=***");
}

async function executeAllowedBatch({ moduleId, requestId, items, dsnOverride }) {
  if (!moduleId) throw new Error("moduleId is required");
  if (!requestId) throw new Error("requestId is required");
  if (!Array.isArray(items) || items.length === 0) throw new Error("items[] is required");

  const connStr = resolveErpConnectionString({ dsnOverride });
  const startedAt = Date.now();
  const out = {};
  let connection;

  try {
    connection = await withTimeout(odbc.connect(connStr), 10000, "CONNECT_TIMEOUT");

    for (const item of items) {
      const key = String(item.key || item.queryId || "").trim();
      const queryId = String(item.queryId || "").trim();
      if (!key || !queryId) throw new Error("Each batch item needs key and queryId");

      const q = getAllowedQuery(queryId);
      const params = Array.isArray(item.params) ? item.params : [];
      const rows = await withTimeout(connection.query(q.sql, params), q.timeoutMs, "QUERY_TIMEOUT");
      if (Array.isArray(rows) && rows.length > q.maxRows) {
        const e = new Error(`Row count ${rows.length} exceeds maxRows ${q.maxRows} for ${queryId}`);
        e.code = "MAX_ROWS_EXCEEDED";
        throw e;
      }
      out[key] = Array.isArray(rows) ? rows : [];
    }

    return {
      ok: true,
      rowsByKey: out,
      audit: {
        module_id: moduleId,
        request_id: requestId,
        duration_ms: Date.now() - startedAt,
        status: "OK"
      }
    };
  } catch (err) {
    return {
      ok: false,
      rowsByKey: out,
      audit: {
        module_id: moduleId,
        request_id: requestId,
        duration_ms: Date.now() - startedAt,
        status: "FAIL",
        error_code: err && err.code ? String(err.code) : "ERP_QUERY_FAILED",
        error: sanitizeErrorMessage(err)
      }
    };
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (_) {
        // close best effort
      }
    }
  }
}

module.exports = {
  executeAllowedBatch
};
