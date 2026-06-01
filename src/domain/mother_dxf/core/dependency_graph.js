"use strict";

const { EDGE_TYPES } = require("./constants");

function addNode(graph, id, type, payload) {
  if (!graph.nodes[id]) {
    graph.nodes[id] = { id, type, payload: payload || null };
  }
}

function addEdge(graph, from, to, type) {
  if (!from || !to) return;
  graph.edges.push({ from, to, type });
}

function buildDependencyGraph(registry) {
  const graph = { nodes: {}, edges: [] };

  for (const unit of registry.technology_units || []) {
    addNode(graph, "technology_unit:" + unit.id, "technology_unit", unit);
  }

  for (const parameterSet of registry.parameter_sets || []) {
    const nodeId = "parameter_set:" + parameterSet.id;
    addNode(graph, nodeId, "parameter_set", parameterSet);
    for (const unitId of parameterSet.compatible_technology_units || []) {
      addEdge(graph, nodeId, "technology_unit:" + unitId, EDGE_TYPES.USES_TECHNOLOGY_UNIT);
    }
  }

  for (const ruleSet of registry.rule_sets || []) {
    const nodeId = "rule_set:" + ruleSet.id;
    addNode(graph, nodeId, "rule_set", ruleSet);
    addEdge(graph, nodeId, "technology_unit:" + ruleSet.technology_unit_id, EDGE_TYPES.USES_TECHNOLOGY_UNIT);
    for (const dependency of ruleSet.depends_on_rule_sets || []) {
      addEdge(graph, nodeId, "rule_set:" + dependency, EDGE_TYPES.DEPENDS_ON_RULE_SET);
    }
  }

  for (const family of registry.family_properties || []) {
    addNode(graph, "family_properties:" + family.family_id, "family_properties", family);
  }

  for (const product of registry.product_structures || []) {
    const productNode = "product_structure:" + product.product_id;
    addNode(graph, productNode, "product_structure", product);
    if (product.family_id) {
      addEdge(graph, productNode, "family_properties:" + product.family_id, EDGE_TYPES.USES_FAMILY_PROPERTIES);
    }
    for (const part of product.parts || []) {
      const partNode = productNode + ":part:" + part.part_id;
      addNode(graph, partNode, "product_part", part);
      addEdge(graph, productNode, partNode, EDGE_TYPES.CONTAINS_PART);
      addEdge(graph, partNode, "technology_unit:" + part.technology_unit_id, EDGE_TYPES.USES_TECHNOLOGY_UNIT);
      addEdge(graph, partNode, "parameter_set:" + part.parameter_set_id, EDGE_TYPES.USES_PARAMETER_SET);
      addEdge(graph, partNode, "rule_set:" + part.rule_set_id, EDGE_TYPES.USES_RULE_SET);
    }
  }

  for (const batch of registry.batch_models || []) {
    const batchNode = "batch_model:" + batch.batch_id;
    addNode(graph, batchNode, "batch_model", batch);
    for (const item of batch.items || []) {
      const itemNode = batchNode + ":item:" + item.item_id;
      addNode(graph, itemNode, "batch_item", item);
      addEdge(graph, batchNode, itemNode, EDGE_TYPES.CONTAINS_BATCH_ITEM);
      addEdge(graph, itemNode, "technology_unit:" + item.technology_unit_id, EDGE_TYPES.USES_TECHNOLOGY_UNIT);
      addEdge(graph, itemNode, "parameter_set:" + item.parameter_set_id, EDGE_TYPES.USES_PARAMETER_SET);
      addEdge(graph, itemNode, "rule_set:" + item.rule_set_id, EDGE_TYPES.USES_RULE_SET);
    }
  }

  return graph;
}

function topologicalSort(graph) {
  const nodes = Object.keys(graph.nodes || {});
  const incoming = new Map(nodes.map((id) => [id, 0]));
  const outgoing = new Map(nodes.map((id) => [id, []]));

  for (const edge of graph.edges || []) {
    if (!incoming.has(edge.to) || !outgoing.has(edge.from)) continue;
    incoming.set(edge.to, incoming.get(edge.to) + 1);
    outgoing.get(edge.from).push(edge.to);
  }

  const queue = nodes.filter((id) => incoming.get(id) === 0).sort();
  const sorted = [];

  while (queue.length) {
    const id = queue.shift();
    sorted.push(id);
    for (const target of outgoing.get(id) || []) {
      incoming.set(target, incoming.get(target) - 1);
      if (incoming.get(target) === 0) queue.push(target);
    }
    queue.sort();
  }

  return {
    sorted,
    has_cycle: sorted.length !== nodes.length,
    unresolved_count: nodes.length - sorted.length
  };
}

module.exports = {
  buildDependencyGraph,
  topologicalSort
};

