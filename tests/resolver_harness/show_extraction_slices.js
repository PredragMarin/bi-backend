"use strict";

const fs = require("fs");
const path = require("path");

const REPORT_PATH = path.resolve(__dirname, "output", "extraction_readiness_report.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function selectedSliceId() {
  return String(process.argv[2] || "").trim();
}

function printSlice(slice) {
  const items = Array.isArray(slice.items) ? slice.items : [];
  console.log("");
  console.log(slice.id + " (" + items.length + ")");
  console.log("- status: " + (slice.status || "unknown"));
  if (slice.candidate_kind) console.log("- candidate_kind: " + slice.candidate_kind);
  if (slice.blocker_kind) console.log("- blocker_kind: " + slice.blocker_kind);
  console.log("- recommended_order: " + (slice.recommended_order == null ? "hold" : slice.recommended_order));
  console.log("- rationale: " + (slice.rationale || ""));
  if (!items.length) {
    console.log("- items: none");
    return;
  }
  for (const item of items) {
    const order = Array.isArray(item.stage_order) && item.stage_order.length
      ? item.stage_order.join(" -> ")
      : "no_movement";
    const axes = Array.isArray(item.axes) && item.axes.length ? item.axes.join(",") : "none";
    console.log("- " + item.fixture + " / " + item.mode
      + " | order=" + order
      + " | axes=" + axes
      + " | stages=" + Number(item.movement_stage_count || 0)
      + " | " + item.output_file);
  }
}

function main() {
  if (!fs.existsSync(REPORT_PATH)) {
    throw new Error("Extraction readiness report does not exist. Run npm run resolver:harness or npm run resolver:assertions first.");
  }
  const report = readJson(REPORT_PATH);
  const slices = Array.isArray(report.extraction_slices?.slices) ? report.extraction_slices.slices : [];
  const filter = selectedSliceId();
  const selected = filter ? slices.filter((slice) => slice.id === filter) : slices;

  console.log("Resolver extraction slices");
  console.log("- report: " + path.relative(process.cwd(), REPORT_PATH));
  console.log("- behavior_change: " + report.behavior_change);
  console.log("- slices: " + slices.length);
  if (filter) console.log("- filter: " + filter);
  if (filter && !selected.length) {
    throw new Error("Unknown extraction slice id: " + filter);
  }
  for (const slice of selected) printSlice(slice);
}

try {
  main();
} catch (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
