"use strict";

const path = require("path");
const {
  defaultOutRoot,
  getReviewDecision,
  getLatestReviewDecisionByTender,
  saveReviewDecision
} = require("../../core_shell/services/eojn_review_store");
const {
  loadActiveCycle,
  loadCanonicalStateArtifacts,
  mergeCanonicalStateArtifacts
} = require("../../core_shell/services/eojn_layer1_store");

const REVIEW_REASON_CATALOG = [
  { code: "IN_SCOPE", label: "U interesnom scopeu" },
  { code: "NEEDS_FOLLOW_UP", label: "Treba daljnje pracenje" },
  { code: "WRONG_CATEGORY", label: "Pogresna kategorija" },
  { code: "WRONG_MATERIAL", label: "Pogresan materijal" },
  { code: "WRONG_SERVICE_TYPE", label: "Pogresan tip nabave" },
  { code: "OUT_OF_SCOPE", label: "Izvan poslovnog interesa" },
  { code: "NO_BUDGET_RELEVANCE", label: "Troskovnik nije relevantan" },
  { code: "CLOSED_NO_ACTION", label: "Postupak zatvoren" },
  { code: "INSUFFICIENT_EVIDENCE", label: "Nedovoljno dokaza" },
  { code: "OTHER", label: "Ostalo" }
];

const ALLOWED_DECISIONS = new Set(["WATCH", "REJECT", "HOLD"]);
const ALLOWED_REASON_CODES = new Set(REVIEW_REASON_CATALOG.map((x) => x.code));

function assertYmd(value, fieldName) {
  const v = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    throw new Error(`Invalid ${fieldName}; expected YYYY-MM-DD`);
  }
  return v;
}

function normalizeDecision(value) {
  const v = String(value || "").trim().toUpperCase();
  if (!ALLOWED_DECISIONS.has(v)) {
    throw new Error("Invalid decision_code; allowed: WATCH, REJECT, HOLD");
  }
  return v;
}

function normalizeReasonCode(value) {
  const v = String(value || "").trim().toUpperCase();
  if (!ALLOWED_REASON_CODES.has(v)) {
    throw new Error(`Invalid reason_code: ${value}`);
  }
  return v;
}

async function resolveRunDateYmd(outRoot, runDateYmd) {
  const explicit = String(runDateYmd || "").trim();
  if (explicit) return assertYmd(explicit, "run_date_ymd");
  const activeCycle = await loadActiveCycle({ outRoot });
  const active = String(activeCycle && activeCycle.run_date_ymd ? activeCycle.run_date_ymd : "").trim();
  if (active) return assertYmd(active, "run_date_ymd");
  throw new Error("Missing run_date_ymd and no active EOJN cycle available.");
}

async function saveOperatorReview(input) {
  const outRoot = input && input.out_root ? String(input.out_root) : defaultOutRoot();
  const runDateYmd = await resolveRunDateYmd(outRoot, input && input.run_date_ymd);
  const tenderId = Number(input && input.tender_id);
  if (!Number.isFinite(tenderId) || tenderId <= 0) {
    throw new Error("Invalid tender_id");
  }

  const decisionCode = normalizeDecision(input && input.decision_code);
  const reasonCode = normalizeReasonCode(input && input.reason_code);
  const reasonNote = String(input && input.reason_note ? input.reason_note : "").trim().slice(0, 500);

  const saved = await saveReviewDecision({
    outRoot,
    runDateYmd,
    tenderId,
    decision: {
      decision_code: decisionCode,
      reason_code: reasonCode,
      reason_note: reasonNote,
      source: "operator_ui"
    }
  });

  try {
    const canonical = await loadCanonicalStateArtifacts({ outRoot });
    const latestRows = Array.isArray(canonical.tender_latest_rows) ? canonical.tender_latest_rows : [];
    const target = latestRows.find((row) => Number(row && row.TenderId) === tenderId);
    const updatedLatestRows = target ? [{
      ...target,
      Decision: decisionCode,
      ReasonCode: reasonCode,
      DecisionUpdatedAt: String(saved.updated_at || "").trim(),
      WatchFlag: decisionCode === "WATCH",
      UpdatedAt: new Date().toISOString()
    }] : [];
    const reviewHistoryRows = [{
      TenderId: tenderId,
      RunDateYmd: runDateYmd,
      Decision: decisionCode,
      ReasonCode: reasonCode,
      ReasonNote: reasonNote,
      SavedAt: String(saved.updated_at || "").trim(),
      Source: String(saved.source || "").trim() || "operator_ui"
    }];
    await mergeCanonicalStateArtifacts({
      outRoot,
      tenderLatestRows: updatedLatestRows,
      tenderNoticeHistoryRows: [],
      reviewDecisionHistoryRows: reviewHistoryRows
    });
  } catch (_) {
    // Keep review saved even if canonical latest/history sync fails.
  }

  return {
    ok: true,
    decision: saved
  };
}

async function getOperatorReview(input) {
  const outRoot = input && input.out_root ? String(input.out_root) : defaultOutRoot();
  const runDateYmd = await resolveRunDateYmd(outRoot, input && input.run_date_ymd);
  const tenderId = Number(input && input.tender_id);
  if (!Number.isFinite(tenderId) || tenderId <= 0) {
    throw new Error("Invalid tender_id");
  }
  const exact = await getReviewDecision({ outRoot, runDateYmd, tenderId });
  const decision = exact || await getLatestReviewDecisionByTender({ outRoot, tenderId });
  return {
    ok: true,
    run_date_ymd: runDateYmd,
    tender_id: tenderId,
    decision,
    source: exact ? "exact_run" : (decision ? "latest_tender" : "none")
  };
}

function getReviewCatalog() {
  return {
    ok: true,
    decision_codes: ["WATCH", "REJECT", "HOLD"],
    reason_catalog: REVIEW_REASON_CATALOG
  };
}

module.exports = {
  getOperatorReview,
  getReviewCatalog,
  saveOperatorReview
};
