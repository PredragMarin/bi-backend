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

function reviewFilePath(outRoot) {
  return path.join(outRoot, "_state", "review_decisions.json");
}

function defaultState() {
  return {
    version: 1,
    updated_at: null,
    decisions: {}
  };
}

function reviewKey(runDateYmd, tenderId) {
  return `${String(runDateYmd || "").trim()}|${Number(tenderId || 0)}`;
}

async function loadReviewState({ outRoot } = {}) {
  const root = path.resolve(String(outRoot || defaultOutRoot()));
  try {
    const text = await fsp.readFile(reviewFilePath(root), "utf8");
    return { ...defaultState(), ...JSON.parse(text) };
  } catch (_) {
    return defaultState();
  }
}

async function saveReviewState({ outRoot, state }) {
  const root = path.resolve(String(outRoot || defaultOutRoot()));
  const next = {
    ...defaultState(),
    ...(state || {}),
    updated_at: new Date().toISOString()
  };
  await writeJsonAtomic(reviewFilePath(root), next);
  return next;
}

async function getReviewDecision({ outRoot, runDateYmd, tenderId }) {
  const state = await loadReviewState({ outRoot });
  return state.decisions[reviewKey(runDateYmd, tenderId)] || null;
}

async function getReviewDecisionsForRun({ outRoot, runDateYmd }) {
  const state = await loadReviewState({ outRoot });
  const prefix = `${String(runDateYmd || "").trim()}|`;
  const out = {};
  for (const [key, value] of Object.entries(state.decisions || {})) {
    if (key.startsWith(prefix)) out[key] = value;
  }
  return out;
}

async function getLatestReviewDecisionByTender({ outRoot, tenderId }) {
  const wanted = Number(tenderId || 0);
  if (!Number.isFinite(wanted) || wanted <= 0) return null;
  const state = await loadReviewState({ outRoot });
  let latest = null;
  for (const value of Object.values(state.decisions || {})) {
    if (Number(value && value.tender_id) !== wanted) continue;
    if (!latest) {
      latest = value;
      continue;
    }
    const currentTs = Date.parse(String(value && value.updated_at || ""));
    const latestTs = Date.parse(String(latest && latest.updated_at || ""));
    if ((Number.isFinite(currentTs) ? currentTs : 0) > (Number.isFinite(latestTs) ? latestTs : 0)) {
      latest = value;
    }
  }
  return latest;
}

async function getLatestReviewDecisionsByTender({ outRoot }) {
  const state = await loadReviewState({ outRoot });
  const out = {};
  for (const value of Object.values(state.decisions || {})) {
    const tenderId = Number(value && value.tender_id);
    if (!Number.isFinite(tenderId) || tenderId <= 0) continue;
    const key = String(tenderId);
    const prev = out[key] || null;
    if (!prev) {
      out[key] = value;
      continue;
    }
    const currentTs = Date.parse(String(value && value.updated_at || ""));
    const prevTs = Date.parse(String(prev && prev.updated_at || ""));
    if ((Number.isFinite(currentTs) ? currentTs : 0) > (Number.isFinite(prevTs) ? prevTs : 0)) {
      out[key] = value;
    }
  }
  return out;
}

async function saveReviewDecision({ outRoot, runDateYmd, tenderId, decision }) {
  const state = await loadReviewState({ outRoot });
  const key = reviewKey(runDateYmd, tenderId);
  const current = state.decisions[key] || null;
  state.decisions[key] = {
    ...(current || {}),
    ...(decision || {}),
    run_date_ymd: String(runDateYmd || "").trim(),
    tender_id: Number(tenderId || 0),
    updated_at: new Date().toISOString()
  };
  const next = await saveReviewState({ outRoot, state });
  return next.decisions[key];
}

module.exports = {
  defaultOutRoot,
  getReviewDecision,
  getReviewDecisionsForRun,
  getLatestReviewDecisionByTender,
  getLatestReviewDecisionsByTender,
  loadReviewState,
  saveReviewDecision
};
