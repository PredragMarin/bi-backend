"use strict";

async function executeQuery({ executor, text, values, logger, label }) {
  const startedAt = Date.now();

  try {
    const result = await executor.query(text, values || []);
    if (logger) {
      logger.info("SQL ok", {
        label: label || "query",
        duration_ms: Date.now() - startedAt,
        row_count: Number(result && result.rowCount || 0)
      });
    }
    return result;
  } catch (error) {
    if (logger) {
      logger.error("SQL failed", {
        label: label || "query",
        duration_ms: Date.now() - startedAt,
        message: error && error.message ? error.message : String(error)
      });
    }
    throw error;
  }
}

module.exports = {
  executeQuery
};
