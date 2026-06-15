"use strict";

function sortFindings(findings) {
  const weights = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, INFO: 1 };
  return [...(findings || [])].sort((left, right) => {
    const delta = (weights[right.severity] || 0) - (weights[left.severity] || 0);
    if (delta) return delta;
    return String(left.code || "").localeCompare(String(right.code || ""));
  });
}

function buildSeveritySummary(findings) {
  const summary = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, INFO: 0 };
  for (const item of findings || []) {
    summary[item.severity] = (summary[item.severity] || 0) + 1;
  }
  return summary;
}

function buildHumanReport({ snapshotId, snapshot }) {
  const ordered = sortFindings(snapshot.findings);
  const severity = buildSeveritySummary(ordered);
  const lines = [
    "=== Repo Risk Sentinel v0 ===",
    `Snapshot: ${snapshotId}`,
    `Generated: ${snapshot.generated_at}`,
    "",
    "Severity summary:",
    `- CRITICAL: ${severity.CRITICAL}`,
    `- HIGH: ${severity.HIGH}`,
    `- MEDIUM: ${severity.MEDIUM}`,
    `- INFO: ${severity.INFO}`,
    "",
    "Findings:"
  ];

  for (const item of ordered) {
    lines.push(`- [${item.severity}] ${item.code}: ${item.message}`);
    if (item.details) lines.push(`  details: ${item.details}`);
  }

  lines.push("", "Area trend:");
  for (const area of snapshot.trend || []) {
    const growth = area.growth_percent === null ? "n/a" : `${area.growth_percent}%`;
    lines.push(`- ${area.label}: lines=${area.current_lines}, prev=${area.previous_lines ?? "n/a"}, growth=${growth}`);
  }

  lines.push("", "Syntax:");
  lines.push(`- checked files: ${snapshot.syntax_checks.file_count}`);
  lines.push(`- failures: ${snapshot.syntax_checks.failed.length}`);

  lines.push("", "JSON contracts:");
  lines.push(`- checked files: ${snapshot.json_checks.file_count}`);
  lines.push(`- failures: ${snapshot.json_checks.failed.length}`);

  return lines.join("\n") + "\n";
}

module.exports = {
  sortFindings,
  buildSeveritySummary,
  buildHumanReport
};
