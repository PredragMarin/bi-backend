"use strict";

const {
  loadCanonicalStateArtifacts,
  writeCanonicalArtifacts,
  mergeCanonicalStateArtifacts
} = require("./eojn_layer1_store");

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

async function persistCanonicalArtifactsForRun({
  outRoot,
  runDateYmd,
  tenderLatestRows,
  tenderNoticeHistoryRows,
  reviewDecisionHistoryRows
}) {
  await writeCanonicalArtifacts({
    outRoot,
    runDateYmd,
    tenderLatestRows,
    tenderNoticeHistoryRows,
    reviewDecisionHistoryRows
  });
  return mergeCanonicalStateArtifacts({
    outRoot,
    tenderLatestRows,
    tenderNoticeHistoryRows,
    reviewDecisionHistoryRows
  });
}

async function syncLayer2ResultsToCanonical({ outRoot, results }) {
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

async function syncReviewDecisionToCanonical({
  outRoot,
  runDateYmd,
  tenderId,
  decisionCode,
  reasonCode,
  reasonNote,
  savedDecision
}) {
  const canonical = await loadCanonicalStateArtifacts({ outRoot });
  const latestRows = Array.isArray(canonical.tender_latest_rows) ? canonical.tender_latest_rows : [];
  const target = latestRows.find((row) => Number(row && row.TenderId) === Number(tenderId));
  const updatedLatestRows = target ? [{
    ...target,
    Decision: String(decisionCode || "").trim(),
    ReasonCode: String(reasonCode || "").trim(),
    DecisionUpdatedAt: String(savedDecision && savedDecision.updated_at || "").trim(),
    WatchFlag: String(decisionCode || "").trim().toUpperCase() === "WATCH",
    UpdatedAt: new Date().toISOString()
  }] : [];
  const reviewHistoryRows = [{
    TenderId: Number(tenderId),
    RunDateYmd: String(runDateYmd || "").trim(),
    Decision: String(decisionCode || "").trim(),
    ReasonCode: String(reasonCode || "").trim(),
    ReasonNote: String(reasonNote || "").trim(),
    SavedAt: String(savedDecision && savedDecision.updated_at || "").trim(),
    Source: String(savedDecision && savedDecision.source || "").trim() || "operator_ui"
  }];
  await mergeCanonicalStateArtifacts({
    outRoot,
    tenderLatestRows: updatedLatestRows,
    tenderNoticeHistoryRows: [],
    reviewDecisionHistoryRows: reviewHistoryRows
  });
  return {
    updated_latest: updatedLatestRows.length,
    appended_history: reviewHistoryRows.length
  };
}

module.exports = {
  persistCanonicalArtifactsForRun,
  syncLayer2ResultsToCanonical,
  syncReviewDecisionToCanonical
};
