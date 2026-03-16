"use strict";

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const crypto = require("crypto");
const { spawnSync, spawn } = require("child_process");
const {
  defaultOutRoot,
  loadLayer2Status,
  saveLayer2Status,
  saveLayer2Result,
  loadLatestLayer2Result
} = require("../../core_shell/services/eojn_layer2_store");
const {
  loadCanonicalStateArtifacts,
  mergeCanonicalStateArtifacts
} = require("../../core_shell/services/eojn_layer1_store");
const {
  getReviewDecisionsForRun,
  getLatestReviewDecisionsByTender
} = require("../../core_shell/services/eojn_review_store");
const { loadActiveCycle, saveActiveCycle } = require("../../core_shell/services/eojn_layer1_store");
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

async function readQueueCount(runDir) {
  try {
    const p = path.join(runDir, "layer2_queue.json");
    if (!fs.existsSync(p)) return 0;
    const rows = await readJson(p);
    return Array.isArray(rows) ? rows.length : 0;
  } catch (_) {
    return 0;
  }
}

async function findLatestNonEmptyQueueRunDir(outRoot) {
  const all = listRunFolders(outRoot);
  if (!all.length) return "";
  const todayTag = ymdTodayLocal().replace(/-/g, "_");
  const eligible = all.filter((d) => d <= todayTag).sort().reverse();
  for (const d of eligible) {
    const runDir = path.join(outRoot, d);
    const q = await readQueueCount(runDir);
    if (q > 0) return runDir;
  }
  return "";
}

async function resolveRunDirForLayer2(outRoot, runDateYmd) {
  if (runDateYmd) {
    return resolveRunDir(outRoot, runDateYmd);
  }
  const activeCycle = await loadActiveCycle({ outRoot });
  const activeDate = String(activeCycle && activeCycle.run_date_ymd ? activeCycle.run_date_ymd : "").trim();
  if (activeDate) {
    try {
      const activeDir = resolveRunDir(outRoot, activeDate);
      const activeQueue = await readQueueCount(activeDir);
      if (activeQueue > 0) return activeDir;
    } catch (_) {
      // fallback below
    }
  }
  const nonEmpty = await findLatestNonEmptyQueueRunDir(outRoot);
  if (nonEmpty) return nonEmpty;
  return resolveRunDir(outRoot, "");
}

function parseIsoTs(value) {
  const t = Date.parse(String(value || ""));
  return Number.isFinite(t) ? t : 0;
}

function normalizeDocShort(v) {
  return String(v || "").replace(/\s+/g, "").toUpperCase();
}

function buildNoticesByTender(noticesRows) {
  const map = new Map();
  for (const n of noticesRows || []) {
    const tenderId = Number(n && (n.TenderId || n.TenderID || n.ProcurementId));
    if (!Number.isFinite(tenderId)) continue;
    if (!map.has(tenderId)) map.set(tenderId, []);
    map.get(tenderId).push(n);
  }
  for (const [k, arr] of map.entries()) {
    map.set(k, arr.sort((a, b) => parseIsoTs(b.PublishDate || b.NoticePublishDate) - parseIsoTs(a.PublishDate || a.NoticePublishDate)));
  }
  return map;
}

function summarizeTenderNotices(notices) {
  const rows = Array.isArray(notices) ? notices : [];
  let hasF14 = false;
  let hasF03 = false;
  for (const n of rows) {
    const docId = Number(n && n.DocumentTypeId);
    const short = normalizeDocShort(n && n.DocumentTypeShortName);
    if (docId === 9 || short.startsWith("F14")) hasF14 = true;
    if (docId === 11 || short.startsWith("F03")) hasF03 = true;
  }
  const latest = rows[0] || null;
  let watchlistGate = "REVIEW_DEFAULT";
  if (hasF03) watchlistGate = "CLOSED_NO_ACTION";
  else if (hasF14) watchlistGate = "REVIEW_WITH_UPDATES";
  return {
    notices_count: rows.length,
    has_f14: hasF14,
    has_f03: hasF03,
    latest_notice_id: latest ? (latest.Id || null) : null,
    latest_publish_date: latest ? (latest.PublishDate || latest.NoticePublishDate || null) : null,
    watchlist_gate: watchlistGate
  };
}

async function buildResultByTender(runDir) {
  const latest = await loadLatestLayer2Result({ runDir });
  const json = latest && latest.payload ? latest.payload : null;
  const rows = Array.isArray(json && json.results) ? json.results : [];
  const map = new Map();
  for (const r of rows) {
    const id = Number(r && r.tender_id);
    if (!Number.isFinite(id)) continue;
    map.set(id, r);
  }
  return map;
}

