"use strict";

const assert = require("assert");
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..", "..");
const runtime = require(path.join(repoRoot, "src", "modules", "mother_dxf_v1", "module_runtime"));

async function main() {
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "mother-param-set-"));
  const storeRoot = path.join(tmpRoot, "mother_dxf_v1");
  const sessionsDir = path.join(storeRoot, "sessions");
  const fixturePath = path.join(repoRoot, "tests", "fixtures", "mother_dxf", "kskr_session_b7f20a6f.json");
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  const sessionPath = path.join(sessionsDir, fixture.session_id + ".json");
  const nextParamSet = {
    technology_profile: "OPS_S4P4",
    product_code: "KSKR",
    parameters: {
      SIRINA_VRATA: 910,
      VISINA_VRATA: 2110,
      BRAVA: "CILINDAR"
    }
  };

  try {
    await fsp.mkdir(sessionsDir, { recursive: true });
    await fsp.writeFile(sessionPath, JSON.stringify(fixture, null, 2), "utf8");

    await runtime.updateConfigParameterSet({
      sessionId: fixture.session_id,
      configParameterSet: nextParamSet,
      storeRoot
    });

    const paramSetPath = path.join(storeRoot, "sessions", fixture.session_id, "param_set.json");
    const actualJson = JSON.parse(await fsp.readFile(paramSetPath, "utf8"));
    const actual = JSON.stringify(actualJson) + "\n";
    const expected = fs.readFileSync(path.join(__dirname, "__snapshots__", "param_set_parity.snap"), "utf8");

    assert.strictEqual(actual, expected);
  } finally {
    await fsp.rm(tmpRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
