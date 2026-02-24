// _poc/erp_gateway_smoke/erp_gateway_runner.js

const odbc = require("odbc");
const { getAllowedQuery } = require("./query_allowlist");
const { resolveErpConnectionString } = require("./secret_provider");

function withTimeout(promise, timeoutMs, timeoutCode) {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`Timeout after ${timeoutMs} ms`);
      err.code = timeoutCode || "TIMEOUT";
      reject(err);
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function sanitizeError(err) {
  const msg = err && err.message ? String(err.message) : String(err);
  return msg
    .replace(/PWD\s*=\s*[^;\s]+/ig, "PWD=***")
    .replace(/password\s*=\s*[^;\s]+/ig, "password=***");
}

async function runAllowedQuery({ moduleId, queryId, params, requestId }) {
  if (!moduleId) throw new Error("moduleId is required");
  if (!requestId) throw new Error("requestId is required");

  const q = getAllowedQuery(queryId);
  if (q.allowParams === false && Array.isArray(params) && params.length > 0) {
    throw new Error(`Params are not allowed for query_id=${queryId}`);
  }

  const connStr = resolveErpConnectionString();
  const started = Date.now();
  let conn;

  try {
    conn = await withTimeout(odbc.connect(connStr), Math.min(8000, q.timeoutMs), "CONNECT_TIMEOUT");

    const rows = await withTimeout(
      conn.query(q.sql, Array.isArray(params) ? params : []),
      q.timeoutMs,
      "QUERY_TIMEOUT"
    );

    if (Array.isArray(rows) && rows.length > q.maxRows) {
      const e = new Error(`Row count ${rows.length} exceeds maxRows ${q.maxRows}`);
      e.code = "MAX_ROWS_EXCEEDED";
      throw e;
    }

    return {
      ok: true,
      rows: Array.isArray(rows) ? rows : [],
      audit: {
        module_id: moduleId,
        request_id: requestId,
        query_id: String(queryId).toUpperCase(),
        row_count: Array.isArray(rows) ? rows.length : 0,
        duration_ms: Date.now() - started,
        status: "OK"
      }
    };
  } catch (err) {
    return {
      ok: false,
      rows: [],
      audit: {
        module_id: moduleId,
        request_id: requestId,
        query_id: String(queryId || "").toUpperCase(),
        row_count: 0,
        duration_ms: Date.now() - started,
        status: "FAIL",
        error_code: err && err.code ? String(err.code) : "ERP_QUERY_FAILED",
        error: sanitizeError(err)
      }
    };
  } finally {
    if (conn) {
      try {
        await conn.close();
      } catch (_) {
        // close best-effort
      }
    }
  }
}

module.exports = {
  runAllowedQuery
};
