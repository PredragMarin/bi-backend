"use strict";

const fs = require("fs");
const path = require("path");
const { buildStageBoundaryPlan } = require("../../src/core_shell/services/dxf_stage_boundary_service");

const ROOT = path.resolve(__dirname, "../..");
const OUTPUT_ROOT = path.resolve(__dirname, "output");
const READINESS_REPORT_PATH = path.join(OUTPUT_ROOT, "extraction_readiness_report.json");
const OUTPUT_JSON_PATH = path.join(OUTPUT_ROOT, "stage_boundary_report.json");
const OUTPUT_MD_PATH = path.join(OUTPUT_ROOT, "stage_boundary_report.md");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function numeric(value) {
  return Number(value || 0);
}

function detailsFromReadiness() {
  if (!fs.existsSync(READINESS_REPORT_PATH)) return [];
  const report = readJson(READINESS_REPORT_PATH);
  return report.extraction_readiness?.details || [];
}

function classify(plan, readiness) {
  if (readiness?.blocked) return "blocked";
  if (plan.stage_count === 0) return "no_boundary_needed";
  if (plan.activation_decision === "candidate_for_future_shadow_execution") return "candidate_shadow_only";
  return "blocked";
}

function summarizeItem(item) {
  const outputFile = item.output_file ? path.resolve(ROOT, item.output_file) : null;
  const snapshot = outputFile && fs.existsSync(outputFile) ? readJson(outputFile) : null;
  const plan = snapshot?.stage_boundary_plan || buildStageBoundaryPlan({ movementInventory: snapshot?.movement_inventory || { stage_count: 0, stages: [] } });
  return {
    fixture: item.fixture,
    mode: item.mode,
    output_file: item.output_file || null,
    readiness_status: item.status,
    category: classify(plan, item),
    stage_count: numeric(plan.stage_count),
    activation_decision: plan.activation_decision,
    blocker_codes: (plan.blockers || []).map((blocker) => blocker.code).filter(Boolean),
    stage_order: item.stage_order || [],
    axes: item.axes || [],
    relation_count: Array.isArray(plan.relations) ? plan.relations.length : 0,
    cross_axis_overlap_count: (plan.relations || []).filter((relation) => relation.cross_axis && relation.overlap_count > 0).length,
    multi_stage_repair: (plan.blockers || []).some((blocker) => blocker.code === "MULTI_STAGE_REPAIR"),
    requirements: plan.requirements || []
  };
}

function markdown(report) {
  const lines = [
    "# Stage Boundary Report",
    "",
    "- behavior_change: false",
    "- snapshots: " + report.summary.snapshots,
    "- categories: " + JSON.stringify(report.summary.category_counts),
    "- production activation: not approved",
    ""
  ];
  for (const item of report.items) {
    lines.push("- " + item.category + " | " + item.fixture + " / " + item.mode
      + " | stages=" + item.stage_count
      + " | decision=" + item.activation_decision
      + " | blockers=" + item.blocker_codes.join(","));
  }
  lines.push("");
  return lines.join("\n");
}

function main() {
  const items = detailsFromReadiness().map(summarizeItem);
  const categoryCounts = items.reduce((acc, item) => {
    acc[item.category] = numeric(acc[item.category]) + 1;
    return acc;
  }, {});
  const report = {
    behavior_change: false,
    generated_by: "npm run resolver:stage-boundaries",
    generated_at: new Date().toISOString(),
    summary: {
      snapshots: items.length,
      category_counts: categoryCounts,
      production_activation_status: "not_approved"
    },
    items
  };
  fs.writeFileSync(OUTPUT_JSON_PATH, JSON.stringify(report, null, 2) + "\n");
  fs.writeFileSync(OUTPUT_MD_PATH, markdown(report));

  console.log("Resolver stage boundaries");
  console.log("- behavior_change: false");
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
