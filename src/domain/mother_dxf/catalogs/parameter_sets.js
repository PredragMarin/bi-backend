"use strict";

const { assertId, assertPlainObject, clonePlain, freezeDeep } = require("../core/identity");

const OVERRIDE_LEVELS = Object.freeze([
  "base",
  "technology_unit",
  "family",
  "product",
  "part",
  "batch_item"
]);

function normalizeOverride(override) {
  assertPlainObject(override, "parameter override");
  const level = override.level || "base";
  if (!OVERRIDE_LEVELS.includes(level)) {
    throw new Error("Unsupported parameter override level: " + level);
  }

  return {
    level,
    selector: clonePlain(override.selector || {}),
    values: clonePlain(override.values || {})
  };
}

function defineParameterSet(input) {
  assertPlainObject(input, "parameter set");
  assertId(input.id, "parameter set id");

  return freezeDeep({
    entity_type: "parameter_set",
    id: input.id,
    version: String(input.version || "1.0.0"),
    compatible_technology_units: Array.isArray(input.compatible_technology_units) ? input.compatible_technology_units.slice() : [],
    compatible_family_ids: Array.isArray(input.compatible_family_ids) ? input.compatible_family_ids.slice() : [],
    base_values: clonePlain(input.base_values || {}),
    overrides: (input.overrides || []).map(normalizeOverride),
    normalization_hints: clonePlain(input.normalization_hints || {}),
    metadata: clonePlain(input.metadata || {})
  });
}

function selectorMatches(selector, context) {
  for (const [key, expected] of Object.entries(selector || {})) {
    if (context[key] !== expected) return false;
  }
  return true;
}

function resolveParameterSetForContext(parameterSet, context) {
  assertPlainObject(parameterSet, "parameter set");
  const ctx = context || {};
  const values = clonePlain(parameterSet.base_values || {});
  const applied_overrides = [];

  for (const override of parameterSet.overrides || []) {
    if (!selectorMatches(override.selector, ctx)) continue;
    Object.assign(values, clonePlain(override.values || {}));
    applied_overrides.push({
      level: override.level,
      selector: clonePlain(override.selector)
    });
  }

  return {
    parameter_set_id: parameterSet.id,
    parameter_set_version: parameterSet.version,
    context: clonePlain(ctx),
    values,
    applied_overrides
  };
}

module.exports = {
  OVERRIDE_LEVELS,
  defineParameterSet,
  resolveParameterSetForContext
};

