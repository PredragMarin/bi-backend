"use strict";

const { assertId, assertPlainObject, clonePlain, freezeDeep } = require("../core/identity");

function normalizePart(part) {
  assertPlainObject(part, "product part");
  assertId(part.part_id, "part id");
  assertId(part.technology_unit_id, "part technology unit id");
  assertId(part.parameter_set_id, "part parameter set id");
  assertId(part.rule_set_id, "part rule set id");

  return {
    part_id: part.part_id,
    parent_part_id: part.parent_part_id || null,
    erp_item_ref: part.erp_item_ref || null,
    material_family: part.material_family || null,
    technology_unit_id: part.technology_unit_id,
    parameter_set_id: part.parameter_set_id,
    rule_set_id: part.rule_set_id,
    quantity: Number.isFinite(part.quantity) ? part.quantity : 1,
    constraints: clonePlain(part.constraints || {}),
    metadata: clonePlain(part.metadata || {})
  };
}

function defineProductInParts(input) {
  assertPlainObject(input, "product structure");
  assertId(input.product_id, "product id");

  return freezeDeep({
    entity_type: "product_structure",
    product_id: input.product_id,
    version: String(input.version || "1.0.0"),
    family_id: input.family_id || null,
    program_id: input.program_id || null,
    erp_product_ref: input.erp_product_ref || null,
    parts: (input.parts || []).map(normalizePart),
    metadata: clonePlain(input.metadata || {})
  });
}

function listTechnologyUnitsForProduct(productStructure) {
  const ids = new Set();
  for (const part of productStructure.parts || []) {
    ids.add(part.technology_unit_id);
  }
  return Array.from(ids).sort();
}

module.exports = {
  defineProductInParts,
  listTechnologyUnitsForProduct
};

