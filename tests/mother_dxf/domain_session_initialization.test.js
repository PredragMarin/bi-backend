"use strict";

const assert = require("assert");
const fs = require("fs");
const fsp = fs.promises;
const os = require("os");
const path = require("path");
const runtime = require("../../src/modules/mother_dxf_v1/module_runtime");

const INOX_CONTEXT = {
  production_program_id: "INOX",
  family_id: "SUDOPERI",
  product_id: "SUD",
  part_id: "SPLO",
  nominal_value_set_id: "nominal_value_set_inox_sudoperi_dummy_v0",
  rule_set_id: "rule_catalog_inox_sud_splo_v0",
  parameter_catalog_id: "parameter_catalog_inox_v0",
  branch_mode: "ALL",
  expected_variant_policy: {
    mode: "required",
    expected_variant_keys: ["PJOVER"]
  }
};

const EMPTY_DXF = [
  "0", "SECTION", "2", "HEADER", "0", "ENDSEC",
  "0", "SECTION", "2", "ENTITIES", "0", "ENDSEC", "0", "EOF"
].join("\n");

async function createWorkingSession(root, title) {
  const draft = await runtime.createContextDraftSession({ context: INOX_CONTEXT, storeRoot: root });
  const locked = await runtime.lockSessionContext({
    sessionId: draft.session_id,
    context: INOX_CONTEXT,
    storeRoot: root
  });
  assert.strictEqual(locked.parameter_catalog.catalog_id, "parameter_catalog_inox_v0");
  assert.strictEqual(locked.rule_catalog.catalog_id, "rule_catalog_inox_sud_splo_v0");
  assert.strictEqual(locked.config_parameter_set.family, "SUDOPERI");
  assert.strictEqual(locked.config_parameter_set.product, "SUD");
  assert.strictEqual(locked.config_parameter_set.part, "SPLO");
  assert.strictEqual(locked.config_parameter_set.parameters.pjover, "Ne");
  assert.strictEqual(locked.config_parameter_set.parameters.MODEL_VRATA, undefined);

  const result = await runtime.createSession({
    sessionId: locked.session_id,
    sessionContext: locked.session_context_v1,
    dxfText: EMPTY_DXF,
    sourceName: title + ".dxf",
    rawSourceName: "SPLO_SUD_combined2.dxf",
    title,
    bands: { left: 80, right: 80, top: 295, bottom: 85 },
    storeRoot: root
  });
  return result.session;
}

async function main() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "mother-domain-session-"));
  const first = await createWorkingSession(root, "SPLO_SUD_combined2_1");
  const second = await createWorkingSession(root, "SPLO_SUD_combined2_2");

  assert.notStrictEqual(first.session_id, second.session_id);
  assert.strictEqual(first.raw_source_name, second.raw_source_name);
  assert(first.storage_key.startsWith("SPLO_SUD_combined2_1__"));
  assert(second.storage_key.startsWith("SPLO_SUD_combined2_2__"));

  await assert.rejects(
    runtime.createContextDraftSession({
      context: { ...INOX_CONTEXT, rule_set_id: "rule_catalog_mxd_missing_v0" },
      storeRoot: root
    }),
    (error) => error && error.code === "SESSION_CONTEXT_ARTIFACT_INVALID"
  );

  await assert.rejects(
    runtime.updateConfigParameterSet({
      sessionId: first.session_id,
      configParameterSet: {
        ...first.config_parameter_set,
        parameter_catalog_id: "legacy_door_configurator_catalog_v0"
      },
      storeRoot: root
    }),
    (error) => error && error.code === "CONFIG_PARAMETER_CATALOG_MISMATCH"
  );

  const sessions = await runtime.listSessionSummaries({ storeRoot: root });
  assert.strictEqual(sessions.length, 2);
  assert(sessions.some((session) => session.title === "SPLO_SUD_combined2_1"));
  assert(sessions.some((session) => session.title === "SPLO_SUD_combined2_2"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
