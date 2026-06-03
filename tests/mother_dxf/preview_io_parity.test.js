"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..", "..");
const runtime = require(path.join(repoRoot, "src", "modules", "mother_dxf_v1", "module_runtime"));

async function main() {
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "mother-preview-io-"));
  const storeRoot = path.join(tmpRoot, "mother_dxf_v1");
  const sessionsDir = path.join(storeRoot, "sessions");
  const fixturePath = path.join(repoRoot, "tests", "fixtures", "mother_dxf", "kskr_session_b7f20a6f.json");
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  const sessionPath = path.join(sessionsDir, fixture.session_id + ".json");
  const originalRandomUUID = crypto.randomUUID;
  const previewId = "preview-parity-id";

  try {
    crypto.randomUUID = () => previewId;
    fixture.session_context_v1 = {
      version: 1,
      status: "context_locked",
      production_program_id: "MDX",
      family_id: "VRATA",
      product_id: "KSKR",
      part_id: "SPLO",
      nominal_value_set_id: "KSKR_DEFAULT",
      rule_set_id: "legacy_door_rule_catalog_v0",
      parameter_catalog_id: "legacy_door_configurator_catalog_v0",
      branch_mode: "ALL",
      expected_variant_policy: { mode: "optional", expected_variant_keys: [] },
      validation: { ok: true, errors: [], warnings: [] }
    };
    fixture.session_lifecycle_v1 = { version: 1, state: "raw_loaded", allowed_transitions: [] };
    fixture.config_parameter_set = {
      ...fixture.config_parameter_set,
      family: "VRATA",
      product: "KSKR",
      part: "SPLO",
      parameter_catalog_id: "legacy_door_configurator_catalog_v0"
    };
    await fsp.mkdir(sessionsDir, { recursive: true });
    await fsp.writeFile(sessionPath, JSON.stringify(fixture, null, 2), "utf8");

    await runtime.computeGeometryContext({ sessionId: fixture.session_id, storeRoot });
    await runtime.validateDomainContext({ sessionId: fixture.session_id, storeRoot });
    await runtime.generateResolverPreview({ sessionId: fixture.session_id, storeRoot });

    const previewDir = path.join(storeRoot, "previews", previewId);
    const previewPath = path.join(previewDir, "preview.json");
    const dxfPath = path.join(previewDir, "preview.dxf");
    const previewJson = JSON.parse(await fsp.readFile(previewPath, "utf8"));

    let hasDxf = true;
    try {
      await fsp.access(dxfPath);
    } catch (_) {
      hasDxf = false;
    }

    const actual = JSON.stringify({
      preview_json: {
        session_id: previewJson.session_id,
        preview_id: previewJson.preview_id,
        type: previewJson.type,
        has_resolver_output: Boolean(previewJson.resolver_output_v1),
        has_simulation: Boolean(previewJson.simulation),
        has_dxf: hasDxf,
        json_path: path.relative(storeRoot, previewPath).split(path.sep).join("/")
      }
    }) + "\n";
    const expected = fs.readFileSync(path.join(__dirname, "__snapshots__", "preview_io_parity.snap"), "utf8");

    assert.strictEqual(actual, expected);
  } finally {
    crypto.randomUUID = originalRandomUUID;
    await fsp.rm(tmpRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
