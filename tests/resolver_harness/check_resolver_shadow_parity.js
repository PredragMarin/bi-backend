"use strict";

const fs = require("fs");
const path = require("path");
const { resolveMotherDxfRuntimePlan } = require("../../src/core_shell/services/dxf_resolver_service");

const FIXTURE_ROOT = path.resolve(__dirname, "../fixtures");
const REPORT_DIR = path.resolve(__dirname, "output");
const ACTIVATION_REPORT_PATH = path.join(REPORT_DIR, "activation_candidate_report.json");
const OUTPUT_REPORT_PATH = path.join(REPORT_DIR, "shadow_parity_report.json");

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
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) out.push(fullPath);
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

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = stable(value[key]);
    return out;
  }
  return value;
}

function normalizeDxfHandles(text) {
  const lines = String(text || "").split(/\r?\n/);
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (String(lines[index]).trim() === "5") lines[index + 1] = "<HANDLE>";
  }
  return lines.join("\n");
}

function stripVolatileFields(value, pathParts = []) {
  if (Array.isArray(value)) return value.map((item, index) => stripVolatileFields(item, pathParts.concat(String(index))));
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value)) {
      const nextPath = pathParts.concat(key);
      if (nextPath.join(".") === "result.session.updated_at") continue;
      if (nextPath.join(".") === "result.dxf_text") {
        out[key] = normalizeDxfHandles(value[key]);
        continue;
      }
      out[key] = stripVolatileFields(value[key], nextPath);
    }
    return out;
  }
  return value;
}

function comparableWrapper(wrapped) {
  return stable(stripVolatileFields({
    result: wrapped?.result || null,
    config_parameter_set: wrapped?.config_parameter_set || null,
    warnings: wrapped?.warnings || [],
    errors: wrapped?.errors || []
  }));
}

function compareJson(left, right) {
  const leftText = JSON.stringify(stable(left));
  const rightText = JSON.stringify(stable(right));
  return {
    matches: leftText === rightText,
    left_length: leftText.length,
    right_length: rightText.length
  };
}

function hasShadowTrace(wrapped) {
  return Boolean((wrapped?.pipeline_trace?.steps || []).some((step) => step.name === "shared_resolver_activation_candidate_shadow"));
}

async function runCandidate(candidate, fixtures) {
  const fixturePath = fixtures.get(candidate.fixture);
  if (!fixturePath) {
    return {
      fixture: candidate.fixture,
      mode: candidate.mode,
      ok: false,
      reason: "fixture_not_found"
    };
  }
  const session = readJson(fixturePath);
  const configParameterSet = session.config_parameter_set || session.configParameterSet || { parameters: session.parameters || {} };
  const baseArgs = {
    session,
    configParameterSet,
    mode: candidate.mode
  };
  const runtime = await resolveMotherDxfRuntimePlan({
    ...baseArgs,
    sharedResolverMode: "runtime"
  });
  const shadow = await resolveMotherDxfRuntimePlan({
    ...baseArgs,
    sharedResolverMode: "activation_candidate_shadow"
  });
  const comparison = compareJson(comparableWrapper(runtime), comparableWrapper(shadow));
  const activation = shadow.shared_resolver_activation || null;
  const shadowOk = Boolean(
    activation
    && activation.active === false
    && activation.diagnostic_only === true
    && hasShadowTrace(shadow)
  );
  return {
    fixture: candidate.fixture,
    mode: candidate.mode,
    bucket: candidate.bucket,
    candidate_kind: candidate.candidate_kind,
    ok: comparison.matches && shadowOk,
    result_matches: comparison.matches,
    shadow_trace_ok: shadowOk,
    runtime_shared_resolver_mode: runtime.shared_resolver_mode,
    shadow_shared_resolver_mode: shadow.shared_resolver_mode,
    shadow_activation: activation,
    comparable_lengths: {
      runtime: comparison.left_length,
      shadow: comparison.right_length
    }
  };
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
    details.push(await runCandidate(candidate, fixtures));
  }
  const failures = details.filter((item) => !item.ok);
  const report = {
    behavior_change: false,
    generated_by: "npm run resolver:shadow-parity",
    source_report: path.relative(process.cwd(), ACTIVATION_REPORT_PATH),
    summary: {
      checked: details.length,
      failures: failures.length,
      passed: details.length - failures.length
    },
    details
  };
  fs.writeFileSync(OUTPUT_REPORT_PATH, JSON.stringify(report, null, 2) + "\n");

  console.log("Resolver shadow parity");
  console.log("- behavior_change: false");
  console.log("- output: " + path.relative(process.cwd(), OUTPUT_REPORT_PATH));
  console.log("- checked: " + report.summary.checked);
  console.log("- passed: " + report.summary.passed);
  console.log("- failures: " + report.summary.failures);
  for (const item of details) {
    console.log("- " + (item.ok ? "OK" : "FAIL") + " " + item.fixture + " / " + item.mode
      + " | bucket=" + (item.bucket || "none")
      + " | result_matches=" + item.result_matches
      + " | shadow_trace_ok=" + item.shadow_trace_ok);
  }
  if (failures.length) {
    const error = new Error("Shadow parity failed for " + failures.length + " candidate(s).");
    error.exitCode = 30;
    throw error;
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = error.exitCode || 1;
});
