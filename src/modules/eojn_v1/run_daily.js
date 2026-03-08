"use strict";

const { runLayer1 } = require("./module_runtime");

function parseArg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : null;
}

(async () => {
  const runDate = parseArg("date") || process.env.EOJN_DATE_YMD || null;
  const mode = parseArg("mode") || process.env.EOJN_LAYER1_MODE || "incremental";
  const dryRun = parseArg("dry_run") === "1" || String(process.env.EOJN_DRY_RUN || "") === "1";

  const result = await runLayer1({
    mode,
    run_date_ymd: runDate,
    dry_run: dryRun
  });

  console.log("[EOJN][L1] OK", result);
})().catch((err) => {
  console.error("[EOJN][L1] ERROR:", err && err.stack ? err.stack : err);
  process.exit(2);
});
