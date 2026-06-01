"use strict";

const { assertId, assertPlainObject, clonePlain, freezeDeep } = require("../core/identity");

function defineTechnologyUnit(input) {
  assertPlainObject(input, "technology unit");
  assertId(input.id, "technology unit id");

  return freezeDeep({
    entity_type: "technology_unit",
    id: input.id,
    name: input.name || input.id,
    material_scope: Array.isArray(input.material_scope) ? input.material_scope.slice() : [],
    parameter_schema_refs: Array.isArray(input.parameter_schema_refs) ? input.parameter_schema_refs.slice() : [],
    transformation_refs: Array.isArray(input.transformation_refs) ? input.transformation_refs.slice() : [],
    constraint_refs: Array.isArray(input.constraint_refs) ? input.constraint_refs.slice() : [],
    preview_model_refs: Array.isArray(input.preview_model_refs) ? input.preview_model_refs.slice() : [],
    batch_model_refs: Array.isArray(input.batch_model_refs) ? input.batch_model_refs.slice() : [],
    metadata: clonePlain(input.metadata || {})
  });
}

module.exports = { defineTechnologyUnit };

