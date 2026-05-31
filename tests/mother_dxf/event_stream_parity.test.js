"use strict";

const assert = require("assert");
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..", "..");
const { appendEvent } = require(path.join(repoRoot, "src", "core_shell", "io", "mother_dxf", "events", "event_stream"));

const RealDate = Date;
const fixedDates = [
  "2026-01-01T00:00:00.000Z",
  "2026-01-01T00:00:01.000Z",
  "2026-01-01T00:00:02.000Z"
];
let dateIndex = 0;

class FixedDate extends RealDate {
  constructor(...args) {
    if (args.length) {
      super(...args);
      return;
    }
    super(fixedDates[Math.min(dateIndex, fixedDates.length - 1)]);
    dateIndex += 1;
  }

  static now() {
    return new RealDate(fixedDates[Math.min(dateIndex, fixedDates.length - 1)]).getTime();
  }
}

async function main() {
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "mother-event-stream-"));
  const previousCwd = process.cwd();
  global.Date = FixedDate;

  try {
    process.chdir(tmpRoot);
    const sessionId = "session_event_parity";

    await appendEvent(sessionId, {
      type: "session_created_artifacts_saved",
      details: { source_name: "fixture.dxf" }
    });
    await appendEvent(sessionId, {
      type: "config_saved",
      details: { parameter_count: 2 }
    });
    await appendEvent(sessionId, {
      type: "mother_export_artifacts_saved",
      details: {
        export_file: "out/mother_dxf_v1/exports/session_event_parity_mother.dxf",
        artifact_file: "out/mother_dxf_v1/artifacts/mother/session_event_parity_mother.dxf"
      }
    });

    const eventPath = path.join(tmpRoot, "out", "mother_dxf_v1", "sessions", sessionId, "events.ndjson");
    const actual = await fsp.readFile(eventPath, "utf8");
    const expected = fs.readFileSync(path.join(__dirname, "__snapshots__", "event_stream_parity.snap"), "utf8");

    assert.strictEqual(actual, expected);
  } finally {
    global.Date = RealDate;
    process.chdir(previousCwd);
    await fsp.rm(tmpRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
