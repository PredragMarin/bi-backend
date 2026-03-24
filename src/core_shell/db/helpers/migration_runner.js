"use strict";

const fs = require("fs");
const path = require("path");
const { executeQuery } = require("./query");

function resolveMigrationFile(migrationsDir, fileName) {
  return path.resolve(migrationsDir, fileName);
}

async function runSqlFile({ executor, filePath, logger, label }) {
  const sql = fs.readFileSync(filePath, "utf8");
  return executeQuery({
    executor,
    text: sql,
    values: [],
    logger,
    label: label || path.basename(filePath)
  });
}

module.exports = {
  resolveMigrationFile,
  runSqlFile
};
