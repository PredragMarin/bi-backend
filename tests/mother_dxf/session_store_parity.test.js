"use strict";

const assert = require("assert");
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..", "..");
const {
  saveSessionEnvelope,
  loadSessionEnvelope,
  loadRawSessionEnvelope
} = require(path.join(repoRoot, "src", "core_shell", "io", "mother_dxf", "session", "session_store"));

const RealDate = Date;
const fixedIso = "2026-01-03T04:05:06.000Z";
const payloadRevisionKey = "__mother_dxf_session_revision";

class FixedDate extends RealDate {
  constructor(...args) {
    if (args.length) {
      super(...args);
      return;
    }
    super(fixedIso);
  }

  static now() {
    return new RealDate(fixedIso).getTime();
  }
}

function snapshotPayload(payload, sessionPath, storeRoot) {
  return {
    session_id: payload.session_id,
    use_case: payload.use_case,
    status: payload.status,
    artifact_state: payload.artifact_state,
    source_name: payload.source_name,
    has_document: Boolean(payload.document),
    parameter_count: Object.keys(payload.config_parameter_set?.parameters || {}).length,
    assignment_count: Object.keys(payload.assignments || {}).length,
    path: path.relative(storeRoot, sessionPath).split(path.sep).join("/")
  };
}

async function main() {
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "mother-session-store-"));
  const storeRoot = path.join(tmpRoot, "mother_dxf_v1");
  const fixturePath = path.join(repoRoot, "tests", "fixtures", "mother_dxf", "kskr_session_b7f20a6f.json");
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  fixture.session_id = "session_store_parity";
  fixture.source_name = "session_store_fixture.dxf";

  global.Date = FixedDate;

  try {
    const firstSave = await saveSessionEnvelope(fixture.session_id, fixture, storeRoot);
    const loadedPayload = await loadSessionEnvelope(fixture.session_id, storeRoot);
    const secondSave = await saveSessionEnvelope(fixture.session_id, loadedPayload, storeRoot);
    const staleSave = await saveSessionEnvelope(fixture.session_id, fixture, storeRoot);
    const reloadedPayload = await loadSessionEnvelope(fixture.session_id, storeRoot);
    const rawEnvelope = await loadRawSessionEnvelope(fixture.session_id, storeRoot);
    const sessionPath = path.join(storeRoot, "sessions", fixture.session_id + ".json");
    const diskEnvelope = JSON.parse(await fsp.readFile(sessionPath, "utf8"));

    assert.strictEqual(firstSave.revision, 1);
    assert.strictEqual(secondSave.revision, 2);
    assert.deepStrictEqual(staleSave, { conflict: true, expected: 2, got: 1 });
    assert.deepStrictEqual(reloadedPayload, fixture);
    assert.strictEqual(Object.prototype.propertyIsEnumerable.call(reloadedPayload, payloadRevisionKey), false);
    assert.deepStrictEqual(rawEnvelope, diskEnvelope);
    assert.deepStrictEqual(diskEnvelope.payload, fixture);
    assert.strictEqual(diskEnvelope.envelope_version, 1);
    assert.strictEqual(diskEnvelope.session_id, fixture.session_id);
    assert.strictEqual(diskEnvelope.status, "active");
    assert.strictEqual(diskEnvelope.owner, null);
    assert.strictEqual(diskEnvelope.revision, 2);

    const actual = JSON.stringify({
      envelope: {
        envelope_version: diskEnvelope.envelope_version,
        session_id: diskEnvelope.session_id,
        created_at: diskEnvelope.created_at,
        updated_at: diskEnvelope.updated_at,
        owner: diskEnvelope.owner,
        status: diskEnvelope.status,
        revision: diskEnvelope.revision,
        payload: snapshotPayload(diskEnvelope.payload, sessionPath, storeRoot)
      },
      legacy_session_payload: snapshotPayload(reloadedPayload, sessionPath, storeRoot)
    }) + "\n";
    const expected = fs.readFileSync(path.join(__dirname, "__snapshots__", "session_store_parity.snap"), "utf8");

    assert.strictEqual(actual, expected);
  } finally {
    global.Date = RealDate;
    await fsp.rm(tmpRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
