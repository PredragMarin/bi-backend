"use strict";

const fs = require("fs");
const path = require("path");
const { resolveMotherDxfRuntimePlan } = require("../../src/core_shell/services/dxf_resolver_service");

const ROOT = path.resolve(__dirname, "../..");
const FIXTURE_ROOT = path.resolve(__dirname, "../fixtures");
const REPORT_DIR = path.resolve(__dirname, "output");
const ACTIVATION_REPORT_PATH = path.join(REPORT_DIR, "activation_candidate_report.json");
const OUTPUT_REPORT_PATH = path.join(REPORT_DIR, "core_shell_strict_probe_report.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function safeName(value) {
  return String(value || "fixture")
    .trim()
    .replace(/\.json$/i, "")
    .replace(/[^A-Za-z0-9_.-]+/g, "_") || "fixture";
}

function listJsonFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(fullPath);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) out.push(fullPath);
    }
  }
  return out.sort();
}

function fixturePathMap() {
  const map = new Map();
  for (const filePath of listJsonFiles(FIXTURE_ROOT)) {
    const rel = path.relative(FIXTURE_ROOT, filePath);
    const relName = safeName(rel);
    const baseName = safeName(path.basename(filePath));
    const parentName = safeName(path.basename(path.dirname(filePath)));
    map.set(relName, filePath);
    map.set(baseName, filePath);
    map.set(parentName + "__" + baseName, filePath);
  }
  return map;
}

function strictFailureOk(error) {
  return Boolean(
    error
    && error.code === "CORE_RESOLVER_STRICT_UNSUPPORTED"
    && error.execution_owner === "core_shell_native"
    && error.legacy_fallback_used === false
    && error.unsupported_reason === "native_session_projection_not_implemented"
  );
}

async function probeCandidate(candidate, fixtures) {
  const fixturePath = fixtures.get(candidate.fixture);
  if (!fixturePath) {
    return {
      fixture: candidate.fixture,
      mode: candidate.mode,
      ok: false,
      outcome: "fixture_not_found"
    };
  }
  const session = readJson(fixturePath);
  try {
    const result = await resolveMotherDxfRuntimePlan({
      session,
      configParameterSet: session.config_parameter_set,
      mode: candidate.mode,
      sharedResolverMode: "core_shell_strict"
    });
    return {
      fixture: candidate.fixture,
      mode: candidate.mode,
      ok: false,
      outcome: "unexpected_success",
      execution_owner: result?.execution_owner || null,
      legacy_fallback_used: result?.legacy_fallback_used ?? null
    };
  } catch (error) {
    return {
      fixture: candidate.fixture,
      mode: candidate.mode,
      bucket: candidate.bucket || null,
      candidate_kind: candidate.candidate_kind || null,
      ok: strictFailureOk(error),
      outcome: strictFailureOk(error) ? "strict_refused_without_legacy" : "unexpected_error",
      code: error?.code || null,
      execution_owner: error?.execution_owner || null,
      legacy_fallback_used: error?.legacy_fallback_used ?? null,
      unsupported_reason: error?.unsupported_reason || null,
      trace_steps: (error?.pipeline_trace?.steps || []).map((step) => step.name)
    };
  }
}

async function main() {
  if (!fs.existsSync(ACTIVATION_REPORT_PATH)) {
    throw new Error("Missing activation candidate report. Run npm run resolver:activation-candidates first.");
  }
  const activationReport = readJson(ACTIVATION_REPORT_PATH);
  const candidates = Array.isArray(activationReport.candidates) ? activationReport.candidates : [];
  const fixtures = fixturePathMap();
  const details = [];
  for (const candidate of candidates) {
    details.push(await probeCandidate(candidate, fixtures));
  }
  const failures = details.filter((item) => !item.ok);
  const report = {
    behavior_change: false,
    generated_by: "npm run resolver:strict-probe",
    generated_at: new Date().toISOString(),
    strict_contract: {
      resolver_entrypoint: "core_shell",
      expected_execution_owner: "core_shell_native",
      legacy_fallback_allowed: false
    },
    summary: {
      checked: details.length,
      passed: details.length - failures.length,
      failures: failures.length,
      strict_refusals_without_legacy: details.filter((item) => item.outcome === "strict_refused_without_legacy").length
    },
    details
  };
  fs.writeFileSync(OUTPUT_REPORT_PATH, JSON.stringify(report, null, 2) + "\n");

  console.log("Core Shell strict probe");
  console.log("- behavior_change: false");
  console.log("- output: " + path.relative(ROOT, OUTPUT_REPORT_PATH));
  console.log("- checked: " + report.summary.checked);
  console.log("- strict refusals without legacy: " + report.summary.strict_refusals_without_legacy);
  console.log("- failures: " + report.summary.failures);
  if (failures.length) {
    const err = new Error("Core Shell strict probe failed.");
    err.exitCode = 50;
    throw err;
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = error.exitCode || 1;
});
