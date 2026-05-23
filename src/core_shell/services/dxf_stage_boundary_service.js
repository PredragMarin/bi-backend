"use strict";

function numeric(value) {
  return Number(value || 0);
}

function idsFromSample(items) {
  const ids = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (item?.entity_id) ids.push(String(item.entity_id));
    if (item?.object_id) ids.push(String(item.object_id));
  }
  return Array.from(new Set(ids)).sort();
}

function intersect(left, right) {
  const rightSet = new Set(right);
  return left.filter((item) => rightSet.has(item));
}

function stageAxis(stage) {
  const axis = String(stage?.axis || "").trim().toUpperCase();
  if (axis) return axis;
  if (numeric(stage?.dx) !== 0 && numeric(stage?.dy) !== 0) return "XY";
  if (numeric(stage?.dx) !== 0) return "X";
  if (numeric(stage?.dy) !== 0) return "Y";
  return null;
}

function stageDelta(stage) {
  return {
    dx: numeric(stage?.dx),
    dy: numeric(stage?.dy)
  };
}

function boundaryActionsForStage(stage) {
  const actions = [
    "apply_movement",
    "stabilize_geometry_state",
    "recompute_local_join_graph"
  ];
  if (stage?.requires_repair) actions.push("apply_stage_allowed_repair");
  actions.push("validate_stage_result");
  return actions;
}

function normalizeStage(stage) {
  return {
    stage_index: numeric(stage?.stage_index),
    phase: stage?.phase || null,
    source: stage?.source || null,
    source_ref: stage?.source_ref || stage?.rule_id || stage?.group || null,
    rule_id: stage?.rule_id || null,
    group: stage?.group || null,
    zone: stage?.zone || null,
    axis: stageAxis(stage),
    delta: stageDelta(stage),
    affected_count: numeric(stage?.affected_count),
    requires_repair: Boolean(stage?.requires_repair),
    post_repair: stage?.post_repair || null,
    post_repair_status: stage?.post_repair_status || null,
    affected_ids_sample: idsFromSample(stage?.affected_entities_sample)
  };
}

function buildPairwiseRelations(stages) {
  const relations = [];
  for (let i = 0; i < stages.length; i += 1) {
    for (let j = i + 1; j < stages.length; j += 1) {
      const left = stages[i];
      const right = stages[j];
      const overlap = intersect(left.affected_ids_sample, right.affected_ids_sample);
      const crossAxis = Boolean(left.axis && right.axis && left.axis !== right.axis);
      relations.push({
        from_stage_index: left.stage_index,
        to_stage_index: right.stage_index,
        from_axis: left.axis,
        to_axis: right.axis,
        cross_axis: crossAxis,
        overlap_count: overlap.length,
        overlap_sample: overlap.slice(0, 40),
        requires_boundary_checkpoint: crossAxis || overlap.length > 0 || left.requires_repair || right.requires_repair
      });
    }
  }
  return relations;
}

function buildStageBoundaryPlan({ movementInventory }) {
  const stages = (Array.isArray(movementInventory?.stages) ? movementInventory.stages : [])
    .map(normalizeStage)
    .filter((stage) => stage.stage_index > 0)
    .sort((left, right) => left.stage_index - right.stage_index);
  const relations = buildPairwiseRelations(stages);
  const hasCrossAxisOverlap = relations.some((relation) => relation.cross_axis && relation.overlap_count > 0);
  const hasMultiStageRepair = stages.filter((stage) => stage.requires_repair).length > 1;
  const boundaryStages = stages.map((stage) => ({
    ...stage,
    boundary_actions: boundaryActionsForStage(stage),
    checkpoint_after_stage: true
  }));

  return {
    ok: true,
    behavior_change: false,
    mode: "stage_boundary_plan_v1",
    stage_count: stages.length,
    stages: boundaryStages,
    relations,
    requirements: [
      "execute stages in stage_index order",
      "after each movement stage, stabilize geometry before the next stage",
      "after each movement stage, recompute local join graph before the next stage",
      "run stage-local repair and validation before child serialization"
    ],
    activation_decision: hasCrossAxisOverlap || hasMultiStageRepair
      ? "blocked_until_stage_boundary_execution_exists"
      : "candidate_for_future_shadow_execution",
    blockers: [
      ...(hasCrossAxisOverlap ? [{ code: "CROSS_AXIS_OVERLAP", message: "A later stage moves entities already affected by a previous stage on another axis." }] : []),
      ...(hasMultiStageRepair ? [{ code: "MULTI_STAGE_REPAIR", message: "More than one movement stage requires repair; stage-local validation is required before execution activation." }] : [])
    ]
  };
}

module.exports = {
  buildStageBoundaryPlan
};
