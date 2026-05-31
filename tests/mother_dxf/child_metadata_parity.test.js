"use strict";

const assert = require("assert");
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..", "..");
const runtime = require(path.join(repoRoot, "src", "modules", "mother_dxf_v1", "module_runtime"));

const RealDate = Date;
const fixedIso = "2026-01-02T03:04:05.000Z";

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
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "mother-child-metadata-"));
  const storeRoot = path.join(tmpRoot, "mother_dxf_v1");
  const sessionsDir = path.join(storeRoot, "sessions");
  const fixturePath = path.join(repoRoot, "tests", "fixtures", "mother_dxf", "kskr_session_b7f20a6f.json");
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  const sessionPath = path.join(sessionsDir, fixture.session_id + ".json");

  global.Date = FixedDate;

  try {
    await fsp.mkdir(sessionsDir, { recursive: true });
    await fsp.writeFile(sessionPath, JSON.stringify(fixture, null, 2), "utf8");

    await runtime.generateChildDxfNoTopoForSession({
      sessionId: fixture.session_id,
      storeRoot
    });

    const metadataPath = path.join(storeRoot, "children", fixture.session_id + "_child_no_topo", "child_metadata.json");
    const actualJson = JSON.parse(await fsp.readFile(metadataPath, "utf8"));
    const actual = JSON.stringify(actualJson) + "\n";
    const expected = fs.readFileSync(path.join(__dirname, "__snapshots__", "child_metadata_parity.snap"), "utf8");

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