function buildNoticesByTenderFromHistory(noticeHistoryRows) {
  const map = new Map();
  for (const n of noticeHistoryRows || []) {
    const tenderId = Number(n && n.TenderId);
    if (!Number.isFinite(tenderId)) continue;
    if (!map.has(tenderId)) map.set(tenderId, []);
    map.get(tenderId).push({
      id: null,
      tender_id: tenderId,
      publish_date: n.PublishDate || "",
      doc_short: "",
      doc_name: n.DocumentTypeName || "",
      notice_number: n.NoticeNumber || "",
      modification_description: n.ModificationDescription || "",
      document_type_id: n.DocumentTypeId || null
    });
  }
  for (const [key, arr] of map.entries()) {
    map.set(key, arr.sort((a, b) => parseIsoTs(b.publish_date) - parseIsoTs(a.publish_date)));
  }
  return map;
}

function normalizeStartOptions(opts) {
  const input = opts && typeof opts === "object" ? opts : {};
  const cap = Number(input.max_items === undefined ? 15 : input.max_items);
  const retry = Number(input.retry_count === undefined ? 1 : input.retry_count);
  const itemTimeoutMs = Number(input.item_timeout_ms === undefined ? 300000 : input.item_timeout_ms);
  const delayMin = Number(input.human_delay_min_ms === undefined ? 0 : input.human_delay_min_ms);
  const delayMax = Number(input.human_delay_max_ms === undefined ? 5000 : input.human_delay_max_ms);
  const minMs = Number.isFinite(delayMin) && delayMin >= 0 ? Math.floor(delayMin) : 0;
  const maxMs = Number.isFinite(delayMax) && delayMax >= minMs ? Math.floor(delayMax) : Math.max(minMs, 5000);
  const tenderIds = Array.isArray(input.tender_ids)
    ? input.tender_ids.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0)
    : [];
  return {
    out_root: input.out_root ? String(input.out_root) : "",
    run_date_ymd: input.run_date_ymd ? String(input.run_date_ymd) : "",
    max_items: Number.isFinite(cap) && cap > 0 ? Math.floor(cap) : 15,
    retry_count: Number.isFinite(retry) && retry >= 0 ? Math.floor(retry) : 1,
    item_timeout_ms: Number.isFinite(itemTimeoutMs) && itemTimeoutMs > 1000 ? Math.floor(itemTimeoutMs) : 300000,
    enable_download: Boolean(input.enable_download),
    config_path: input.config_path ? String(input.config_path) : "",
    human_delay_min_ms: minMs,
    human_delay_max_ms: maxMs,
    tender_ids: Array.from(new Set(tenderIds)),
    force_reprocess: Boolean(input.force_reprocess)
  };
}

function filterQueueByTenderIds(queueRows, tenderIds) {
  return Array.isArray(tenderIds) && tenderIds.length
    ? queueRows.filter((row) => tenderIds.includes(Number(row && row.Id)))
    : queueRows;
}

function canonicalLatestRowToQueueRow(row) {
  return {
    Id: Number(row && row.TenderId),
    ReferenceNumber: row && row.Reference ? String(row.Reference) : "",
    Name: row && row.Name ? String(row.Name) : "",
    topProgram: row && row.L1TopProgram ? String(row.L1TopProgram) : "",
    topScore: Number(row && row.L1Score || 0),
    SourceRunDate: row && row.SourceRunDate ? String(row.SourceRunDate) : ""
  };
}

function canonicalNoticeHistoryRowToNoticeRow(row) {
  return {
    TenderId: Number(row && row.TenderId),
    PublishDate: row && row.PublishDate ? String(row.PublishDate) : "",
    DocumentTypeId: Number(row && row.DocumentTypeId || 0),
    DocumentTypeShortName: "",
    DocumentTypeName: row && row.DocumentTypeName ? String(row.DocumentTypeName) : "",
    NoticeNumber: row && row.NoticeNumber ? String(row.NoticeNumber) : "",
    ModificationDescription: row && row.ModificationDescription ? String(row.ModificationDescription) : ""
  };
}

function shouldProcessCanonicalLatestRow(row) {
  const status = String(row && row.L2Status ? row.L2Status : "PENDING").trim().toUpperCase();
  return !status || status === "PENDING" || status === "FAILED" || status === "TIMEOUT" || status === "EXTRACT_FAILED" || status === "LOGIN_FAILED" || status === "CONFIG_FAILED";
}

