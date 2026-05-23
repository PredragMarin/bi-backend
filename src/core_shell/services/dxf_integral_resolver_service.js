"use strict";

const { buildStageBoundaryPlan } = require("./dxf_stage_boundary_service");
const {
  buildMovementInventory,
  buildResolverPlan,
  buildResolverPlanAssertions,
  buildResolverExtractionReadiness
} = require("./dxf_resolver_plan_service");

function numeric(value) {
  return Number(value || 0);
}

function stableList(values) {
  return Array.from(new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean))).sort();
}

function collectAxes(movementInventory) {
  return stableList((movementInventory?.stages || []).map((stage) => stage.axis));
}

function collectStageSources(movementInventory) {
  return stableList((movementInventory?.stages || []).map((stage) => stage.source));
}

function collectBlockers(stageBoundaryPlan, extractionReadiness) {
  const blockers = [];
  for (const blocker of Array.isArray(stageBoundaryPlan?.blockers) ? stageBoundaryPlan.blockers : []) {
    blockers.push({
      source: "stage_boundary",
      code: blocker.code || "STAGE_BOUNDARY_BLOCKER",
      kind: blocker.kind || "execution_boundary",
      message: blocker.message || null
    });
  }
  for (const blocker of Array.isArray(extractionReadiness?.blockers) ? extractionReadiness.blockers : []) {
    blockers.push({
      source: "extraction_readiness",
      code: blocker.code || "EXTRACTION_BLOCKER",
      kind: blocker.kind || "runtime_review",
      message: blocker.message || null
    });
  }
  return blockers;
}

function activationDecision({ stageBoundaryPlan, extractionReadiness, blockers }) {
  if (blockers.length > 0) return "blocked_until_explicit_stage_execution_exists";
  if (extractionReadiness?.requires_review) return "manual_review_required_before_execution_shadow";
  if (stageBoundaryPlan?.stage_count > 0) return "candidate_for_shadow_execution";
  return "candidate_no_movement";
}

function buildExecutionPlan({ movementInventory, stageBoundaryPlan }) {
  const stages = Array.isArray(stageBoundaryPlan?.stages) ? stageBoundaryPlan.stages : [];
  return {
    mode: "stage_boundary_execution_plan_v1",
    stage_count: stages.length,
    stages: stages.map((stage) => ({
      stage_index: stage.stage_index,
      phase: stage.phase || null,
      source: stage.source || null,
      source_ref: stage.source_ref || null,
      rule_id: stage.rule_id || null,
      group: stage.group || null,
      zone: stage.zone || null,
      axis: stage.axis || null,
      delta: stage.delta || { dx: numeric(stage.dx), dy: numeric(stage.dy) },
      affected_count: numeric(stage.affected_count),
      required_actions: Array.isArray(stage.boundary_actions) ? stage.boundary_actions : []
    })),
    observed_stage_sources: collectStageSources(movementInventory),
    observed_axes: collectAxes(movementInventory)
  };
}

function buildIntegralResolverShadow({
  mode,
  movementInventory,
  resolverPlan,
  extractionReadiness,
  stageBoundaryPlan,
  summary,
  warnings,
  errors
}) {
  const boundaryPlan = stageBoundaryPlan || buildStageBoundaryPlan({
    movementInventory: movementInventory || { stage_count: 0, stages: [] }
  });
  const blockers = collectBlockers(boundaryPlan, extractionReadiness);
  const decision = activationDecision({
    stageBoundaryPlan: boundaryPlan,
    extractionReadiness,
    blockers
  });
  const executionPlan = buildExecutionPlan({
    movementInventory: movementInventory || { stage_count: 0, stages: [] },
    stageBoundaryPlan: boundaryPlan
  });
  const warningCount = Array.isArray(warnings) ? warnings.length : numeric(summary?.warnings?.length);
  const errorCount = Array.isArray(errors) ? errors.length : numeric(summary?.errors?.length);

  return {
    ok: true,
    behavior_change: false,
    mode: "integral_resolver_shadow_v1",
    requested_mode: mode || null,
    production_ready: false,
    execution_status: "not_executed_shadow",
    activation_decision: decision,
    activation_allowed: false,
    activation_reason: "Integral resolver is assembled as a standalone shadow envelope only; Mother runtime remains the behavior source.",
    execution_plan: executionPlan,
    stage_boundary_plan: boundaryPlan,
    resolver_plan: resolverPlan || null,
    extraction_readiness: extractionReadiness || null,
    blockers,
    summary: {
      movement_stage_count: numeric(movementInventory?.stage_count),
      boundary_stage_count: numeric(boundaryPlan?.stage_count),
      warning_count: warningCount,
      error_count: errorCount,
      axes: executionPlan.observed_axes,
      stage_sources: executionPlan.observed_stage_sources
    },
    handoff_contract: [
      "Input is an already normalized Mother DXF session plus config parameter set.",
      "Execution must resolve SEM visibility before collision/sweep validation.",
      "Each movement stage must execute alone, then stabilize geometry state.",
      "Local join graph must be recomputed after every stage before repair.",
      "Repair must be stage-local and must not search outside the active branch geometry.",
      "Child DXF serialization is allowed only after all stages validate.",
      "DBR batch use requires non-interactive errors/warnings and no UI dependencies."
    ]
  };
}

function buildIntegralResolverShadowFromObservation({
  mode,
  snapshotOk = true,
  documentRuleDiagnostics,
  topoDiagnostics,
  pipelineTrace,
  summary,
  warnings,
  errors
}) {
  const movementInventory = buildMovementInventory({
    documentRuleDiagnostics,
    topoDiagnostics
  });
  const resolverPlan = buildResolverPlan({
    movementInventory,
    pipelineTrace: pipelineTrace || null
  });
  const stageBoundaryPlan = buildStageBoundaryPlan({ movementInventory });
  const resolverPlanAssertions = buildResolverPlanAssertions({
    movementInventory,
    resolverPlan,
    topoDiagnostics: topoDiagnostics || { runtime: {} }
  });
  const extractionReadiness = buildResolverExtractionReadiness({
    snapshotOk,
    movementInventory,
    resolverPlan,
    resolverPlanAssertions
  });
  const integralResolverShadow = buildIntegralResolverShadow({
    mode,
    movementInventory,
    resolverPlan,
    extractionReadiness,
    stageBoundaryPlan,
    summary,
    warnings,
    errors
  });

  return {
    movement_inventory: movementInventory,
    resolver_plan: resolverPlan,
    stage_boundary_plan: stageBoundaryPlan,
    resolver_plan_assertions: resolverPlanAssertions,
    extraction_readiness: extractionReadiness,
    integral_resolver_shadow: integralResolverShadow
  };
}

module.exports = {
  buildIntegralResolverShadow,
  buildIntegralResolverShadowFromObservation
};
