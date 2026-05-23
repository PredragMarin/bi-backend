"use strict";

function buildNoMovementSummary({ result, warnings = [], errors = [] }) {
  const generationSummary = result?.generation_summary || {};
  const simulationSummary = result?.simulation?.summary || result?.resolver_preview?.summary || {};
  const movedEntities = Array.isArray(generationSummary.moved_entities)
    ? generationSummary.moved_entities
    : [];

  return {
    object_count: simulationSummary.object_count ?? generationSummary.entity_count ?? null,
    included_count: simulationSummary.included_count ?? generationSummary.included_count ?? null,
    excluded_count: simulationSummary.excluded_count ?? generationSummary.excluded_count ?? null,
    moved_count: generationSummary.moved_count ?? movedEntities.length,
    moved_entities: movedEntities.map((item) => ({
      entity_id: item.entity_id || null,
      object_id: item.object_id || null,
      type: item.type || null,
      group: item.group || null,
      zone: item.zone || null,
      dx: item.dx ?? null,
      dy: item.dy ?? null
    })),
    warnings: Array.isArray(warnings) ? warnings : [],
    errors: Array.isArray(errors) ? errors : []
  };
}

function stableJson(value) {
  return JSON.stringify(value ?? null);
}

function compareNoMovementSummary(shared, runtime) {
  const fields = [
    "object_count",
    "included_count",
    "excluded_count",
    "moved_count",
    "moved_entities",
    "warnings",
    "errors"
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
  buildNoMovementSummary,
  compareNoMovementSummary
};
