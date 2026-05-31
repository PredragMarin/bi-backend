"use strict";

const { DB_ENABLED } = require("./db_config");

/**
 * DB adapter je za sada no-op skeleton.
 * U A5.4 radi samo logicki dual-write, bez stvarne DB implementacije.
 * Kasnije se moze zamijeniti pravim Postgres/SQLite adapterom.
 */

async function saveSessionEnvelopeToDb(sessionId, envelope) {
  if (!DB_ENABLED) return { skipped: true };
  // TODO: implement real DB write in A5.5+
  return { ok: true, sessionId };
}

async function saveArtifactRegistryToDb(sessionId, registry) {
  if (!DB_ENABLED) return { skipped: true };
  // TODO: implement real DB write in A5.5+
  return { ok: true, sessionId };
}

module.exports = {
  saveSessionEnvelopeToDb,
  saveArtifactRegistryToDb
};
