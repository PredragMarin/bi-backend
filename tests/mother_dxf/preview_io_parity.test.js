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
    await fsp.mkdir(sessionsDir, { recursive: true });
    await fsp.writeFile(sessionPath, JSON.stringify(fixture, null, 2), "utf8");

    await runtime.simulateSession({
      sessionId: fixture.session_id,
      storeRoot
    });

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
