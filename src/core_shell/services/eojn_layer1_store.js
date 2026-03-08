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
  writeLayer1RunArtifacts,
  appendEventLog
};