async function buildCanonicalStartRows({ outRoot, cfg }) {
  const canonical = await loadCanonicalStateArtifacts({ outRoot });
  const latestRows = Array.isArray(canonical.tender_latest_rows) ? canonical.tender_latest_rows : [];
  const noticeHistoryRows = Array.isArray(canonical.tender_notice_history_rows) ? canonical.tender_notice_history_rows : [];
  const latestReviewByTender = await getLatestReviewDecisionsByTender({ outRoot });

  let queueRows = latestRows
    .map(canonicalLatestRowToQueueRow)
    .filter((row) => Number.isFinite(Number(row && row.Id)) && Number(row.Id) > 0);
  queueRows = filterQueueByTenderIds(queueRows, cfg.tender_ids);

  let skippedReviewed = 0;
  if (!cfg.force_reprocess) {
    const latestByTender = new Map(latestRows.map((row) => [Number(row && row.TenderId), row]));
    const filtered = [];
    for (const row of queueRows) {
      const tenderId = Number(row && row.Id);
      const review = latestReviewByTender[String(tenderId)] || null;
      if (review && String(review.decision_code || "").trim()) {
        skippedReviewed += 1;
        continue;
      }
      const latest = latestByTender.get(tenderId) || null;
      if (latest && !shouldProcessCanonicalLatestRow(latest)) {
        continue;
      }
      filtered.push(row);
    }
    queueRows = filtered;
  }

  const noticesByTender = new Map();
  for (const row of noticeHistoryRows) {
    const tenderId = Number(row && row.TenderId);
    if (!Number.isFinite(tenderId)) continue;
    if (!noticesByTender.has(tenderId)) noticesByTender.set(tenderId, []);
    noticesByTender.get(tenderId).push(canonicalNoticeHistoryRowToNoticeRow(row));
  }
  for (const [key, arr] of noticesByTender.entries()) {
    noticesByTender.set(key, arr.sort((a, b) => parseIsoTs(b.PublishDate || b.NoticePublishDate) - parseIsoTs(a.PublishDate || a.NoticePublishDate)));
  }

  return {
    queueRows,
    skippedReviewed,
    noticesByTender
  };
}

function applyLayer2ResultsToLatestRows(latestRows, results) {
  const currentRows = Array.isArray(latestRows) ? latestRows : [];
  const resultMap = new Map(
    (Array.isArray(results) ? results : [])
      .filter((row) => Number.isFinite(Number(row && row.tender_id)))
      .map((row) => [Number(row.tender_id), row])
  );
  return currentRows
    .filter((row) => resultMap.has(Number(row && row.TenderId)))
    .map((row) => {
      const result = resultMap.get(Number(row && row.TenderId));
      const hitItems = Number(result && result.hit_items || 0);
      const keywordHits = Number(result && result.total_keyword_hits || 0);
      return {
        ...row,
        L2Status: String(result && result.status || row.L2Status || "PENDING").trim(),
        L2Label: String(result && result.label || row.L2Label || "").trim(),
        L2Incidence: result && result.incidence !== undefined ? Number(result.incidence || 0) : row.L2Incidence,
        L2ItemCount: result && result.total_items !== undefined ? Number(result.total_items || 0) : row.L2ItemCount,
        L2HitItems: result && result.hit_items !== undefined ? Number(result.hit_items || 0) : row.L2HitItems,
        L2Intensity: hitItems > 0 ? Number((keywordHits / hitItems).toFixed(4)) : row.L2Intensity,
        L2MaxSheet: String(result && result.max_sheet || row.L2MaxSheet || "").trim(),
        LifecycleGate: String(result && result.watchlist_gate || row.LifecycleGate || "").trim(),
        UpdatedAt: new Date().toISOString()
      };
    });
}

async function syncCanonicalLatestAfterLayer2({ outRoot, results }) {
  const canonical = await loadCanonicalStateArtifacts({ outRoot });
  const latestRows = Array.isArray(canonical.tender_latest_rows) ? canonical.tender_latest_rows : [];
  const updatedLatestRows = applyLayer2ResultsToLatestRows(latestRows, results);
  if (!updatedLatestRows.length) return 0;
  await mergeCanonicalStateArtifacts({
    outRoot,
    tenderLatestRows: updatedLatestRows,
    tenderNoticeHistoryRows: [],
    reviewDecisionHistoryRows: []
  });
  return updatedLatestRows.length;
}

function resolveReviewForTender(reviewDecisionsForRun, latestReviewByTender, runDateYmd, tenderId) {
  const runKey = `${String(runDateYmd || "").trim()}|${Number(tenderId || 0)}`;
  return reviewDecisionsForRun[runKey] || latestReviewByTender[String(Number(tenderId || 0))] || null;
}

