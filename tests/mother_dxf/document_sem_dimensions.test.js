"use strict";

const assert = require("assert");
const runtime = require("../../src/modules/mother_dxf_v1/module_runtime");

const inox = {
  nominal_dimensions: { length: 1000, width: 600, height: 850 },
  family: "SUDOPERI",
  product: "SUD",
  part: "SPLO"
};
const normalizedInox = runtime.normalizeDocumentSemPayload(inox);
assert.deepStrictEqual(normalizedInox.nominal_dimensions, { length: 1000, width: 600, height: 850 });
assert.strictEqual(
  runtime.buildDocumentSemIdentityComment(inox),
  "SEM:document=true;nominal_length=1000;nominal_width=600;nominal_height=850;family=SUDOPERI;product=SUD;part=SPLO"
);

const legacyMxd = runtime.normalizeDocumentSemPayload({
  nominal_width: 900,
  nominal_height: 2100,
  family: "VRATA",
  product: "PPV",
  part: "LBRA"
});
assert.deepStrictEqual(legacyMxd.nominal_dimensions, { width: 900, height: 2100 });
