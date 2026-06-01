"use strict";

const {
  defineBatchModel,
  defineFamilyProperties,
  defineParameterSet,
  defineProductInParts,
  defineRuleSet,
  defineTechnologyUnit
} = require("..");

function createInoxRegistryV2() {
  const technology_units = [
    defineTechnologyUnit({
      id: "inox_laser_cutting",
      name: "INOX laser cutting",
      material_scope: ["inox"],
      transformation_refs: ["dxf_transform:laser_cutting_v1"],
      preview_model_refs: ["preview:flat_pattern_v1"],
      batch_model_refs: ["batch:mixed_technology_v1"]
    }),
    defineTechnologyUnit({
      id: "inox_bending",
      name: "INOX bending",
      material_scope: ["inox"],
      transformation_refs: ["dxf_transform:bending_marks_v1"],
      preview_model_refs: ["preview:bend_sequence_v1"],
      batch_model_refs: ["batch:mixed_technology_v1"]
    })
  ];

  const family_properties = [
    defineFamilyProperties({
      family_id: "inox_door_family",
      version: "2.0.0",
      material_scope: ["inox"],
      properties: [
        {
          key: "surface_finish",
          value_type: "enum",
          enum_values: ["brushed", "polished"],
          affects_parameter_keys: ["kerf_compensation"],
          affects_rule_tags: ["surface"]
        },
        {
          key: "sheet_thickness_mm",
          value_type: "number",
          required: true,
          affects_parameter_keys: ["bend_allowance_mm", "cut_speed_mm_min"],
          affects_rule_tags: ["thickness"]
        }
      ]
    })
  ];

  const parameter_sets = [
    defineParameterSet({
      id: "inox_default_params",
      version: "2.0.0",
      compatible_technology_units: ["inox_laser_cutting", "inox_bending"],
      compatible_family_ids: ["inox_door_family"],
      base_values: {
        kerf_compensation: 0.15,
        cut_speed_mm_min: 1200,
        bend_allowance_mm: 1.2
      },
      overrides: [
        {
          level: "technology_unit",
          selector: { technology_unit_id: "inox_bending" },
          values: { bend_allowance_mm: 1.35 }
        },
        {
          level: "family",
          selector: { surface_finish: "polished" },
          values: { kerf_compensation: 0.12 }
        }
      ]
    })
  ];

  const rule_sets = [
    defineRuleSet({
      id: "inox_laser_rules",
      version: "2.0.0",
      technology_unit_id: "inox_laser_cutting",
      compatible_family_ids: ["inox_door_family"],
      rules: [
        {
          id: "min_internal_radius",
          severity: "error",
          expression_ref: "rule_expression:min_internal_radius_v1",
          tags: ["geometry", "thickness"]
        }
      ]
    }),
    defineRuleSet({
      id: "inox_bending_rules",
      version: "2.0.0",
      technology_unit_id: "inox_bending",
      compatible_family_ids: ["inox_door_family"],
      rules: [
        {
          id: "max_bend_count",
          severity: "warning",
          expression_ref: "rule_expression:max_bend_count_v1",
          tags: ["bending"]
        }
      ]
    })
  ];

  const product_structures = [
    defineProductInParts({
      product_id: "inox_door_leaf",
      version: "2.0.0",
      family_id: "inox_door_family",
      program_id: "inox_program",
      erp_product_ref: "ERP:PRODUCT:INOX_DOOR_LEAF",
      parts: [
        {
          part_id: "leaf_panel",
          erp_item_ref: "ERP:ITEM:LEAF_PANEL",
          material_family: "inox",
          technology_unit_id: "inox_laser_cutting",
          parameter_set_id: "inox_default_params",
          rule_set_id: "inox_laser_rules"
        },
        {
          part_id: "leaf_bends",
          parent_part_id: "leaf_panel",
          erp_item_ref: "ERP:ITEM:LEAF_BENDS",
          material_family: "inox",
          technology_unit_id: "inox_bending",
          parameter_set_id: "inox_default_params",
          rule_set_id: "inox_bending_rules"
        }
      ]
    })
  ];

  const batch_models = [
    defineBatchModel({
      batch_id: "inox_mixed_batch_template",
      version: "2.0.0",
      batch_type: "mixed_technology",
      items: [
        {
          item_id: "cut_leaf_panel",
          product_id: "inox_door_leaf",
          part_id: "leaf_panel",
          technology_unit_id: "inox_laser_cutting",
          parameter_set_id: "inox_default_params",
          rule_set_id: "inox_laser_rules",
          scheduling_group: "laser"
        },
        {
          item_id: "bend_leaf_panel",
          product_id: "inox_door_leaf",
          part_id: "leaf_bends",
          technology_unit_id: "inox_bending",
          parameter_set_id: "inox_default_params",
          rule_set_id: "inox_bending_rules",
          scheduling_group: "bending"
        }
      ]
    })
  ];

  return {
    domain: "mother_dxf",
    domain_version: 2,
    technology_units,
    family_properties,
    parameter_sets,
    rule_sets,
    product_structures,
    batch_models
  };
}

module.exports = { createInoxRegistryV2 };