function filterQueueByReviewState(queueRows, reviewDecisionsForRun, latestReviewByTender, runDateYmd, forceReprocess) {
  if (forceReprocess) {
    return {
      rows: queueRows,
      skipped_reviewed: 0
    };
  }
  const rows = [];
  let skippedReviewed = 0;
  for (const row of queueRows) {
    const tenderId = Number(row && row.Id);
    const review = resolveReviewForTender(reviewDecisionsForRun, latestReviewByTender, runDateYmd, tenderId);
    if (review && String(review.decision_code || "").trim()) {
      skippedReviewed += 1;
      continue;
    }
    rows.push(row);
  }
  return {
    rows,
    skipped_reviewed: skippedReviewed
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

function summarizeScriptOutput(stdout, stderr) {
  const merged = String(stderr || stdout || "");
  const head = merged.slice(0, 300);
  const tail = merged.length > 900 ? merged.slice(-900) : merged;
  return `${head}${merged.length > 900 ? "\n...\n" : "\n"}${tail}` || "";
}

async function runNodeScriptMonitored(scriptPath, args, timeoutMs, hooks) {
  return await new Promise((resolve, reject) => {
    const child = spawn("node", [scriptPath, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    let finished = false;
    let timeoutHandle = null;
    let heartbeatHandle = null;
    let stdoutRemainder = "";
    let stderrRemainder = "";

    const finish = (fn, value) => {
      if (finished) return;
      finished = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (heartbeatHandle) clearInterval(heartbeatHandle);
      fn(value);
    };

    const emitLine = (kind, line) => {
      if (!hooks || typeof hooks.onLine !== "function") return;
      Promise.resolve(hooks.onLine({ kind, line })).catch(() => {});
    };

    const flushChunk = (kind, chunk, remainder) => {
      const merged = remainder + String(chunk || "");
      const parts = merged.split(/\r?\n/);
      const rest = parts.pop() || "";
      for (const part of parts) {
        const line = String(part || "").trim();
        if (line) emitLine(kind, line);
      }
      return rest;
    };

    child.stdout.on("data", (chunk) => {
      const text = String(chunk || "");
      stdout += text;
      stdoutRemainder = flushChunk("stdout", text, stdoutRemainder);
    });
    child.stderr.on("data", (chunk) => {
      const text = String(chunk || "");
      stderr += text;
      stderrRemainder = flushChunk("stderr", text, stderrRemainder);
    });
    child.on("error", (err) => finish(reject, err));
    child.on("close", (code) => {
      if (stdoutRemainder.trim()) emitLine("stdout", stdoutRemainder.trim());
      if (stderrRemainder.trim()) emitLine("stderr", stderrRemainder.trim());
      if (code !== 0) {
        const e = new Error(summarizeScriptOutput(stdout, stderr) || `Exit code ${code}`);
        e.code = "SCRIPT_FAILED";
        return finish(reject, e);
      }
      return finish(resolve, { status: code, stdout, stderr });
    });

    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        try { child.kill(); } catch (_) {}
        const e = new Error(`Timed out after ${timeoutMs}ms`);
        e.code = "TIMEOUT";
        finish(reject, e);
      }, timeoutMs);
    }

    if (hooks && typeof hooks.onHeartbeat === "function") {
      const startedAt = Date.now();
      const hbMs = Number(hooks.heartbeatMs) > 0 ? Number(hooks.heartbeatMs) : 4000;
      heartbeatHandle = setInterval(() => {
        Promise.resolve(hooks.onHeartbeat({ elapsedMs: Date.now() - startedAt })).catch(() => {});
      }, hbMs);
    }
  });
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

function safeFolderName(input) {
  return String(input || "")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "archive";
}

function runPowerShellExpandZip(zipPath, destDir) {
  const command = [
    "$ErrorActionPreference='Stop'",
    `$zip='${String(zipPath).replace(/'/g, "''")}'`,
    `$dest='${String(destDir).replace(/'/g, "''")}'`,
    "[System.IO.Directory]::CreateDirectory($dest) | Out-Null",
    "Expand-Archive -LiteralPath $zip -DestinationPath $dest -Force"
  ].join("; ");
  const out = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], {
    encoding: "utf8",
    timeout: 120000,
    maxBuffer: 20 * 1024 * 1024
  });
  if (out.status !== 0) {
    const message = String(out.stderr || out.stdout || "ZIP extraction failed");
    throw new Error(`ZIP_EXTRACT_FAILED: ${message}`);
  }
}

