"use strict";

function movementDeltaForAxis(axis, value) {
  const normalizedAxis = String(axis || "").toUpperCase();
  const numericValue = Number(value || 0);
  return {
    dx: normalizedAxis === "X" ? numericValue : 0,
    dy: normalizedAxis === "Y" ? numericValue : 0
  };
}

function affectedEntitySample(items) {
  return (Array.isArray(items) ? items : []).slice(0, 25).map((entity) => ({
    entity_id: entity.entity_id || null,
    object_id: entity.object_id || null,
    type: entity.type || null
  }));
}

function normalizeRuleMovement(rule, phase) {
  const axis = String(rule?.axis || "").toUpperCase() || null;
  const value = Number(rule?.value_mm || 0);
  const delta = movementDeltaForAxis(axis, value);
  if (!axis && !value) return null;
  const source = phase === "post_topo_rules" ? "post_topo_rule" : "document_rule";
  return {
    phase,
    source,
    movement_kind: rule?.action?.geometry || rule?.geometry || "offset",
    source_ref: rule?.rule_id || null,
    rule_id: rule?.rule_id || null,
    axis,
    value_mm: Number.isFinite(value) ? value : null,
    dx: delta.dx,
    dy: delta.dy,
    affected_count: Number(rule?.affected_count || 0),
    post_repair: rule?.post_repair || null,
    post_repair_status: rule?.post_repair_status || null,
    requires_repair: Boolean(rule?.post_repair),
    affected_entities_sample: affectedEntitySample(rule?.affected_entities)
  };
}

function normalizeRuleMovements(rules, phase) {
  return (Array.isArray(rules) ? rules : [])
    .map((rule) => normalizeRuleMovement(rule, phase))
    .filter(Boolean);
}

function normalizeDocumentRuleMovements(documentRuleDiagnostics) {
  return normalizeRuleMovements(documentRuleDiagnostics?.applied_rules, "document_rules");
}

function normalizePostTopoRuleMovements(documentRuleDiagnostics) {
  return normalizeRuleMovements(documentRuleDiagnostics?.post_topo_rules, "post_topo_rules");
}

function normalizeTopoMovements(topoDiagnostics) {
  const grouped = new Map();
  for (const item of Array.isArray(topoDiagnostics?.moved_entities) ? topoDiagnostics.moved_entities : []) {
    const key = [item.group || "", item.zone || "", item.dx ?? 0, item.dy ?? 0].join("|");
    if (!grouped.has(key)) {
      grouped.set(key, {
        phase: "topo_simulation",
        source: "topo_mover",
        movement_kind: "offset",
        source_ref: item.group || null,
        group: item.group || null,
        zone: item.zone || null,
        axis: topoDiagnostics?.runtime?.axis || null,
        value_mm: null,
        dx: Number(item.dx || 0),
        dy: Number(item.dy || 0),
        affected_count: 0,
        post_repair: topoDiagnostics?.runtime?.trim_policy || null,
        post_repair_status: topoDiagnostics?.runtime?.trim_policy_status || null,
        requires_repair: Boolean(topoDiagnostics?.runtime?.trim_policy),
        affected_entities_sample: []
      });
    }
    const entry = grouped.get(key);
    entry.affected_count += 1;
    if (entry.affected_entities_sample.length < 25) {
      entry.affected_entities_sample.push({
        entity_id: item.entity_id || null,
        object_id: item.object_id || null,
        type: item.type || null
      });
    }
  }
  return Array.from(grouped.values());
}

function buildMovementInventory({ documentRuleDiagnostics, topoDiagnostics }) {
  const stages = [];
  stages.push(...normalizeDocumentRuleMovements(documentRuleDiagnostics));
  stages.push(...normalizeTopoMovements(topoDiagnostics));
  stages.push(...normalizePostTopoRuleMovements(documentRuleDiagnostics));
  return {
    stage_count: stages.length,
    stages: stages.map((stage, index) => ({ stage_index: index + 1, ...stage }))
  };
}

function stageMovesOnAxis(stage, axis) {
  const normalizedAxis = String(axis || "").toUpperCase();
  if (String(stage?.axis || "").toUpperCase() === normalizedAxis) return true;
  if (normalizedAxis === "X") return Number(stage?.dx || 0) !== 0;
  if (normalizedAxis === "Y") return Number(stage?.dy || 0) !== 0;
  return false;
}

