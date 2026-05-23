"use strict";

const {
  buildNoMovementSummary,
  compareNoMovementSummary
} = require("./dxf_no_movement_summary_service");

function numeric(value) {
  return Number(value || 0);
}

function canExecuteNoMovement({ movementInventory, extractionReadiness }) {
  const stageCount = numeric(movementInventory?.stage_count);
  const stageOrder = Array.isArray(extractionReadiness?.stage_order) ? extractionReadiness.stage_order : [];
  const candidate = Boolean(extractionReadiness?.extraction_candidate);
  return candidate && (stageCount === 0 || stageOrder.length === 0);
}

function executeNoMovementShadow({
  result,
  movementInventory,
  extractionReadiness,
  warnings = [],
  errors = []
}) {
  const applicable = canExecuteNoMovement({ movementInventory, extractionReadiness });
  if (!applicable) {
    return {
      ok: true,
      behavior_change: false,
      mode: "no_movement_execution_shadow_v1",
      applicable: false,
      executed: false,
      execution_status: "skipped_not_no_movement_candidate",
      production_ready: false,
      output_summary: null
    };
  }

  const outputSummary = buildNoMovementSummary({
    result: result || {},
    warnings,
    errors
  });

  return {
    ok: true,
    behavior_change: false,
    mode: "no_movement_execution_shadow_v1",
    applicable: true,
    executed: true,
    execution_status: "executed_shadow",
    production_ready: false,
    input_contract: "projected_runtime_result_v1",
    output_summary: outputSummary,
    notes: [
      "No movement stages were observed.",
      "No TOPO movement, repair, trim, extend, rejoin, or child DXF serialization is executed in this slice.",
      "This slice validates shared no-movement finalization against the current Mother runtime projection."
    ]
  };
}

function compareNoMovementExecution(execution, runtimeSummary) {
  if (!execution?.applicable) {
    return {
      available: true,
      checked: false,
      mismatch_count: 0,
      reason: execution?.execution_status || "not_applicable",
      mismatches: []
    };
  }
  const comparison = compareNoMovementSummary(execution.output_summary, runtimeSummary);
  return {
    available: true,
    checked: true,
    mismatch_count: comparison.mismatch_count,
    reason: comparison.ok ? "parity" : "mismatch",
    mismatches: comparison.mismatches
  };
}

module.exports = {
  canExecuteNoMovement,
  executeNoMovementShadow,
  compareNoMovementExecution
};
