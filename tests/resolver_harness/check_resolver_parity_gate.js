"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const HARNESS_SCRIPT = path.resolve(__dirname, "run_resolver_harness.js");
const REPORT_PATH = path.resolve(__dirname, "output", "resolver_plan_assertions_report.json");

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
    const error = new Error("Resolver harness failed before parity gate could be checked.");
    error.exitCode = result.status || 1;
    throw error;
  }
}

function numeric(value) {
  return Number(value || 0);
}

function main() {
  runHarness();
  if (!fs.existsSync(REPORT_PATH)) {
    throw new Error("Resolver assertion report was not generated: " + REPORT_PATH);
  }
  const report = readJson(REPORT_PATH);
  const noMovement = report.no_movement || {};
  const noMovementExecution = report.no_movement_execution || {};
  const topoXOnly = report.topo_x_only || {};
  const topoXOnlyExecution = report.topo_x_only_execution || {};
  const facadeSharedDiagnostics = report.facade_shared_diagnostics || {};
  const failures = [];

  if (numeric(noMovement.mismatches) > 0) {
    failures.push("no-movement parity mismatches=" + numeric(noMovement.mismatches));
  }
  if (numeric(noMovementExecution.mismatches) > 0) {
    failures.push("no-movement execution mismatches=" + numeric(noMovementExecution.mismatches));
  }
  if (numeric(topoXOnly.mismatches) > 0) {
    failures.push("topo-x-only parity mismatches=" + numeric(topoXOnly.mismatches));
  }
  if (numeric(topoXOnlyExecution.mismatches) > 0) {
    failures.push("topo-x-only execution mismatches=" + numeric(topoXOnlyExecution.mismatches));
  }
  if (numeric(facadeSharedDiagnostics.mismatches) > 0) {
    failures.push("facade shared diagnostics parity mismatches=" + numeric(facadeSharedDiagnostics.mismatches));
  }

  console.log("Resolver parity gate");
  console.log("- report: " + path.relative(process.cwd(), REPORT_PATH));
  console.log("- behavior_change: " + report.behavior_change);
  console.log("- no-movement parity: checked=" + numeric(noMovement.checked) + ", mismatches=" + numeric(noMovement.mismatches));
  console.log("- no-movement execution: checked=" + numeric(noMovementExecution.checked) + ", mismatches=" + numeric(noMovementExecution.mismatches));
  console.log("- topo-x-only parity: checked=" + numeric(topoXOnly.checked) + ", mismatches=" + numeric(topoXOnly.mismatches));
  console.log("- topo-x-only execution: checked=" + numeric(topoXOnlyExecution.checked) + ", mismatches=" + numeric(topoXOnlyExecution.mismatches));
  console.log("- facade shared diagnostics parity: checked=" + numeric(facadeSharedDiagnostics.checked) + ", mismatches=" + numeric(facadeSharedDiagnostics.mismatches));

  if (failures.length) {
    const error = new Error("Resolver parity gate failed: " + failures.join("; "));
    error.exitCode = 10;
    throw error;
  }
  console.log("- status: parity gate passed");
}

try {
  main();
} catch (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = error.exitCode || 1;
}
