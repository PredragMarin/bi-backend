"use strict";

const assert = require("assert");
const fs = require("fs");
const fsp = fs.promises;
const os = require("os");
const path = require("path");
const {
  buildSessionStorageKey
} = require("../../src/core_shell/io/mother_dxf/session/session_locator");
const {
  saveSessionEnvelope,
  loadSessionEnvelope,
  listSessionEnvelopes
} = require("../../src/core_shell/io/mother_dxf/session/session_store");
const { saveParamSet } = require("../../src/core_shell/io/mother_dxf/catalogs/param_set");
const { appendEvent } = require("../../src/core_shell/io/mother_dxf/events/event_stream");

async function main() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "mother-session-locator-"));
  const sessionId = "cf76e993-1c20-42e5-b15d-44f689c4ee67";
  const title = "SPLO_SUD_combined2_1";
  const storageKey = buildSessionStorageKey(title, sessionId);
  const payload = {
    session_id: sessionId,
    title,
    source_name: title + ".dxf",
    raw_source_name: "SPLO_SUD_combined2.dxf",
    storage_key: storageKey,
    status: "draft",
    artifact_state: "sanitized"
  };

  await saveSessionEnvelope(sessionId, payload, root);
  await saveParamSet(sessionId, { version: 1 }, root);
  await appendEvent(sessionId, { type: "hybrid_locator_test" }, root);

  const sessionsDir = path.join(root, "sessions");
  const entries = await fsp.readdir(sessionsDir);
  assert.strictEqual(storageKey, "SPLO_SUD_combined2_1__cf76e993");
  assert(entries.includes(storageKey + ".json"));
  assert(entries.includes(storageKey));
  assert(!entries.includes(sessionId + ".json"));
  assert(fs.existsSync(path.join(sessionsDir, storageKey, "param_set.json")));
  assert(fs.existsSync(path.join(sessionsDir, storageKey, "events.ndjson")));

  const loaded = await loadSessionEnvelope(sessionId, root);
  assert.strictEqual(loaded.session_id, sessionId);
  assert.strictEqual(loaded.storage_key, storageKey);
  const listed = await listSessionEnvelopes(root);
  assert.strictEqual(listed.length, 1);
  assert.strictEqual(listed[0].session_id, sessionId);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
