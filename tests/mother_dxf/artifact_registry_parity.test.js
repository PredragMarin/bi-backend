"use strict";

const assert = require("assert");
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..", "..");
const {
  registerArtifact,
  loadArtifactRegistry,
  resolveArtifactPath
} = require(path.join(repoRoot, "src", "core_shell", "io", "mother_dxf", "session", "artifact_registry"));

const RealDate = Date;
const fixedIso = "2026-01-04T05:06:07.000Z";

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
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "mother-artifact-registry-"));
  const storeRoot = path.join(tmpRoot, "mother_dxf_v1");
  const sessionId = "session-registry";

  global.Date = FixedDate;

  try {
    await registerArtifact(sessionId, "mother_dxf", "mother-main", "out/mother_dxf_v1/artifacts/mother/session-registry_mother.dxf", storeRoot);
    await registerArtifact(sessionId, "child_dxf", "child-no-topo", "out/mother_dxf_v1/children/session-registry_child_no_topo/child.dxf", storeRoot);
    await registerArtifact(sessionId, "preview_json", "preview-main", "out/mother_dxf_v1/previews/preview-main/preview.json", storeRoot);
    await registerArtifact(sessionId, "preview_json", "preview-main", "out/mother_dxf_v1/previews/preview-main/preview.json", storeRoot);

    const registry = await loadArtifactRegistry(sessionId, storeRoot);
    const resolved = await resolveArtifactPath(sessionId, "preview_json", "preview-main", storeRoot);

    assert.strictEqual(registry.registry_version, 1);
    assert.strictEqual(registry.session_id, sessionId);
    assert.strictEqual(registry.registry_revision, 4);
    assert.strictEqual(resolved, "out/mother_dxf_v1/previews/preview-main/preview.json");

    for (const [artifactType, byId] of Object.entries(registry.artifacts)) {
      assert.ok(["mother_dxf", "child_dxf", "preview_json"].includes(artifactType));
      for (const [artifactId, record] of Object.entries(byId)) {
        assert.strictEqual(record.created_at, fixedIso);
        assert.strictEqual(record.status, "valid");
        assert.strictEqual(record.checksum, null);
        assert.strictEqual(record.size_bytes, null);
        assert.ok(typeof record.path === "string" && record.path.length > 0);
        assert.strictEqual(record.artifact_revision, artifactId === "preview-main" ? 2 : 1);
      }
    }

    const legacySessionId = "legacy-registry";
    const legacyRegistryDir = path.join(storeRoot, "sessions", legacySessionId);
    const legacyRegistryPath = path.join(legacyRegistryDir, "artifact_registry.json");
    await fsp.mkdir(legacyRegistryDir, { recursive: true });
    await fsp.writeFile(legacyRegistryPath, JSON.stringify({ legacy_type: { legacy_id: "legacy/path.dxf" } }, null, 2), "utf8");
    const upgraded = await loadArtifactRegistry(legacySessionId, storeRoot);
    assert.strictEqual(upgraded.registry_version, 1);
    assert.strictEqual(upgraded.session_id, legacySessionId);
    assert.strictEqual(upgraded.registry_revision, 0);
    assert.strictEqual(upgraded.artifacts.legacy_type.legacy_id.path, "legacy/path.dxf");
    assert.strictEqual(upgraded.artifacts.legacy_type.legacy_id.status, "valid");
    assert.strictEqual(upgraded.artifacts.legacy_type.legacy_id.checksum, null);
    assert.strictEqual(upgraded.artifacts.legacy_type.legacy_id.size_bytes, null);
    assert.strictEqual(upgraded.artifacts.legacy_type.legacy_id.artifact_revision, 0);

    const actual = JSON.stringify(registry) + "\n";
    const expected = fs.readFileSync(path.join(__dirname, "__snapshots__", "artifact_registry_parity.snap"), "utf8");

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
