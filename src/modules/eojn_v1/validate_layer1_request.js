"use strict";

const ALLOWED_MODES = new Set(["bootstrap", "incremental", "safety_full"]);

function assertYmd(value, fieldName) {
  if (value === undefined || value === null || value === "") return null;
  const v = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    throw new Error(`Invalid ${fieldName}; expected YYYY-MM-DD`);
  }
  return v;
}

function validateLayer1Request(input) {
  const body = input && typeof input === "object" ? input : {};
  const mode = String(body.mode || "incremental").trim().toLowerCase();
  if (!ALLOWED_MODES.has(mode)) {
    throw new Error("Invalid mode; allowed: bootstrap, incremental, safety_full");
  }

  return {
    mode,
    run_date_ymd: assertYmd(body.run_date_ymd, "run_date_ymd"),
    out_root: body.out_root ? String(body.out_root).trim() : "",
    dry_run: Boolean(body.dry_run)
  };
}

module.exports = {
  validateLayer1Request
};
