"use strict";

const fs = require("fs");
const path = require("path");
const { buildIntegralResolverShadow } = require("../../src/core_shell/services/dxf_integral_resolver_service");

const ROOT = path.resolve(__dirname, "../..");
const OUTPUT_ROOT = path.resolve(__dirname, "output");
const READINESS_REPORT_PATH = path.join(OUTPUT_ROOT, "extraction_readiness_report.json");
const OUTPUT_JSON_PATH = path.join(OUTPUT_ROOT, "integral_resolver_shadow_report.json");
const OUTPUT_MD_PATH = path.join(OUTPUT_ROOT, "integral_resolver_shadow_report.md");

function numeric(value) {
  return Number(value || 0);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readSnapshot(item) {
  if (!item?.output_file) return null;
  const filePath = path.resolve(ROOT, item.output_file);
  if (!fs.existsSync(filePath)) return null;
  return readJson(filePath);
}

function detailsFromReadiness() {
  if (!fs.existsSync(READINESS_REPORT_PATH)) return [];
  const report = readJson(READINESS_REPORT_PATH);
  return report.extraction_readiness?.details || [];
}

function envelopeFromSnapshot(item) {
  const snapshot = readSnapshot(item);
  if (!snapshot) {
    return {
      fixture: item.fixture,
      mode: item.mode,
      output_file: item.output_file || null,
      available: false,
      activation_decision: "missing_snapshot",
      blocker_codes: ["MISSING_SNAPSHOT"],
      stage_count: 0
    };
  }
  const existing = snapshot.integral_resolver_shadow || buildIntegralResolverShadow({
    mode: item.mode,
    movementInventory: snapshot.movement_inventory,
    resolverPlan: snapshot.resolver_plan,
    extractionReadiness: snapshot.extraction_readiness,
    stageBoundaryPlan: snapshot.stage_boundary_plan,
    summary: snapshot.summary,
    warnings: snapshot.summary?.warnings || [],
    errors: snapshot.summary?.errors || []
  });
  return {
    fixture: item.fixture,
    mode: item.mode,
    output_file: item.output_file || null,
    available: true,
    behavior_change: existing.behavior_change,
    production_ready: existing.production_ready,
    execution_status: existing.execution_status,
    activation_allowed: existing.activation_allowed,
    activation_decision: existing.activation_decision,
    blocker_codes: (existing.blockers || []).map((blocker) => blocker.code).filter(Boolean),
    stage_count: numeric(existing.execution_plan?.stage_count),
    axes: existing.execution_plan?.observed_axes || [],
    stage_sources: existing.execution_plan?.observed_stage_sources || [],
    summary: existing.summary || {}
  };
}

function categoryFor(item) {
  if (!item.available) return "missing_snapshot";
  if (item.activation_decision === "candidate_no_movement") return "candidate_no_movement";
  if (item.activation_decision === "candidate_for_shadow_execution") return "candidate_shadow_execution";
  if (item.activation_decision === "manual_review_required_before_execution_shadow") return "manual_review";
  return "blocked";
}

function markdown(report) {
  const lines = [
    "# Integral Resolver Shadow Report",
    "",
    "- behavior_change: false",
    "- production_ready: false",
    "- snapshots: " + report.summary.snapshots,
    "- categories: " + JSON.stringify(report.summary.category_counts),
    "- activation_allowed: false",
    ""
  ];
  for (const item of report.items) {
    lines.push("- " + item.category + " | " + item.fixture + " / " + item.mode
      + " | stages=" + item.stage_count
      + " | decision=" + item.activation_decision
      + " | blockers=" + item.blocker_codes.join(","));
  }
  lines.push("");
  lines.push("## Interpretation");
  lines.push("Integral resolver exists as a standalone shadow envelope. It is not a production executor yet.");
  lines.push("");
  return lines.join("\n");
}

function main() {
  const items = detailsFromReadiness().map(envelopeFromSnapshot).map((item) => ({
    ...item,
    category: categoryFor(item)
  }));
  const categoryCounts = items.reduce((acc, item) => {
    acc[item.category] = numeric(acc[item.category]) + 1;
    return acc;
  }, {});
  const report = {
    ok: true,
    behavior_change: false,
    generated_by: "npm run resolver:integral-shadow",
    generated_at: new Date().toISOString(),
    production_ready: false,
    activation_allowed: false,
    summary: {
      snapshots: items.length,
      category_counts: categoryCounts,
      blocked: numeric(categoryCounts.blocked),
      manual_review: numeric(categoryCounts.manual_review),
      candidates: numeric(categoryCounts.candidate_no_movement) + numeric(categoryCounts.candidate_shadow_execution)
    },
    items
  };
  fs.writeFileSync(OUTPUT_JSON_PATH, JSON.stringify(report, null, 2) + "\n");
  fs.writeFileSync(OUTPUT_MD_PATH, markdown(report));

  console.log("Integral resolver shadow");
  console.log("- behavior_change: false");
  console.log("- production_ready: false");
  console.log("- report: " + path.relative(ROOT, OUTPUT_JSON_PATH));
  console.log("- markdown: " + path.relative(ROOT, OUTPUT_MD_PATH));
  console.log("- snapshots: " + report.summary.snapshots);
  console.log("- categories: " + JSON.stringify(categoryCounts));
}

try {
  main();
} catch (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
