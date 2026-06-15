"use strict";

const assert = require("assert");
const runtime = require("../../src/modules/mother_dxf_v1/module_runtime");

for (const mode of ["four_band_parameter_resize", "fixed_envelope_slide", "static_geometry"]) {
  const strategy = runtime.normalizeGeometryStrategyV1(mode);
  assert.strictEqual(strategy.mode, mode);
  assert.strictEqual(strategy.status, "confirmed");
  assert.strictEqual(strategy.source, "manual");
}

assert.throws(
  () => runtime.normalizeGeometryStrategyV1(""),
  /Select a supported geometry parametrization strategy/
);
