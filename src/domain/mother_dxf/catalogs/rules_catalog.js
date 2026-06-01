"use strict";

const { assertId, assertPlainObject, clonePlain, freezeDeep } = require("../core/identity");

function normalizeRule(rule) {
  assertPlainObject(rule, "rule");
  assertId(rule.id, "rule id");
  return {
    id: rule.id,
    severity: rule.severity || "error",
    expression_ref: rule.expression_ref || null,
    tags: Array.isArray(rule.tags) ? rule.tags.slice() : [],
    family_property_conditions: clonePlain(rule.family_property_conditions || {}),
    parameter_conditions: clonePlain(rule.parameter_conditions || {}),
    message: rule.message || rule.id
  };
}

function defineRuleSet(input) {
  assertPlainObject(input, "rule set");
  assertId(input.id, "rule set id");
  assertId(input.technology_unit_id, "rule set technology unit id");

  return freezeDeep({
    entity_type: "rule_set",
    id: input.id,
    version: String(input.version || "1.0.0"),
    technology_unit_id: input.technology_unit_id,
    compatible_family_ids: Array.isArray(input.compatible_family_ids) ? input.compatible_family_ids.slice() : [],
    depends_on_rule_sets: Array.isArray(input.depends_on_rule_sets) ? input.depends_on_rule_sets.slice() : [],
    family_property_refs: Array.isArray(input.family_property_refs) ? input.family_property_refs.slice() : [],
    rules: (input.rules || []).map(normalizeRule),
    metadata: clonePlain(input.metadata || {})
  });
}

function objectContains(expected, actual) {
  for (const [key, value] of Object.entries(expected || {})) {
    if (actual[key] !== value) return false;
  }
  return true;
}

function selectRuleSetsForContext(ruleSets, context) {
  const ctx = context || {};
  return (ruleSets || []).filter((ruleSet) => {
    if (ctx.technology_unit_id && ruleSet.technology_unit_id !== ctx.technology_unit_id) return false;
    if (ctx.family_id && ruleSet.compatible_family_ids.length && !ruleSet.compatible_family_ids.includes(ctx.family_id)) return false;
    return objectContains(ctx.family_properties || {}, ctx.family_properties || {});
  });
}

module.exports = {
  defineRuleSet,
  selectRuleSetsForContext
};

