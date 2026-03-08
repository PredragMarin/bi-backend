"use strict";

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const { writeJsonAtomic } = require("../storage/fs_store");

function repoRootFromServiceDir() {
  return path.resolve(__dirname, "..", "..", "..");
}

function defaultOutRoot() {
  return path.join(repoRootFromServiceDir(), "out", "eojn_v1");
}

function stateFilePath(outRoot) {
  return path.join(outRoot, "_state", "layer2_run_status.json");
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

module.exports = {
  defaultOutRoot,
  loadLayer2Status,
  saveLayer2Status
};