function extractNestedZipTree(rootDir, maxDepth = 4) {
  const queue = [{
    dir: rootDir,
    depth: 0
  }];
  const extractedDirs = [];
  const seenZipTargets = new Set();

  while (queue.length) {
    const current = queue.shift();
    if (!current || current.depth > maxDepth) continue;
    const zipFiles = findFilesRecursive(current.dir, (p) => /\.zip$/i.test(p), []);
    for (const zipPath of zipFiles) {
      const zipKey = path.resolve(zipPath);
      if (seenZipTargets.has(zipKey)) continue;
      seenZipTargets.add(zipKey);
      const destDir = path.join(path.dirname(zipPath), `_extracted_${safeFolderName(path.basename(zipPath, path.extname(zipPath)))}`);
      runPowerShellExpandZip(zipPath, destDir);
      extractedDirs.push(destDir);
      queue.push({ dir: destDir, depth: current.depth + 1 });
    }
  }

  return extractedDirs;
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

function findBudgetArchivesForTender({ outRoot, runDir, tenderId }) {
  const matcher = (p) => /\.zip$/i.test(p);
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

async function extractBudgetArchivesForTender({ outRoot, runDir, tenderId }) {
  const archives = findBudgetArchivesForTender({ outRoot, runDir, tenderId });
  if (!archives.length) return [];
  const extracted = [];
  for (const archivePath of archives) {
    try {
      extracted.push(...extractNestedZipTree(path.dirname(archivePath)));
    } catch (_) {
      // Do not fail the tender here; fallback remains NO_BUDGET_FILE if no workbook appears.
    }
  }
  return extracted;
}

async function tryDownloadBudgetForTender({ outRoot, moduleDir, tenderId, configPath, timeoutMs, onProgress }) {
  const resolvedConfigPath = resolveEojnConfigPath({ configPathOverride: configPath });
  const downloader = path.join(moduleDir, "dev_pw_download_budget.js");
  try {
    await runNodeScriptMonitored(
      downloader,
      [`--config=${resolvedConfigPath}`, `--tender=${tenderId}`, "--fresh=0", "--headed=0"],
      timeoutMs,
      {
        heartbeatMs: 4000,
        onHeartbeat: ({ elapsedMs }) => onProgress && onProgress({
          stage: "download_wait",
          message: `Downloading tender ${tenderId}... ${Math.round(elapsedMs / 1000)}s`
        }),
        onLine: ({ line }) => {
          if (!onProgress) return;
          if (/Opening:/i.test(line)) {
            onProgress({ stage: "contacting_eojn", message: `Contacting EOJN for tender ${tenderId}` });
            return;
          }
          if (/budget candidates:/i.test(line)) {
            onProgress({ stage: "budget_links_found", message: `Budget links discovered for tender ${tenderId}` });
            return;
          }
          if (/Tender .* downloading /i.test(line)) {
            onProgress({
              stage: "downloading_budget",
              message: line.replace(/^\[EOJN\]\[PW\]\[[A-Z]+\]\s*/, "")
            });
            return;
          }
          if (/BATCH DONE/i.test(line)) {
            onProgress({ stage: "download_done", message: `Download phase finished for tender ${tenderId}` });
          }
        }
      }
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

async function runBudgetAnalyzer({ moduleDir, budgetFile, outFile, timeoutMs, onProgress }) {
  const scanner = path.join(moduleDir, "layer2_budget_scan.js");
  await runNodeScriptMonitored(scanner, [`--file=${budgetFile}`, `--out=${outFile}`], timeoutMs, {
    heartbeatMs: 4000,
    onHeartbeat: ({ elapsedMs }) => onProgress && onProgress({
      stage: "analyzing_incidence",
      message: `Calculating incidence for ${path.basename(budgetFile)}... ${Math.round(elapsedMs / 1000)}s`
    })
  });
  return readJson(outFile);
}

function randomIntInclusive(min, max) {
  if (max <= min) return min;
  return min + Math.floor(Math.random() * (max - min + 1));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sleepWithCountdown(ms, onTick) {
  let remaining = Number(ms || 0);
  if (!(remaining > 0)) return;
  while (remaining > 0) {
    const step = Math.min(1000, remaining);
    await sleep(step);
    remaining -= step;
    if (typeof onTick === "function") {
      await onTick({
        remainingMs: remaining,
        remainingSec: Math.ceil(Math.max(0, remaining) / 1000)
      });
    }
  }
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
  jitterMaxMs,
  noticesForTender
}) {
  const tenderId = row && row.Id ? Number(row.Id) : null;
  const attempts = retryCount + 1;
  let lastErr = null;
  const tenderNotices = Array.isArray(noticesForTender) ? noticesForTender : [];
  const noticeSummary = summarizeTenderNotices(tenderNotices);

  for (let a = 1; a <= attempts; a += 1) {
    try {
      const jitterMs = randomIntInclusive(jitterMinMs, jitterMaxMs);
      if (jitterMs > 0) {
        await updateStatus(outRoot, {
          phase: "RUNNING",
          subphase: "HUMAN_DELAY",
          current_index: idx,
          current_tender_id: tenderId,
          message: `Human delay ${Math.round(jitterMs / 1000)}s before tender ${idx}/${total}`
        });
        await sleepWithCountdown(jitterMs, async ({ remainingSec }) => {
          await updateStatus(outRoot, {
            phase: "RUNNING",
            subphase: "HUMAN_DELAY",
            current_index: idx,
            current_tender_id: tenderId,
            message: `Human delay ${remainingSec}s before tender ${idx}/${total}`
          });
        });
      }

      await updateStatus(outRoot, {
        phase: "RUNNING",
        subphase: "PREPARING_TENDER",
        current_index: idx,
        current_tender_id: tenderId,
        message: `Preparing tender ${tenderId} (${idx}/${total}, attempt ${a}/${attempts})`
      });

      await extractBudgetArchivesForTender({ outRoot, runDir, tenderId });
      let files = findBudgetFilesForTender({ outRoot, runDir, tenderId });
      if (!files.length && enableDownload) {
        await updateStatus(outRoot, {
          phase: "RUNNING",
          subphase: "CONTACTING_EOJN",
          current_index: idx,
          current_tender_id: tenderId,
          message: `Contacting EOJN for tender ${tenderId} (${idx}/${total})`
        });
        await tryDownloadBudgetForTender({
          outRoot,
          moduleDir,
          tenderId,
          configPath,
          timeoutMs: itemTimeoutMs,
          onProgress: async ({ stage, message }) => {
            await updateStatus(outRoot, {
              phase: "RUNNING",
              subphase: String(stage || "DOWNLOADING_BUDGET").toUpperCase(),
              current_index: idx,
              current_tender_id: tenderId,
              message: `${message} (${idx}/${total})`
            });
          }
        });
        await extractBudgetArchivesForTender({ outRoot, runDir, tenderId });
        files = findBudgetFilesForTender({ outRoot, runDir, tenderId });
      }
      if (!files.length) {
        throw new Error("NO_BUDGET_FILE");
      }

      const budgetFile = pickBestBudgetFile(files);
      const analysisOut = path.join(runDir, `layer2_analysis_${runId}_${tenderId}.json`);

      await updateStatus(outRoot, {
        phase: "RUNNING",
        subphase: "ANALYZING_INCIDENCE",
        current_index: idx,
        current_tender_id: tenderId,
        message: `Calculating incidence for tender ${tenderId} (${idx}/${total}, attempt ${a}/${attempts})`
      });

      const analysis = await runBudgetAnalyzer({
        moduleDir,
        budgetFile,
        outFile: analysisOut,
        timeoutMs: itemTimeoutMs,
        onProgress: async ({ stage, message }) => {
          await updateStatus(outRoot, {
            phase: "RUNNING",
            subphase: String(stage || "ANALYZING_INCIDENCE").toUpperCase(),
            current_index: idx,
            current_tender_id: tenderId,
            message: `${message} (${idx}/${total})`
          });
        }
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
        hit_items: Number(analysis.hit_items || 0),
        total_keyword_hits: Number(analysis.total_keyword_hits || 0),
        max_sheet: String(analysis.max_sheet || ""),
        notice_summary: noticeSummary,
        tender_notices: tenderNotices,
        watchlist_gate: noticeSummary.watchlist_gate
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
    error: String((lastErr && lastErr.message) || lastErr || ""),
    notice_summary: noticeSummary,
    tender_notices: tenderNotices,
    watchlist_gate: noticeSummary.watchlist_gate
  };
}

async function runLayer2Worker({ outRoot, runDir, queueRows, cfg, runId }) {
  const runDateYmd = path.basename(runDir).replace(/_/g, "-");
  const skipReviewFilter = Boolean(cfg.skip_review_filter);
  let selected = [];
  let skippedReviewed = 0;
  if (skipReviewFilter) {
    selected = (Array.isArray(queueRows) ? queueRows : []).slice(0, cfg.max_items);
    skippedReviewed = Number(cfg.review_skipped_count || 0);
  } else {
    const reviewDecisions = await getReviewDecisionsForRun({ outRoot, runDateYmd });
    const latestReviewByTender = await getLatestReviewDecisionsByTender({ outRoot });
    const requestedQueue = filterQueueByTenderIds(queueRows, cfg.tender_ids);
    const reviewFiltered = filterQueueByReviewState(requestedQueue, reviewDecisions, latestReviewByTender, runDateYmd, cfg.force_reprocess);
    selected = reviewFiltered.rows.slice(0, cfg.max_items);
    skippedReviewed = reviewFiltered.skipped_reviewed;
  }
  const total = selected.length;
  const results = [];
  const moduleDir = __dirname;
  let noticesByTender = cfg.notices_by_tender instanceof Map ? cfg.notices_by_tender : null;
  if (!noticesByTender) {
    let noticesRows = [];
    try {
      const noticesPath = path.join(runDir, "notices_raw.json");
      if (fs.existsSync(noticesPath)) {
        const loaded = await readJson(noticesPath);
        noticesRows = Array.isArray(loaded) ? loaded : [];
      }
    } catch (_) {
      noticesRows = [];
    }
    noticesByTender = buildNoticesByTender(noticesRows);
  }
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
    reviewed: skippedReviewed,
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
      jitterMaxMs: cfg.human_delay_max_ms,
      noticesForTender: noticesByTender.get(Number(row && row.Id)) || []
    });
    results.push(item);
    if (item.status === "DONE") done += 1;
    else if (item.status === "NEMA_TROSKOVNIK") skipped += 1;
    else failed += 1;

    await updateStatus(outRoot, {
      current_index: idx,
      done,
      skipped,
      reviewed: skippedReviewed,
      failed,
      current_tender_id: null,
      message: `Processed ${idx}/${total} (done=${done}, skipped=${skipped}, failed=${failed})`
    });
  }

  const outputPayload = {
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
  };
  const outputFile = await saveLayer2Result({
    runDir,
    runId,
    result: outputPayload
  });
  try {
    await syncCanonicalLatestAfterLayer2({ outRoot, results });
  } catch (_) {
    // Keep Layer 2 result persisted even if canonical latest sync fails.
  }

  await updateStatus(outRoot, {
    active: false,
    completed_at: new Date().toISOString(),
    phase: "DONE",
    message: `Layer 2 run done (${done}/${total}, skipped=${skipped}, reviewed=${skippedReviewed}, failed=${failed})`,
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

  const runDir = await resolveRunDirForLayer2(outRoot, cfg.run_date_ymd);
  let queueRows = [];
  let skippedReviewed = 0;
  let noticesByTender = null;
  let queueSource = "legacy_queue";
  if (!cfg.run_date_ymd) {
    const canonicalStart = await buildCanonicalStartRows({ outRoot, cfg });
    queueRows = canonicalStart.queueRows;
    skippedReviewed = canonicalStart.skippedReviewed;
    noticesByTender = canonicalStart.noticesByTender;
    queueSource = "canonical_state";
  } else {
    const queuePath = path.join(runDir, "layer2_queue.json");
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
    const runDateYmd = path.basename(runDir).replace(/_/g, "-");
    const reviewDecisions = await getReviewDecisionsForRun({ outRoot, runDateYmd });
    const latestReviewByTender = await getLatestReviewDecisionsByTender({ outRoot });
    const requestedQueue = filterQueueByTenderIds(queueRows, cfg.tender_ids);
    const reviewFiltered = filterQueueByReviewState(requestedQueue, reviewDecisions, latestReviewByTender, runDateYmd, cfg.force_reprocess);
    queueRows = reviewFiltered.rows;
    skippedReviewed = reviewFiltered.skipped_reviewed;
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
      message: `Layer 2 run is starting from ${queueSource}...`,
      current_index: 0,
      total: Math.min(queueRows.length, cfg.max_items),
      done: 0,
      skipped: 0,
      reviewed: skippedReviewed,
      failed: 0,
      progress_pct: 0,
      current_tender_id: null,
      last_heartbeat_at: new Date().toISOString(),
      output_file: null
    }
  });
  try {
    const prevCycle = await loadActiveCycle({ outRoot });
    await saveActiveCycle({
      outRoot,
      activeCycle: {
        ...(prevCycle || {}),
        run_date_ymd: cfg.run_date_ymd || path.basename(runDir).replace(/_/g, "-"),
        out_dir: runDir,
        layer2_run: {
          run_id: runId,
          started_at: new Date().toISOString(),
          status: "STARTING"
        }
      }
    });
  } catch (_) {
    // non-blocking for Layer 2 start
  }

  runLayer2Worker({
    outRoot,
    runDir,
    queueRows,
    cfg: {
      ...cfg,
      skip_review_filter: !cfg.run_date_ymd,
      review_skipped_count: skippedReviewed,
      notices_by_tender: noticesByTender
    },
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
    queue_skipped_reviewed: skippedReviewed,
    queue_source: queueSource,
    config: {
      retry_count: cfg.retry_count,
      item_timeout_ms: cfg.item_timeout_ms,
      enable_download: cfg.enable_download,
      human_delay_min_ms: cfg.human_delay_min_ms,
      human_delay_max_ms: cfg.human_delay_max_ms,
      tender_ids: cfg.tender_ids,
      force_reprocess: cfg.force_reprocess
    }
  };
}

async function getLayer2RunStatus(opts) {
  const outRoot = opts && opts.out_root ? String(opts.out_root) : defaultOutRoot();
  const status = await loadLayer2Status({ outRoot });
  return { ...status, out_root: outRoot };
}

async function getLayer2ViewData(opts) {
  const outRoot = opts && opts.out_root ? String(opts.out_root) : defaultOutRoot();
  const requestedRunDateYmd = opts && opts.run_date_ymd ? String(opts.run_date_ymd) : "";
  if (!requestedRunDateYmd) {
    const canonical = await loadCanonicalStateArtifacts({ outRoot });
    const latestRows = Array.isArray(canonical.tender_latest_rows) ? canonical.tender_latest_rows : [];
    const noticeHistoryRows = Array.isArray(canonical.tender_notice_history_rows) ? canonical.tender_notice_history_rows : [];
    const noticesByTender = buildNoticesByTenderFromHistory(noticeHistoryRows);
    const rows = latestRows.map((r) => {
      const tenderId = Number(r && r.TenderId);
      const notices = noticesByTender.get(tenderId) || [];
      const lifecycle = summarizeTenderNotices(notices.map((n) => ({
        TenderId: n.tender_id,
        PublishDate: n.publish_date,
        DocumentTypeId: n.document_type_id,
        DocumentTypeShortName: n.doc_short
      })));
      return {
        tender_id: tenderId,
        reference_number: r.Reference || "",
        name: r.Name || "",
        top_program: r.L1TopProgram || "",
        top_score: Number(r.L1Score || 0),
        reasons: [],
        watchlist_gate: r.LifecycleGate || lifecycle.watchlist_gate || "",
        lifecycle,
        layer2_status: r.L2Status || "PENDING",
        layer2_label: r.L2Label || "",
        layer2_incidence: r.L2Incidence === null || r.L2Incidence === undefined ? null : Number(r.L2Incidence),
        review_decision: r.Decision || "",
        review_reason_code: r.ReasonCode || "",
        review_reason_note: "",
        review_updated_at: r.DecisionUpdatedAt || "",
        notices,
        source_run_date: r.SourceRunDate || ""
      };
    });
    return {
      run_dir: "",
      run_date_ymd: "",
      queue_total: rows.length,
      source: "canonical_state",
      rows
    };
  }
  const runDir = await resolveRunDirForLayer2(outRoot, requestedRunDateYmd);
  const runDateYmd = path.basename(runDir).replace(/_/g, "-");
  const tenderLatestPath = path.join(runDir, "tender_latest.json");
  const tenderNoticeHistoryPath = path.join(runDir, "tender_notice_history.json");
  if (fs.existsSync(tenderLatestPath) && fs.existsSync(tenderNoticeHistoryPath)) {
    const latestRows = await readJson(tenderLatestPath);
    const noticeHistoryRows = await readJson(tenderNoticeHistoryPath);
    const noticesByTender = buildNoticesByTenderFromHistory(Array.isArray(noticeHistoryRows) ? noticeHistoryRows : []);
    const rows = (Array.isArray(latestRows) ? latestRows : []).map((r) => {
      const tenderId = Number(r && r.TenderId);
      const notices = noticesByTender.get(tenderId) || [];
      const lifecycle = summarizeTenderNotices(notices.map((n) => ({
        TenderId: n.tender_id,
        PublishDate: n.publish_date,
        DocumentTypeId: n.document_type_id,
        DocumentTypeShortName: n.doc_short
      })));
      return {
        tender_id: tenderId,
        reference_number: r.Reference || "",
        name: r.Name || "",
        top_program: r.L1TopProgram || "",
        top_score: Number(r.L1Score || 0),
        reasons: [],
        watchlist_gate: r.LifecycleGate || lifecycle.watchlist_gate || "",
        lifecycle,
        layer2_status: r.L2Status || "PENDING",
        layer2_label: r.L2Label || "",
        layer2_incidence: r.L2Incidence === null || r.L2Incidence === undefined ? null : Number(r.L2Incidence),
        review_decision: r.Decision || "",
        review_reason_code: r.ReasonCode || "",
        review_reason_note: "",
        review_updated_at: r.DecisionUpdatedAt || "",
        notices,
        source_run_date: r.SourceRunDate || ""
      };
    });
    return {
      run_dir: runDir,
      run_date_ymd: runDateYmd,
      queue_total: rows.length,
      source: "run_canonical",
      rows
    };
  }
  const queuePath = path.join(runDir, "layer2_queue.json");
  const noticesPath = path.join(runDir, "notices_raw.json");
  const queueRows = fs.existsSync(queuePath) ? await readJson(queuePath) : [];
  const noticesRows = fs.existsSync(noticesPath) ? await readJson(noticesPath) : [];
  const noticesByTender = buildNoticesByTender(Array.isArray(noticesRows) ? noticesRows : []);
  const resultByTender = await buildResultByTender(runDir);
  const reviewDecisions = await getReviewDecisionsForRun({ outRoot, runDateYmd });
  const latestReviewByTender = await getLatestReviewDecisionsByTender({ outRoot });

  const rows = (Array.isArray(queueRows) ? queueRows : []).map((q) => {
    const tenderId = Number(q && q.Id);
    const review = resolveReviewForTender(reviewDecisions, latestReviewByTender, runDateYmd, tenderId);
    const tn = noticesByTender.get(tenderId) || [];
    const summary = summarizeTenderNotices(tn);
    const rr = resultByTender.get(tenderId) || null;
    return {
      tender_id: tenderId,
      reference_number: q.ReferenceNumber || "",
      name: q.Name || "",
      top_program: q.topProgram || "",
      top_score: Number(q.topScore || 0),
      reasons: Array.isArray(q.reasons) ? q.reasons : [],
      watchlist_gate: rr && rr.watchlist_gate ? rr.watchlist_gate : summary.watchlist_gate,
      lifecycle: summary,
      layer2_status: rr ? (rr.status || "") : "PENDING",
      layer2_label: rr ? (rr.label || "") : "",
      layer2_incidence: rr ? Number(rr.incidence || 0) : null,
      review_decision: review ? (review.decision_code || "") : "",
      review_reason_code: review ? (review.reason_code || "") : "",
      review_reason_note: review ? (review.reason_note || "") : "",
      review_updated_at: review ? (review.updated_at || "") : "",
      notices: tn.map((n) => ({
        id: n.Id || null,
        tender_id: Number(n.TenderId || n.TenderID || tenderId || 0),
        publish_date: n.PublishDate || n.NoticePublishDate || "",
        doc_short: n.DocumentTypeShortName || "",
        doc_name: n.DocumentTypeName || "",
        notice_number: n.NoticeNumber || "",
        modification_description: n.ModificationDescription || ""
      })),
      source_run_date: runDateYmd
    };
  });

  return {
    run_dir: runDir,
    run_date_ymd: runDateYmd,
    queue_total: rows.length,
    source: "legacy_queue",
    rows
  };
}

module.exports = {
  startLayer2Run,
  getLayer2RunStatus,
  getLayer2ViewData
};
