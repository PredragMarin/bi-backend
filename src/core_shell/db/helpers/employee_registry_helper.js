"use strict";

const { loadDbConfig } = require("../../config/db_config");
const { getSharedPool } = require("../client/postgres_pool");
const { executeQuery } = require("./query");
const { createLogger } = require("../../logging/minimal_logger");

const logger = createLogger("employee-registry-helper");

function normalizeDateInput(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    throw new Error("Missing required date input.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new Error(`Invalid date input (expected YYYY-MM-DD): ${raw}`);
  }
  return raw;
}

async function getActiveEmployeesForPeriod(dateFrom, dateTo) {
  const from = normalizeDateInput(dateFrom);
  const to = normalizeDateInput(dateTo);
  const pool = getSharedPool(loadDbConfig().connection);

  const result = await executeQuery({
    executor: pool,
    text: `
      SELECT
        oseba_id,
        ime,
        prezime,
        datum_pocetka,
        datum_kraja,
        grupa,
        mode,
        osobni_odbitak,
        porezna_stopa,
        erp_sync_at,
        created_at,
        updated_at
      FROM public.employee_registry
      WHERE datum_pocetka <= $2::date
        AND (datum_kraja IS NULL OR datum_kraja >= $1::date)
      ORDER BY prezime ASC NULLS LAST, ime ASC NULLS LAST, oseba_id ASC
    `,
    values: [from, to],
    logger,
    label: "get-active-employees-for-period"
  });

  return result.rows;
}

async function getEmployeeByOsebaId(oseba_id) {
  const id = Number(oseba_id);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`Invalid oseba_id: ${oseba_id}`);
  }
  const pool = getSharedPool(loadDbConfig().connection);

  const result = await executeQuery({
    executor: pool,
    text: `
      SELECT
        oseba_id,
        ime,
        prezime,
        datum_pocetka,
        datum_kraja,
        grupa,
        mode,
        osobni_odbitak,
        porezna_stopa,
        erp_sync_at,
        created_at,
        updated_at
      FROM public.employee_registry
      WHERE oseba_id = $1
      LIMIT 1
    `,
    values: [id],
    logger,
    label: "get-employee-by-oseba-id"
  });

  return result.rows[0] || null;
}

module.exports = {
  getActiveEmployeesForPeriod,
  getEmployeeByOsebaId
};
