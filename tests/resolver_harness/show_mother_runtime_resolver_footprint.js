"use strict";

const fs = require("fs");
const path = require("path");

const RUNTIME_PATH = path.resolve(__dirname, "../../src/modules/mother_dxf_v1/module_runtime.js");

const SECTIONS = [
  {
    id: "imports",
    label: "Core Shell resolver/repair imports",
    patterns: [
      "dxf_resolver_service",
      "dxf_line_repair_service"
    ]
  },
  {
    id: "preview_execution",
    label: "Preview resolver execution",
    patterns: [
      "simulateChildPreview",
      "buildTopoGeometrySimulationMap",
      "validateCombinedPreviewGeometry",
      "applyDocumentRulesToSimulationMap",
      "applyPostTopoRulesToSimulationMap"
    ]
  },
  {
    id: "child_execution",
    label: "Child DXF generation execution",
    patterns: [
      "materializeChildDocumentTopoPoc",
      "generateChildDxfTopoPoc",
      "buildResolverMaterializedSimulation",
      "generateChildDxfNoTopo",
      "materializeChildDocumentNoTopo"
    ]
  },
  {
    id: "repair_execution",
    label: "Repair / trim / rejoin execution",
    patterns: [
      "applyTopoTrimRejoinEndpointFollowerRepair",
      "applyFinalOpenContourGapRepair",
      "applyTrimRejoinToTranslatedLine",
      "trimVerticalLineEndpointToPoint",
      "trimLineToPoint",
      "bounded_trim_rejoin"
    ]
  },
  {
    id: "topo_metadata",
    label: "TOPO metadata authoring and validation",
    patterns: [
      "parseTopoCommentValue",
      "validateTopoBlock",
      "normalizeTopoRuntimeModel",
      "upsertFileLevelTopoComment",
      "upsertEntityTopoComment",
      "updateTopoMetadata"
    ]
  },
  {
    id: "sem_execution",
    label: "SEM parsing / inclusion execution",
    patterns: [
      "parseSemanticComment",
      "evaluatePresenceInstruction",
      "evaluateVariantInstruction",
      "evaluateChildEntityInclusion",
      "SEM:"
    ]
  }
];

function lineMatches(line, pattern) {
  return line.includes(pattern);
}

function collectMatches(lines, patterns) {
  const matches = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    for (const pattern of patterns) {
      if (lineMatches(line, pattern)) {
        matches.push({
          line: index + 1,
          pattern,
          text: line.trim().slice(0, 220)
        });
      }
    }
  }
  return matches;
}

function main() {
  const text = fs.readFileSync(RUNTIME_PATH, "utf8");
  const lines = text.split(/\r?\n/);
  const report = {
    runtime_path: path.relative(process.cwd(), RUNTIME_PATH),
    line_count: lines.length,
    behavior_change: false,
    generated_by: "npm run resolver:footprint",
    sections: SECTIONS.map((section) => ({
      id: section.id,
      label: section.label,
      patterns: section.patterns,
      match_count: collectMatches(lines, section.patterns).length,
      matches: collectMatches(lines, section.patterns).slice(0, 80)
    }))
  };

  console.log("Mother DXF runtime resolver footprint");
  console.log("- runtime: " + report.runtime_path);
  console.log("- lines: " + report.line_count);
  for (const section of report.sections) {
    console.log("- " + section.id + ": " + section.match_count + " match(es)");
    for (const match of section.matches.slice(0, 12)) {
      console.log("  L" + match.line + " [" + match.pattern + "] " + match.text);
    }
    if (section.match_count > 12) console.log("  ... " + (section.match_count - 12) + " more");
  }
}

main();