function buildResolverPlanAssertions({ movementInventory, resolverPlan, topoDiagnostics }) {
  const stages = Array.isArray(movementInventory?.stages) ? movementInventory.stages : [];
  const assertions = [];
  const documentRuleYStages = stages.filter((stage) => stage.source === "document_rule" && stageMovesOnAxis(stage, "Y"));
  const topoXStages = stages.filter((stage) => stage.source === "topo_mover" && stageMovesOnAxis(stage, "X"));
  const topoYStages = stages.filter((stage) => stage.source === "topo_mover" && stageMovesOnAxis(stage, "Y"));
  const hasDocumentRuleYAndTopoX = documentRuleYStages.length > 0 && topoXStages.length > 0;
  const documentRuleY9p5Stages = documentRuleYStages.filter((stage) => Math.abs(Math.abs(Number(stage.dy || stage.value_mm || 0)) - 9.5) < 0.000001);
  const runtimeDyValues = Array.isArray(topoDiagnostics?.runtime?.dy_range?.values) ? topoDiagnostics.runtime.dy_range.values : [];
  const hasRuntimeTopoYMovement = topoYStages.length > 0 || runtimeDyValues.some((value) => Number(value) !== 0);
  const inertPostTopoStages = stages.filter((stage) => {
    if (stage.source !== "post_topo_rule") return false;
    const hasAxis = Boolean(String(stage.axis || "").trim());
    const dx = Number(stage.dx || 0);
    const dy = Number(stage.dy || 0);
    return hasAxis && dx === 0 && dy === 0;
  });

  if (hasDocumentRuleYAndTopoX) {
    assertions.push({
      code: "DOCUMENT_RULE_Y_BEFORE_TOPO_X",
      severity: "warning",
      status: "observed",
      message: "Observed document-rule Y movement and TOPO X movement in the same runtime plan; future resolver extraction should preserve or explicitly redefine stage sequencing with recalculation checkpoints.",
      document_rule_stage_indexes: documentRuleYStages.map((stage) => stage.stage_index),
      topo_stage_indexes: topoXStages.map((stage) => stage.stage_index),
      document_rule_count: documentRuleYStages.length,
      topo_count: topoXStages.length
    });
  }

  if (documentRuleY9p5Stages.length > 0 && !hasRuntimeTopoYMovement) {
    assertions.push({
      code: "DOCUMENT_RULE_Y_9P5_NOT_RUNTIME_TOPO_Y",
      severity: "info",
      status: "observed",
      message: "Observed B-layer Y 9.5 document-rule movement, but runtime TOPO moved_entities do not expose a Y movement; future validation should not rely only on TOPO moved_entities for this stage.",
      document_rule_stage_indexes: documentRuleY9p5Stages.map((stage) => stage.stage_index),
      document_rule_count: documentRuleY9p5Stages.length,
      runtime_dy_values: runtimeDyValues
    });
  }

  if (inertPostTopoStages.length > 0) {
    assertions.push({
      code: "POST_TOPO_AXIS_WITH_ZERO_DELTA",
      severity: "info",
      status: "observed",
      message: "Observed post-topo rule stage with declared axis but zero dx/dy in movement inventory; keep this historical branch visible before extracting execution logic.",
      post_topo_stage_indexes: inertPostTopoStages.map((stage) => stage.stage_index),
      post_topo_count: inertPostTopoStages.length
    });
  }

  if (resolverPlan?.reorder_candidate) {
    assertions.push({
      code: "REORDER_CANDIDATE",
      severity: "info",
      status: "observed",
      message: "Observed plan is a candidate for explicit sequencing review before movement execution is extracted.",
      stage_order: Array.isArray(resolverPlan.stage_order) ? resolverPlan.stage_order : [],
      axes: Array.isArray(resolverPlan.axes) ? resolverPlan.axes : []
    });
  }

  return {
    ok: true,
    behavior_change: false,
    checked_stage_count: stages.length,
    warning_count: assertions.filter((item) => item.severity === "warning").length,
    info_count: assertions.filter((item) => item.severity === "info").length,
    assertions
  };
}

