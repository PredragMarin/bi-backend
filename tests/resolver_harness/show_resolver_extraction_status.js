"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "../..");
const REPORT_DIR = path.resolve(__dirname, "output");
const ASSERTION_REPORT_PATH = path.join(REPORT_DIR, "resolver_plan_assertions_report.json");
const READINESS_REPORT_PATH = path.join(REPORT_DIR, "extraction_readiness_report.json");
const ACTIVATION_REPORT_PATH = path.join(REPORT_DIR, "activation_candidate_report.json");
const SHADOW_REPORT_PATH = path.join(REPORT_DIR, "shadow_parity_report.json");
const INTEGRAL_SHADOW_REPORT_PATH = path.join(REPORT_DIR, "integral_resolver_shadow_report.json");
const STATUS_REPORT_PATH = path.join(REPORT_DIR, "resolver_extraction_status_report.json");
const STATUS_MD_PATH = path.join(REPORT_DIR, "resolver_extraction_status_report.md");

const CHECKS = [
  { id: "checkpoint", script: "check_resolver_extraction_checkpoint.js" },
  { id: "cleanup_scope", script: "show_resolver_cleanup_scope.js" },
  { id: "activation_candidates", script: "show_resolver_activation_candidates.js" },
  { id: "shadow_parity", script: "check_resolver_shadow_parity.js" },
  { id: "sequencing_risk", script: "show_resolver_sequencing_risk.js" },
  { id: "stage_boundaries", script: "show_resolver_stage_boundaries.js" },
  { id: "integral_shadow", script: "show_integral_resolver_shadow.js" }
];

