"use strict";

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const { writeJsonAtomic } = require("../storage/fs_store");

const STATE_VERSION = 1;

function repoRootFromServiceDir() {
  return path.resolve(__dirname, "..", "..", "..");
}

function defaultOutRoot() {
  return path.join(repoRootFromServiceDir(), "out", "eojn_v1");
}

function normalizeYmd(value) {
  const v = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    throw new Error(`Invalid YMD date: ${value}`);
  }
  return v;
}

function outDirForDate(outRoot, ymd) {
  return path.join(outRoot, normalizeYmd(ymd).replace(/-/g, "_"));
}

function stateFilePath(outRoot) {
  return path.join(outRoot, "_state", "layer1_state.json");
}

function activeCycleFilePath(outRoot) {
  return path.join(outRoot, "_state", "active_cycle.json");
}

function defaultState() {
  return {
    version: STATE_VERSION,
    updated_at: null,
    watermarks: {
      procurements_notice_publish_date: null,
      notices_publish_date: null
    },
    processed_tenders: {},
    processed_notice_keys: {},
    last_successful_run: null
  };
}

async function readJsonSafe(filePath, fallback) {
  try {
    const text = await fsp.readFile(filePath, "utf8");
    return JSON.parse(text);
  } catch (_) {
    return fallback;
  }
}

async function loadLayer1State({ outRoot } = {}) {
  const root = path.resolve(String(outRoot || defaultOutRoot()));
  return readJsonSafe(stateFilePath(root), defaultState());
}

async function saveLayer1State({ outRoot, state }) {
  const root = path.resolve(String(outRoot || defaultOutRoot()));
  const next = {
    ...defaultState(),
    ...(state || {}),
    version: STATE_VERSION,
    updated_at: new Date().toISOString()
  };
  await writeJsonAtomic(stateFilePath(root), next);
  return next;
}

async function loadActiveCycle({ outRoot } = {}) {
  const root = path.resolve(String(outRoot || defaultOutRoot()));
  const existing = await readJsonSafe(activeCycleFilePath(root), null);
  if (existing && existing.run_date_ymd) return existing;
  const l1 = await readJsonSafe(stateFilePath(root), defaultState());
  const runDate = String(l1 && l1.last_successful_run && l1.last_successful_run.run_date_ymd ? l1.last_successful_run.run_date_ymd : "").trim();
  if (!runDate) return null;
  return {
    cycle_id: String(l1.last_successful_run.completed_at || ""),
    run_date_ymd: runDate,
    out_dir: outDirForDate(root, runDate),
    layer1_run: l1.last_successful_run || null,
    layer2_run: null,
    updated_at: new Date().toISOString()
  };
}

async function saveActiveCycle({ outRoot, activeCycle }) {
  const root = path.resolve(String(outRoot || defaultOutRoot()));
  const payload = {
    cycle_id: String(activeCycle && activeCycle.cycle_id ? activeCycle.cycle_id : ""),
    run_date_ymd: String(activeCycle && activeCycle.run_date_ymd ? activeCycle.run_date_ymd : ""),
    out_dir: String(activeCycle && activeCycle.out_dir ? activeCycle.out_dir : ""),
    layer1_run: activeCycle && activeCycle.layer1_run ? activeCycle.layer1_run : null,
    layer2_run: activeCycle && activeCycle.layer2_run ? activeCycle.layer2_run : null,
    updated_at: new Date().toISOString()
  };
  await writeJsonAtomic(activeCycleFilePath(root), payload);
  return payload;
}

async function appendEventLog({ outDir, event }) {
  const target = path.join(outDir, "events.log");
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.appendFile(target, `${JSON.stringify(event)}\n`, "utf8");
}

async function writeLayer1RunArtifacts({
  outRoot,
  runDateYmd,
  procurementsRows,
  noticesRows,
  scoredRows,
  shortlistRows,
  layer2QueueRows,
  manifest
}) {
  const root = path.resolve(String(outRoot || defaultOutRoot()));
  const outDir = outDirForDate(root, runDateYmd);
  await fsp.mkdir(outDir, { recursive: true });

  await Promise.all([
    writeJsonAtomic(path.join(outDir, "procurements_raw.json"), procurementsRows || []),
    writeJsonAtomic(path.join(outDir, "notices_raw.json"), noticesRows || []),
    writeJsonAtomic(path.join(outDir, "raw.json"), procurementsRows || []),
    writeJsonAtomic(path.join(outDir, "scored.json"), scoredRows || []),
    writeJsonAtomic(path.join(outDir, "shortlist.json"), shortlistRows || []),
    writeJsonAtomic(path.join(outDir, "layer2_queue.json"), layer2QueueRows || []),
    writeJsonAtomic(path.join(outDir, "manifest.json"), manifest || {})
  ]);

  return { outDir };
}

module.exports = {
  defaultOutRoot,
  loadLayer1State,
  saveLayer1State,
  loadActiveCycle,
  saveActiveCycle,
  writeLayer1RunArtifacts,
  appendEventLog
};
