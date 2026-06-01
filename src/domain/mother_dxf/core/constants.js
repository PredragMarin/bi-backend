"use strict";

const DOMAIN_VERSION = 2;

const ENTITY_TYPES = Object.freeze({
  TECHNOLOGY_UNIT: "technology_unit",
  PARAMETER_SET: "parameter_set",
  RULE_SET: "rule_set",
  FAMILY_PROPERTIES: "family_properties",
  PRODUCT_STRUCTURE: "product_structure",
  PRODUCT_PART: "product_part",
  BATCH_MODEL: "batch_model",
  BATCH_ITEM: "batch_item"
});

const EDGE_TYPES = Object.freeze({
  USES_TECHNOLOGY_UNIT: "uses_technology_unit",
  USES_PARAMETER_SET: "uses_parameter_set",
  USES_RULE_SET: "uses_rule_set",
  USES_FAMILY_PROPERTIES: "uses_family_properties",
  OVERRIDES_PARAMETER_SET: "overrides_parameter_set",
  DEPENDS_ON_RULE_SET: "depends_on_rule_set",
  CONTAINS_PART: "contains_part",
  CONTAINS_BATCH_ITEM: "contains_batch_item"
});

module.exports = {
  DOMAIN_VERSION,
  ENTITY_TYPES,
  EDGE_TYPES
};