function numeric(value) {
  return Number(value || 0);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readJsonIfExists(filePath) {
  return fs.existsSync(filePath) ? readJson(filePath) : null;
}

function runCheck(check) {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const result = spawnSync(process.execPath, [path.join(__dirname, check.script)], {
    cwd: ROOT,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 1024 * 1024 * 20
  });
  const stdout = result.stdout || "";
  const stderr = result.stderr || "";
  return {
    id: check.id,
    script: path.relative(ROOT, path.join(__dirname, check.script)),
    ok: !result.error && result.status === 0,
    exit_code: result.status == null ? null : result.status,
    error: result.error ? String(result.error.message || result.error) : null,
    started_at: startedAt,
    ended_at: new Date().toISOString(),
    duration_ms: Date.now() - startedMs,
    stdout_tail: stdout.slice(-4000),
    stderr_tail: stderr.slice(-4000)
  };
}

function cleanupApprovalFrom(assertions) {
  const extraction = assertions?.extraction_readiness || {};
  const blockerKinds = extraction.blocker_kind_counts || {};
  const parityMismatchTotal = numeric(assertions?.no_movement?.mismatches)
    + numeric(assertions?.no_movement_execution?.mismatches)
    + numeric(assertions?.topo_x_only?.mismatches)
    + numeric(assertions?.topo_x_only_execution?.mismatches)
    + numeric(assertions?.facade_shared_diagnostics?.mismatches);
  if (!assertions || assertions.behavior_change !== false) return "no";
  if (parityMismatchTotal !== 0) return "no";
  if (numeric(blockerKinds.sequencing_risk) > 0) return "no";
  if (numeric(extraction.blocked) > 0) return "no";
  return "review_required";
}

function buildStatus({ checkResults, assertions, activation, shadow, integralShadow }) {
  const extraction = assertions?.extraction_readiness || {};
  const blockerKinds = extraction.blocker_kind_counts || {};
  const plan = assertions?.resolver_plan || {};
  const parityMismatchTotal = numeric(assertions?.no_movement?.mismatches)
    + numeric(assertions?.topo_x_only?.mismatches)
    + numeric(assertions?.facade_shared_diagnostics?.mismatches);
  const failedChecks = checkResults.filter((item) => !item.ok);
  const cleanupApproval = cleanupApprovalFrom(assertions);
  const shadowFailures = numeric(shadow?.summary?.failures);
  const activationCandidates = numeric(activation?.summary?.activation_candidates);
  const sequencingBlockers = numeric(blockerKinds.sequencing_risk);
  const blocked = numeric(extraction.blocked);
  const overall = failedChecks.length === 0 && parityMismatchTotal === 0 && shadowFailures === 0 && assertions?.behavior_change === false
    ? "green_for_shadow_only"
    : "blocked";

  return {
    behavior_change: false,
    generated_by: "npm run resolver:status",
    generated_at: new Date().toISOString(),
    overall_status: overall,
    production_activation_status: "not_approved",
    cleanup_approval: cleanupApproval,
    check_results: checkResults.map((item) => ({
      id: item.id,
      ok: item.ok,
      exit_code: item.exit_code,
      duration_ms: item.duration_ms,
      script: item.script
    })),
    summary: {
      parity_mismatches_total: parityMismatchTotal,
      no_movement_parity: {
        checked: numeric(assertions?.no_movement?.checked),
        mismatches: numeric(assertions?.no_movement?.mismatches)
      },
      no_movement_execution: {
        checked: numeric(assertions?.no_movement_execution?.checked),
        mismatches: numeric(assertions?.no_movement_execution?.mismatches)
      },
      topo_x_only_parity: {
        checked: numeric(assertions?.topo_x_only?.checked),
        mismatches: numeric(assertions?.topo_x_only?.mismatches)
      },
      topo_x_only_execution: {
        checked: numeric(assertions?.topo_x_only_execution?.checked),
        mismatches: numeric(assertions?.topo_x_only_execution?.mismatches)
      },
      facade_shared_diagnostics_parity: {
        checked: numeric(assertions?.facade_shared_diagnostics?.checked),
        mismatches: numeric(assertions?.facade_shared_diagnostics?.mismatches)
      },
      activation_candidates: activationCandidates,
      activation_by_bucket: activation?.summary?.by_bucket || {},
      shadow_parity: {
        checked: numeric(shadow?.summary?.checked),
        passed: numeric(shadow?.summary?.passed),
        failures: shadowFailures
      },
      readiness: {
        candidates: numeric(extraction.candidates),
        review: numeric(extraction.review),
        blocked,
        blocker_kind_counts: blockerKinds,
        candidate_kind_counts: extraction.candidate_kind_counts || {}
      },
      assertions: {
        warnings: numeric(plan.assertion_warnings),
        infos: numeric(plan.assertion_infos),
        codes: plan.assertion_codes || {}
      },
      known_blockers: {
        sequencing_risk: sequencingBlockers,
        fixture_or_entrypoint_gap: numeric(blockerKinds.fixture_or_entrypoint_gap)
      },
      stage_boundary_plan: "diagnostic_only",
      integral_resolver_shadow: {
        production_ready: Boolean(integralShadow?.production_ready),
        activation_allowed: Boolean(integralShadow?.activation_allowed),
        candidates: numeric(integralShadow?.summary?.candidates),
        manual_review: numeric(integralShadow?.summary?.manual_review),
        blocked: numeric(integralShadow?.summary?.blocked),
        category_counts: integralShadow?.summary?.category_counts || {}
      }
    },
    source_reports: {
      assertions: path.relative(ROOT, ASSERTION_REPORT_PATH),
      readiness: path.relative(ROOT, READINESS_REPORT_PATH),
      activation_candidates: path.relative(ROOT, ACTIVATION_REPORT_PATH),
      shadow_parity: path.relative(ROOT, SHADOW_REPORT_PATH),
      integral_shadow: path.relative(ROOT, INTEGRAL_SHADOW_REPORT_PATH)
    },
    next_recommended_step: sequencingBlockers > 0
      ? "Address sequencing-risk path before production activation or cleanup."
      : blocked > 0
        ? "Resolve blocked fixture/entrypoint gaps before widening extraction."
        : "Review whether first runtime activation flag should be implemented for the safest candidate bucket."
  };
}

function markdown(report) {
  const s = report.summary;
  return [
    "# Resolver Extraction Status",
    "",
    "- behavior_change: " + report.behavior_change,
    "- overall_status: " + report.overall_status,
    "- production_activation_status: " + report.production_activation_status,
    "- cleanup_approval: " + report.cleanup_approval,
    "- generated_at: " + report.generated_at,
    "",
    "## Checks",
    ...report.check_results.map((item) => "- " + item.id + ": " + (item.ok ? "ok" : "failed") + " (" + item.duration_ms + " ms)"),
    "",
    "## Parity",
    "- total mismatches: " + s.parity_mismatches_total,
    "- no-movement: " + s.no_movement_parity.checked + " checked / " + s.no_movement_parity.mismatches + " mismatch",
    "- no-movement execution: " + s.no_movement_execution.checked + " checked / " + s.no_movement_execution.mismatches + " mismatch",
    "- topo-x-only: " + s.topo_x_only_parity.checked + " checked / " + s.topo_x_only_parity.mismatches + " mismatch",
    "- topo-x-only execution: " + s.topo_x_only_execution.checked + " checked / " + s.topo_x_only_execution.mismatches + " mismatch",
    "- facade shared diagnostics: " + s.facade_shared_diagnostics_parity.checked + " checked / " + s.facade_shared_diagnostics_parity.mismatches + " mismatch",
    "",
    "## Activation Candidates",
    "- candidates: " + s.activation_candidates,
    "- by bucket: " + JSON.stringify(s.activation_by_bucket),
    "- shadow parity: " + s.shadow_parity.passed + "/" + s.shadow_parity.checked + " passed",
    "",
    "## Readiness",
    "- candidates/review/blocked: " + s.readiness.candidates + "/" + s.readiness.review + "/" + s.readiness.blocked,
    "- blocker kinds: " + JSON.stringify(s.readiness.blocker_kind_counts),
    "- assertion codes: " + JSON.stringify(s.assertions.codes),
    "",
    "## Next Step",
    report.next_recommended_step,
    ""
  ].join("\n");
}

function main() {
  const checkResults = CHECKS.map(runCheck);
  const assertions = readJsonIfExists(ASSERTION_REPORT_PATH);
  const activation = readJsonIfExists(ACTIVATION_REPORT_PATH);
  const shadow = readJsonIfExists(SHADOW_REPORT_PATH);
  const integralShadow = readJsonIfExists(INTEGRAL_SHADOW_REPORT_PATH);
  const report = buildStatus({ checkResults, assertions, activation, shadow, integralShadow });
  fs.writeFileSync(STATUS_REPORT_PATH, JSON.stringify(report, null, 2) + "\n");
  fs.writeFileSync(STATUS_MD_PATH, markdown(report));

  console.log("Resolver extraction status");
  console.log("- behavior_change: " + report.behavior_change);
  console.log("- overall_status: " + report.overall_status);
  console.log("- production_activation_status: " + report.production_activation_status);
  console.log("- cleanup_approval: " + report.cleanup_approval);
  console.log("- report: " + path.relative(ROOT, STATUS_REPORT_PATH));
  console.log("- markdown: " + path.relative(ROOT, STATUS_MD_PATH));
  console.log("- parity mismatches total: " + report.summary.parity_mismatches_total);
  console.log("- activation candidates: " + report.summary.activation_candidates);
  console.log("- shadow parity: " + report.summary.shadow_parity.passed + "/" + report.summary.shadow_parity.checked + " passed");
  console.log("- readiness candidates/review/blocked: " + report.summary.readiness.candidates + "/" + report.summary.readiness.review + "/" + report.summary.readiness.blocked);
  console.log("- integral shadow candidates/review/blocked: " + report.summary.integral_resolver_shadow.candidates + "/" + report.summary.integral_resolver_shadow.manual_review + "/" + report.summary.integral_resolver_shadow.blocked);
  console.log("- next: " + report.next_recommended_step);

  const failed = checkResults.filter((item) => !item.ok);
  if (failed.length || report.summary.parity_mismatches_total > 0 || report.summary.shadow_parity.failures > 0 || report.behavior_change !== false) {
    const error = new Error("Resolver extraction status is blocked.");
    error.exitCode = 40;
    throw error;
  }
}

main();
