"use strict";

const fs = require("fs");
const path = require("path");
const { REPORT_DIR } = require("./config");
const { collectCurrentSnapshot, toPosix } = require("./checks");
const { buildHumanReport, buildSeveritySummary } = require("./formatters");

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n");
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function main() {
  ensureDir(REPORT_DIR);
  const latestPath = path.join(REPORT_DIR, "latest.json");
  const previousSnapshot = readJson(latestPath);
  const snapshotId = `repo_risk_${nowStamp()}`;
  const snapshot = collectCurrentSnapshot(previousSnapshot);
  const summary = buildSeveritySummary(snapshot.findings);
  const envelope = {
    report_id: "repo_risk_sentinel_v0",
    snapshot_id: snapshotId,
    generated_at: snapshot.generated_at,
    previous_snapshot_id: previousSnapshot ? previousSnapshot.snapshot_id || null : null,
    summary,
    ...snapshot
  };

  const snapshotJsonPath = path.join(REPORT_DIR, `${snapshotId}.json`);
  const snapshotTxtPath = path.join(REPORT_DIR, `${snapshotId}.txt`);
  const latestTxtPath = path.join(REPORT_DIR, "latest.txt");

  writeJson(snapshotJsonPath, envelope);
  writeJson(latestPath, envelope);
  fs.writeFileSync(snapshotTxtPath, buildHumanReport({ snapshotId, snapshot: envelope }), "utf8");
  fs.writeFileSync(latestTxtPath, buildHumanReport({ snapshotId, snapshot: envelope }), "utf8");

  console.log("Repo Risk Sentinel v0 complete.");
  console.log(`- latest json: ${toPosix(path.relative(process.cwd(), latestPath))}`);
  console.log(`- latest txt: ${toPosix(path.relative(process.cwd(), latestTxtPath))}`);
  console.log(`- CRITICAL: ${summary.CRITICAL}`);
  console.log(`- HIGH: ${summary.HIGH}`);
  console.log(`- MEDIUM: ${summary.MEDIUM}`);
  console.log(`- INFO: ${summary.INFO}`);
}

try {
  main();
} catch (error) {
  console.error("Repo Risk Sentinel v0 failed.");
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
}
