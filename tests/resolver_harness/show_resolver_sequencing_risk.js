"use strict";

const fs = require("fs");
const path = require("path");
const { buildStageBoundaryPlan } = require("../../src/core_shell/services/dxf_stage_boundary_service");

const ROOT = path.resolve(__dirname, "../..");
const REPORT_DIR = path.resolve(__dirname, "output");
const READINESS_REPORT_PATH = path.join(REPORT_DIR, "extraction_readiness_report.json");
const OUTPUT_JSON_PATH = path.join(REPORT_DIR, "sequencing_risk_report.json");
const OUTPUT_MD_PATH = path.join(REPORT_DIR, "sequencing_risk_report.md");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function numeric(value) {
  return Number(value || 0);
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean).map(String))).sort();
}

function idsFromEntities(items) {
  const ids = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (item?.entity_id) ids.push(item.entity_id);
    if (item?.object_id) ids.push(item.object_id);
  }
  return unique(ids);
}

function intersect(left, right) {
  const rightSet = new Set(right);
  return left.filter((item) => rightSet.has(item));
}

function sequencingItems(readiness) {
  const details = readiness?.extraction_readiness?.details || [];
  return details.filter((item) => item.status === "blocked"
    && (item.blockers || []).some((blocker) => blocker.kind === "sequencing_risk"));
}

function summarizeSnapshot(item) {
  const outputPath = path.resolve(ROOT, item.output_file);
  const snapshot = readJson(outputPath);
  const stages = snapshot.movement_inventory?.stages || [];
  const documentStages = stages.filter((stage) => stage.source === "document_rule");
  const topoStages = stages.filter((stage) => stage.source === "topo_mover");
  const documentAffected = idsFromEntities((snapshot.document_rule_diagnostics?.applied_rules || []).flatMap((rule) => rule.affected_entities || []));
  const topoMoved = idsFromEntities(snapshot.topo_diagnostics?.moved_entities || []);
  const overlapping = intersect(documentAffected, topoMoved);
  const assertions = snapshot.resolver_plan_assertions?.assertions || [];
  const stageBoundaryPlan = buildStageBoundaryPlan({ movementInventory: snapshot.movement_inventory });
  return {
    fixture: item.fixture,
    mode: item.mode,
    output_file: item.output_file,
    status: item.status,
    stage_order: item.stage_order || [],
    axes: item.axes || [],
    movement_stage_count: numeric(item.movement_stage_count),
    blockers: item.blockers || [],
    review_items: item.review_items || [],
    document_rule_stages: documentStages.map((stage) => ({
      stage_index: stage.stage_index,
      rule_id: stage.rule_id,
      axis: stage.axis,
      dx: stage.dx,
      dy: stage.dy,
      value_mm: stage.value_mm,
      affected_count: stage.affected_count,
      post_repair: stage.post_repair,
      post_repair_status: stage.post_repair_status,
      requires_repair: stage.requires_repair
    })),
    topo_stages: topoStages.map((stage) => ({
      stage_index: stage.stage_index,
      group: stage.group,
      zone: stage.zone,
      axis: stage.axis,
      dx: stage.dx,
      dy: stage.dy,
      affected_count: stage.affected_count,
      post_repair: stage.post_repair,
      post_repair_status: stage.post_repair_status,
      requires_repair: stage.requires_repair
    })),
    document_affected_count: documentAffected.length,
    topo_moved_count: topoMoved.length,
    overlapping_entity_count: overlapping.length,
    overlapping_entity_sample: overlapping.slice(0, 40),
    assertion_codes: assertions.map((assertion) => assertion.code).filter(Boolean),
    required_resolution: [
      "execute document-rule Y movement as an explicit stage",
      "stabilize/recompute active geometry and local join graph after the Y stage",
      "then execute TOPO X movement against the stabilized geometry",
      "validate repair/rejoin after each stage before child serialization"
    ],
    stage_boundary_plan: stageBoundaryPlan,
    extraction_decision: "blocked_until_stage_sequencing_contract_is_implemented"
  };
}

function markdown(report) {
  const lines = [
    "# Sequencing Risk Report",
    "",
    "- behavior_change: false",
    "- sequencing risk count: " + report.summary.sequencing_risk_count,
    "- production activation: not approved",
    "- cleanup: not approved",
    ""
  ];
  for (const item of report.items) {
    lines.push("## " + item.fixture + " / " + item.mode);
    lines.push("- output: " + item.output_file);
    lines.push("- stage order: " + item.stage_order.join(" -> "));
    lines.push("- axes: " + item.axes.join(","));
    lines.push("- document affected ids: " + item.document_affected_count);
    lines.push("- topo moved ids: " + item.topo_moved_count);
    lines.push("- overlap ids: " + item.overlapping_entity_count);
    lines.push("- decision: " + item.extraction_decision);
    lines.push("- boundary decision: " + (item.stage_boundary_plan?.activation_decision || "unknown"));
    lines.push("- assertions: " + item.assertion_codes.join(", "));
    lines.push("");
    lines.push("Required resolution:");
    for (const step of item.required_resolution) lines.push("- " + step);
    lines.push("");
  }
  return lines.join("\n");
}

function main() {
  if (!fs.existsSync(READINESS_REPORT_PATH)) {
    throw new Error("Missing extraction readiness report. Run npm run resolver:checkpoint first.");
  }
  const readiness = readJson(READINESS_REPORT_PATH);
  const items = sequencingItems(readiness).map(summarizeSnapshot);
  const report = {
    behavior_change: false,
    generated_by: "npm run resolver:sequencing-risk",
    generated_at: new Date().toISOString(),
    summary: {
      sequencing_risk_count: items.length,
      total_overlapping_entity_count: items.reduce((sum, item) => sum + numeric(item.overlapping_entity_count), 0),
      production_activation_status: "not_approved",
      cleanup_approval: "no"
    },
    items
  };
  fs.writeFileSync(OUTPUT_JSON_PATH, JSON.stringify(report, null, 2) + "\n");
  fs.writeFileSync(OUTPUT_MD_PATH, markdown(report));

  console.log("Resolver sequencing risk");
  console.log("- behavior_change: false");
  console.log("- report: " + path.relative(ROOT, OUTPUT_JSON_PATH));
  console.log("- markdown: " + path.relative(ROOT, OUTPUT_MD_PATH));
  console.log("- sequencing risk count: " + report.summary.sequencing_risk_count);
  console.log("- total overlapping entity count: " + report.summary.total_overlapping_entity_count);
  for (const item of items) {
    console.log("- " + item.fixture + " / " + item.mode
      + " | order=" + item.stage_order.join(" -> ")
      + " | axes=" + item.axes.join(",")
      + " | overlap=" + item.overlapping_entity_count
      + " | decision=" + item.extraction_decision);
  }
}

try {
  main();
} catch (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
