"use strict";

const assert = require("assert");
const runtime = require("../../src/modules/mother_dxf_v1/module_runtime");

const context = {
  version: 1,
  status: "context_locked",
  production_program_id: "INOX",
  family_id: "SUDOPERI",
  product_id: "SUD",
  part_id: "SPLO",
  nominal_value_set_id: "nominal_value_set_inox_sudoperi_dummy_v0",
  rule_set_id: "rule_catalog_inox_sud_splo_v0",
  parameter_catalog_id: "parameter_catalog_inox_v0",
  branch_mode: "ALL",
  expected_variant_policy: { mode: "required", expected_variant_keys: ["PJOVER"] },
  validation: { ok: true, errors: [], warnings: [] }
};

const view = {
  session_context_v1: context,
  document_sem: null,
  xdata_context: { geometry_variants: [], tagged_object_count: 0, branch_filtering_ready: false },
  domain_context_v1: {
    version: 1,
    family: "SUDOPERI",
    product: "SUD",
    part: "SPLO",
    parameter_catalog_id: "parameter_catalog_inox_v0",
    branch_mode: "ALL",
    validation: { ok: true, warnings: [] }
  },
  geometry_context_v1: {
    version: 1,
    slot_width: 3000,
    slots: [{ slot_index: 0 }, { slot_index: 1 }],
    validation: { ok: true, warnings: [] }
  }
};

const session = {
  session_context_v1: context,
  session_lifecycle_v1: { version: 1, state: "geometry_projected" },
  execution_intent_authoring_v1: {
    version: 1,
    slots: [
      { slot_index: 0, variant_key: "BASE", evidence_source: "manual" },
      { slot_index: 1, variant_key: "PJOVER", evidence_source: "manual" }
    ]
  }
};

const valid = runtime.buildDomainValidationV1(session, view);
assert.strictEqual(valid.ok, true);
assert.strictEqual(valid.blocking_error_count, 0);

const missingIntent = runtime.buildDomainValidationV1({
  ...session,
  execution_intent_authoring_v1: { version: 1, slots: [] }
}, view);
assert.strictEqual(missingIntent.ok, false);
assert(missingIntent.errors.some((error) => error.code === "EXPECTED_VARIANT_UNMAPPED"));

const revalidated = runtime.buildDomainValidationV1({
  ...session,
  geometry_validation_v1: { version: 1, status: "projected", ok: true },
  session_lifecycle_v1: { version: 1, state: "authoring_ready" }
}, view);
assert.strictEqual(revalidated.ok, true);
assert(!revalidated.errors.some((error) => error.code === "GEOMETRY_CONTEXT_INVALID"));
