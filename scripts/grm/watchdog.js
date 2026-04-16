"use strict";

const { getGrmConfig } = require("../../src/modules/gosoft_request_module_v1/config/grm_config");
const { ensureBaseFolders } = require("../../src/modules/gosoft_request_module_v1/services/target_folder_service");
const { listRequestFiles } = require("../../src/modules/gosoft_request_module_v1/services/request_inbox_service");
const { processRequestFile } = require("../../src/modules/gosoft_request_module_v1/runtime");

const DEFAULT_INTERVAL_MS = 5000;
const ERROR_COOLDOWN_MS = 30000;

function nowIso() {
  return new Date().toISOString();
}

async function main() {
  const config = getGrmConfig();
  ensureBaseFolders(config);

  const intervalMs = Number(process.env.GRM_POLL_INTERVAL_MS) > 0
    ? Number(process.env.GRM_POLL_INTERVAL_MS)
    : DEFAULT_INTERVAL_MS;

  const recentErrors = new Map();
  let tickRunning = false;

  async function tick() {
    if (tickRunning) return;
    tickRunning = true;
    try {
      const files = listRequestFiles(config.requestDir);
      for (const file of files) {
        const lastErrorAt = recentErrors.get(file.fullPath) || 0;
        if (lastErrorAt && (Date.now() - lastErrorAt) < ERROR_COOLDOWN_MS) {
          continue;
        }
        try {
          const result = await processRequestFile(file.fullPath);
          recentErrors.delete(file.fullPath);
          console.log(JSON.stringify({
            ts: nowIso(),
            event: "request_processed",
            request_file: file.name,
            ok: !!result.ok,
            request_id: result.request_id || null,
            response_dir: result.response_dir || null,
            error_manifest_path: result.error_manifest_path || null,
            error: result.error || null
          }));
        } catch (err) {
          recentErrors.set(file.fullPath, Date.now());
          console.error(JSON.stringify({
            ts: nowIso(),
            event: "request_processing_error",
            request_file: file.name,
            error: err && err.message ? err.message : String(err)
          }));
        }
      }
    } finally {
      tickRunning = false;
    }
  }

  console.log(JSON.stringify({
    ts: nowIso(),
    event: "grm_watchdog_started",
    request_dir: config.requestDir,
    poll_interval_ms: intervalMs
  }));

  await tick();
  setInterval(() => {
    tick().catch((err) => {
      console.error(JSON.stringify({
        ts: nowIso(),
        event: "watchdog_tick_failure",
        error: err && err.message ? err.message : String(err)
      }));
    });
  }, intervalMs);
}

main().catch((err) => {
  console.error(JSON.stringify({
    ts: nowIso(),
    event: "grm_watchdog_fatal",
    error: err && err.message ? err.message : String(err)
  }));
  process.exit(1);
});
