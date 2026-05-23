"use strict";

function normalizeMovedEntity(item) {
  return {
    entity_id: item?.entity_id || null,
    object_id: item?.object_id || null,
    type: item?.type || null,
    group: item?.group || null,
    zone: item?.zone || null,
    dx: item?.dx ?? null,
    dy: item?.dy ?? null
  };
}

function uniqueSortedNumbers(items, key) {
  const values = (Array.isArray(items) ? items : [])
    .map((item) => Number(item?.[key]))
    .filter((value) => Number.isFinite(value));
  return Array.from(new Set(values)).sort((a, b) => a - b);
}

function buildTopoXOnlySummary({ result }) {
  const generationSummary = result?.generation_summary || {};
  const movedEntities = Array.isArray(generationSummary.moved_entities)
    ? generationSummary.moved_entities
    : [];

  return {
    topology_mode: generationSummary.topology_mode || null,
    topo_group: generationSummary.topo_group || null,
    axis: generationSummary.axis || null,
    trim_policy: generationSummary.trim_policy || null,
    trim_policy_status: generationSummary.trim_policy_status || null,
    moved_count: generationSummary.moved_count ?? movedEntities.length,
    dx_values: uniqueSortedNumbers(movedEntities, "dx"),
    dy_values: uniqueSortedNumbers(movedEntities, "dy"),
    moved_entities: movedEntities.map(normalizeMovedEntity)
  };
}

function stableJson(value) {
  return JSON.stringify(value ?? null);
}

function compareTopoXOnlySummary(shared, runtime) {
  const fields = [
    "topology_mode",
    "topo_group",
    "axis",
    "trim_policy",
    "trim_policy_status",
    "moved_count",
    "dx_values",
    "dy_values",
    "moved_entities"
  ];
  const mismatches = [];
  for (const field of fields) {
    if (stableJson(shared?.[field]) !== stableJson(runtime?.[field])) {
      mismatches.push({
        field,
        shared: shared?.[field] ?? null,
        runtime: runtime?.[field] ?? null
      });
    }
  }
  return {
    ok: mismatches.length === 0,
    mismatch_count: mismatches.length,
    mismatches
  };
}

module.exports = {
  buildTopoXOnlySummary,
  compareTopoXOnlySummary
};
