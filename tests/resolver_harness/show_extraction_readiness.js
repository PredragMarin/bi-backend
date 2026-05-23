"use strict";

const fs = require("fs");
const path = require("path");

const REPORT_PATH = path.resolve(__dirname, "output", "extraction_readiness_report.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function itemKinds(items) {
  const kinds = (Array.isArray(items) ? items : [])
    .map((item) => item && item.kind)
    .filter(Boolean);
  return kinds.length ? Array.from(new Set(kinds)).join(", ") : "none";
}

function itemCodes(items) {
  const codes = (Array.isArray(items) ? items : [])
    .map((item) => item && item.code)
    .filter(Boolean);
  return codes.length ? codes.join(", ") : "none";
}

function selectedStatus() {
  const raw = String(process.argv[2] || "").trim().toLowerCase();
  if (!raw) return null;
  if (["candidate", "review", "blocked"].includes(raw)) return raw;
  throw new Error("Unsupported readiness status filter: " + raw + ". Use candidate, review, or blocked.");
}

function selectedDetailFilter(status) {
  const raw = String(process.argv[3] || "").trim().toLowerCase();
  if (!raw) return null;
  if (status === "candidate") {
    if (["no_movement", "topo_x_only", "other_candidate"].includes(raw)) return raw;
    throw new Error("Unsupported candidate kind filter: " + raw + ". Use no_movement, topo_x_only, or other_candidate.");
  }
  if (status === "blocked") {
    if (["fixture_or_entrypoint_gap", "sequencing_risk", "runtime_review"].includes(raw)) return raw;
    throw new Error("Unsupported blocker kind filter: " + raw + ". Use fixture_or_entrypoint_gap, sequencing_risk, or runtime_review.");
  }
  throw new Error("Detail filter is only supported for candidate or blocked readiness status.");
}

function hasBlockerKind(item, kind) {
  if (!kind) return true;
  return (Array.isArray(item.blockers) ? item.blockers : []).some((blocker) => blocker && blocker.kind === kind);
}

function hasCandidateKind(item, kind) {
  if (!kind) return true;
  return item.candidate_kind === kind;
}

function printGroup(title, details) {
  console.log("");
  console.log(title + " (" + details.length + ")");
  if (!details.length) {
    console.log("- none");
    return;
  }
  for (const item of details) {
    const order = Array.isArray(item.stage_order) && item.stage_order.length
      ? item.stage_order.join(" -> ")
      : "no_movement";
    const axes = Array.isArray(item.axes) && item.axes.length ? item.axes.join(",") : "none";
    const reason = item.status === "blocked"
      ? itemCodes(item.blockers)
      : itemCodes(item.review_items);
    const kind = item.status === "blocked" ? itemKinds(item.blockers) : "none";
    const candidateKind = item.candidate_kind || "none";
    console.log("- " + item.fixture + " / " + item.mode
      + " | order=" + order
      + " | axes=" + axes
      + " | reason=" + reason
      + " | candidate_kind=" + candidateKind
      + " | kind=" + kind
      + " | " + item.output_file);
  }
}

function main() {
  if (!fs.existsSync(REPORT_PATH)) {
    throw new Error("Extraction readiness report does not exist. Run npm run resolver:harness or npm run resolver:assertions first.");
  }
  const report = readJson(REPORT_PATH);
  const readiness = report.extraction_readiness || {};
  const details = Array.isArray(readiness.details) ? readiness.details : [];
  const candidates = details.filter((item) => item.status === "candidate");
  const review = details.filter((item) => item.status === "review");
  const blocked = details.filter((item) => item.status === "blocked");
  const filter = selectedStatus();
  const detailFilter = selectedDetailFilter(filter);
  const filteredCandidates = candidates.filter((item) => hasCandidateKind(item, detailFilter));
  const filteredReview = review;
  const filteredBlocked = blocked.filter((item) => hasBlockerKind(item, detailFilter));

  console.log("Resolver extraction readiness");
  console.log("- report: " + path.relative(process.cwd(), REPORT_PATH));
  console.log("- behavior_change: " + report.behavior_change);
  console.log("- snapshots: " + Number(readiness.snapshots || 0));
  console.log("- candidate: " + candidates.length);
  console.log("- review: " + review.length);
  console.log("- blocked: " + blocked.length);
  console.log("- candidate kinds: " + JSON.stringify(readiness.candidate_kind_counts || {}));
  console.log("- blocker codes: " + JSON.stringify(readiness.blocker_codes || {}));
  console.log("- blocker kinds: " + JSON.stringify(readiness.blocker_kind_counts || {}));
  console.log("- review codes: " + JSON.stringify(readiness.review_codes || {}));
  if (filter) console.log("- filter: " + filter);
  if (detailFilter) console.log("- detail filter: " + detailFilter);

  if (!filter || filter === "candidate") printGroup("Candidates", filteredCandidates);
  if (!filter || filter === "review") printGroup("Review", filteredReview);
  if (!filter || filter === "blocked") printGroup("Blocked", filteredBlocked);
}

try {
  main();
} catch (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
