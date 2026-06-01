"use strict";

const { buildDependencyGraph, topologicalSort } = require("./dependency_graph");

function collectIds(items, key) {
  const ids = new Set();
  const duplicates = [];
  for (const item of items || []) {
    const id = item && item[key];
    if (!id) continue;
    if (ids.has(id)) duplicates.push(id);
    ids.add(id);
  }
  return { ids, duplicates };
}

function pushMissing(errors, entity, id, field, ref) {
  errors.push({
    code: "missing_reference",
    entity,
    id,
    field,
    ref
  });
}

function validateDomainRegistry(registry) {
  const source = registry || {};
  const errors = [];
  const warnings = [];

  const technologyUnits = collectIds(source.technology_units, "id");
  const parameterSets = collectIds(source.parameter_sets, "id");
  const ruleSets = collectIds(source.rule_sets, "id");
  const families = collectIds(source.family_properties, "family_id");
  const products = collectIds(source.product_structures, "product_id");
  const batches = collectIds(source.batch_models, "batch_id");

  for (const id of technologyUnits.duplicates) errors.push({ code: "duplicate_id", entity: "technology_unit", id });
  for (const id of parameterSets.duplicates) errors.push({ code: "duplicate_id", entity: "parameter_set", id });
  for (const id of ruleSets.duplicates) errors.push({ code: "duplicate_id", entity: "rule_set", id });
  for (const id of families.duplicates) errors.push({ code: "duplicate_id", entity: "family_properties", id });
  for (const id of products.duplicates) errors.push({ code: "duplicate_id", entity: "product_structure", id });
  for (const id of batches.duplicates) errors.push({ code: "duplicate_id", entity: "batch_model", id });

  for (const parameterSet of source.parameter_sets || []) {
    for (const unitId of parameterSet.compatible_technology_units || []) {
      if (!technologyUnits.ids.has(unitId)) {
        pushMissing(errors, "parameter_set", parameterSet.id, "compatible_technology_units", unitId);
      }
    }
  }

  for (const ruleSet of source.rule_sets || []) {
    if (!technologyUnits.ids.has(ruleSet.technology_unit_id)) {
      pushMissing(errors, "rule_set", ruleSet.id, "technology_unit_id", ruleSet.technology_unit_id);
    }
    for (const dependency of ruleSet.depends_on_rule_sets || []) {
      if (!ruleSets.ids.has(dependency)) {
        pushMissing(errors, "rule_set", ruleSet.id, "depends_on_rule_sets", dependency);
      }
    }
  }

  for (const product of source.product_structures || []) {
    if (product.family_id && !families.ids.has(product.family_id)) {
      pushMissing(errors, "product_structure", product.product_id, "family_id", product.family_id);
    }
    const partIds = new Set();
    for (const part of product.parts || []) {
      if (partIds.has(part.part_id)) errors.push({ code: "duplicate_part_id", entity: "product_structure", id: product.product_id, part_id: part.part_id });
      partIds.add(part.part_id);
      if (!technologyUnits.ids.has(part.technology_unit_id)) pushMissing(errors, "product_part", part.part_id, "technology_unit_id", part.technology_unit_id);
      if (!parameterSets.ids.has(part.parameter_set_id)) pushMissing(errors, "product_part", part.part_id, "parameter_set_id", part.parameter_set_id);
      if (!ruleSets.ids.has(part.rule_set_id)) pushMissing(errors, "product_part", part.part_id, "rule_set_id", part.rule_set_id);
    }
  }

  for (const batch of source.batch_models || []) {
    const itemIds = new Set();
    for (const item of batch.items || []) {
      if (itemIds.has(item.item_id)) errors.push({ code: "duplicate_batch_item_id", entity: "batch_model", id: batch.batch_id, item_id: item.item_id });
      itemIds.add(item.item_id);
      if (!products.ids.has(item.product_id)) pushMissing(errors, "batch_item", item.item_id, "product_id", item.product_id);
      if (!technologyUnits.ids.has(item.technology_unit_id)) pushMissing(errors, "batch_item", item.item_id, "technology_unit_id", item.technology_unit_id);
      if (!parameterSets.ids.has(item.parameter_set_id)) pushMissing(errors, "batch_item", item.item_id, "parameter_set_id", item.parameter_set_id);
      if (!ruleSets.ids.has(item.rule_set_id)) pushMissing(errors, "batch_item", item.item_id, "rule_set_id", item.rule_set_id);
    }
  }

  const graph = buildDependencyGraph(source);
  const sort = topologicalSort(graph);
  if (sort.has_cycle) {
    errors.push({
      code: "dependency_cycle",
      unresolved_count: sort.unresolved_count
    });
  }

  if (!source.technology_units || !source.technology_units.length) {
    warnings.push({ code: "empty_catalog", entity: "technology_unit" });
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    graph_summary: {
      node_count: Object.keys(graph.nodes).length,
      edge_count: graph.edges.length,
      has_cycle: sort.has_cycle
    }
  };
}

module.exports = { validateDomainRegistry };

