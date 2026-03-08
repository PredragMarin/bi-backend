"use strict";

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { defaultOutRoot, loadLayer2Status, saveLayer2Status } = require("../../core_shell/services/eojn_layer2_store");
const { resolveEojnConfigPath } = require("./secret_provider");

let activeRun = null;
const STALE_ACTIVE_MS = 5 * 60 * 1000;

function listRunFolders(outRoot) {
  const entries = fs.readdirSync(outRoot, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((n) => /^\d{4}_\d{2}_\d{2}$/.test(n))
    .sort();
}

function ymdTodayLocal() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function resolveRunDir(outRoot, runDateYmd) {
  if (runDateYmd) {
    const wanted = path.join(outRoot, String(runDateYmd).replace(/-/g, "_"));
    if (!fs.existsSync(wanted)) {
      throw new Error(`Run folder not found for date ${runDateYmd}`);
    }
    return wanted;
  }
  const all = listRunFolders(outRoot);
  if (!all.length) throw new Error("No EOJN run folders found.");
  const todayTag = ymdTodayLocal().replace(/-/g, "_");
  const eligible = all.filter((d) => d <= todayTag);
  const picked = eligible.length ? eligible[eligible.length - 1] : all[all.length - 1];
  return path.join(outRoot, picked);
}

function normalizeStartOptions(opts) {
  const input = opts && typeof opts === "object" ? opts : {};
  const cap = Number(input.max_items === undefined ? 15 : input.max_items);
  const retry = Number(input.retry_count === undefined ? 1 : input.retry_count);
  const itemTimeoutMs = Number(input.item_timeout_ms === undefined ? 300000 : input.item_timeout_ms);
  const delayMin = Number(input.human_delay_min_ms === undefined ? 10000 : input.human_delay_min_ms);
  const delayMax = Number(input.human_delay_max_ms === undefined ? 15000 : input.human_delay_max_ms);
  const minMs = Number.isFinite(delayMin) && delayMin >= 0 ? Math.floor(delayMin) : 10000;
  const maxMs = Number.isFinite(delayMax) && delayMax >= minMs ? Math.floor(delayMax) : Math.max(minMs, 15000);
  return {
    out_root: input.out_root ? String(input.out_root) : "",
    run_date_ymd: input.run_date_ymd ? String(input.run_date_ymd) : "",
    max_items: Number.isFinite(cap) && cap > 0 ? Math.floor(cap) : 15,
    retry_count: Number.isFinite(retry) && retry >= 0 ? Math.floor(retry) : 1,
    item_timeout_ms: Number.isFinite(itemTimeoutMs) && itemTimeoutMs > 1000 ? Math.floor(itemTimeoutMs) : 300000,
    enable_download: Boolean(input.enable_download),
    config_path: input.config_path ? String(input.config_path) : "",
    human_delay_min_ms: minMs,
    human_delay_max_ms: maxMs
  };
}

async function readJson(filePath) {
  const text = await fsp.readFile(filePath, "utf8");
  return JSON.parse(text);
}

function runNodeScript(scriptPath, args, timeoutMs) {
  const out = spawnSync("node", [scriptPath, ...args], {
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 30 * 1024 * 1024
  });
  if (out.error && out.error.code === "ETIMEDOUT") {
    const e = new Error(`Timed out after ${timeoutMs}ms`);
    e.code = "TIMEOUT";
    throw e;
  }
  if (out.status !== 0) {
    const merged = String(out.stderr || out.stdout || "");
    const head = merged.slice(0, 300);
    const tail = merged.length > 900 ? merged.slice(-900) : merged;
    const message = `${head}${merged.length > 900 ? "\n...\n" : "\n"}${tail}` || `Exit code ${out.status}`;
    const e = new Error(message);
    e.code = "SCRIPT_FAILED";
    throw e;
  }
  return out;
}

function findLatestBatchReport(outRoot) {
  const devRoot = path.join(outRoot, "_dev_budget_pw");
  if (!fs.existsSync(devRoot)) return null;
  const dirs = fs.readdirSync(devRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .reverse();
  for (const d of dirs) {
    const p = path.join(devRoot, d, "batch_report.json");
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function readDownloaderFailureReason({ outRoot, tenderId }) {
  try {
    const reportPath = findLatestBatchReport(outRoot);
    if (!reportPath) return "";
    const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    const rows = Array.isArray(report && report.tenders) ? report.tenders : [];
    const hit = rows.find((r) => Number(r && r.tenderId) === Number(tenderId));
    if (!hit) return "";
    const errors = Array.isArray(hit.errors) ? hit.errors.filter(Boolean).map(String) : [];
    if (!errors.length) return "";
    return errors.join("|");
  } catch (_) {
    return "";
  }
}

function findFilesRecursive(dir, pred, out = []) {
  if (!fs.existsSync(dir)) return out;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      findFilesRecursive(full, pred, out);
    } else if (pred(full)) {
      out.push(full);
    }
  }
  return out;
}

function extScore(filePath) {
  return /\.xlsx$/i.test(filePath) ? 2 : /\.xls$/i.test(filePath) ? 1 : 0;
}

function pickBestBudgetFile(files) {
  return [...files].sort((a, b) => {
    const sa = extScore(a);
    const sb = extScore(b);
    if (sa !== sb) return sb - sa;
    const ta = fs.statSync(a).mtimeMs;
    const tb = fs.statSync(b).mtimeMs;
    return tb - ta;
  })[0] || null;
}

function findBudgetFilesForTender({ outRoot, runDir, tenderId }) {
  const matcher = (p) => /\.(xlsx|xls)$/i.test(p) && !/^\~\$/.test(path.basename(p));
  const tenderFolder = path.join(runDir, `tender_${tenderId}`);
  const inRun = findFilesRecursive(tenderFolder, matcher, []);

  const devRoot = path.join(outRoot, "_dev_budget_pw");
  const devDirs = fs.existsSync(devRoot)
    ? fs.readdirSync(devRoot, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort().reverse()
    : [];
  const fromDev = [];
  for (const d of devDirs) {
    const p = path.join(devRoot, d, `tender_${tenderId}`);
    findFilesRecursive(p, matcher, fromDev);
  }

  return [...inRun, ...fromDev];
}

function tryDownloadBudgetForTender({ outRoot, moduleDir, tenderId, configPath, timeoutMs }) {
  const resolvedConfigPath = resolveEojnConfigPath({ configPathOverride: configPath });
  const downloader = path.join(moduleDir, "dev_pw_download_budget.js");
  try {
    runNodeScript(
      downloader,
      [`--config=${resolvedConfigPath}`, `--tender=${tenderId}`, "--fresh=0", "--headed=0"],
      timeoutMs
    );
  } catch (err) {
    const reason = readDownloaderFailureReason({ outRoot, tenderId });
    if (reason) {
      const e = new Error(`DOWNLOADER_${reason}`);
      e.code = "DOWNLOADER_FAILED";
      throw e;
    }
    throw err;
  }
}

function runBudgetAnalyzer({ moduleDir, budgetFile, outFile, timeoutMs }) {
  const scanner = path.join(moduleDir, "layer2_budget_scan.js");
  runNodeScript(scanner, [`--file=${budgetFile}`, `--out=${outFile}`], timeoutMs);
  return readJson(outFile);
}

function randomIntInclusive(min, max) {
  if (max <= min) return min;
  return min + Math.floor(Math.random() * (max - min + 1));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function updateStatus(outRoot, patch) {
  const current = await loadLayer2Status({ outRoot });
  const next = {
    ...current,
    ...patch,
    last_heartbeat_at: new Date().toISOString()
  };
  if (next.total > 0) {
    next.progress_pct = Math.max(0, Math.min(100, Math.round((Number(next.current_index || 0) / next.total) * 100)));
  } else {
    next.progress_pct = 0;
  }
  await saveLayer2Status({ outRoot, status: next });
  return next;
}

function classifyFailure(err) {
  const msg = String((err && err.message) || err || "");
  if ((err && err.code === "TIMEOUT") || /timed out/i.test(msg)) return "TIMEOUT";
  if (/PowerShell JSON parse failed|PowerShell Excel extraction failed|JSON parse failed/i.test(msg)) return "EXTRACT_FAILED";
  if (/Missing EOJN credentials file|EOJN_SECRET_FILE|EOJN_CONFIG_PATH|EOJN config file not found/i.test(msg)) return "CONFIG_FAILED";
  if (/LOGIN_FAILED|STILL_LOGIN_WALL|DOWNLOADER_LOGIN_FAILED/i.test(msg)) return "LOGIN_FAILED";
  if (/NO_BUDGET_LINKS|DOWNLOADER_NO_BUDGET_LINKS/i.test(msg)) return "NEMA_TROSKOVNIK";
  if (/NO_BUDGET_FILE/i.test(msg)) return "NO_BUDGET_FILE";
  return "FAILED";
}

async function processTender({
  outRoot,
  runDir,
  moduleDir,
  row,
  idx,
  total,
  retryCount,
  itemTimeoutMs,
  enableDownload,
  configPath,
  runId,
  jitterMinMs,
  jitterMaxMs
}) {
  const tenderId = row && row.Id ? Number(row.Id) : null;
  const attempts = retryCount + 1;
  let lastErr = null;

  for (let a = 1; a <= attempts; a += 1) {
    try {
      const jitterMs = randomIntInclusive(jitterMinMs, jitterMaxMs);
      if (jitterMs > 0) {
        await updateStatus(outRoot, {
          phase: "RUNNING",
          current_index: idx,
          current_tender_id: tenderId,
          message: `Human delay ${Math.round(jitterMs / 1000)}s before tender ${idx}/${total}`
        });
        await sleep(jitterMs);
      }

      await updateStatus(outRoot, {
        phase: "RUNNING",
        current_index: idx,
        current_tender_id: tenderId,
        message: `Downloading troskovnik ${idx}/${total} (attempt ${a}/${attempts})`
      });

      let files = findBudgetFilesForTender({ outRoot, runDir, tenderId });
      if (!files.length && enableDownload) {
        tryDownloadBudgetForTender({
          outRoot,
          moduleDir,
          tenderId,
          configPath,
          timeoutMs: itemTimeoutMs
        });
        files = findBudgetFilesForTender({ outRoot, runDir, tenderId });
      }
      if (!files.length) {
        throw new Error("NO_BUDGET_FILE");
      }

      const budgetFile = pickBestBudgetFile(files);
      const analysisOut = path.join(runDir, `layer2_analysis_${runId}_${tenderId}.json`);

      await updateStatus(outRoot, {
        phase: "RUNNING",
        current_index: idx,
        current_tender_id: tenderId,
        message: `Analyzing troskovnik ${idx}/${total} (attempt ${a}/${attempts})`
      });

      const analysis = await runBudgetAnalyzer({
        moduleDir,
        budgetFile,
        outFile: analysisOut,
        timeoutMs: itemTimeoutMs
      });

      return {
        tender_id: tenderId,
        reference_number: row.ReferenceNumber || "",
        name: row.Name || "",
        status: "DONE",
        analyzed_at: new Date().toISOString(),
        attempts: a,
        budget_file: budgetFile,
        analysis_file: analysisOut,
        label: analysis.label || "",
        incidence: Number(analysis.incidence || 0),
        total_items: Number(analysis.total_items || 0),
        hit_items: Number(analysis.hit_items || 0)
      };
    } catch (err) {
      lastErr = err;
      if (a < attempts) {
        await updateStatus(outRoot, {
          phase: "RUNNING",
          current_index: idx,
          current_tender_id: tenderId,
          message: `Retrying tender ${idx}/${total} after error: ${String(err.message || err).slice(0, 120)}`
        });
      }
    }
  }

  const kind = classifyFailure(lastErr);
  return {
    tender_id: tenderId,
    reference_number: row.ReferenceNumber || "",
    name: row.Name || "",
    status: kind,
    analyzed_at: new Date().toISOString(),
    attempts,
    error: String((lastErr && lastErr.message) || lastErr || "")
  };
}

async function runLayer2Worker({ outRoot, runDir, queueRows, cfg, runId }) {
  const selected = queueRows.slice(0, cfg.max_items);
  const total = selected.length;
  const results = [];
  const moduleDir = __dirname;
  let done = 0;
  let skipped = 0;
  let failed = 0;

  await updateStatus(outRoot, {
    active: true,
    run_id: runId,
    started_at: new Date().toISOString(),
    completed_at: null,
    phase: "RUNNING",
    message: total ? `Starting Layer 2 run: 0/${total}` : "No queue items to process.",
    current_index: 0,
    total,
    done: 0,
    skipped: 0,
    failed: 0,
    progress_pct: 0,
    current_tender_id: null,
    output_file: null
  });

  for (let i = 0; i < selected.length; i += 1) {
    const idx = i + 1;
    const row = selected[i];
    const item = await processTender({
      outRoot,
      runDir,
      moduleDir,
      row,
      idx,
      total,
      retryCount: cfg.retry_count,
      itemTimeoutMs: cfg.item_timeout_ms,
      enableDownload: cfg.enable_download,
      configPath: cfg.config_path || "",
      runId,
      jitterMinMs: cfg.human_delay_min_ms,
      jitterMaxMs: cfg.human_delay_max_ms
    });
    results.push(item);
    if (item.status === "DONE") done += 1;
    else if (item.status === "NEMA_TROSKOVNIK") skipped += 1;
    else failed += 1;

    await updateStatus(outRoot, {
      current_index: idx,
      done,
      skipped,
      failed,
      current_tender_id: null,
      message: `Processed ${idx}/${total} (done=${done}, skipped=${skipped}, failed=${failed})`
    });
  }

  const outputFile = path.join(runDir, `layer2_monitor_result_${runId}.json`);
  await fsp.writeFile(outputFile, JSON.stringify({
    run_id: runId,
    created_at: new Date().toISOString(),
    run_dir: runDir,
    config: {
      max_items: cfg.max_items,
      retry_count: cfg.retry_count,
      item_timeout_ms: cfg.item_timeout_ms,
      enable_download: cfg.enable_download,
      human_delay_min_ms: cfg.human_delay_min_ms,
      human_delay_max_ms: cfg.human_delay_max_ms
    },
    total,
    done,
    skipped,
    failed,
    results
  }, null, 2), "utf8");

  await updateStatus(outRoot, {
    active: false,
    completed_at: new Date().toISOString(),
    phase: "DONE",
    message: `Layer 2 run done (${done}/${total}, skipped=${skipped}, failed=${failed})`,
    current_tender_id: null,
    output_file: outputFile,
    current_index: total
  });
}

async function startLayer2Run(opts) {
  const cfg = normalizeStartOptions(opts);
  const outRoot = cfg.out_root || defaultOutRoot();
  const current = await loadLayer2Status({ outRoot });
  if (activeRun || current.active) {
    const hb = Date.parse(String(current.last_heartbeat_at || ""));
    const stale = Number.isFinite(hb) ? (Date.now() - hb) > STALE_ACTIVE_MS : true;
    if (!stale) {
      throw new Error("Layer 2 run is already active.");
    }
    await saveLayer2Status({
      outRoot,
      status: {
        ...current,
        active: false,
        phase: "ABORTED_STALE",
        message: "Recovered from stale active run state.",
        completed_at: new Date().toISOString()
      }
    });
  }

  const runDir = resolveRunDir(outRoot, cfg.run_date_ymd);
  const queuePath = path.join(runDir, "layer2_queue.json");
  let queueRows;
  try {
    queueRows = await readJson(queuePath);
  } catch (err) {
    if (err && err.code === "ENOENT") {
      throw new Error(`Missing layer2_queue.json in ${runDir}. Run Layer 1 first for that date.`);
    }
    throw err;
  }
  if (!Array.isArray(queueRows)) {
    throw new Error(`Invalid layer2_queue.json in ${runDir}`);
  }

  const runId = crypto.randomUUID();
  activeRun = { runId, outRoot };

  await saveLayer2Status({
    outRoot,
    status: {
      active: true,
      run_id: runId,
      started_at: new Date().toISOString(),
      completed_at: null,
      phase: "STARTING",
      message: "Layer 2 run is starting...",
      current_index: 0,
      total: Math.min(queueRows.length, cfg.max_items),
      done: 0,
      skipped: 0,
      failed: 0,
      progress_pct: 0,
      current_tender_id: null,
      last_heartbeat_at: new Date().toISOString(),
      output_file: null
    }
  });

  runLayer2Worker({
    outRoot,
    runDir,
    queueRows,
    cfg,
    runId
  }).finally(() => {
    activeRun = null;
  });

  return {
    ok: true,
    started: true,
    run_id: runId,
    run_dir: runDir,
    queue_total: queueRows.length,
    queue_selected: Math.min(queueRows.length, cfg.max_items),
    config: {
      retry_count: cfg.retry_count,
      item_timeout_ms: cfg.item_timeout_ms,
      enable_download: cfg.enable_download,
      human_delay_min_ms: cfg.human_delay_min_ms,
      human_delay_max_ms: cfg.human_delay_max_ms
    }
  };
}

async function getLayer2RunStatus(opts) {
  const outRoot = opts && opts.out_root ? String(opts.out_root) : defaultOutRoot();
  const status = await loadLayer2Status({ outRoot });
  return { ...status, out_root: outRoot };
}

module.exports = {
  startLayer2Run,
  getLayer2RunStatus
};