function blockerKindForCode(code) {
  if (code === "DIAGNOSTIC_ERROR") return "fixture_or_entrypoint_gap";
  if (code === "DOCUMENT_RULE_Y_BEFORE_TOPO_X") return "sequencing_risk";
  return "runtime_review";
}

function buildResolverExtractionReadiness({ snapshotOk = true, movementInventory, resolverPlan, resolverPlanAssertions }) {
  const assertions = Array.isArray(resolverPlanAssertions?.assertions) ? resolverPlanAssertions.assertions : [];
  const warningAssertions = assertions.filter((item) => item.severity === "warning");
  const infoAssertions = assertions.filter((item) => item.severity === "info");
  const blockers = [];
  const reviewItems = [];

  if (!snapshotOk) {
    blockers.push({
      code: "DIAGNOSTIC_ERROR",
      kind: blockerKindForCode("DIAGNOSTIC_ERROR"),
      message: "Snapshot did not complete through the observed Mother DXF runtime path."
    });
  }
  for (const assertion of warningAssertions) {
    {
      const code = assertion.code || "WARNING_ASSERTION";
      blockers.push({
        code,
        kind: blockerKindForCode(code),
        message: assertion.message || null
      });
    }
  }
  for (const assertion of infoAssertions) {
    reviewItems.push({
      code: assertion.code || "INFO_ASSERTION",
      message: assertion.message || null
    });
  }

  const status = blockers.length ? "blocked" : (reviewItems.length ? "review" : "candidate");
  return {
    ok: true,
    behavior_change: false,
    status,
    extraction_candidate: status === "candidate",
    requires_review: status === "review",
    blocked: status === "blocked",
    movement_stage_count: Number(movementInventory?.stage_count || resolverPlan?.movement_stage_count || 0),
    stage_order: Array.isArray(resolverPlan?.stage_order) ? resolverPlan.stage_order : [],
    axes: Array.isArray(resolverPlan?.axes) ? resolverPlan.axes : [],
    blockers,
    review_items: reviewItems
  };
}

function buildResolverPlan({ movementInventory, pipelineTrace }) {
  const stages = Array.isArray(movementInventory?.stages) ? movementInventory.stages : [];
  const phaseOrder = [];
  const seenPhases = new Set();
  for (const stage of stages) {
    const phase = stage.phase || "unknown";
    if (!seenPhases.has(phase)) {
      seenPhases.add(phase);
      phaseOrder.push(phase);
    }
  }
  const axes = Array.from(new Set(stages.map((stage) => String(stage.axis || "").toUpperCase()).filter(Boolean)));
  const hasDocumentRuleMovement = stages.some((stage) => stage.source === "document_rule");
  const hasTopoMovement = stages.some((stage) => stage.source === "topo_mover");
  const hasPostTopoMovement = stages.some((stage) => stage.source === "post_topo_rule");
  const hasMultiAxis = axes.length > 1;
  const traceSteps = Array.isArray(pipelineTrace?.steps) ? pipelineTrace.steps.map((step) => step.name).filter(Boolean) : [];
  return {
    kind: "observed_runtime_plan",
    behavior_change: false,
    stage_order: phaseOrder,
    movement_stage_count: stages.length,
    axes,
    has_document_rule_movement: hasDocumentRuleMovement,
    has_topo_movement: hasTopoMovement,
    has_post_topo_movement: hasPostTopoMovement,
    has_multi_axis_movement: hasMultiAxis,
    reorder_candidate: hasMultiAxis && hasDocumentRuleMovement && hasTopoMovement,
    pipeline_trace_steps: traceSteps,
    notes: hasMultiAxis && hasDocumentRuleMovement && hasTopoMovement
      ? ["Observed plan contains document-rule movement and TOPO movement on different axes; future resolver may need explicit sequencing/recalculation between stages."]
      : []
  };
}

module.exports = {
  normalizeDocumentRuleMovements,
  normalizePostTopoRuleMovements,
  normalizeTopoMovements,
  buildMovementInventory,
  buildResolverPlan,
  buildResolverPlanAssertions,
  buildResolverExtractionReadiness
};
