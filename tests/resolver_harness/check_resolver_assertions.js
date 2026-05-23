"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const HARNESS_SCRIPT = path.resolve(__dirname, "run_resolver_harness.js");
const REPORT_PATH = path.resolve(__dirname, "output", "resolver_plan_assertions_report.json");
const READINESS_REPORT_PATH = path.resolve(__dirname, "output", "extraction_readiness_report.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function runHarness() {
  const result = spawnSync(process.execPath, [HARNESS_SCRIPT], {
    cwd: path.resolve(__dirname, "../.."),
    stdio: "inherit",
    env: process.env
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const error = new Error("Resolver harness failed before assertion report could be checked.");
    error.exitCode = result.status || 1;
    throw error;
  }
}

function main() {
  runHarness();
  if (!fs.existsSync(REPORT_PATH)) {
    throw new Error("Resolver assertion report was not generated: " + REPORT_PATH);
  }
  const report = readJson(REPORT_PATH);
  const plan = report.resolver_plan || {};
  const warningCount = Number(plan.assertion_warnings || 0);
  const infoCount = Number(plan.assertion_infos || 0);
  const codes = plan.assertion_codes || {};
  const noMovement = report.no_movement || {};
  const noMovementMismatchCount = Number(noMovement.mismatches || 0);
  const topoXOnly = report.topo_x_only || {};
  const topoXOnlyMismatchCount = Number(topoXOnly.mismatches || 0);
  const facadeSharedDiagnostics = report.facade_shared_diagnostics || {};
  const facadeSharedDiagnosticsMismatchCount = Number(facadeSharedDiagnostics.mismatches || 0);
  const readiness = report.extraction_readiness || {};
  const statusCounts = readiness.status_counts || {};
  const blockerCodes = readiness.blocker_codes || {};
  const reviewCodes = readiness.review_codes || {};

  console.log("Resolver assertion check");
  console.log("- report: " + path.relative(process.cwd(), REPORT_PATH));
  if (fs.existsSync(READINESS_REPORT_PATH)) {
    console.log("- readiness report: " + path.relative(process.cwd(), READINESS_REPORT_PATH));
  }
  console.log("- behavior_change: " + report.behavior_change);
  console.log("- snapshots: " + report.snapshots_written);
  console.log("- warnings: " + warningCount);
  console.log("- infos: " + infoCount);
  console.log("- no-movement parity: checked=" + Number(noMovement.checked || 0)
    + ", mismatches=" + noMovementMismatchCount);
  console.log("- topo-x-only parity: checked=" + Number(topoXOnly.checked || 0)
    + ", mismatches=" + topoXOnlyMismatchCount);
  console.log("- facade shared diagnostics parity: checked=" + Number(facadeSharedDiagnostics.checked || 0)
    + ", mismatches=" + facadeSharedDiagnosticsMismatchCount);
  console.log("- extraction readiness: candidates=" + Number(readiness.candidates || 0)
    + ", review=" + Number(readiness.review || 0)
    + ", blocked=" + Number(readiness.blocked || 0));
  console.log("- readiness statuses: " + JSON.stringify(statusCounts));
  console.log("- readiness blockers: " + JSON.stringify(blockerCodes));
  console.log("- readiness review codes: " + JSON.stringify(reviewCodes));
  const strict = String(process.env.RESOLVER_ASSERTIONS_STRICT || "").trim() === "1";

  console.log("- codes: " + JSON.stringify(codes));
  console.log("- strict: " + strict);
  if (strict && warningCount > 0) {
    const error = new Error("Resolver assertion strict mode failed because warning assertions were observed.");
    error.exitCode = 2;
    throw error;
  }
  if (strict && noMovementMismatchCount > 0) {
    const error = new Error("Resolver assertion strict mode failed because no-movement parity mismatches were observed.");
    error.exitCode = 3;
    throw error;
  }
  if (strict && topoXOnlyMismatchCount > 0) {
    const error = new Error("Resolver assertion strict mode failed because topo-x-only parity mismatches were observed.");
    error.exitCode = 4;
    throw error;
  }
  if (strict && facadeSharedDiagnosticsMismatchCount > 0) {
    const error = new Error("Resolver assertion strict mode failed because facade shared diagnostics parity mismatches were observed.");
    error.exitCode = 5;
    throw error;
  }
  console.log("- status: " + (strict ? "strict check passed" : "diagnostic-only, warnings do not fail this check"));
}

try {
  main();
} catch (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = error.exitCode || 1;
}
