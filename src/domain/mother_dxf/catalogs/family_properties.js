"use strict";

const { assertId, assertPlainObject, clonePlain, freezeDeep } = require("../core/identity");

const ALLOWED_VALUE_TYPES = new Set(["string", "number", "boolean", "enum", "json"]);

function normalizeProperty(property) {
  assertPlainObject(property, "family property");
  assertId(property.key, "family property key");
  const valueType = property.value_type || "string";
  if (!ALLOWED_VALUE_TYPES.has(valueType)) {
    throw new Error("Unsupported family property value_type: " + valueType);
  }

  return {
    key: property.key,
    value_type: valueType,
    required: Boolean(property.required),
    enum_values: Array.isArray(property.enum_values) ? property.enum_values.slice() : [],
    default_value: clonePlain(property.default_value),
    affects_parameter_keys: Array.isArray(property.affects_parameter_keys) ? property.affects_parameter_keys.slice() : [],
    affects_rule_tags: Array.isArray(property.affects_rule_tags) ? property.affects_rule_tags.slice() : []
  };
}

function defineFamilyProperties(input) {
  assertPlainObject(input, "family properties");
  assertId(input.family_id, "family id");

  return freezeDeep({
    entity_type: "family_properties",
    family_id: input.family_id,
    version: String(input.version || "1.0.0"),
    material_scope: Array.isArray(input.material_scope) ? input.material_scope.slice() : [],
    properties: (input.properties || []).map(normalizeProperty),
    metadata: clonePlain(input.metadata || {})
  });
}

module.exports = { defineFamilyProperties };

