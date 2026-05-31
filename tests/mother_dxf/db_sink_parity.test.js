"use strict";

const assert = require("assert");
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");

process.env.MOTHER_DXF_DB_ENABLED = "1";

const repoRoot = path.resolve(__dirname, "..", "..");
const dbCalls = {
  sessions: [],
  registries: []
};

const adapterPath = require.resolve(path.join(repoRoot, "src", "core_shell", "io", "mother_dxf", "db", "db_adapter"));
require.cache[adapterPath] = {
  id: adapterPath,
  filename: adapterPath,
  loaded: true,
  exports: {
    async saveSessionEnvelopeToDb(sessionId, envelope) {
      dbCalls.sessions.push({
        sessionId,
        envelope: JSON.parse(JSON.stringify(envelope))
      });
      return { ok: true, sessionId };
    },
    async saveArtifactRegistryToDb(sessionId, registry) {
      dbCalls.registries.push({
        sessionId,
        registry: JSON.parse(JSON.stringify(registry))
      });
      return { ok: true, sessionId };
    }
  }
};

const {
  saveSessionEnvelope
} = require(path.join(repoRoot, "src", "core_shell", "io", "mother_dxf", "session", "session_store"));
const {
  registerArtifact
} = require(path.join(repoRoot, "src", "core_shell", "io", "mother_dxf", "session", "artifact_registry"));

const RealDate = Date;
const fixedIso = "2026-01-05T06:07:08.000Z";

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

async function main() {
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "mother-db-sink-"));
  const storeRoot = path.join(tmpRoot, "mother_dxf_v1");
  const sessionId = "db-sink-session";
  const sessionPayload = {
    session_id: sessionId,
    use_case: "mother_dxf_v1",
    status: "draft",
    artifact_state: "mother_draft",
    source_name: "db_sink_fixture.dxf",
    document: { entities: [] }
  };

  global.Date = FixedDate;

  try {
    await saveSessionEnvelope(sessionId, sessionPayload, storeRoot);
    await registerArtifact(
      sessionId,
      "mother_dxf",
      "mother-main",
      "out/mother_dxf_v1/artifacts/mother/db-sink-session_mother.dxf",
      storeRoot
    );

    const sessionPath = path.join(storeRoot, "sessions", sessionId + ".json");
    const registryPath = path.join(storeRoot, "sessions", sessionId, "artifact_registry.json");
    const diskEnvelope = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
    const diskRegistry = JSON.parse(fs.readFileSync(registryPath, "utf8"));

    assert.ok(fs.existsSync(sessionPath));
    assert.ok(fs.existsSync(registryPath));
    assert.strictEqual(diskEnvelope.session_id, sessionId);
    assert.deepStrictEqual(diskEnvelope.payload, sessionPayload);
    assert.strictEqual(diskRegistry.artifacts.mother_dxf["mother-main"].path, "out/mother_dxf_v1/artifacts/mother/db-sink-session_mother.dxf");

    assert.strictEqual(dbCalls.sessions.length, 1);
    assert.strictEqual(dbCalls.registries.length, 1);
    assert.strictEqual(dbCalls.sessions[0].sessionId, sessionId);
    assert.strictEqual(dbCalls.registries[0].sessionId, sessionId);
    assert.deepStrictEqual(dbCalls.sessions[0].envelope, diskEnvelope);
    assert.deepStrictEqual(dbCalls.registries[0].registry, diskRegistry);
  } finally {
    global.Date = RealDate;
    await fsp.rm(tmpRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
