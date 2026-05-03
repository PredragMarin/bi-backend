"use strict";

const path = require("path");
const { loadDbConfig } = require("../config/db_config");
const { getSharedPool } = require("../db/client/postgres_pool");
const { executeQuery } = require("../db/helpers/query");
const { resolveMigrationFile, runSqlFile } = require("../db/helpers/migration_runner");
const { createLogger } = require("../logging/minimal_logger");

const logger = createLogger("catalog-db");
let ensureReadyPromise = null;

function getPool() {
  return getSharedPool(loadDbConfig().connection);
}

async function ensureCatalogReady() {
  if (!ensureReadyPromise) {
    ensureReadyPromise = runSqlFile({
      executor: getPool(),
      filePath: resolveMigrationFile(
        path.join("src", "core_shell", "migrations", "catalog"),
        "001_create_catalog_foundation.up.sql"
      ),
      logger,
      label: "ensure-catalog-schema"
    }).catch((error) => {
      ensureReadyPromise = null;
      throw error;
    });
  }

  await ensureReadyPromise;
}

function mapParameterRow(row) {
  return {
    id: Number(row.id),
    catalogId: String(row.catalog_id),
    schemaVersion: String(row.schema_version),
    parameterKey: String(row.parameter_key),
    code: row.code,
    label: row.label,
    type: String(row.type),
    unit: row.unit,
    minValue: row.min_value === null ? null : Number(row.min_value),
    maxValue: row.max_value === null ? null : Number(row.max_value),
    stepValue: row.step_value === null ? null : Number(row.step_value),
    values: row.values_json,
    source: row.source,
    status: String(row.status),
    createdAt: row.created_at
  };
}

function mapRuleRow(row) {
  return {
    id: Number(row.id),
    catalogId: String(row.catalog_id),
    schemaVersion: String(row.schema_version),
    ruleId: String(row.rule_id),
    profileId: row.profile_id,
    label: row.label,
    feature: row.feature,
    appliesToVariant: row.applies_to_variant,
    expression: row.expression,
    result: row.result,
    status: String(row.status),
    payload: row.payload,
    createdAt: row.created_at
  };
}

function mapKitPartRow(row) {
  return {
    id: Number(row.id),
    productCode: String(row.product_code),
    technologyProfile: String(row.technology_profile),
    kitVersion: String(row.kit_version),
    partCode: String(row.part_code),
    partSequence: Number(row.part_sequence),
    required: !!row.required,
    status: String(row.status),
    createdAt: row.created_at
  };
}

async function listParameters({ catalogId, status } = {}) {
  await ensureCatalogReady();
  const clauses = [];
  const values = [];

  if (catalogId) {
    values.push(String(catalogId));
    clauses.push(`catalog_id = $${values.length}`);
  }
  if (status) {
    values.push(String(status));
    clauses.push(`status = $${values.length}`);
  }

  const result = await executeQuery({
    executor: getPool(),
    text: `
      SELECT *
      FROM catalog.parameter_catalog
      ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
      ORDER BY catalog_id ASC, parameter_key ASC
    `,
    values,
    logger,
    label: "list-parameters"
  });

  return result.rows.map(mapParameterRow);
}

async function getParameter({ catalogId, parameterKey }) {
  await ensureCatalogReady();
  const result = await executeQuery({
    executor: getPool(),
    text: `
      SELECT *
      FROM catalog.parameter_catalog
      WHERE catalog_id = $1
        AND parameter_key = $2
    `,
    values: [String(catalogId || ""), String(parameterKey || "")],
    logger,
    label: "get-parameter"
  });

  return result.rows.length ? mapParameterRow(result.rows[0]) : null;
}

async function listRules({ catalogId, profileId, status } = {}) {
  await ensureCatalogReady();
  const clauses = [];
  const values = [];

  if (catalogId) {
    values.push(String(catalogId));
    clauses.push(`catalog_id = $${values.length}`);
  }
  if (profileId) {
    values.push(String(profileId));
    clauses.push(`profile_id = $${values.length}`);
  }
  if (status) {
    values.push(String(status));
    clauses.push(`status = $${values.length}`);
  }

  const result = await executeQuery({
    executor: getPool(),
    text: `
      SELECT *
      FROM catalog.rule_catalog
      ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
      ORDER BY catalog_id ASC, rule_id ASC
    `,
    values,
    logger,
    label: "list-rules"
  });

  return result.rows.map(mapRuleRow);
}

async function getRule({ catalogId, ruleId }) {
  await ensureCatalogReady();
  const result = await executeQuery({
    executor: getPool(),
    text: `
      SELECT *
      FROM catalog.rule_catalog
      WHERE catalog_id = $1
        AND rule_id = $2
    `,
    values: [String(catalogId || ""), String(ruleId || "")],
    logger,
    label: "get-rule"
  });

  return result.rows.length ? mapRuleRow(result.rows[0]) : null;
}

async function listProductKitParts({ productCode, technologyProfile, kitVersion, status = "active" }) {
  await ensureCatalogReady();
  const clauses = ["product_code = $1", "technology_profile = $2"];
  const values = [String(productCode || ""), String(technologyProfile || "")];

  if (kitVersion) {
    values.push(String(kitVersion));
    clauses.push(`kit_version = $${values.length}`);
  }
  if (status) {
    values.push(String(status));
    clauses.push(`status = $${values.length}`);
  }

  const result = await executeQuery({
    executor: getPool(),
    text: `
      SELECT *
      FROM catalog.product_kit_mapping
      WHERE ${clauses.join(" AND ")}
      ORDER BY part_sequence ASC, part_code ASC
    `,
    values,
    logger,
    label: "list-product-kit-parts"
  });

  return result.rows.map(mapKitPartRow);
}

module.exports = {
  ensureCatalogReady,
  listParameters,
  getParameter,
  listRules,
  getRule,
  listProductKitParts
};
