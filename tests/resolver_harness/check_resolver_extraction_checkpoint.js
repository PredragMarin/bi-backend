"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const PARITY_SCRIPT = path.resolve(__dirname, "check_resolver_parity_gate.js");
const FOOTPRINT_SCRIPT = path.resolve(__dirname, "show_mother_runtime_resolver_footprint.js");
const ASSERTION_REPORT_PATH = path.resolve(__dirname, "output", "resolver_plan_assertions_report.json");
const READINESS_REPORT_PATH = path.resolve(__dirname, "output", "extraction_readiness_report.json");

function runNodeScript(scriptPath, label) {
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: path.resolve(__dirname, "../.."),
    stdio: "inherit",
    env: process.env
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const error = new Error(label + " failed.");
    error.exitCode = result.status || 1;
    throw error;
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function numeric(value) {
  return Number(value || 0);
}

function main() {
  runNodeScript(PARITY_SCRIPT, "Resolver parity gate");
  runNodeScript(FOOTPRINT_SCRIPT, "Mother DXF runtime footprint inventory");

  const assertions = readJson(ASSERTION_REPORT_PATH);
  const readiness = fs.existsSync(READINESS_REPORT_PATH) ? readJson(READINESS_REPORT_PATH) : null;
  const plan = assertions.resolver_plan || {};
  const extraction = assertions.extraction_readiness || {};
  const noMovement = assertions.no_movement || {};
  const noMovementExecution = assertions.no_movement_execution || {};
  const topoXOnly = assertions.topo_x_only || {};
  const topoXOnlyExecution = assertions.topo_x_only_execution || {};
  const facade = assertions.facade_shared_diagnostics || {};

  const parityMismatchTotal = numeric(noMovement.mismatches)
    + numeric(noMovementExecution.mismatches)
    + numeric(topoXOnly.mismatches)
    + numeric(topoXOnlyExecution.mismatches)
    + numeric(facade.mismatches);
  const sequencingBlockers = numeric(extraction.blocker_kind_counts?.sequencing_risk);
  const fixtureGaps = numeric(extraction.blocker_kind_counts?.fixture_or_entrypoint_gap);

  console.log("Resolver extraction checkpoint");
  console.log("- behavior_change: " + assertions.behavior_change);
  console.log("- parity mismatches total: " + parityMismatchTotal);
  console.log("- no-movement execution: checked=" + numeric(noMovementExecution.checked) + ", mismatches=" + numeric(noMovementExecution.mismatches));
  console.log("- topo-x-only execution: checked=" + numeric(topoXOnlyExecution.checked) + ", mismatches=" + numeric(topoXOnlyExecution.mismatches));
  console.log("- candidates: " + numeric(extraction.candidates));
  console.log("- review: " + numeric(extraction.review));
  console.log("- blocked: " + numeric(extraction.blocked));
  console.log("- sequencing blockers: " + sequencingBlockers);
  console.log("- fixture/entrypoint gaps: " + fixtureGaps);
  console.log("- assertion warning count: " + numeric(plan.assertion_warnings));
  console.log("- assertion info count: " + numeric(plan.assertion_infos));
  console.log("- readiness report: " + (readiness ? path.relative(process.cwd(), READINESS_REPORT_PATH) : "missing"));
  console.log("- cleanup approval: not yet; use this checkpoint only as pre-cleanup inventory and rollback reference");

  if (parityMismatchTotal > 0) {
    const error = new Error("Extraction checkpoint failed because parity mismatches are present.");
    error.exitCode = 20;
    throw error;
  }
  if (assertions.behavior_change !== false) {
    const error = new Error("Extraction checkpoint failed because assertion report does not declare behavior_change=false.");
    error.exitCode = 21;
    throw error;
  }
  console.log("- status: checkpoint passed");
}

try {
  main();
} catch (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = error.exitCode || 1;
}
