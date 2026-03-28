"use strict";

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const { writeJsonAtomic } = require("../storage");

function repoRootFromServiceDir() {
  return path.resolve(__dirname, "..", "..", "..");
}

function defaultOutRoot() {
  return path.join(repoRootFromServiceDir(), "out", "eojn_v1");
}

function stateFilePath(outRoot) {
  return path.join(outRoot, "_state", "layer2_run_status.json");
}

function layer2ResultFilePath(runDir, runId) {
  return path.join(runDir, `layer2_monitor_result_${String(runId || "").trim()}.json`);
}

function defaultStatus() {
  return {
    active: false,
    run_id: null,
    started_at: null,
    completed_at: null,
    phase: null,
    message: null,
    current_index: 0,
    total: 0,
    done: 0,
    skipped: 0,
    reviewed: 0,
    failed: 0,
    progress_pct: 0,
    current_tender_id: null,
    last_heartbeat_at: null,
    output_file: null
  };
}

async function loadLayer2Status({ outRoot } = {}) {
  const root = path.resolve(String(outRoot || defaultOutRoot()));
  const file = stateFilePath(root);
  try {
    const text = await fsp.readFile(file, "utf8");
    return { ...defaultStatus(), ...JSON.parse(text) };
  } catch (_) {
    return defaultStatus();
  }
}

async function saveLayer2Status({ outRoot, status }) {
  const root = path.resolve(String(outRoot || defaultOutRoot()));
  const merged = { ...defaultStatus(), ...(status || {}) };
  await writeJsonAtomic(stateFilePath(root), merged);
  return merged;
}

async function saveLayer2Result({ runDir, runId, result }) {
  const dir = path.resolve(String(runDir || ""));
  const filePath = layer2ResultFilePath(dir, runId);
  await writeJsonAtomic(filePath, result || {});
  return filePath;
}

function listLayer2ResultFiles(runDir) {
  const dir = path.resolve(String(runDir || ""));
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((n) => /^layer2_monitor_result_.*\.json$/i.test(n))
    .map((n) => path.join(dir, n))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
}

async function loadLatestLayer2Result({ runDir } = {}) {
  const files = listLayer2ResultFiles(runDir);
  if (!files.length) return null;
  try {
    const text = await fsp.readFile(files[0], "utf8");
    return { file_path: files[0], payload: JSON.parse(text) };
  } catch (_) {
    return null;
  }
}

module.exports = {
  defaultOutRoot,
  loadLayer2Status,
  saveLayer2Status,
  saveLayer2Result,
  loadLatestLayer2Result
};
