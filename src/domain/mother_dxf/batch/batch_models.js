"use strict";

const { assertId, assertPlainObject, clonePlain, freezeDeep } = require("../core/identity");

function normalizeBatchItem(item) {
  assertPlainObject(item, "batch item");
  assertId(item.item_id, "batch item id");
  assertId(item.product_id, "batch item product id");
  assertId(item.part_id, "batch item part id");
  assertId(item.technology_unit_id, "batch item technology unit id");
  assertId(item.parameter_set_id, "batch item parameter set id");
  assertId(item.rule_set_id, "batch item rule set id");

  return {
    item_id: item.item_id,
    product_id: item.product_id,
    part_id: item.part_id,
    technology_unit_id: item.technology_unit_id,
    parameter_set_id: item.parameter_set_id,
    rule_set_id: item.rule_set_id,
    quantity: Number.isFinite(item.quantity) ? item.quantity : 1,
    scheduling_group: item.scheduling_group || null,
    constraints: clonePlain(item.constraints || {}),
    overrides: clonePlain(item.overrides || {})
  };
}

function defineBatchModel(input) {
  assertPlainObject(input, "batch model");
  assertId(input.batch_id, "batch id");

  return freezeDeep({
    entity_type: "batch_model",
    batch_id: input.batch_id,
    version: String(input.version || "1.0.0"),
    batch_type: input.batch_type || "mixed_technology",
    items: (input.items || []).map(normalizeBatchItem),
    constraints: clonePlain(input.constraints || {}),
    metadata: clonePlain(input.metadata || {})
  });
}

function listBatchExecutionUnits(batchModel) {
  return (batchModel.items || []).map((item) => ({
    batch_id: batchModel.batch_id,
    item_id: item.item_id,
    product_id: item.product_id,
    part_id: item.part_id,
    technology_unit_id: item.technology_unit_id,
    parameter_set_id: item.parameter_set_id,
    rule_set_id: item.rule_set_id,
    scheduling_group: item.scheduling_group
  }));
}

module.exports = {
  defineBatchModel,
  listBatchExecutionUnits
};

