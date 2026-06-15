"use strict";

const fs = require("fs/promises");
const path = require("path");
const { resolveSessionStorageKey } = require("../session/session_locator");

function defaultRoot() {
  return path.join("out", "mother_dxf_v1");
}

async function appendEvent(sessionId, event, rootDir) {
  const storageKey = await resolveSessionStorageKey(sessionId, rootDir);
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    ...(event && typeof event === "object" ? event : { type: "event", details: {} })
  }) + "\n";

  const filePath = path.join(
    rootDir || defaultRoot(),
    "sessions",
    storageKey,
    "events.ndjson"
  );

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, line, "utf8");

  return { filePath };
}

module.exports = { appendEvent };
