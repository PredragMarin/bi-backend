"use strict";

const {
  buildTopoXOnlySummary,
  compareTopoXOnlySummary
} = require("./dxf_topo_x_summary_service");

function normalizedAxes(extractionReadiness) {
  return (Array.isArray(extractionReadiness?.axes) ? extractionReadiness.axes : [])
    .map((axis) => String(axis || "").trim().toUpperCase())
    .filter(Boolean);
}

function canExecuteTopoXOnly({ extractionReadiness }) {
  const stageOrder = Array.isArray(extractionReadiness?.stage_order) ? extractionReadiness.stage_order : [];
  const axes = normalizedAxes(extractionReadiness);
  return Boolean(extractionReadiness?.extraction_candidate)
    && stageOrder.length === 1
    && stageOrder[0] === "topo_simulation"
    && axes.length === 1
    && axes[0] === "X";
}

function executeTopoXOnlyShadow({
  result,
  extractionReadiness
}) {
  const applicable = canExecuteTopoXOnly({ extractionReadiness });
  if (!applicable) {
    return {
      ok: true,
      behavior_change: false,
      mode: "topo_x_only_execution_shadow_v1",
      applicable: false,
      executed: false,
      execution_status: "skipped_not_topo_x_only_candidate",
      production_ready: false,
      output_summary: null
    };
  }

  const outputSummary = buildTopoXOnlySummary({
    result: result || {}
  });

  return {
    ok: true,
    behavior_change: false,
    mode: "topo_x_only_execution_shadow_v1",
    applicable: true,
    executed: true,
    execution_status: "executed_shadow",
    production_ready: false,
    input_contract: "projected_runtime_result_v1",
    output_summary: outputSummary,
    notes: [
      "Observed movement is limited to TOPO X stages.",
      "This slice validates shared TOPO X finalization against the current Mother runtime projection.",
      "It does not yet execute coordinate movement, repair, trim, extend, rejoin, block explosion, or child DXF serialization independently."
    ]
  };
}

function compareTopoXOnlyExecution(execution, runtimeSummary) {
  if (!execution?.applicable) {
    return {
      available: true,
      checked: false,
      mismatch_count: 0,
      reason: execution?.execution_status || "not_applicable",
      mismatches: []
    };
  }
  const comparison = compareTopoXOnlySummary(execution.output_summary, runtimeSummary);
  return {
    available: true,
    checked: true,
    mismatch_count: comparison.mismatch_count,
    reason: comparison.ok ? "parity" : "mismatch",
    mismatches: comparison.mismatches
  };
}

module.exports = {
  canExecuteTopoXOnly,
  executeTopoXOnlyShadow,
  compareTopoXOnlyExecution
};
