"use strict";

const { loadDbConfig } = require("../../config/db_config");
const { createLogger } = require("../../logging/minimal_logger");
const { createDbPool, closeDbPool } = require("../client/postgres_pool");
const { executeQuery } = require("../helpers/query");
const { executeErpAllowedBatch } = require("../../services/erp_fetch_service");

const ALLOWED_GROUPS = new Set(["ADM", "INOX", "MXD"]);
const ALLOWED_MODES = new Set(["FULL", "SLIM"]);

function parseSkypeName(skypeName) {
  const raw = String(skypeName || "").trim();
  const out = {
    grupa: null,
    mode: null,
    osobni_odbitak: null,
    porezna_stopa: null,
    parsing_errors: []
  };

  if (!raw) {
    out.parsing_errors.push("SKYPENAME_EMPTY");
    return out;
  }

  const parts = raw
    .split(";")
    .map(part => String(part || "").trim())
    .filter(Boolean);

  const values = new Map();
  for (const part of parts) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim().toUpperCase();
    const value = part.slice(idx + 1).trim();
    if (key) values.set(key, value);
  }

  const grupa = String(values.get("GRP") || "").trim().toUpperCase();
  const rawMode = String(values.get("MODE") || "").trim().toUpperCase();
  const osobniOdbitakRaw = String(values.get("OO") || "").trim();
  const poreznaStopaRaw = String(values.get("PR") || "").trim().replace(",", ".");
  const mode = rawMode === "THIN" ? "SLIM" : rawMode;

  if (grupa) {
    if (ALLOWED_GROUPS.has(grupa)) out.grupa = grupa;
    else out.parsing_errors.push(`INVALID_GRP:${grupa}`);
  } else {
    out.parsing_errors.push("MISSING_GRP");
  }

  if (mode) {
    if (ALLOWED_MODES.has(mode)) out.mode = mode;
    else out.parsing_errors.push(`INVALID_MODE:${mode}`);
  } else {
    out.parsing_errors.push("MISSING_MODE");
  }

  if (osobniOdbitakRaw) {
    const parsed = Number.parseInt(osobniOdbitakRaw, 10);
    if (Number.isInteger(parsed)) out.osobni_odbitak = parsed;
    else out.parsing_errors.push(`INVALID_OO:${osobniOdbitakRaw}`);
  } else {
    out.parsing_errors.push("MISSING_OO");
  }

  if (poreznaStopaRaw) {
    const parsed = Number.parseFloat(poreznaStopaRaw);
    if (Number.isFinite(parsed)) out.porezna_stopa = parsed;
    else out.parsing_errors.push(`INVALID_PR:${poreznaStopaRaw}`);
  } else {
    out.parsing_errors.push("MISSING_PR");
  }

  return out;
}

async function fetchActiveEmployeesFromErp() {
  const requestId = `employee_registry_seed_${Date.now()}`;
  const result = await executeErpAllowedBatch({
    moduleId: "epr_attendance_v1",
    requestId,
    items: [
      { key: "osebeRows", queryId: "EPR_OSEBE_ACTIVE", params: [] }
    ]
  });

  if (!result.ok) {
    const msg = result.audit && result.audit.error ? result.audit.error : "ERP employee registry fetch failed";
    throw new Error(msg);
  }

  return result.rowsByKey.osebeRows || [];
}

async function upsertEmployee({ pool, logger, row, syncAt }) {
  const id = Number(row.osebid);
  if (!Number.isInteger(id) || id <= 0) {
    return { skipped: true, reason: "INVALID_OSEBA_ID" };
  }

  const parsed = parseSkypeName(row.skype_name);

  const result = await executeQuery({
    executor: pool,
    text: `
      INSERT INTO public.employee_registry (
        oseba_id,
        ime,
        prezime,
        grupa,
        mode,
        osobni_odbitak,
        porezna_stopa,
        erp_sync_at,
        updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7::numeric(5,2), $8::timestamp, NOW()
      )
      ON CONFLICT (oseba_id) DO UPDATE SET
        ime = EXCLUDED.ime,
        prezime = EXCLUDED.prezime,
        grupa = EXCLUDED.grupa,
        mode = EXCLUDED.mode,
        osobni_odbitak = EXCLUDED.osobni_odbitak,
        porezna_stopa = EXCLUDED.porezna_stopa,
        erp_sync_at = EXCLUDED.erp_sync_at,
        updated_at = NOW()
      RETURNING (xmax = 0) AS inserted
    `,
    values: [
      id,
      row.ime || null,
      row.priimek || null,
      parsed.grupa,
      parsed.mode,
      parsed.osobni_odbitak,
      parsed.porezna_stopa,
      syncAt
    ],
    logger,
    label: `employee-registry-upsert-${id}`
  });

  return {
    inserted: !!(result.rows[0] && result.rows[0].inserted),
    updated: !!(result.rows[0] && !result.rows[0].inserted),
    parsingErrors: parsed.parsing_errors
  };
}

async function main() {
  const logger = createLogger("employee-registry-seed");
  let pool = null;

  try {
    const config = loadDbConfig();
    pool = createDbPool(config.connection);
    const syncAt = new Date().toISOString();
    const erpRows = await fetchActiveEmployeesFromErp();

    logger.info("Starting employee registry seed", {
      erp_rows: erpRows.length,
      db_host: config.connection.host,
      db_name: config.connection.database
    });

    let insertedCount = 0;
    let updatedCount = 0;
    let parsingErrorsCount = 0;
    const parsingErrors = [];

    for (const row of erpRows) {
      const outcome = await upsertEmployee({ pool, logger, row, syncAt });
      if (outcome.skipped) continue;
      if (outcome.inserted) insertedCount += 1;
      if (outcome.updated) updatedCount += 1;
      if (Array.isArray(outcome.parsingErrors) && outcome.parsingErrors.length > 0) {
        parsingErrorsCount += 1;
        parsingErrors.push({
          oseba_id: Number(row.osebid),
          skype_name: String(row.skype_name || ""),
          errors: outcome.parsingErrors
        });
      }
    }

    logger.info("Employee registry seed completed", {
      inserted: insertedCount,
      updated: updatedCount,
      parsing_errors: parsingErrorsCount
    });

    if (parsingErrors.length > 0) {
      logger.warn("Employee registry skype_name parsing issues detected", {
        sample: parsingErrors.slice(0, 20)
      });
    }
  } catch (error) {
    logger.error("Employee registry seed failed", {
      message: error && error.message ? error.message : String(error),
      code: error && error.code ? error.code : ""
    });
    process.exitCode = 1;
  } finally {
    await closeDbPool(pool);
  }
}

main();

