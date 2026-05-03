"use strict";

const fs = require("fs");
const path = require("path");
const { loadDbConfig } = require("../../config/db_config");
const { createLogger } = require("../../logging/minimal_logger");
const { createDbPool, closeDbPool } = require("../client/postgres_pool");
const { executeQuery } = require("../helpers/query");
const { resolveMigrationFile, runSqlFile } = require("../helpers/migration_runner");

const PARAMETER_CATALOG_PATH = path.join(
  "src",
  "modules",
  "mother_dxf_v1",
  "contracts",
  "parameter_catalog_legacy_door_v0.json"
);

const RULE_CATALOG_PATH = path.join(
  "src",
  "modules",
  "mother_dxf_v1",
  "contracts",
  "rule_catalog_mxd_door_v0.json"
);

const PPV_KIT_PARTS = [
  "KSKR",
  "LBRA",
  "OBRA",
  "OBRIT",
  "OSPY",
  "OMET",
  "LBRIT",
  "LHOR",
  "LMET",
  "SBRA",
  "SBRIT",
  "SHOR"
];

function readJsonFile(relativePath) {
  return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8"));
}

async function runFoundationMigrations({ pool, logger }) {
  const migrations = [
    ["catalog", "001_create_catalog_foundation.up.sql"],
    ["dcm", "001_create_dcm_foundation.up.sql"],
    ["dbr", "001_create_dbr_foundation.up.sql"]
  ];

  for (const [folder, fileName] of migrations) {
    await runSqlFile({
      executor: pool,
      filePath: resolveMigrationFile(path.join("src", "core_shell", "migrations", folder), fileName),
      logger,
      label: `migration-${folder}`
    });
  }
}

async function seedParameterCatalog({ pool, logger }) {
  const catalog = readJsonFile(PARAMETER_CATALOG_PATH);
  const parameters = catalog.parameters && typeof catalog.parameters === "object" ? catalog.parameters : {};
  let count = 0;

  for (const parameter of Object.values(parameters)) {
    const valuesJson = Array.isArray(parameter.values) ? parameter.values : null;
    await executeQuery({
      executor: pool,
      text: `
        INSERT INTO catalog.parameter_catalog (
          catalog_id,
          schema_version,
          parameter_key,
          code,
          label,
          type,
          unit,
          min_value,
          max_value,
          step_value,
          values_json,
          source,
          status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::numeric, $9::numeric, $10::numeric, $11::jsonb, $12, $13)
        ON CONFLICT (catalog_id, parameter_key) DO UPDATE SET
          schema_version = EXCLUDED.schema_version,
          code = EXCLUDED.code,
          label = EXCLUDED.label,
          type = EXCLUDED.type,
          unit = EXCLUDED.unit,
          min_value = EXCLUDED.min_value,
          max_value = EXCLUDED.max_value,
          step_value = EXCLUDED.step_value,
          values_json = EXCLUDED.values_json,
          source = EXCLUDED.source,
          status = EXCLUDED.status
      `,
      values: [
        String(catalog.catalog_id || "legacy_door_configurator_catalog_v0"),
        String(catalog.schema_version || "parameter_catalog.v0"),
        String(parameter.key || ""),
        parameter.code === undefined ? null : String(parameter.code),
        parameter.label === undefined ? null : String(parameter.label),
        String(parameter.type || "string"),
        parameter.unit === undefined ? null : String(parameter.unit),
        parameter.min === undefined ? null : Number(parameter.min),
        parameter.max === undefined ? null : Number(parameter.max),
        parameter.step === undefined ? null : Number(parameter.step),
        valuesJson ? JSON.stringify(valuesJson) : null,
        String(catalog.source || "mother_dxf_contract_seed"),
        "active"
      ],
      logger,
      label: `seed-parameter-${parameter.key}`
    });
    count += 1;
  }

  return count;
}

async function seedRuleCatalog({ pool, logger }) {
  const catalog = readJsonFile(RULE_CATALOG_PATH);
  const rules = catalog.rules && typeof catalog.rules === "object" ? catalog.rules : {};
  let count = 0;

  for (const rule of Object.values(rules)) {
    await executeQuery({
      executor: pool,
      text: `
        INSERT INTO catalog.rule_catalog (
          catalog_id,
          schema_version,
          rule_id,
          profile_id,
          label,
          feature,
          applies_to_variant,
          expression,
          result,
          status,
          payload
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
        ON CONFLICT (catalog_id, rule_id) DO UPDATE SET
          schema_version = EXCLUDED.schema_version,
          profile_id = EXCLUDED.profile_id,
          label = EXCLUDED.label,
          feature = EXCLUDED.feature,
          applies_to_variant = EXCLUDED.applies_to_variant,
          expression = EXCLUDED.expression,
          result = EXCLUDED.result,
          status = EXCLUDED.status,
          payload = EXCLUDED.payload
      `,
      values: [
        String(catalog.catalog_id || "rule_catalog_mxd_door_v0"),
        String(catalog.schema_version || "rule_catalog.v0"),
        String(rule.rule_id || ""),
        catalog.profile_id === undefined ? null : String(catalog.profile_id),
        rule.label === undefined ? null : String(rule.label),
        rule.feature === undefined ? null : String(rule.feature),
        rule.applies_to_variant === undefined ? null : String(rule.applies_to_variant),
        rule.expression === undefined ? null : String(rule.expression),
        rule.result === undefined ? null : String(rule.result),
        String(rule.status || "draft"),
        JSON.stringify(rule)
      ],
      logger,
      label: `seed-rule-${rule.rule_id}`
    });
    count += 1;
  }

  return count;
}

async function seedPpvKitMapping({ pool, logger }) {
  const productCode = "PPV";
  const technologyProfile = "OPS_S4P4";
  const kitVersion = "PPV_OPS_S4P4_v0";

  for (let index = 0; index < PPV_KIT_PARTS.length; index += 1) {
    const partCode = PPV_KIT_PARTS[index];
    await executeQuery({
      executor: pool,
      text: `
        INSERT INTO catalog.product_kit_mapping (
          product_code,
          technology_profile,
          part_code,
          part_sequence,
          required,
          kit_version,
          status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (product_code, technology_profile, kit_version, part_code) DO UPDATE SET
          part_sequence = EXCLUDED.part_sequence,
          required = EXCLUDED.required,
          status = EXCLUDED.status
      `,
      values: [
        productCode,
        technologyProfile,
        partCode,
        index + 1,
        true,
        kitVersion,
        "active"
      ],
      logger,
      label: `seed-kit-${productCode}-${partCode}`
    });
  }

  return PPV_KIT_PARTS.length;
}

async function main() {
  const logger = createLogger("dbr-catalog-seed");
  let pool = null;

  try {
    const config = loadDbConfig();
    pool = createDbPool(config.connection);

    logger.info("Starting DBR catalog seed", {
      db_host: config.connection.host,
      db_name: config.connection.database
    });

    await runFoundationMigrations({ pool, logger });
    const parameterCount = await seedParameterCatalog({ pool, logger });
    const ruleCount = await seedRuleCatalog({ pool, logger });
    const kitCount = await seedPpvKitMapping({ pool, logger });

    logger.info("DBR catalog seed completed", {
      parameters: parameterCount,
      rules: ruleCount,
      kit_parts: kitCount,
      product_code: "PPV",
      technology_profile: "OPS_S4P4"
    });
  } catch (error) {
    logger.error("DBR catalog seed failed", {
      message: error && error.message ? error.message : String(error),
      code: error && error.code ? error.code : ""
    });
    process.exitCode = 1;
  } finally {
    await closeDbPool(pool);
  }
}

main();
