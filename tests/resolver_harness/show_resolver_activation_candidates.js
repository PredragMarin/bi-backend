"use strict";

const fs = require("fs");
const path = require("path");

const REPORT_DIR = path.resolve(__dirname, "output");
const ASSERTION_REPORT_PATH = path.join(REPORT_DIR, "resolver_plan_assertions_report.json");
const READINESS_REPORT_PATH = path.join(REPORT_DIR, "extraction_readiness_report.json");
const OUTPUT_REPORT_PATH = path.join(REPORT_DIR, "activation_candidate_report.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function numeric(value) {
  return Number(value || 0);
}

function keyOf(item) {
  return String(item.fixture || "") + "::" + String(item.mode || "");
}

function parityMap(details) {
  const map = new Map();
  for (const item of Array.isArray(details) ? details : []) {
    map.set(keyOf(item), {
      mismatch_count: numeric(item.mismatch_count),
      reason: item.reason || null,
      output_file: item.output_file || null
    });
  }
  return map;
}

function activationBucketFor(item) {
  if (item.candidate_kind === "no_movement") return "slice_1_no_movement";
  if (item.candidate_kind === "topo_x_only") return "slice_2_topo_x_only";
  return null;
}

function buildReport(assertions, readinessReport) {
  const readiness = readinessReport.extraction_readiness || {};
  const details = Array.isArray(readiness.details) ? readiness.details : [];
  const noMovementParity = parityMap(assertions.no_movement?.details);
  const topoXParity = parityMap(assertions.topo_x_only?.details);
  const candidates = [];
  const rejected = [];

  for (const item of details) {
    const bucket = activationBucketFor(item);
    const key = keyOf(item);
    const parity = item.candidate_kind === "no_movement"
      ? noMovementParity.get(key)
      : item.candidate_kind === "topo_x_only"
        ? topoXParity.get(key)
        : null;
    const base = {
      fixture: item.fixture,
      mode: item.mode,
      bucket,
      candidate_kind: item.candidate_kind || null,
      stage_order: Array.isArray(item.stage_order) ? item.stage_order : [],
      axes: Array.isArray(item.axes) ? item.axes : [],
      movement_stage_count: numeric(item.movement_stage_count),
      readiness_status: item.status,
      parity,
      output_file: item.output_file
    };

    if (item.status === "candidate" && bucket && parity && numeric(parity.mismatch_count) === 0) {
      candidates.push({
        ...base,
        activation_status: "candidate_after_flag",
        activation_guard: "behind_explicit_facade_flag_only"
      });
    } else {
      rejected.push({
        ...base,
        activation_status: "not_candidate",
        reason: item.status !== "candidate"
          ? "readiness_status_" + item.status
          : !bucket
            ? "unsupported_candidate_kind"
            : !parity
              ? "missing_parity_record"
              : "parity_mismatch"
      });
    }
  }

  const byBucket = candidates.reduce((acc, item) => {
    acc[item.bucket] = numeric(acc[item.bucket]) + 1;
    return acc;
  }, {});

  return {
    behavior_change: false,
    generated_by: "npm run resolver:activation-candidates",
    source_reports: {
      assertions: path.relative(process.cwd(), ASSERTION_REPORT_PATH),
      readiness: path.relative(process.cwd(), READINESS_REPORT_PATH)
    },
    summary: {
      total_snapshots: details.length,
      activation_candidates: candidates.length,
      rejected: rejected.length,
      by_bucket: byBucket,
      no_movement_parity_mismatches: numeric(assertions.no_movement?.mismatches),
      topo_x_only_parity_mismatches: numeric(assertions.topo_x_only?.mismatches),
      facade_shared_diagnostics_mismatches: numeric(assertions.facade_shared_diagnostics?.mismatches)
    },
    activation_rules: [
      "candidate must come from extraction_readiness.status=candidate",
      "candidate kind must be no_movement or topo_x_only",
      "candidate must have an exact parity record with mismatch_count=0",
      "activation is future-only and must be behind an explicit facade flag",
      "this report does not activate shared resolver execution"
    ],
    candidates,
    rejected
  };
}

function main() {
  if (!fs.existsSync(ASSERTION_REPORT_PATH) || !fs.existsSync(READINESS_REPORT_PATH)) {
    throw new Error("Missing resolver reports. Run npm run resolver:checkpoint first.");
  }
  const assertions = readJson(ASSERTION_REPORT_PATH);
  const readiness = readJson(READINESS_REPORT_PATH);
  const report = buildReport(assertions, readiness);
  fs.writeFileSync(OUTPUT_REPORT_PATH, JSON.stringify(report, null, 2) + "\n");

  console.log("Resolver activation candidates");
  console.log("- behavior_change: false");
  console.log("- output: " + path.relative(process.cwd(), OUTPUT_REPORT_PATH));
  console.log("- candidates: " + report.summary.activation_candidates);
  console.log("- rejected: " + report.summary.rejected);
  console.log("- by bucket: " + JSON.stringify(report.summary.by_bucket));
  console.log("- no-movement parity mismatches: " + report.summary.no_movement_parity_mismatches);
  console.log("- topo-x-only parity mismatches: " + report.summary.topo_x_only_parity_mismatches);
  console.log("- facade shared diagnostics mismatches: " + report.summary.facade_shared_diagnostics_mismatches);
  for (const item of report.candidates) {
    const order = item.stage_order.length ? item.stage_order.join(" -> ") : "no_movement";
    const axes = item.axes.length ? item.axes.join(",") : "none";
    console.log("- " + item.bucket + " | " + item.fixture + " / " + item.mode
      + " | order=" + order
      + " | axes=" + axes
      + " | " + item.output_file);
  }
}

try {
  main();
} catch (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
