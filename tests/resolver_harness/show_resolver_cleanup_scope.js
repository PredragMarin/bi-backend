"use strict";

const fs = require("fs");
const path = require("path");

const REPORT_DIR = path.resolve(__dirname, "output");
const ASSERTION_REPORT_PATH = path.join(REPORT_DIR, "resolver_plan_assertions_report.json");
const READINESS_REPORT_PATH = path.join(REPORT_DIR, "extraction_readiness_report.json");

const CLEANUP_SCOPE = [
  {
    id: "sem_execution",
    status: "review_only",
    reason: "Shared SEM evaluator is extracted, but Mother runtime still owns SEM timing and deletion/visibility orchestration."
  },
  {
    id: "no_movement_summary",
    status: "candidate_after_activation",
    reason: "No-movement shared diagnostics have parity, but execution has not been activated through the facade."
  },
  {
    id: "topo_x_only_summary",
    status: "candidate_after_activation",
    reason: "TOPO X-only shared diagnostics have parity, but execution has not been activated through the facade."
  },
  {
    id: "preview_execution",
    status: "do_not_cleanup",
    reason: "Preview orchestration is still Mother-only and UX-facing."
  },
  {
    id: "child_execution",
    status: "do_not_cleanup",
    reason: "Child serialization/materialization is still Mother runtime owned."
  },
  {
    id: "repair_execution",
    status: "do_not_cleanup",
    reason: "Repair behavior is not extracted; sequencing and Y/document-rule repair risks remain."
  },
  {
    id: "topo_metadata",
    status: "do_not_cleanup",
    reason: "TOPO authoring/validation belongs to Mother DXF metadata workflow for now."
  },
  {
    id: "document_rules",
    status: "do_not_cleanup",
    reason: "Document rule execution order is not yet explicit enough for cleanup."
  }
];

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function numeric(value) {
  return Number(value || 0);
}

function getMismatchTotal(assertions) {
  if (!assertions) return null;
  return numeric(assertions.no_movement?.mismatches)
    + numeric(assertions.topo_x_only?.mismatches)
    + numeric(assertions.facade_shared_diagnostics?.mismatches);
}

function summarize(assertions, readiness) {
  const extraction = assertions?.extraction_readiness || {};
  const blockerKinds = extraction.blocker_kind_counts || {};
  return {
    behavior_change: assertions ? assertions.behavior_change : null,
    parity_mismatches_total: getMismatchTotal(assertions),
    candidates: numeric(extraction.candidates),
    review: numeric(extraction.review),
    blocked: numeric(extraction.blocked),
    sequencing_blockers: numeric(blockerKinds.sequencing_risk),
    fixture_or_entrypoint_gaps: numeric(blockerKinds.fixture_or_entrypoint_gap),
    assertion_warnings: numeric(assertions?.resolver_plan?.assertion_warnings),
    assertion_infos: numeric(assertions?.resolver_plan?.assertion_infos),
    readiness_report_available: Boolean(readiness)
  };
}

function decideCleanupApproval(summary) {
  if (!summary) return "no";
  if (summary.behavior_change !== false) return "no";
  if (summary.parity_mismatches_total !== 0) return "no";
  if (summary.sequencing_blockers > 0) return "no";
  if (summary.blocked > 0) return "no";
  return "review_required";
}

function main() {
  const assertions = readJsonIfExists(ASSERTION_REPORT_PATH);
  const readiness = readJsonIfExists(READINESS_REPORT_PATH);
  const summary = summarize(assertions, readiness);
  const cleanupApproval = decideCleanupApproval(summary);
  const report = {
    behavior_change: false,
    generated_by: "npm run resolver:cleanup-scope",
    source_reports: {
      assertions: assertions ? path.relative(process.cwd(), ASSERTION_REPORT_PATH) : null,
      readiness: readiness ? path.relative(process.cwd(), READINESS_REPORT_PATH) : null
    },
    checkpoint_summary: summary,
    cleanup_approval: cleanupApproval,
    cleanup_scope: CLEANUP_SCOPE
  };

  console.log("Resolver cleanup scope");
  console.log("- behavior_change: false");
  console.log("- cleanup approval: " + cleanupApproval);
  console.log("- parity mismatches total: " + summary.parity_mismatches_total);
  console.log("- candidates/review/blocked: " + summary.candidates + "/" + summary.review + "/" + summary.blocked);
  console.log("- sequencing blockers: " + summary.sequencing_blockers);
  console.log("- fixture/entrypoint gaps: " + summary.fixture_or_entrypoint_gaps);
  for (const item of CLEANUP_SCOPE) {
    console.log("- " + item.id + ": " + item.status + " | " + item.reason);
  }
  console.log(JSON.stringify(report, null, 2));
}

main();
