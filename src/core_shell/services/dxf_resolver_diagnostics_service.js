"use strict";

const {
  buildNoMovementSummary
} = require("./dxf_no_movement_summary_service");
const {
  buildTopoXOnlySummary
} = require("./dxf_topo_x_summary_service");

function collectResultWarnings(result) {
  if (Array.isArray(result?.warnings)) return result.warnings;
  if (Array.isArray(result?.simulation?.validation?.warnings)) return result.simulation.validation.warnings;
  if (Array.isArray(result?.resolver_preview?.validation?.warnings)) return result.resolver_preview.validation.warnings;
  return [];
}

function collectResultErrors(result) {
  if (Array.isArray(result?.errors)) return result.errors;
  if (Array.isArray(result?.simulation?.validation?.errors)) return result.simulation.validation.errors;
  if (Array.isArray(result?.resolver_preview?.validation?.errors)) return result.resolver_preview.validation.errors;
  return [];
}

function buildSharedResolverDiagnostics({ result }) {
  const warnings = collectResultWarnings(result);
  const errors = collectResultErrors(result);
  return {
    enabled: true,
    behavior_change: false,
    diagnostic_only: true,
    no_movement_summary: buildNoMovementSummary({ result, warnings, errors }),
    topo_x_only_summary: buildTopoXOnlySummary({ result })
  };
}

function stableDiagnosticJson(value) {
  return JSON.stringify(value ?? null);
}

function compareSharedResolverDiagnosticField(local, facade, field) {
  const matches = stableDiagnosticJson(local) === stableDiagnosticJson(facade);
  return {
    field,
    matches,
    mismatch_count: matches ? 0 : 1,
    local: matches ? null : local,
    facade: matches ? null : facade
  };
}

function compareSharedResolverDiagnostics({ local = {}, facade = null }) {
  if (!facade) {
    return {
      available: false,
      checked: false,
      mismatch_count: 0,
      comparisons: []
    };
  }
  const comparisons = [];
  if (local.no_movement_summary !== undefined) {
    comparisons.push(compareSharedResolverDiagnosticField(
      local.no_movement_summary,
      facade.no_movement_summary || null,
      "no_movement_summary"
    ));
  }
  if (local.topo_x_only_summary !== undefined) {
    comparisons.push(compareSharedResolverDiagnosticField(
      local.topo_x_only_summary,
      facade.topo_x_only_summary || null,
      "topo_x_only_summary"
    ));
  }
  const mismatchCount = comparisons.reduce((sum, item) => sum + Number(item.mismatch_count || 0), 0);
  return {
    available: true,
    checked: comparisons.length > 0,
    mismatch_count: mismatchCount,
    comparisons
  };
}

module.exports = {
  buildSharedResolverDiagnostics,
  compareSharedResolverDiagnostics,
  collectResultWarnings,
  collectResultErrors
};
