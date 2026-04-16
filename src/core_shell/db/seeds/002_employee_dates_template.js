"use strict";

const { loadDbConfig } = require("../../config/db_config");
const { createLogger } = require("../../logging/minimal_logger");
const { createDbPool, closeDbPool } = require("../client/postgres_pool");
const { executeQuery } = require("../helpers/query");

async function main() {
  const logger = createLogger("employee-dates-template");
  let pool = null;

  try {
    const config = loadDbConfig();
    pool = createDbPool(config.connection);

    const result = await executeQuery({
      executor: pool,
      text: `
        SELECT
          oseba_id,
          ime,
          prezime,
          datum_pocetka,
          datum_kraja
        FROM public.employee_registry
        WHERE datum_pocetka IS NULL
        ORDER BY prezime ASC NULLS LAST, ime ASC NULLS LAST, oseba_id ASC
      `,
      values: [],
      logger,
      label: "employee-dates-template"
    });

    if (!result.rows.length) {
      console.log("Nema employee_registry redova bez datum_pocetka.");
    } else {
      for (const row of result.rows) {
        console.log(
          `${row.oseba_id} | ${row.ime || ""} | ${row.prezime || ""} | ${row.datum_pocetka || "NULL"} | ${row.datum_kraja || "NULL"}`
        );
      }
    }

    console.log("");
    console.log("Ručno unesite datume SQL UPDATE naredbom:");
    console.log("UPDATE employee_registry");
    console.log("SET datum_pocetka = 'YYYY-MM-DD',");
    console.log("    datum_kraja = 'YYYY-MM-DD'  -- ili NULL ako aktivan");
    console.log("WHERE oseba_id = X;");
  } catch (error) {
    logger.error("Employee dates template failed", {
      message: error && error.message ? error.message : String(error),
      code: error && error.code ? error.code : ""
    });
    process.exitCode = 1;
  } finally {
    await closeDbPool(pool);
  }
}

main();
