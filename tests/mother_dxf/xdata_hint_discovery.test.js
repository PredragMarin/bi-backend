"use strict";

const assert = require("assert");
const hygiene = require("../../src/core_shell/services/dxf_geometry_hygiene_service");

function entityWithMotherXdata(values) {
  return {
    id: "entity-1",
    pairs: [
      { code: "0", value: "LINE" },
      { code: "1001", value: "MOTHERDXF" },
      ...values.map((value) => ({ code: "1000", value }))
    ]
  };
}

const hintEntity = entityWithMotherXdata([
  "RAZINA1=INOX",
  "RAZINA2=PLOCA",
  "RAZINA3=MOKRA"
]);
const hintMetadata = hygiene.collectEntityXdataMetadata(hintEntity);
assert.strictEqual(hintMetadata.observed_xdata_hint, "INOX/PLOCA/MOKRA");
assert.strictEqual(hintMetadata.xdata_classification, "classification_hint");
assert.strictEqual(hintMetadata.geometry_variant, null);
assert.strictEqual(hintMetadata.branch_valid, null);

const hintContext = hygiene.collectXdataContext([{ xdata_metadata: hintMetadata }]);
assert.deepStrictEqual(hintContext.geometry_variants, []);
assert.strictEqual(hintContext.invalid_branch_xdata_count, 0);
assert.strictEqual(hintContext.base_object_count, 1);
assert.deepStrictEqual(hintContext.observed_xdata_hints, [{
  hint: "INOX/PLOCA/MOKRA",
  app: "MOTHERDXF",
  attributes: { RAZINA1: "INOX", RAZINA2: "PLOCA", RAZINA3: "MOKRA" },
  object_count: 1
}]);

const legacyMetadata = hygiene.collectEntityXdataMetadata(entityWithMotherXdata(["GEOMETRY_VARIANT=ECO"]));
assert.strictEqual(legacyMetadata.geometry_variant, "ECO");
assert.strictEqual(legacyMetadata.xdata_classification, "branch_variant");
assert.strictEqual(legacyMetadata.branch_valid, true);
