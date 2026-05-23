"use strict";

const fs = require("fs");
const path = require("path");
const {
  resolveMotherDxfRuntimePlan
} = require("../../src/core_shell/services/dxf_resolver_service");
const sharedSem = require("../../src/core_shell/services/sem_evaluator_service");
const {
  buildNoMovementSummary,
  compareNoMovementSummary
} = require("../../src/core_shell/services/dxf_no_movement_summary_service");
const {
  buildTopoXOnlySummary,
  compareTopoXOnlySummary
} = require("../../src/core_shell/services/dxf_topo_x_summary_service");
const {
  executeNoMovementShadow,
  compareNoMovementExecution
} = require("../../src/core_shell/services/dxf_no_movement_execution_service");
const {
  executeTopoXOnlyShadow,
  compareTopoXOnlyExecution
} = require("../../src/core_shell/services/dxf_topo_x_execution_service");
const {
  compareSharedResolverDiagnostics
} = require("../../src/core_shell/services/dxf_resolver_diagnostics_service");
const {
  buildIntegralResolverShadowFromObservation
} = require("../../src/core_shell/services/dxf_integral_resolver_service");

const DEFAULT_MODES = ["preview_combined", "child_topo_poc"];
const FIXTURE_ROOT = path.resolve(__dirname, "../fixtures");
const OUTPUT_ROOT = path.resolve(__dirname, "output");

function safeName(value) {
  return String(value || "fixture")
    .trim()
    .replace(/\.json$/i, "")
    .replace(/[^A-Za-z0-9_.-]+/g, "_") || "fixture";
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function isMotherDxfSession(value) {
  return Boolean(
    value
    && typeof value === "object"
    && value.document
    && Array.isArray(value.document.entities)
  );
}

function listJsonFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) {
        out.push(fullPath);
      }
    }
  }
  return out.sort();
}

function supportsSharedSemHarnessMode(mode) {
  const normalizedMode = String(mode || "").trim();
  return normalizedMode === "preview_combined" || normalizedMode === "child_topo_poc_preview";
}

function configuredSemEvaluatorMode(mode) {
  const requested = String(process.env.RESOLVER_HARNESS_SEM_EVALUATOR_MODE || "runtime").trim() || "runtime";
  if (requested === "runtime") return requested;
  return supportsSharedSemHarnessMode(mode) ? requested : "runtime";
}

function configuredModes() {
  const raw = String(process.env.RESOLVER_HARNESS_MODES || "").trim();
  if (!raw) return DEFAULT_MODES;
  return raw.split(",").map((item) => item.trim()).filter(Boolean);
}

function summaryFromWrappedResult(wrapped) {
  const result = wrapped?.result || {};
  const generationSummary = result.generation_summary || {};
  const simulationSummary = result.simulation?.summary || result.resolver_preview?.summary || {};
  const validation = result.simulation?.validation || result.resolver_preview?.validation || {};
  const movedEntities = Array.isArray(generationSummary.moved_entities)
    ? generationSummary.moved_entities
    : [];
  const wrappedWarnings = Array.isArray(wrapped?.warnings) ? wrapped.warnings : [];
  const validationWarnings = Array.isArray(validation.warnings) ? validation.warnings : [];
  const wrappedErrors = Array.isArray(wrapped?.errors) ? wrapped.errors : [];
  const validationErrors = Array.isArray(validation.errors) ? validation.errors : [];
  return {
    object_count: simulationSummary.object_count ?? generationSummary.entity_count ?? null,
    included_count: simulationSummary.included_count ?? generationSummary.included_count ?? null,
    excluded_count: simulationSummary.excluded_count ?? generationSummary.excluded_count ?? null,
    moved_count: generationSummary.moved_count ?? movedEntities.length,
    moved_entities: movedEntities.map((item) => ({
      entity_id: item.entity_id || null,
      object_id: item.object_id || null,
      type: item.type || null,
      group: item.group || null,
      zone: item.zone || null,
      dx: item.dx ?? null,
      dy: item.dy ?? null
    })),
    warnings: wrappedWarnings.length ? wrappedWarnings : validationWarnings,
    errors: wrappedErrors.length ? wrappedErrors : validationErrors
  };
}

function previewItemsFromWrappedResult(wrapped) {
  const result = wrapped?.result || {};
  if (Array.isArray(result?.simulation?.items)) return result.simulation.items;
  if (Array.isArray(result?.resolver_preview?.items)) return result.resolver_preview.items;
  return [];
}

function sourceObjectsFromWrappedResult(wrapped) {
  const result = wrapped?.result || {};
  if (Array.isArray(result?.session?.objects)) return result.session.objects;
  if (Array.isArray(result?.simulation?.items)) {
    return result.simulation.items.map((item) => ({
      entity_id: item.entity_id,
      object_id: item.object_id,
      display_label: item.display_label,
      semantic_metadata: item.semantic_metadata
    }));
  }
  if (Array.isArray(result?.resolver_preview?.render_objects)) {
    return result.resolver_preview.render_objects;
  }
  return [];
}

function isNoMovementCandidate(readiness) {
  const stageOrder = Array.isArray(readiness?.stage_order) ? readiness.stage_order : [];
  const stageCount = Number(readiness?.movement_stage_count || 0);
  return Boolean(readiness?.extraction_candidate) && (stageCount === 0 || stageOrder.length === 0);
}

function buildNoMovementDiagnostics({ wrapped, runtimeSummary, extractionReadiness }) {
  const applicable = isNoMovementCandidate(extractionReadiness);
  if (!applicable) {
    return {
      applicable: false,
      checked: false,
      reason: "snapshot_not_no_movement_candidate",
      mismatch_count: 0,
      shared: null,
      runtime: null,
      mismatches: []
    };
  }
  const shared = buildNoMovementSummary({
    result: wrapped?.result || {},
    warnings: wrapped?.warnings || [],
    errors: wrapped?.errors || []
  });
  const comparison = compareNoMovementSummary(shared, runtimeSummary);
  return {
    applicable: true,
    checked: true,
    reason: comparison.ok ? "parity" : "mismatch",
    mismatch_count: comparison.mismatch_count,
    shared,
    runtime: runtimeSummary,
    mismatches: comparison.mismatches
  };
}

function buildNoMovementExecutionDiagnostics({ wrapped, movementInventory, extractionReadiness, runtimeSummary }) {
  const execution = executeNoMovementShadow({
    result: wrapped?.result || {},
    movementInventory,
    extractionReadiness,
    warnings: wrapped?.warnings || [],
    errors: wrapped?.errors || []
  });
  const comparison = compareNoMovementExecution(execution, runtimeSummary);
  return {
    applicable: Boolean(execution.applicable),
    checked: Boolean(comparison.checked),
    reason: comparison.reason || null,
    mismatch_count: Number(comparison.mismatch_count || 0),
    execution,
    runtime: runtimeSummary,
    mismatches: comparison.mismatches || []
  };
}

function isTopoXOnlyCandidate(readiness) {
  const stageOrder = Array.isArray(readiness?.stage_order) ? readiness.stage_order : [];
  const axes = Array.isArray(readiness?.axes) ? readiness.axes.map((axis) => String(axis || "").toUpperCase()).filter(Boolean) : [];
  return Boolean(readiness?.extraction_candidate)
    && stageOrder.length === 1
    && stageOrder[0] === "topo_simulation"
    && axes.length === 1
    && axes[0] === "X";
}

function buildTopoXRuntimeSummary(topoDiagnostics) {
  const runtime = topoDiagnostics?.runtime || {};
  const movedEntities = Array.isArray(topoDiagnostics?.moved_entities) ? topoDiagnostics.moved_entities : [];
  return {
    topology_mode: runtime.topology_mode || null,
    topo_group: runtime.topo_group || null,
    axis: runtime.axis || null,
    trim_policy: runtime.trim_policy || null,
    trim_policy_status: runtime.trim_policy_status || null,
    moved_count: runtime.moved_count ?? movedEntities.length,
    dx_values: runtime.dx_range?.values || [],
    dy_values: runtime.dy_range?.values || [],
    moved_entities: movedEntities.map((item) => ({
      entity_id: item.entity_id || null,
      object_id: item.object_id || null,
      type: item.type || null,
      group: item.group || null,
      zone: item.zone || null,
      dx: item.dx ?? null,
      dy: item.dy ?? null
    }))
  };
}

function buildTopoXOnlyDiagnostics({ wrapped, topoDiagnostics, extractionReadiness }) {
  const applicable = isTopoXOnlyCandidate(extractionReadiness);
  if (!applicable) {
    return {
      applicable: false,
      checked: false,
      reason: "snapshot_not_topo_x_only_candidate",
      mismatch_count: 0,
      shared: null,
      runtime: null,
      mismatches: []
    };
  }
  const shared = buildTopoXOnlySummary({
    result: wrapped?.result || {}
  });
  const runtime = buildTopoXRuntimeSummary(topoDiagnostics);
  const comparison = compareTopoXOnlySummary(shared, runtime);
  return {
    applicable: true,
    checked: true,
    reason: comparison.ok ? "parity" : "mismatch",
    mismatch_count: comparison.mismatch_count,
    shared,
    runtime,
    mismatches: comparison.mismatches
  };
}

function buildTopoXOnlyExecutionDiagnostics({ wrapped, topoDiagnostics, extractionReadiness }) {
  const runtime = buildTopoXRuntimeSummary(topoDiagnostics);
  const execution = executeTopoXOnlyShadow({
    result: wrapped?.result || {},
    extractionReadiness
  });
  const comparison = compareTopoXOnlyExecution(execution, runtime);
  return {
    applicable: Boolean(execution.applicable),
    checked: Boolean(comparison.checked),
    reason: comparison.reason || null,
    mismatch_count: Number(comparison.mismatch_count || 0),
    execution,
    runtime,
    mismatches: comparison.mismatches || []
  };
}

function buildFacadeSharedDiagnosticsParity({ wrapped, noMovementDiagnostics, topoXOnlyDiagnostics }) {
  const local = {};
  if (noMovementDiagnostics?.applicable) local.no_movement_summary = noMovementDiagnostics.shared;
  if (topoXOnlyDiagnostics?.applicable) local.topo_x_only_summary = topoXOnlyDiagnostics.shared;
  return compareSharedResolverDiagnostics({
    local,
    facade: wrapped?.shared_resolver_diagnostics || null
  });
}

function compactSemResult(result) {
  return {
    included: Boolean(result?.included),
    reason: result?.exclusion_reason || null,
    geometry_ops_count: Array.isArray(result?.geometry_ops) ? result.geometry_ops.length : 0,
    raw: result || null
  };
}

function buildSemDiagnostics({ wrapped }) {
  const config = wrapped?.config_parameter_set || wrapped?.result?.config_parameter_set || {};
  const parameters = config?.parameters || {};
  const previewItems = previewItemsFromWrappedResult(wrapped);
  const previewByObjectId = new Map(previewItems.map((item) => [String(item.object_id || ""), item]));
  const previewByEntityId = new Map(previewItems.map((item) => [String(item.entity_id || ""), item]));
  const objects = sourceObjectsFromWrappedResult(wrapped);
  const diagnostics = [];
  let mismatchCount = 0;

  for (const object of objects) {
    const parsed = object?.semantic_metadata?.parsed;
    if (!Array.isArray(parsed) || !parsed.length) continue;
    const sharedRaw = sharedSem.evaluateChildEntityInclusion(object, parameters);
    const shared = compactSemResult(sharedRaw);
    const previewItem = previewByObjectId.get(String(object.object_id || object.id || ""))
      || previewByEntityId.get(String(object.entity_id || ""));
    if (!previewItem?.preview) {
      diagnostics.push({
        entity_id: object.entity_id || null,
        object_id: object.object_id || object.id || null,
        display_label: object.display_label || null,
        comparison: "skipped_no_preview_item",
        shared,
        preview: null,
        mismatch: false
      });
      continue;
    }
    const previewGeometryOps = Array.isArray(previewItem.preview.geometry_ops)
      ? previewItem.preview.geometry_ops
      : [];
    const preview = {
      included: Boolean(previewItem.preview.included),
      reason: previewItem.preview.exclusion_reason || null,
      geometry_ops_count: previewGeometryOps.length,
      raw: {
        included: previewItem.preview.included,
        exclusion_reason: previewItem.preview.exclusion_reason || null,
        geometry_ops: previewGeometryOps
      }
    };
    const mismatch = shared.included !== preview.included
      || shared.reason !== preview.reason
      || shared.geometry_ops_count !== preview.geometry_ops_count;
    if (mismatch) mismatchCount += 1;
    diagnostics.push({
      entity_id: object.entity_id || previewItem.entity_id || null,
      object_id: object.object_id || object.id || previewItem.object_id || null,
      display_label: object.display_label || previewItem.display_label || null,
      comparison: "preview_item",
      shared,
      preview,
      mismatch,
      warning: mismatch ? "Shared SEM evaluator differs from preview inclusion" : null
    });
  }

  return {
    checked_count: diagnostics.length,
    mismatch_count: mismatchCount,
    items: diagnostics
  };
}

function parseXdataAttributes(value) {
  const attributes = {};
  const parts = String(value || "").split(";").map((item) => item.trim()).filter(Boolean);
  for (const part of parts) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const attrValue = part.slice(idx + 1).trim();
    if (key) attributes[key] = attrValue;
  }
  return attributes;
}

function collectSessionEntities(document) {
  const entities = [];
  for (const entity of Array.isArray(document?.entities) ? document.entities : []) {
    entities.push({ entity, scope: "top_level", block: null });
  }
  for (const block of Array.isArray(document?.blocks) ? document.blocks : []) {
    for (const entity of Array.isArray(block?.entities) ? block.entities : []) {
      entities.push({ entity, scope: "block_child", block: block.name || null });
    }
  }
  return entities;
}

function collectBranchMetadataForEntity(session, entity) {
  const assignment = session?.xdata_assignments && session.xdata_assignments[entity?.id]
    ? session.xdata_assignments[entity.id]
    : null;
  const rawValue = String(assignment?.value || "").trim();
  if (!rawValue) {
    return { geometry_variant: null, raw_geometry_variant: null, branch_valid: true, branch_issue: null, raw_value: null };
  }
  const attributes = parseXdataAttributes(rawValue);
  const keys = Object.keys(attributes);
  const rawGeometryVariant = String(attributes.GEOMETRY_VARIANT || "").trim() || null;
  let branchIssue = null;
  if (!rawGeometryVariant) branchIssue = "missing_geometry_variant";
  else if (keys.length !== 1) branchIssue = "unexpected_branch_attributes";
  return {
    geometry_variant: branchIssue ? null : rawGeometryVariant,
    raw_geometry_variant: rawGeometryVariant,
    branch_valid: !branchIssue,
    branch_issue: branchIssue,
    raw_value: rawValue
  };
}

function incrementCount(target, key) {
  const normalizedKey = String(key || "BASE").trim() || "BASE";
  target[normalizedKey] = Number(target[normalizedKey] || 0) + 1;
}

function branchMetadataMatchesMode(metadata, branchMode) {
  const mode = String(branchMode || "ALL").trim() || "ALL";
  if (mode === "ALL") return true;
  const geometryVariant = String(metadata?.geometry_variant || "").trim();
  if (mode === "BASE") return !geometryVariant;
  return geometryVariant === mode;
}

function buildBranchDiagnostics({ session, wrapped, mode }) {
  const result = wrapped?.result || {};
  const requestedBranchMode = String(process.env.RESOLVER_HARNESS_BRANCH_MODE || session?.config_parameter_set?.branch_mode || "ALL").trim() || "ALL";
  const entities = collectSessionEntities(session?.document);
  const counts = {
    total_entities: entities.length,
    top_level_entities: 0,
    block_child_entities: 0,
    base_or_unassigned: 0,
    valid_branch_assigned: 0,
    invalid_branch_assigned: 0,
    by_variant: {},
    by_scope: { top_level: {}, block_child: {} }
  };
  const issues = [];
  let wouldKeep = 0;
  let wouldRemove = 0;
  for (const entry of entities) {
    if (entry.scope === "top_level") counts.top_level_entities += 1;
    if (entry.scope === "block_child") counts.block_child_entities += 1;
    const metadata = collectBranchMetadataForEntity(session, entry.entity);
    const variantKey = metadata.geometry_variant || "BASE";
    incrementCount(counts.by_variant, variantKey);
    incrementCount(counts.by_scope[entry.scope], variantKey);
    if (metadata.branch_issue) {
      counts.invalid_branch_assigned += 1;
      issues.push({
        entity_id: entry.entity?.id || null,
        scope: entry.scope,
        block: entry.block,
        issue: metadata.branch_issue,
        raw_value: metadata.raw_value
      });
    } else if (metadata.geometry_variant) {
      counts.valid_branch_assigned += 1;
    } else {
      counts.base_or_unassigned += 1;
    }
    if (branchMetadataMatchesMode(metadata, requestedBranchMode)) wouldKeep += 1;
    else wouldRemove += 1;
  }
  const generationSummary = result?.generation_summary || {};
  return {
    mode,
    requested_branch_mode: requestedBranchMode,
    session_counts: counts,
    branch_issues: issues,
    harness_predicted_filter: {
      branch_mode: requestedBranchMode,
      would_keep: wouldKeep,
      would_remove: wouldRemove
    },
    runtime_branch_mode: generationSummary.branch_mode || result?.resolver_preview?.summary?.branch_mode || result?.simulation?.summary?.branch_mode || null,
    runtime_branch_filter: generationSummary.branch_filter || result?.resolver_preview?.summary?.branch_filter || result?.simulation?.summary?.branch_filter || null,
    note: mode === "child_topo_poc"
      ? "Child TOPO POC applies runtime branch filtering when executable TOPO metadata exists."
      : "Preview mode reports source branch distribution; no child branch filtering is assumed from this diagnostic."
  };
}
function parseTopoCommentValue(commentValue) {
  const raw = String(commentValue || "").trim();
  if (!raw.toUpperCase().startsWith("TOPO:")) return null;
  const body = raw.slice(5).trim();
  const pairs = body ? body.split(";").map((item) => item.trim()).filter(Boolean) : [];
  if (!pairs.length) return null;
  const keys = {};
  for (const pair of pairs) {
    const idx = pair.indexOf("=");
    if (idx <= 0 || idx === pair.length - 1) return null;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (!key || !value || Object.prototype.hasOwnProperty.call(keys, key)) return null;
    keys[key] = value;
  }
  return { family: "TOPO", raw_comment: raw, keys };
}

function topoCommentsFromPairs(pairs) {
  return (Array.isArray(pairs) ? pairs : [])
    .map((pair) => typeof pair === "string" ? pair : (String(pair?.code || "") === "999" ? pair.value : null))
    .filter((value) => typeof value === "string")
    .map(parseTopoCommentValue)
    .filter(Boolean);
}

function collectFileLevelTopoDefinitions(session) {
  const sources = []
    .concat(Array.isArray(session?.document?.preComments) ? session.document.preComments : [])
    .concat(Array.isArray(session?.topo_comments) ? session.topo_comments.map((value) => ({ code: "999", value })) : []);
  return topoCommentsFromPairs(sources)
    .filter((item) => !String(item.keys?.role || "").trim())
    .map((item) => ({
      mode: item.keys.mode || null,
      group: item.keys.group || null,
      axis: item.keys.axis || null,
      delta_rule: item.keys.delta_rule || null,
      trim_policy: item.keys.trim_policy || null,
      raw_comment: item.raw_comment
    }));
}

function collectEntityTopoRoles(session) {
  const roles = [];
  for (const entry of collectSessionEntities(session?.document)) {
    const parsed = topoCommentsFromPairs(entry.entity?.preComments).find((item) => String(item.keys?.role || "").trim()) || null;
    if (!parsed) continue;
    roles.push({
      entity_id: entry.entity?.id || null,
      type: entry.entity?.type || null,
      scope: entry.scope,
      block: entry.block,
      role: parsed.keys.role || null,
      group: parsed.keys.group || null,
      zone: parsed.keys.zone || null,
      raw_comment: parsed.raw_comment
    });
  }
  return roles;
}

function countBy(items, keyFn) {
  const out = {};
  for (const item of Array.isArray(items) ? items : []) {
    const key = String(keyFn(item) || "unknown").trim() || "unknown";
    out[key] = Number(out[key] || 0) + 1;
  }
  return out;
}

function numericRange(items, key) {
  const values = (Array.isArray(items) ? items : [])
    .map((item) => Number(item?.[key]))
    .filter((value) => Number.isFinite(value));
  if (!values.length) return null;
  return { min: Math.min(...values), max: Math.max(...values), values: Array.from(new Set(values)).sort((a, b) => a - b) };
}

function buildTopoDiagnostics({ session, wrapped, mode }) {
  const result = wrapped?.result || {};
  const generationSummary = result?.generation_summary || {};
  const fileDefinitions = collectFileLevelTopoDefinitions(session);
  const entityRoles = collectEntityTopoRoles(session);
  const moverRoles = entityRoles.filter((item) => String(item.role || "").trim() === "mover");
  const movedEntities = Array.isArray(generationSummary.moved_entities) ? generationSummary.moved_entities : [];
  const skippedTopoEntities = Array.isArray(generationSummary.skipped_topo_entities) ? generationSummary.skipped_topo_entities : [];
  const zoneInputs = generationSummary.zone_inputs || null;
  return {
    mode,
    file_definitions: fileDefinitions,
    file_definition_count: fileDefinitions.length,
    entity_role_count: entityRoles.length,
    mover_role_count: moverRoles.length,
    roles_by_group: countBy(entityRoles, (item) => item.group),
    mover_roles_by_zone: countBy(moverRoles, (item) => item.zone),
    runtime: {
      topology_mode: generationSummary.topology_mode || result?.simulation?.topology_mode || null,
      topo_group: generationSummary.topo_group || null,
      axis: generationSummary.axis || null,
      trim_policy: generationSummary.trim_policy || null,
      trim_policy_status: generationSummary.trim_policy_status || null,
      entity_count: generationSummary.entity_count ?? null,
      moved_count: generationSummary.moved_count ?? movedEntities.length,
      skipped_count: skippedTopoEntities.length,
      zone_inputs: zoneInputs,
      dx_range: numericRange(movedEntities, "dx"),
      dy_range: numericRange(movedEntities, "dy")
    },
    moved_entities: movedEntities.map((item) => ({
      entity_id: item.entity_id || null,
      object_id: item.object_id || null,
      type: item.type || null,
      group: item.group || null,
      zone: item.zone || null,
      dx: item.dx ?? null,
      dy: item.dy ?? null
    })),
    skipped_topo_entities: skippedTopoEntities,
    note: movedEntities.length
      ? "Runtime moved TOPO entities in this snapshot."
      : "No runtime TOPO movement was observed in this snapshot."
  };
}
function collectDocumentSemRecords(session) {
  const comments = Array.isArray(session?.document?.preComments) ? session.document.preComments : [];
  return comments
    .map((comment) => sharedSem.parseSemanticComment(comment?.value || comment))
    .filter((parsed) => parsed && String(parsed.keys?.document || "").trim().toLowerCase() === "true");
}

function collectDocumentRuleRefsFromSession(session) {
  return collectDocumentSemRecords(session)
    .map((record) => String(record.keys?.rule_ref || "").trim())
    .filter(Boolean);
}

function collectRuleCatalogEntries(session) {
  const catalogs = [
    session?.rule_catalog,
    session?.rule_catalog?.rules,
    session?.metadata_catalog?.rule_catalog,
    session?.metadata_catalog?.rule_catalog?.rules,
    session?.contracts?.rule_catalog,
    session?.contracts?.rule_catalog?.rules
  ];
  const out = [];
  for (const catalog of catalogs) {
    if (Array.isArray(catalog)) {
      out.push(...catalog.filter((item) => item && typeof item === "object"));
      continue;
    }
    if (catalog && typeof catalog === "object") {
      out.push(...Object.values(catalog).filter((item) => item && typeof item === "object"));
    }
  }
  return out;
}

function collectConfiguredParameters(session) {
  const config = session?.config_parameter_set || {};
  return config.parameters && typeof config.parameters === "object" ? config.parameters : {};
}

function evaluateSimpleRuleCondition(rule, parameters) {
  const condition = rule?.condition || rule?.when || null;
  if (!condition || typeof condition !== "object") {
    return { evaluable: false, matched: null, reason: "condition_not_structured" };
  }
  const parameter = condition.parameter || condition.key || condition.field || null;
  if (!parameter) {
    return { evaluable: false, matched: null, reason: "missing_parameter_key" };
  }
  const actual = parameters[parameter];
  const operator = String(condition.operator || condition.op || "==").trim();
  const expected = Object.prototype.hasOwnProperty.call(condition, "value") ? condition.value : condition.values;
  if (operator === "in" || operator === "IN") {
    const values = Array.isArray(expected) ? expected : [];
    return {
      evaluable: true,
      matched: values.map(String).includes(String(actual)),
      parameter,
      operator: "in",
      actual,
      expected: values
    };
  }
  if (operator === "==" || operator === "=" || operator === "eq") {
    return {
      evaluable: true,
      matched: String(actual) === String(expected),
      parameter,
      operator: "==",
      actual,
      expected
    };
  }
  return { evaluable: false, matched: null, reason: "unsupported_operator", parameter, operator, actual, expected };
}

function buildDeclaredRuleActivationDiagnostics(session, declaredRuleRefs) {
  const parameters = collectConfiguredParameters(session);
  const rulesById = new Map();
  for (const rule of collectRuleCatalogEntries(session)) {
    const ruleId = String(rule.rule_id || rule.id || "").trim();
    if (ruleId) rulesById.set(ruleId, rule);
  }
  return declaredRuleRefs.map((ruleId) => {
    const rule = rulesById.get(ruleId) || null;
    return {
      rule_id: ruleId,
      found_in_catalog: Boolean(rule),
      activation: rule ? evaluateSimpleRuleCondition(rule, parameters) : { evaluable: false, matched: null, reason: "rule_not_found" }
    };
  });
}
function buildRuleActivationDiagnosticsForIds(session, ruleIds) {
  const parameters = collectConfiguredParameters(session);
  const rulesById = new Map();
  for (const rule of collectRuleCatalogEntries(session)) {
    const ruleId = String(rule.rule_id || rule.id || "").trim();
    if (ruleId) rulesById.set(ruleId, rule);
  }
  return ruleIds.map((ruleId) => {
    const rule = rulesById.get(ruleId) || null;
    return {
      rule_id: ruleId,
      found_in_catalog: Boolean(rule),
      activation: rule ? evaluateSimpleRuleCondition(rule, parameters) : { evaluable: false, matched: null, reason: "rule_not_found" }
    };
  });
}

function collectDocumentIdentityFromSession(session) {
  const record = collectDocumentSemRecords(session).find((item) => !String(item.keys?.rule_ref || "").trim()) || null;
  const keys = record?.keys || {};
  return {
    family: keys.family || null,
    product: keys.product || keys.product_code || null,
    part: keys.part || null,
    nominal_width: keys.nominal_width || null,
    nominal_height: keys.nominal_height || null,
    raw_comment: record?.raw_comment || null
  };
}

function collectAppliedDocumentRulesFromResult(result) {
  const buckets = [
    result?.generation_summary?.document_rules_applied,
    result?.combined_summary?.document_rules_applied,
    result?.simulation?.summary?.document_rules_applied,
    result?.resolver_preview?.summary?.document_rules_applied

  ];
  const out = [];
  for (const bucket of buckets) {
    if (!Array.isArray(bucket)) continue;
    for (const item of bucket) out.push(item);
  }
  return out;
}

function collectPostTopoRulesFromResult(result) {
  const buckets = [
    result?.generation_summary?.post_topo_rules_applied,
    result?.combined_summary?.post_topo_rules_applied,
    result?.simulation?.summary?.post_topo_rules_applied,
    result?.resolver_preview?.summary?.post_topo_rules_applied

  ];
  const out = [];
  for (const bucket of buckets) {
    if (!Array.isArray(bucket)) continue;
    for (const item of bucket) out.push(item);
  }
  return out;
}

function buildDocumentRuleDiagnostics({ session, wrapped, mode }) {
  const result = wrapped?.result || {};
  const declaredRuleRefs = collectDocumentRuleRefsFromSession(session);
  const appliedRules = collectAppliedDocumentRulesFromResult(result);
  const postTopoRules = collectPostTopoRulesFromResult(result);
  const documentRuleStep = (wrapped?.pipeline_trace?.steps || []).find((step) => step.name === "document_rules") || null;
  return {
    mode,
    identity: collectDocumentIdentityFromSession(session),
    declared_rule_refs: declaredRuleRefs,
    declared_count: declaredRuleRefs.length,
    declared_rule_activation: buildDeclaredRuleActivationDiagnostics(session, declaredRuleRefs),
    b_layer_catalog_activation: buildRuleActivationDiagnosticsForIds(session, ["MXD_LAYER_B_OFFSET_9P5", "MXD_PPV_LAYER_B_OFFSET_9P5"]),
    applied_rules: appliedRules,
    applied_count: appliedRules.length,
    post_topo_rules: postTopoRules,
    post_topo_count: postTopoRules.length,
    document_rule_step: documentRuleStep,
    note: appliedRules.length || declaredRuleRefs.length
      ? "Document rule metadata was observed in this snapshot."
      : "No document rule refs or applied document rules were observed in this snapshot."
  };
}
function snapshotForSuccess({ fixtureName, mode, wrapped, session }) {
  const documentRuleDiagnostics = buildDocumentRuleDiagnostics({ session, wrapped, mode });
  const topoDiagnostics = buildTopoDiagnostics({ session, wrapped, mode });
  const runtimeSummary = summaryFromWrappedResult(wrapped);
  const integralObservation = buildIntegralResolverShadowFromObservation({
    mode,
    snapshotOk: true,
    documentRuleDiagnostics,
    topoDiagnostics,
    pipelineTrace: wrapped.pipeline_trace || null,
    summary: runtimeSummary,
    warnings: runtimeSummary.warnings,
    errors: runtimeSummary.errors
  });
  const movementInventory = integralObservation.movement_inventory;
  const resolverPlan = integralObservation.resolver_plan;
  const stageBoundaryPlan = integralObservation.stage_boundary_plan;
  const resolverPlanAssertions = integralObservation.resolver_plan_assertions;
  const extractionReadiness = integralObservation.extraction_readiness;
  const integralResolverShadow = integralObservation.integral_resolver_shadow;
  const noMovementDiagnostics = buildNoMovementDiagnostics({
    wrapped,
    runtimeSummary,
    extractionReadiness
  });
  const noMovementExecutionDiagnostics = buildNoMovementExecutionDiagnostics({
    wrapped,
    movementInventory,
    extractionReadiness,
    runtimeSummary
  });
  const topoXOnlyDiagnostics = buildTopoXOnlyDiagnostics({
    wrapped,
    topoDiagnostics,
    extractionReadiness
  });
  const topoXOnlyExecutionDiagnostics = buildTopoXOnlyExecutionDiagnostics({
    wrapped,
    topoDiagnostics,
    extractionReadiness
  });
  const facadeSharedDiagnosticsParity = buildFacadeSharedDiagnosticsParity({
    wrapped,
    noMovementDiagnostics,
    topoXOnlyDiagnostics
  });
  return {
    fixture: fixtureName,
    mode,
    ok: true,
    pipeline_trace: wrapped.pipeline_trace || null,
    sem_evaluator_mode: wrapped.sem_evaluator_mode || "runtime",
    shared_sem_activation: wrapped.shared_sem_activation || null,
    document_rule_diagnostics: documentRuleDiagnostics,
    branch_diagnostics: buildBranchDiagnostics({ session, wrapped, mode }),
    topo_diagnostics: topoDiagnostics,
    movement_inventory: movementInventory,
    resolver_plan: resolverPlan,
    stage_boundary_plan: stageBoundaryPlan,
    integral_resolver_shadow: integralResolverShadow,
    resolver_plan_assertions: resolverPlanAssertions,
    extraction_readiness: extractionReadiness,
    no_movement_diagnostics: noMovementDiagnostics,
    no_movement_execution_diagnostics: noMovementExecutionDiagnostics,
    topo_x_only_diagnostics: topoXOnlyDiagnostics,
    topo_x_only_execution_diagnostics: topoXOnlyExecutionDiagnostics,
    summary: runtimeSummary,
    sem_diagnostics: wrapped.sem_diagnostics || buildSemDiagnostics({ wrapped }),
    shared_resolver_diagnostics: wrapped.shared_resolver_diagnostics || null,
    facade_shared_diagnostics_parity: facadeSharedDiagnosticsParity,
    thrown_error: null
  };
}

function snapshotForError({ fixtureName, mode, error, session }) {
  const documentRuleDiagnostics = buildDocumentRuleDiagnostics({
    session,
    wrapped: { pipeline_trace: error?.pipeline_trace || null, result: {} },
    mode
  });
  const topoDiagnostics = buildTopoDiagnostics({
    session,
    wrapped: { pipeline_trace: error?.pipeline_trace || null, result: {} },
    mode
  });
  const integralObservation = buildIntegralResolverShadowFromObservation({
    mode,
    snapshotOk: false,
    documentRuleDiagnostics,
    topoDiagnostics,
    pipelineTrace: error?.pipeline_trace || null,
    summary: null,
    warnings: [],
    errors: []
  });
  const movementInventory = integralObservation.movement_inventory;
  const resolverPlan = integralObservation.resolver_plan;
  const stageBoundaryPlan = integralObservation.stage_boundary_plan;
  const resolverPlanAssertions = integralObservation.resolver_plan_assertions;
  const extractionReadiness = integralObservation.extraction_readiness;
  const integralResolverShadow = integralObservation.integral_resolver_shadow;
  return {
    fixture: fixtureName,
    mode,
    ok: false,
    pipeline_trace: error?.pipeline_trace || null,
    document_rule_diagnostics: documentRuleDiagnostics,
    branch_diagnostics: buildBranchDiagnostics({ session, wrapped: { pipeline_trace: error?.pipeline_trace || null, result: {} }, mode }),
    topo_diagnostics: topoDiagnostics,
    movement_inventory: movementInventory,
    resolver_plan: resolverPlan,
    stage_boundary_plan: stageBoundaryPlan,
    integral_resolver_shadow: integralResolverShadow,
    resolver_plan_assertions: resolverPlanAssertions,
    extraction_readiness: extractionReadiness,
    summary: {
      object_count: null,
      included_count: null,
      excluded_count: null,
      moved_count: null,
      moved_entities: [],
      warnings: [],
      errors: []
    },
    no_movement_execution_diagnostics: {
      applicable: false,
      checked: false,
      reason: "snapshot_error",
      mismatch_count: 0,
      execution: null,
      runtime: null,
      mismatches: []
    },
    topo_x_only_execution_diagnostics: {
      applicable: false,
      checked: false,
      reason: "snapshot_error",
      mismatch_count: 0,
      execution: null,
      runtime: null,
      mismatches: []
    },
    sem_diagnostics: {
      checked_count: 0,
      mismatch_count: 0,
      items: []
    },
    thrown_error: {
      name: error?.name || "Error",
      message: error?.message || String(error || "Unknown error")
    }
  };
}

function writeSnapshot(fixtureName, mode, snapshot) {
  const dir = path.join(OUTPUT_ROOT, safeName(fixtureName));
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, safeName(mode) + ".json");
  fs.writeFileSync(target, JSON.stringify(snapshot, null, 2) + "\n");
  return target;
}

function writeRunSummary(summary) {
  fs.mkdirSync(OUTPUT_ROOT, { recursive: true });
  const target = path.join(OUTPUT_ROOT, "summary.json");
  fs.writeFileSync(target, JSON.stringify(summary, null, 2) + "\n");
  return target;
}

function reportLine(label, value) {
  return "- " + label + ": " + value;
}

function buildSemParityReport(summary) {
  const lines = [];
  lines.push("# Resolver Harness SEM Parity Report");
  lines.push("");
  lines.push("Generated by npm run resolver:harness.");
  lines.push("");
  lines.push("## Run Summary");
  lines.push(reportLine("fixture root", summary.fixture_root));
  lines.push(reportLine("output root", summary.output_root));
  lines.push(reportLine("modes", Array.isArray(summary.modes) ? summary.modes.join(", ") : ""));
  lines.push(reportLine("discovered JSON files", summary.discovered_json_files));
  lines.push(reportLine("runnable fixtures", summary.runnable_fixtures));
  lines.push(reportLine("skipped files", summary.skipped_files));
  lines.push(reportLine("snapshots written", summary.snapshots_written));
  lines.push(reportLine("OK snapshots", summary.ok));
  lines.push(reportLine("diagnostic ERR snapshots", summary.failed));
  lines.push("");
  lines.push("## No-Movement Slice Parity");
  lines.push(reportLine("checked", summary.no_movement.checked));
  lines.push(reportLine("mismatches", summary.no_movement.mismatches));
  lines.push(reportLine("snapshots with mismatch", summary.no_movement.snapshots_with_mismatch));
  if (summary.no_movement.details.length) {
    for (const item of summary.no_movement.details) {
      lines.push("- " + item.fixture + " / " + item.mode + ": mismatch_count=" + item.mismatch_count + ", reason=" + item.reason + ", snapshot=" + item.output_file);
    }
  }
  lines.push("");
  lines.push("## No-Movement Execution Slice");
  lines.push(reportLine("checked", summary.no_movement_execution.checked));
  lines.push(reportLine("mismatches", summary.no_movement_execution.mismatches));
  lines.push(reportLine("snapshots with mismatch", summary.no_movement_execution.snapshots_with_mismatch));
  if (summary.no_movement_execution.details.length) {
    for (const item of summary.no_movement_execution.details) {
      lines.push("- " + item.fixture + " / " + item.mode + ": mismatch_count=" + item.mismatch_count + ", reason=" + item.reason + ", executed=" + item.executed + ", snapshot=" + item.output_file);
    }
  }
  lines.push("");
  lines.push("## TOPO X-Only Slice Parity");
  lines.push(reportLine("checked", summary.topo_x_only.checked));
  lines.push(reportLine("mismatches", summary.topo_x_only.mismatches));
  lines.push(reportLine("snapshots with mismatch", summary.topo_x_only.snapshots_with_mismatch));
  if (summary.topo_x_only.details.length) {
    for (const item of summary.topo_x_only.details) {
      lines.push("- " + item.fixture + " / " + item.mode + ": mismatch_count=" + item.mismatch_count + ", reason=" + item.reason + ", moved=" + item.moved_count + ", dx=" + JSON.stringify(item.dx_values) + ", snapshot=" + item.output_file);
    }
  }
  lines.push("");
  lines.push("## TOPO X-Only Execution Slice");
  lines.push(reportLine("checked", summary.topo_x_only_execution.checked));
  lines.push(reportLine("mismatches", summary.topo_x_only_execution.mismatches));
  lines.push(reportLine("snapshots with mismatch", summary.topo_x_only_execution.snapshots_with_mismatch));
  if (summary.topo_x_only_execution.details.length) {
    for (const item of summary.topo_x_only_execution.details) {
      lines.push("- " + item.fixture + " / " + item.mode + ": mismatch_count=" + item.mismatch_count + ", reason=" + item.reason + ", executed=" + item.executed + ", moved=" + item.moved_count + ", snapshot=" + item.output_file);
    }
  }
  lines.push("");
  lines.push("## Facade Shared Diagnostics Parity");
  lines.push(reportLine("available snapshots", summary.facade_shared_diagnostics.available_snapshots));
  lines.push(reportLine("checked", summary.facade_shared_diagnostics.checked));
  lines.push(reportLine("mismatches", summary.facade_shared_diagnostics.mismatches));
  lines.push(reportLine("snapshots with mismatch", summary.facade_shared_diagnostics.snapshots_with_mismatch));
  if (summary.facade_shared_diagnostics.details.length) {
    for (const item of summary.facade_shared_diagnostics.details) {
      lines.push("- " + item.fixture + " / " + item.mode + ": mismatch_count=" + item.mismatch_count + ", fields=" + JSON.stringify(item.fields) + ", snapshot=" + item.output_file);
    }
  }
  lines.push("");
  lines.push("## SEM Parity");
  lines.push(reportLine("checked", summary.sem.checked));
  lines.push(reportLine("mismatches", summary.sem.mismatches));
  lines.push(reportLine("snapshots with SEM", summary.sem.snapshots_with_sem));
  lines.push(reportLine("snapshots with mismatch", summary.sem.snapshots_with_mismatch));
  lines.push("");
  lines.push("## Document Rules");
  lines.push(reportLine("declared rule refs", summary.document_rules.declared_refs));
  lines.push(reportLine("applied document rules", summary.document_rules.applied));
  lines.push(reportLine("post-topo rules", summary.document_rules.post_topo));
  lines.push(reportLine("snapshots with declared refs", summary.document_rules.snapshots_with_declared_refs));
  lines.push(reportLine("snapshots with applied rules", summary.document_rules.snapshots_with_applied));
  if (summary.document_rules.details.length) {
    for (const item of summary.document_rules.details) {
      const activationText = Array.isArray(item.declared_rule_activation) && item.declared_rule_activation.length
        ? ", activation=" + JSON.stringify(item.declared_rule_activation.map((entry) => ({ rule_id: entry.rule_id, matched: entry.activation?.matched ?? null, parameter: entry.activation?.parameter || null, actual: entry.activation?.actual ?? null, expected: entry.activation?.expected ?? null })))
        : "";
      lines.push("- " + item.fixture + " / " + item.mode + ": declared=[" + item.declared_rule_refs.join(", ") + "], applied=" + item.applied_count + ", post_topo=" + item.post_topo_count + activationText);
    }
  } else {
    lines.push("No document-level rule refs or applied document rules were observed.");
  }
  lines.push("");
  lines.push("## Branch Filtering");
  lines.push(reportLine("valid branch-assigned entities", summary.branch.valid_branch_assigned));
  lines.push(reportLine("invalid branch assignments", summary.branch.invalid_branch_assigned));
  lines.push(reportLine("predicted removed by requested branch", summary.branch.predicted_removed));
  lines.push(reportLine("snapshots with branch metadata", summary.branch.snapshots_with_branch_metadata));
  lines.push(reportLine("snapshots with runtime branch filter", summary.branch.snapshots_with_runtime_branch_filter));
  if (summary.branch.details.length) {
    for (const item of summary.branch.details) {
      lines.push("- " + item.fixture + " / " + item.mode + ": requested=" + item.requested_branch_mode + ", variants=" + JSON.stringify(item.by_variant) + ", predicted_remove=" + item.predicted_remove);
    }
  } else {
    lines.push("No branch metadata was observed.");
  }
  lines.push("");
  lines.push("## TOPO Movers");
  lines.push(reportLine("file-level TOPO definitions", summary.topo.file_definitions));
  lines.push(reportLine("entity TOPO roles", summary.topo.entity_roles));
  lines.push(reportLine("mover roles", summary.topo.mover_roles));
  lines.push(reportLine("runtime moved entities", summary.topo.moved_entities));
  lines.push(reportLine("skipped TOPO entities", summary.topo.skipped_topo_entities));
  lines.push(reportLine("snapshots with runtime movement", summary.topo.snapshots_with_runtime_movement));
  if (summary.topo.details.length) {
    for (const item of summary.topo.details) {
      const dxText = item.dx_range ? JSON.stringify(item.dx_range.values) : "[]";
      const dyText = item.dy_range ? JSON.stringify(item.dy_range.values) : "[]";
      lines.push("- " + item.fixture + " / " + item.mode + ": defs=" + item.file_definition_count + ", movers=" + item.mover_role_count + ", group=" + item.runtime_group + ", axis=" + item.axis + ", moved=" + item.moved_count + ", skipped=" + item.skipped_count + ", dx=" + dxText + ", dy=" + dyText);
    }
  } else {
    lines.push("No TOPO definitions or mover roles were observed.");
  }
  lines.push("");
  lines.push("## Resolver Plan");
  lines.push(reportLine("snapshots with plan", summary.resolver_plan.snapshots_with_plan));
  lines.push(reportLine("reorder candidates", summary.resolver_plan.reorder_candidates));
  lines.push(reportLine("multi-axis plans", summary.resolver_plan.multi_axis_plans));
  lines.push(reportLine("assertion warnings", summary.resolver_plan.assertion_warnings));
  lines.push(reportLine("assertion infos", summary.resolver_plan.assertion_infos));
  lines.push(reportLine("observed orders", JSON.stringify(summary.resolver_plan.observed_orders)));
  if (summary.resolver_plan.details.length) {
    for (const item of summary.resolver_plan.details) {
      lines.push("- " + item.fixture + " / " + item.mode + ": order=" + item.stage_order.join(" -> ") + ", axes=" + JSON.stringify(item.axes) + ", stages=" + item.movement_stage_count + ", reorder_candidate=" + item.reorder_candidate);
    }
  } else {
    lines.push("No resolver plan movement details were observed.");
  }
  lines.push("");
  lines.push("## Movement Inventory");
  lines.push(reportLine("movement stages", summary.movement.stage_count));
  lines.push(reportLine("snapshots with movement", summary.movement.snapshots_with_movement));
  lines.push(reportLine("document-rule stages", summary.movement.document_rule_stages));
  lines.push(reportLine("TOPO stages", summary.movement.topo_stages));
  lines.push(reportLine("post-topo stages", summary.movement.post_topo_stages));
  lines.push(reportLine("X-axis stages", summary.movement.x_stages));
  lines.push(reportLine("Y-axis stages", summary.movement.y_stages));
  if (summary.movement.details.length) {
    for (const item of summary.movement.details) {
      const stageText = item.stages.map((stage) => {
        const label = stage.source === "document_rule" ? stage.rule_id : (stage.group || stage.source);
        return "#" + stage.stage_index + ":" + stage.source + ":" + label + ":axis=" + stage.axis + ":dx=" + stage.dx + ":dy=" + stage.dy + ":n=" + stage.affected_count;
      }).join(" | ");
      lines.push("- " + item.fixture + " / " + item.mode + ": " + stageText);
    }
  } else {
    lines.push("No movement stages were observed.");
  }
  lines.push("");
  lines.push("## Coverage Checkpoints");
  lines.push("### Y 9.5 B-layer Movement");
  lines.push(reportLine("declared B-layer rule snapshots", summary.coverage.y_9p5.declared_snapshots));
  lines.push(reportLine("runtime Y movement snapshots", summary.coverage.y_9p5.runtime_y_movement_snapshots));
  lines.push(reportLine("runtime 9.5 movement snapshots", summary.coverage.y_9p5.runtime_9p5_snapshots));
  lines.push(reportLine("document-rule Y 9.5 snapshots", summary.coverage.y_9p5.document_rule_y_9p5_snapshots));
  lines.push(reportLine("document-rule Y 9.5 affected entities", summary.coverage.y_9p5.document_rule_y_9p5_affected_entities));
  lines.push(reportLine("document-rule Y 9.5 linked warnings", summary.coverage.y_9p5.document_rule_y_9p5_warning_count));
  lines.push(reportLine("document-rule Y 9.5 open-boundary warnings", summary.coverage.y_9p5.document_rule_y_9p5_open_boundary_count));
  lines.push(reportLine("document-rule Y 9.5 unresolved-rejoin warnings", summary.coverage.y_9p5.document_rule_y_9p5_unresolved_rejoin_count));
  lines.push(reportLine("declared + condition matched snapshots", summary.coverage.y_9p5.declared_condition_matched_snapshots));
  lines.push(reportLine("condition matched but not declared snapshots", summary.coverage.y_9p5.condition_matched_without_declared_snapshots));
  lines.push(reportLine("declared but condition false snapshots", summary.coverage.y_9p5.declared_condition_false_snapshots));
  if (summary.coverage.y_9p5.runtime_9p5_snapshots > 0) {
    lines.push("Coverage status: covered.");
  } else {
    lines.push("Coverage status: missing runtime Y 9.5 movement fixture.");
  }
  if (summary.coverage.y_9p5.details.length) {
    for (const item of summary.coverage.y_9p5.details) {
      const activationText = item.b_layer_rule_activation ? ", activation=" + JSON.stringify(item.b_layer_rule_activation) : "";
      lines.push("- " + item.fixture + " / " + item.mode + ": declared=" + item.declared_b_layer_rule + ", runtime_y=" + item.runtime_y_movement + ", runtime_9p5=" + item.runtime_9p5_movement + ", document_rule_y_9p5=" + item.document_rule_y_9p5 + ", affected=" + item.document_rule_y_9p5_affected_count + ", linked_warnings=" + item.document_rule_y_9p5_warning_count + ", open_boundary=" + item.document_rule_y_9p5_open_boundary_count + ", unresolved_rejoin=" + item.document_rule_y_9p5_unresolved_rejoin_count + ", dy=" + JSON.stringify(item.dy_values) + activationText);
    }
  }
  lines.push("");
  lines.push("## Mismatch Details");
  if (summary.sem.mismatch_details.length) {
    for (const item of summary.sem.mismatch_details) {
      lines.push("- " + item.fixture + " / " + item.mode + ": " + item.mismatch_count + " mismatch(es) in " + item.output_file);
    }
  } else {
    lines.push("No SEM parity mismatches were detected.");
  }
  lines.push("");
  if (summary.error_details.length) {
    lines.push("## Diagnostic Errors");
    for (const item of summary.error_details) {
      lines.push("- " + item.fixture + " / " + item.mode + ": " + item.message);
    }
    lines.push("");
  }
  lines.push("## Interpretation");
  lines.push(summary.sem.mismatches === 0
    ? "Shared SEM evaluator is parity-clean against the captured preview behavior for this fixture set."
    : "Shared SEM evaluator differs from captured preview behavior; inspect mismatch snapshots before activating it further.");
  lines.push("");
  return lines.join("\n");
}

function writeSemParityReport(summary) {
  fs.mkdirSync(OUTPUT_ROOT, { recursive: true });
  const target = path.join(OUTPUT_ROOT, "sem_parity_report.md");
  fs.writeFileSync(target, buildSemParityReport(summary) + "\n");
  return target;
}

function buildResolverPlanReport(summary) {
  const lines = [];
  lines.push("# Resolver Harness Plan Report");
  lines.push("");
  lines.push("Generated by npm run resolver:harness.");
  lines.push("");
  lines.push("## Run Summary");
  lines.push(reportLine("fixture root", summary.fixture_root));
  lines.push(reportLine("output root", summary.output_root));
  lines.push(reportLine("modes", Array.isArray(summary.modes) ? summary.modes.join(", ") : ""));
  lines.push(reportLine("snapshots written", summary.snapshots_written));
  lines.push(reportLine("OK snapshots", summary.ok));
  lines.push(reportLine("diagnostic ERR snapshots", summary.failed));
  lines.push("");
  lines.push("## Observed Resolver Plans");
  lines.push(reportLine("snapshots with plan", summary.resolver_plan.snapshots_with_plan));
  lines.push(reportLine("movement stages", summary.movement.stage_count));
  lines.push(reportLine("snapshots with movement", summary.movement.snapshots_with_movement));
  lines.push(reportLine("observed orders", JSON.stringify(summary.resolver_plan.observed_orders)));
  lines.push(reportLine("reorder candidates", summary.resolver_plan.reorder_candidates));
  lines.push(reportLine("multi-axis plans", summary.resolver_plan.multi_axis_plans));
  lines.push(reportLine("assertion warnings", summary.resolver_plan.assertion_warnings));
  lines.push(reportLine("assertion infos", summary.resolver_plan.assertion_infos));
  lines.push(reportLine("assertion codes", JSON.stringify(summary.resolver_plan.assertion_codes || {})));
  lines.push("");
  lines.push("## Movement Stage Counts");
  lines.push(reportLine("document-rule stages", summary.movement.document_rule_stages));
  lines.push(reportLine("TOPO stages", summary.movement.topo_stages));
  lines.push(reportLine("post-topo stages", summary.movement.post_topo_stages));
  lines.push(reportLine("other stages", summary.movement.other_stages));
  lines.push(reportLine("X-axis stages", summary.movement.x_stages));
  lines.push(reportLine("Y-axis stages", summary.movement.y_stages));
  lines.push("");
  lines.push("## Plan Details");
  if (summary.resolver_plan.details.length) {
    for (const item of summary.resolver_plan.details) {
      lines.push("### " + item.fixture + " / " + item.mode);
      lines.push(reportLine("stage order", item.stage_order.length ? item.stage_order.join(" -> ") : "no_movement"));
      lines.push(reportLine("axes", JSON.stringify(item.axes)));
      lines.push(reportLine("movement stages", item.movement_stage_count));
      lines.push(reportLine("reorder candidate", item.reorder_candidate));
      if (Array.isArray(item.notes) && item.notes.length) {
        for (const note of item.notes) lines.push(reportLine("note", note));
      }
      lines.push(reportLine("snapshot", item.output_file));
      lines.push("");
    }
  } else {
    lines.push("No movement-bearing resolver plans were observed.");
    lines.push("");
  }
  lines.push("## Movement Inventory Details");
  if (summary.movement.details.length) {
    for (const item of summary.movement.details) {
      lines.push("### " + item.fixture + " / " + item.mode);
      for (const stage of item.stages) {
        const label = stage.source === "document_rule"
          ? stage.rule_id
          : (stage.group || stage.source || "unknown");
        const zone = stage.zone ? ", zone=" + stage.zone : "";
        lines.push("- #" + stage.stage_index
          + " " + stage.phase
          + " | " + stage.source
          + " | " + label
          + zone
          + " | axis=" + stage.axis
          + " | dx=" + stage.dx
          + " | dy=" + stage.dy
          + " | affected=" + stage.affected_count);
      }
      lines.push(reportLine("snapshot", item.output_file));
      lines.push("");
    }
  } else {
    lines.push("No movement inventory stages were observed.");
    lines.push("");
  }
  lines.push("## Extraction Readiness");
  lines.push(reportLine("candidate snapshots", summary.extraction_readiness.candidates));
  lines.push(reportLine("review snapshots", summary.extraction_readiness.review));
  lines.push(reportLine("blocked snapshots", summary.extraction_readiness.blocked));
  lines.push(reportLine("status counts", JSON.stringify(summary.extraction_readiness.status_counts || {})));
  lines.push(reportLine("candidate kinds", JSON.stringify(summary.extraction_readiness.candidate_kind_counts || {})));
  lines.push(reportLine("blocker codes", JSON.stringify(summary.extraction_readiness.blocker_codes || {})));
  lines.push(reportLine("blocker kinds", JSON.stringify(summary.extraction_readiness.blocker_kind_counts || {})));
  lines.push(reportLine("review codes", JSON.stringify(summary.extraction_readiness.review_codes || {})));
  if (summary.extraction_readiness.details.length) {
    for (const item of summary.extraction_readiness.details) {
      lines.push("- " + item.fixture + " / " + item.mode + ": " + item.status + ", order=" + item.stage_order.join(" -> ") + ", axes=" + JSON.stringify(item.axes));
    }
  }
  lines.push("");
  lines.push("## Plan Assertions");
  if (summary.resolver_plan.assertion_details.length) {
    for (const item of summary.resolver_plan.assertion_details) {
      lines.push("- " + item.fixture + " / " + item.mode + ": " + item.code + " [" + item.severity + "] " + item.message);
    }
  } else {
    lines.push("No plan assertions were observed.");
  }
  lines.push("");
  lines.push("## Critical Checkpoints");
  lines.push("### Y 9.5 B-layer Rule");
  lines.push(reportLine("declared B-layer rule snapshots", summary.coverage.y_9p5.declared_snapshots));
  lines.push(reportLine("declared + condition matched snapshots", summary.coverage.y_9p5.declared_condition_matched_snapshots));
  lines.push(reportLine("document-rule Y 9.5 snapshots", summary.coverage.y_9p5.document_rule_y_9p5_snapshots));
  lines.push(reportLine("document-rule Y 9.5 affected entities", summary.coverage.y_9p5.document_rule_y_9p5_affected_entities));
  lines.push(reportLine("runtime Y movement snapshots", summary.coverage.y_9p5.runtime_y_movement_snapshots));
  lines.push(reportLine("runtime 9.5 movement snapshots", summary.coverage.y_9p5.runtime_9p5_snapshots));
  lines.push("");
  lines.push("## Interpretation");
  lines.push(summary.resolver_plan.reorder_candidates > 0
    ? "At least one observed runtime plan combines document-rule movement and TOPO movement across axes. Treat these snapshots as sequencing candidates before extracting movement execution."
    : "No observed multi-axis document-rule + TOPO movement plans were found in this run.");
  lines.push("");
  return lines.join("\n");
}

function writeResolverPlanReport(summary) {
  fs.mkdirSync(OUTPUT_ROOT, { recursive: true });
  const target = path.join(OUTPUT_ROOT, "resolver_plan_report.md");
  fs.writeFileSync(target, buildResolverPlanReport(summary) + "\n");
  return target;
}

function buildResolverPlanAssertionsReport(summary) {
  return {
    ok: true,
    behavior_change: false,
    generated_by: "npm run resolver:harness",
    snapshots_written: summary.snapshots_written,
    ok_snapshots: summary.ok,
    diagnostic_err_snapshots: summary.failed,
    no_movement: summary.no_movement,
    no_movement_execution: summary.no_movement_execution,
    topo_x_only: summary.topo_x_only,
    topo_x_only_execution: summary.topo_x_only_execution,
    facade_shared_diagnostics: summary.facade_shared_diagnostics,
    resolver_plan: {
      snapshots_with_plan: summary.resolver_plan.snapshots_with_plan,
      reorder_candidates: summary.resolver_plan.reorder_candidates,
      multi_axis_plans: summary.resolver_plan.multi_axis_plans,
      assertion_snapshots: summary.resolver_plan.assertion_snapshots,
      assertion_warnings: summary.resolver_plan.assertion_warnings,
      assertion_infos: summary.resolver_plan.assertion_infos,
      assertion_codes: summary.resolver_plan.assertion_codes,
      assertion_details: summary.resolver_plan.assertion_details
    },
    extraction_readiness: summary.extraction_readiness
  };
}

function extractionSliceItems(details, predicate) {
  return (Array.isArray(details) ? details : [])
    .filter(predicate)
    .map((item) => ({
      fixture: item.fixture,
      mode: item.mode,
      status: item.status,
      candidate_kind: item.candidate_kind || null,
      stage_order: item.stage_order || [],
      axes: item.axes || [],
      movement_stage_count: item.movement_stage_count || 0,
      output_file: item.output_file
    }));
}

function buildExtractionSlices(summary) {
  const details = summary?.extraction_readiness?.details || [];
  return {
    behavior_change: false,
    slices: [
      {
        id: "slice_1_no_movement",
        status: "candidate",
        candidate_kind: "no_movement",
        recommended_order: 1,
        rationale: "Earliest parity-safe extraction bucket: no observed movement stages.",
        items: extractionSliceItems(details, (item) => item.status === "candidate" && item.candidate_kind === "no_movement")
      },
      {
        id: "slice_2_topo_x_only",
        status: "candidate",
        candidate_kind: "topo_x_only",
        recommended_order: 2,
        rationale: "Next narrow extraction bucket: observed TOPO simulation movement only on X axis.",
        items: extractionSliceItems(details, (item) => item.status === "candidate" && item.candidate_kind === "topo_x_only")
      },
      {
        id: "hold_sequencing_risk",
        status: "blocked",
        blocker_kind: "sequencing_risk",
        recommended_order: null,
        rationale: "Do not extract execution for these paths until sequencing/recalculation semantics are explicit.",
        items: extractionSliceItems(details, (item) => item.status === "blocked" && (item.blockers || []).some((blocker) => blocker.kind === "sequencing_risk"))
      }
    ]
  };
}

function buildExtractionReadinessReport(summary) {
  return {
    ok: true,
    behavior_change: false,
    generated_by: "npm run resolver:harness",
    snapshots_written: summary.snapshots_written,
    ok_snapshots: summary.ok,
    diagnostic_err_snapshots: summary.failed,
    extraction_readiness: summary.extraction_readiness,
    extraction_slices: buildExtractionSlices(summary)
  };
}

function writeExtractionReadinessReport(summary) {
  fs.mkdirSync(OUTPUT_ROOT, { recursive: true });
  const target = path.join(OUTPUT_ROOT, "extraction_readiness_report.json");
  fs.writeFileSync(target, JSON.stringify(buildExtractionReadinessReport(summary), null, 2) + "\n");
  return target;
}

function writeResolverPlanAssertionsReport(summary) {
  fs.mkdirSync(OUTPUT_ROOT, { recursive: true });
  const target = path.join(OUTPUT_ROOT, "resolver_plan_assertions_report.json");
  fs.writeFileSync(target, JSON.stringify(buildResolverPlanAssertionsReport(summary), null, 2) + "\n");
  return target;
}
function updateCoverageSummary(summary, fixtureName, mode, snapshot) {
  const documentRules = snapshot?.document_rule_diagnostics || {};
  const topo = snapshot?.topo_diagnostics || {};
  const declaredRefs = Array.isArray(documentRules.declared_rule_refs) ? documentRules.declared_rule_refs : [];
  const hasBLayerRule = declaredRefs.includes("MXD_LAYER_B_OFFSET_9P5")
    || declaredRefs.includes("MXD_PPV_LAYER_B_OFFSET_9P5");
  const bLayerRuleActivation = (Array.isArray(documentRules.declared_rule_activation) ? documentRules.declared_rule_activation : [])
    .filter((entry) => entry.rule_id === "MXD_LAYER_B_OFFSET_9P5" || entry.rule_id === "MXD_PPV_LAYER_B_OFFSET_9P5")
    .map((entry) => ({
      rule_id: entry.rule_id,
      matched: entry.activation?.matched ?? null,
      parameter: entry.activation?.parameter || null,
      actual: entry.activation?.actual ?? null,
      expected: entry.activation?.expected ?? null,
      reason: entry.activation?.reason || null
    }));
  const bLayerCatalogActivation = (Array.isArray(documentRules.b_layer_catalog_activation) ? documentRules.b_layer_catalog_activation : [])
    .map((entry) => ({
      rule_id: entry.rule_id,
      found_in_catalog: Boolean(entry.found_in_catalog),
      matched: entry.activation?.matched ?? null,
      parameter: entry.activation?.parameter || null,
      actual: entry.activation?.actual ?? null,
      expected: entry.activation?.expected ?? null,
      reason: entry.activation?.reason || null
    }));
  const declaredConditionMatched = hasBLayerRule && bLayerRuleActivation.some((entry) => entry.matched === true);
  const declaredConditionFalse = hasBLayerRule && bLayerRuleActivation.some((entry) => entry.matched === false);
  const catalogConditionMatched = bLayerCatalogActivation.some((entry) => entry.matched === true);
  const conditionMatchedWithoutDeclared = !hasBLayerRule && catalogConditionMatched;
  const dyValues = topo?.runtime?.dy_range?.values || [];
  const appliedRules = Array.isArray(documentRules.applied_rules) ? documentRules.applied_rules : [];
  const appliedBLayerY9p5Rules = appliedRules.filter((rule) => {
    const axis = String(rule.axis || "").toUpperCase();
    const value = Number(rule.value_mm);
    return (rule.rule_id === "MXD_LAYER_B_OFFSET_9P5" || rule.rule_id === "MXD_PPV_LAYER_B_OFFSET_9P5")
      && axis === "Y"
      && Math.abs(Math.abs(value) - 9.5) < 0.000001;
  });
  const hasDocumentRuleY9p5 = appliedBLayerY9p5Rules.length > 0;
  const documentRuleY9p5Affected = appliedBLayerY9p5Rules.reduce((sum, rule) => sum + Number(rule.affected_count || 0), 0);
  const y9p5AffectedIds = new Set();
  for (const rule of appliedBLayerY9p5Rules) {
    for (const affected of Array.isArray(rule.affected_entities) ? rule.affected_entities : []) {
      if (affected?.entity_id) y9p5AffectedIds.add(String(affected.entity_id));
      if (affected?.object_id) y9p5AffectedIds.add(String(affected.object_id));
    }
  }
  const linkedWarnings = (Array.isArray(snapshot?.summary?.warnings) ? snapshot.summary.warnings : [])
    .filter((warning) => y9p5AffectedIds.has(String(warning?.entity_id || "")) || y9p5AffectedIds.has(String(warning?.object_id || "")));
  const openBoundaryWarnings = linkedWarnings.filter((warning) => warning?.code === "OPEN_BOUNDARY_CONTOUR");
  const unresolvedRejoinWarnings = linkedWarnings.filter((warning) => warning?.code === "UNRESOLVED_REJOIN");
  const hasRuntimeYMovement = Array.isArray(dyValues) && dyValues.some((value) => Number(value) !== 0);
  const hasRuntime9p5Movement = Array.isArray(dyValues) && dyValues.some((value) => Math.abs(Math.abs(Number(value)) - 9.5) < 0.000001);
  if (hasBLayerRule) summary.coverage.y_9p5.declared_snapshots += 1;
  if (hasRuntimeYMovement) summary.coverage.y_9p5.runtime_y_movement_snapshots += 1;
  if (hasRuntime9p5Movement) summary.coverage.y_9p5.runtime_9p5_snapshots += 1;
  if (hasDocumentRuleY9p5) summary.coverage.y_9p5.document_rule_y_9p5_snapshots += 1;
  summary.coverage.y_9p5.document_rule_y_9p5_affected_entities += documentRuleY9p5Affected;
  summary.coverage.y_9p5.document_rule_y_9p5_warning_count += linkedWarnings.length;
  summary.coverage.y_9p5.document_rule_y_9p5_open_boundary_count += openBoundaryWarnings.length;
  summary.coverage.y_9p5.document_rule_y_9p5_unresolved_rejoin_count += unresolvedRejoinWarnings.length;
  if (declaredConditionMatched) summary.coverage.y_9p5.declared_condition_matched_snapshots += 1;
  if (conditionMatchedWithoutDeclared) summary.coverage.y_9p5.condition_matched_without_declared_snapshots += 1;
  if (declaredConditionFalse) summary.coverage.y_9p5.declared_condition_false_snapshots += 1;
  if (hasBLayerRule || catalogConditionMatched || hasRuntimeYMovement || hasRuntime9p5Movement || hasDocumentRuleY9p5) {
    summary.coverage.y_9p5.details.push({
      fixture: fixtureName,
      mode,
      declared_b_layer_rule: hasBLayerRule,
      runtime_y_movement: hasRuntimeYMovement,
      runtime_9p5_movement: hasRuntime9p5Movement,
      document_rule_y_9p5: hasDocumentRuleY9p5,
      document_rule_y_9p5_affected_count: documentRuleY9p5Affected,
      document_rule_y_9p5_warning_count: linkedWarnings.length,
      document_rule_y_9p5_open_boundary_count: openBoundaryWarnings.length,
      document_rule_y_9p5_unresolved_rejoin_count: unresolvedRejoinWarnings.length,
      document_rule_y_9p5_warning_codes: countBy(linkedWarnings, (warning) => warning.code),
      document_rule_y_9p5_warning_entities: linkedWarnings.slice(0, 25).map((warning) => ({
        code: warning.code || null,
        entity_id: warning.entity_id || null,
        object_id: warning.object_id || null,
        message: warning.message || null
      })),
      dy_values: Array.isArray(dyValues) ? dyValues : [],
      b_layer_rule_activation: bLayerRuleActivation,
      b_layer_catalog_activation: bLayerCatalogActivation,
      declared_condition_matched: declaredConditionMatched,
      condition_matched_without_declared: conditionMatchedWithoutDeclared,
      declared_condition_false: declaredConditionFalse,
      output_file: path.join(
        "tests/resolver_harness/output",
        safeName(fixtureName),
        safeName(mode) + ".json"
      )
    });
  }
}
function candidateKindForReadiness(readiness) {
  if (!readiness?.extraction_candidate) return null;
  const stageOrder = Array.isArray(readiness.stage_order) ? readiness.stage_order : [];
  const axes = Array.isArray(readiness.axes) ? readiness.axes.map((axis) => String(axis || "").toUpperCase()).filter(Boolean) : [];
  const stageCount = Number(readiness.movement_stage_count || 0);
  if (stageCount === 0 || stageOrder.length === 0) return "no_movement";
  if (stageOrder.length === 1 && stageOrder[0] === "topo_simulation" && axes.length === 1 && axes[0] === "X") return "topo_x_only";
  return "other_candidate";
}

function updateExtractionReadinessSummary(summary, fixtureName, mode, snapshot) {
  const readiness = snapshot?.extraction_readiness || null;
  if (!readiness) return;
  summary.extraction_readiness.snapshots += 1;
  const status = String(readiness.status || "unknown");
  summary.extraction_readiness.status_counts[status] = Number(summary.extraction_readiness.status_counts[status] || 0) + 1;
  const candidateKind = candidateKindForReadiness(readiness);
  if (readiness.extraction_candidate) {
    summary.extraction_readiness.candidates += 1;
    const kind = candidateKind || "unknown";
    summary.extraction_readiness.candidate_kind_counts[kind] = Number(summary.extraction_readiness.candidate_kind_counts[kind] || 0) + 1;
  }
  if (readiness.requires_review) summary.extraction_readiness.review += 1;
  if (readiness.blocked) summary.extraction_readiness.blocked += 1;
  const blockers = Array.isArray(readiness.blockers) ? readiness.blockers : [];
  const reviewItems = Array.isArray(readiness.review_items) ? readiness.review_items : [];
  for (const item of blockers) {
    const code = String(item.code || "unknown");
    const kind = String(item.kind || "unknown");
    summary.extraction_readiness.blocker_codes[code] = Number(summary.extraction_readiness.blocker_codes[code] || 0) + 1;
    summary.extraction_readiness.blocker_kind_counts[kind] = Number(summary.extraction_readiness.blocker_kind_counts[kind] || 0) + 1;
  }
  for (const item of reviewItems) {
    const code = String(item.code || "unknown");
    summary.extraction_readiness.review_codes[code] = Number(summary.extraction_readiness.review_codes[code] || 0) + 1;
  }
  summary.extraction_readiness.details.push({
    fixture: fixtureName,
    mode,
    status,
    extraction_candidate: Boolean(readiness.extraction_candidate),
    requires_review: Boolean(readiness.requires_review),
    blocked: Boolean(readiness.blocked),
    candidate_kind: candidateKind,
    blockers,
    review_items: reviewItems,
    stage_order: readiness.stage_order || [],
    axes: readiness.axes || [],
    movement_stage_count: readiness.movement_stage_count || 0,
    output_file: path.join(
      "tests/resolver_harness/output",
      safeName(fixtureName),
      safeName(mode) + ".json"
    )
  });
}

function updateTopoXOnlyExecutionSummary(summary, fixtureName, mode, snapshot) {
  const diagnostics = snapshot?.topo_x_only_execution_diagnostics || null;
  if (!diagnostics || !diagnostics.applicable) return;
  summary.topo_x_only_execution.checked += 1;
  summary.topo_x_only_execution.mismatches += Number(diagnostics.mismatch_count || 0);
  if (diagnostics.mismatch_count > 0) summary.topo_x_only_execution.snapshots_with_mismatch += 1;
  summary.topo_x_only_execution.details.push({
    fixture: fixtureName,
    mode,
    mismatch_count: Number(diagnostics.mismatch_count || 0),
    reason: diagnostics.reason || null,
    executed: Boolean(diagnostics.execution?.executed),
    execution_status: diagnostics.execution?.execution_status || null,
    moved_count: diagnostics.runtime?.moved_count ?? diagnostics.execution?.output_summary?.moved_count ?? null,
    dx_values: diagnostics.runtime?.dx_values || diagnostics.execution?.output_summary?.dx_values || [],
    dy_values: diagnostics.runtime?.dy_values || diagnostics.execution?.output_summary?.dy_values || [],
    output_file: path.join(
      "tests/resolver_harness/output",
      safeName(fixtureName),
      safeName(mode) + ".json"
    )
  });
}

function updateFacadeSharedDiagnosticsSummary(summary, fixtureName, mode, snapshot) {
  const parity = snapshot?.facade_shared_diagnostics_parity || null;
  if (!parity || !parity.available) return;
  summary.facade_shared_diagnostics.available_snapshots += 1;
  if (!parity.checked) return;
  summary.facade_shared_diagnostics.checked += 1;
  summary.facade_shared_diagnostics.mismatches += Number(parity.mismatch_count || 0);
  if (parity.mismatch_count > 0) summary.facade_shared_diagnostics.snapshots_with_mismatch += 1;
  summary.facade_shared_diagnostics.details.push({
    fixture: fixtureName,
    mode,
    mismatch_count: Number(parity.mismatch_count || 0),
    fields: (Array.isArray(parity.comparisons) ? parity.comparisons : []).map((item) => ({
      field: item.field || null,
      matches: Boolean(item.matches)
    })),
    output_file: path.join(
      "tests/resolver_harness/output",
      safeName(fixtureName),
      safeName(mode) + ".json"
    )
  });
}

function updateNoMovementExecutionSummary(summary, fixtureName, mode, snapshot) {
  const diagnostics = snapshot?.no_movement_execution_diagnostics || null;
  if (!diagnostics || !diagnostics.applicable) return;
  summary.no_movement_execution.checked += 1;
  summary.no_movement_execution.mismatches += Number(diagnostics.mismatch_count || 0);
  if (diagnostics.mismatch_count > 0) summary.no_movement_execution.snapshots_with_mismatch += 1;
  summary.no_movement_execution.details.push({
    fixture: fixtureName,
    mode,
    mismatch_count: Number(diagnostics.mismatch_count || 0),
    reason: diagnostics.reason || null,
    executed: Boolean(diagnostics.execution?.executed),
    execution_status: diagnostics.execution?.execution_status || null,
    output_file: path.join(
      "tests/resolver_harness/output",
      safeName(fixtureName),
      safeName(mode) + ".json"
    )
  });
}

function updateTopoXOnlySummary(summary, fixtureName, mode, snapshot) {
  const diagnostics = snapshot?.topo_x_only_diagnostics || null;
  if (!diagnostics || !diagnostics.applicable) return;
  summary.topo_x_only.checked += 1;
  summary.topo_x_only.mismatches += Number(diagnostics.mismatch_count || 0);
  if (diagnostics.mismatch_count > 0) summary.topo_x_only.snapshots_with_mismatch += 1;
  summary.topo_x_only.details.push({
    fixture: fixtureName,
    mode,
    mismatch_count: Number(diagnostics.mismatch_count || 0),
    reason: diagnostics.reason || null,
    moved_count: diagnostics.runtime?.moved_count ?? diagnostics.shared?.moved_count ?? null,
    dx_values: diagnostics.runtime?.dx_values || diagnostics.shared?.dx_values || [],
    dy_values: diagnostics.runtime?.dy_values || diagnostics.shared?.dy_values || [],
    output_file: path.join(
      "tests/resolver_harness/output",
      safeName(fixtureName),
      safeName(mode) + ".json"
    )
  });
}

function updateNoMovementSummary(summary, fixtureName, mode, snapshot) {
  const diagnostics = snapshot?.no_movement_diagnostics || null;
  if (!diagnostics || !diagnostics.applicable) return;
  summary.no_movement.checked += 1;
  summary.no_movement.mismatches += Number(diagnostics.mismatch_count || 0);
  if (diagnostics.mismatch_count > 0) summary.no_movement.snapshots_with_mismatch += 1;
  summary.no_movement.details.push({
    fixture: fixtureName,
    mode,
    mismatch_count: Number(diagnostics.mismatch_count || 0),
    reason: diagnostics.reason || null,
    output_file: path.join(
      "tests/resolver_harness/output",
      safeName(fixtureName),
      safeName(mode) + ".json"
    )
  });
}

function updateResolverPlanSummary(summary, fixtureName, mode, snapshot) {
  const assertions = snapshot?.resolver_plan_assertions || null;
  if (assertions) {
    summary.resolver_plan.assertion_snapshots += 1;
    summary.resolver_plan.assertion_warnings += Number(assertions.warning_count || 0);
    summary.resolver_plan.assertion_infos += Number(assertions.info_count || 0);
    for (const assertion of Array.isArray(assertions.assertions) ? assertions.assertions : []) {
      const code = String(assertion.code || "unknown");
      summary.resolver_plan.assertion_codes[code] = Number(summary.resolver_plan.assertion_codes[code] || 0) + 1;
      summary.resolver_plan.assertion_details.push({
        fixture: fixtureName,
        mode,
        code,
        severity: assertion.severity || null,
        message: assertion.message || null,
        output_file: path.join(
          "tests/resolver_harness/output",
          safeName(fixtureName),
          safeName(mode) + ".json"
        )
      });
    }
  }
  const plan = snapshot?.resolver_plan || null;
  if (!plan) return;
  summary.resolver_plan.snapshots_with_plan += 1;
  if (plan.reorder_candidate) summary.resolver_plan.reorder_candidates += 1;
  if (plan.has_multi_axis_movement) summary.resolver_plan.multi_axis_plans += 1;
  const orderKey = Array.isArray(plan.stage_order) && plan.stage_order.length ? plan.stage_order.join(" -> ") : "no_movement";
  summary.resolver_plan.observed_orders[orderKey] = Number(summary.resolver_plan.observed_orders[orderKey] || 0) + 1;
  if (plan.movement_stage_count || plan.reorder_candidate) {
    summary.resolver_plan.details.push({
      fixture: fixtureName,
      mode,
      stage_order: plan.stage_order || [],
      axes: plan.axes || [],
      movement_stage_count: plan.movement_stage_count || 0,
      reorder_candidate: Boolean(plan.reorder_candidate),
      notes: plan.notes || [],
      output_file: path.join(
        "tests/resolver_harness/output",
        safeName(fixtureName),
        safeName(mode) + ".json"
      )
    });
  }
}

function updateMovementSummary(summary, fixtureName, mode, snapshot) {
  const inventory = snapshot?.movement_inventory || {};
  const stages = Array.isArray(inventory.stages) ? inventory.stages : [];
  summary.movement.stage_count += stages.length;
  if (stages.length) summary.movement.snapshots_with_movement += 1;
  for (const stage of stages) {
    const source = String(stage.source || "unknown");
    const axis = String(stage.axis || "").toUpperCase();
    if (source === "document_rule") summary.movement.document_rule_stages += 1;
    else if (source === "topo_mover") summary.movement.topo_stages += 1;
    else if (source === "post_topo_rule") summary.movement.post_topo_stages += 1;
    else summary.movement.other_stages += 1;
    if (axis === "X" || Number(stage.dx || 0) !== 0) summary.movement.x_stages += 1;
    if (axis === "Y" || Number(stage.dy || 0) !== 0) summary.movement.y_stages += 1;
  }
  if (stages.length) {
    summary.movement.details.push({
      fixture: fixtureName,
      mode,
      stage_count: stages.length,
      stages: stages.map((stage) => ({
        stage_index: stage.stage_index,
        phase: stage.phase || null,
        source: stage.source || null,
        rule_id: stage.rule_id || null,
        group: stage.group || null,
        zone: stage.zone || null,
        axis: stage.axis || null,
        dx: stage.dx ?? null,
        dy: stage.dy ?? null,
        affected_count: stage.affected_count ?? null
      })),
      output_file: path.join(
        "tests/resolver_harness/output",
        safeName(fixtureName),
        safeName(mode) + ".json"
      )
    });
  }
}

function updateTopoSummary(summary, fixtureName, mode, snapshot) {
  const diagnostics = snapshot?.topo_diagnostics || {};
  const runtime = diagnostics.runtime || {};
  const movedCount = Number(runtime.moved_count || 0);
  const skippedCount = Number(runtime.skipped_count || 0);
  summary.topo.file_definitions += Number(diagnostics.file_definition_count || 0);
  summary.topo.entity_roles += Number(diagnostics.entity_role_count || 0);
  summary.topo.mover_roles += Number(diagnostics.mover_role_count || 0);
  summary.topo.moved_entities += movedCount;
  summary.topo.skipped_topo_entities += skippedCount;
  if (diagnostics.file_definition_count > 0) summary.topo.snapshots_with_file_definition += 1;
  if (diagnostics.mover_role_count > 0) summary.topo.snapshots_with_mover_roles += 1;
  if (movedCount > 0) summary.topo.snapshots_with_runtime_movement += 1;
  if (diagnostics.file_definition_count > 0 || diagnostics.mover_role_count > 0 || movedCount > 0 || skippedCount > 0) {
    summary.topo.details.push({
      fixture: fixtureName,
      mode,
      file_definition_count: Number(diagnostics.file_definition_count || 0),
      mover_role_count: Number(diagnostics.mover_role_count || 0),
      runtime_group: runtime.topo_group || null,
      axis: runtime.axis || null,
      moved_count: movedCount,
      skipped_count: skippedCount,
      dx_range: runtime.dx_range || null,
      dy_range: runtime.dy_range || null,
      output_file: path.join(
        "tests/resolver_harness/output",
        safeName(fixtureName),
        safeName(mode) + ".json"
      )
    });
  }
}

function updateBranchSummary(summary, fixtureName, mode, snapshot) {
  const diagnostics = snapshot?.branch_diagnostics || {};
  const counts = diagnostics.session_counts || {};
  const valid = Number(counts.valid_branch_assigned || 0);
  const invalid = Number(counts.invalid_branch_assigned || 0);
  const predictedRemove = Number(diagnostics.harness_predicted_filter?.would_remove || 0);
  summary.branch.total_entities_seen += Number(counts.total_entities || 0);
  summary.branch.valid_branch_assigned += valid;
  summary.branch.invalid_branch_assigned += invalid;
  summary.branch.predicted_removed += predictedRemove;
  if (valid > 0) summary.branch.snapshots_with_branch_metadata += 1;
  if (invalid > 0) summary.branch.snapshots_with_branch_issues += 1;
  if (diagnostics.runtime_branch_filter) summary.branch.snapshots_with_runtime_branch_filter += 1;
  if (valid > 0 || invalid > 0 || diagnostics.runtime_branch_filter) {
    summary.branch.details.push({
      fixture: fixtureName,
      mode,
      requested_branch_mode: diagnostics.requested_branch_mode || null,
      by_variant: counts.by_variant || {},
      predicted_remove: predictedRemove,
      runtime_branch_filter: diagnostics.runtime_branch_filter || null,
      output_file: path.join(
        "tests/resolver_harness/output",
        safeName(fixtureName),
        safeName(mode) + ".json"
      )
    });
  }
}

function updateDocumentRuleSummary(summary, fixtureName, mode, snapshot) {
  const diagnostics = snapshot?.document_rule_diagnostics || {};
  const declaredCount = Number(diagnostics.declared_count || 0);
  const appliedCount = Number(diagnostics.applied_count || 0);
  const postTopoCount = Number(diagnostics.post_topo_count || 0);
  summary.document_rules.declared_refs += declaredCount;
  summary.document_rules.applied += appliedCount;
  summary.document_rules.post_topo += postTopoCount;
  if (declaredCount > 0) summary.document_rules.snapshots_with_declared_refs += 1;
  if (appliedCount > 0) summary.document_rules.snapshots_with_applied += 1;
  if (declaredCount > 0 || appliedCount > 0 || postTopoCount > 0) {
    summary.document_rules.details.push({
      fixture: fixtureName,
      mode,
      declared_rule_refs: diagnostics.declared_rule_refs || [],
      declared_rule_activation: diagnostics.declared_rule_activation || [],
      b_layer_catalog_activation: diagnostics.b_layer_catalog_activation || [],
      applied_count: appliedCount,
      post_topo_count: postTopoCount,
      output_file: path.join(
        "tests/resolver_harness/output",
        safeName(fixtureName),
        safeName(mode) + ".json"
      )
    });
  }
}

function updateSemSummary(summary, fixtureName, mode, snapshot) {
  const sem = snapshot?.sem_diagnostics || {};
  const checked = Number(sem.checked_count || 0);
  const mismatches = Number(sem.mismatch_count || 0);
  summary.sem.checked += checked;
  summary.sem.mismatches += mismatches;
  if (checked > 0) summary.sem.snapshots_with_sem += 1;
  if (mismatches > 0) {
    summary.sem.snapshots_with_mismatch += 1;
    summary.sem.mismatch_details.push({
      fixture: fixtureName,
      mode,
      checked_count: checked,
      mismatch_count: mismatches,
      output_file: path.join(
        "tests/resolver_harness/output",
        safeName(fixtureName),
        safeName(mode) + ".json"
      )
    });
  }
}

async function runFixtureMode({ fixtureName, session, mode }) {
  try {
    const wrapped = await resolveMotherDxfRuntimePlan({
      session,
      configParameterSet: session.config_parameter_set,
      mode,
      branchMode: process.env.RESOLVER_HARNESS_BRANCH_MODE || undefined,
      semDiagnostics: true,
      semEvaluatorMode: configuredSemEvaluatorMode(mode),
      resolverDiagnostics: true
    });
    return snapshotForSuccess({ fixtureName, mode, wrapped, session });
  } catch (error) {
    return snapshotForError({ fixtureName, mode, error, session });
  }
}

async function main() {
  const modes = configuredModes();
  const fixtureFiles = listJsonFiles(FIXTURE_ROOT);
  const summary = {
    fixture_root: FIXTURE_ROOT,
    output_root: OUTPUT_ROOT,
    modes,
    discovered_json_files: fixtureFiles.length,
    runnable_fixtures: 0,
    skipped_files: 0,
    snapshots_written: 0,
    ok: 0,
    failed: 0,
    sem: {
      checked: 0,
      mismatches: 0,
      snapshots_with_sem: 0,
      snapshots_with_mismatch: 0,
      mismatch_details: []
    },
    no_movement: {
      checked: 0,
      mismatches: 0,
      snapshots_with_mismatch: 0,
      details: []
    },
    no_movement_execution: {
      checked: 0,
      mismatches: 0,
      snapshots_with_mismatch: 0,
      details: []
    },
    topo_x_only: {
      checked: 0,
      mismatches: 0,
      snapshots_with_mismatch: 0,
      details: []
    },
    topo_x_only_execution: {
      checked: 0,
      mismatches: 0,
      snapshots_with_mismatch: 0,
      details: []
    },
    facade_shared_diagnostics: {
      available_snapshots: 0,
      checked: 0,
      mismatches: 0,
      snapshots_with_mismatch: 0,
      details: []
    },
    document_rules: {
      declared_refs: 0,
      applied: 0,
      post_topo: 0,
      snapshots_with_declared_refs: 0,
      snapshots_with_applied: 0,
      details: []
    },
    branch: {
      total_entities_seen: 0,
      valid_branch_assigned: 0,
      invalid_branch_assigned: 0,
      predicted_removed: 0,
      snapshots_with_branch_metadata: 0,
      snapshots_with_branch_issues: 0,
      snapshots_with_runtime_branch_filter: 0,
      details: []
    },
    topo: {
      file_definitions: 0,
      entity_roles: 0,
      mover_roles: 0,
      moved_entities: 0,
      skipped_topo_entities: 0,
      snapshots_with_file_definition: 0,
      snapshots_with_mover_roles: 0,
      snapshots_with_runtime_movement: 0,
      details: []
    },
    movement: {
      stage_count: 0,
      snapshots_with_movement: 0,
      document_rule_stages: 0,
      topo_stages: 0,
      post_topo_stages: 0,
      other_stages: 0,
      x_stages: 0,
      y_stages: 0,
      details: []
    },
    resolver_plan: {
      snapshots_with_plan: 0,
      reorder_candidates: 0,
      multi_axis_plans: 0,
      assertion_snapshots: 0,
      assertion_warnings: 0,
      assertion_infos: 0,
      assertion_codes: {},
      assertion_details: [],
      observed_orders: {},
      details: []
    },
    extraction_readiness: {
      snapshots: 0,
      candidates: 0,
      review: 0,
      blocked: 0,
      status_counts: {},
      candidate_kind_counts: {},
      blocker_codes: {},
      blocker_kind_counts: {},
      review_codes: {},
      details: []
    },
    coverage: {
      y_9p5: {
        declared_snapshots: 0,
        runtime_y_movement_snapshots: 0,
        runtime_9p5_snapshots: 0,
        document_rule_y_9p5_snapshots: 0,
        document_rule_y_9p5_affected_entities: 0,
        document_rule_y_9p5_warning_count: 0,
        document_rule_y_9p5_open_boundary_count: 0,
        document_rule_y_9p5_unresolved_rejoin_count: 0,
        declared_condition_matched_snapshots: 0,
        condition_matched_without_declared_snapshots: 0,
        declared_condition_false_snapshots: 0,
        details: []
      }
    },
    error_details: []
  };

  for (const filePath of fixtureFiles) {
    const raw = readJson(filePath);
    if (!isMotherDxfSession(raw)) {
      summary.skipped_files += 1;
      continue;
    }
    summary.runnable_fixtures += 1;
    const relative = path.relative(FIXTURE_ROOT, filePath);
    const fixtureName = safeName(relative.replace(/[\\/]/g, "__"));
    for (const mode of modes) {
      const snapshot = await runFixtureMode({ fixtureName, session: raw, mode });
      const outPath = writeSnapshot(fixtureName, mode, snapshot);
      summary.snapshots_written += 1;
      if (snapshot.ok) summary.ok += 1;
      else {
        summary.failed += 1;
        summary.error_details.push({
          fixture: fixtureName,
          mode,
          message: snapshot.thrown_error?.message || "Unknown diagnostic error",
          output_file: path.join(
            "tests/resolver_harness/output",
            safeName(fixtureName),
            safeName(mode) + ".json"
          )
        });
      }
      updateSemSummary(summary, fixtureName, mode, snapshot);
      updateNoMovementSummary(summary, fixtureName, mode, snapshot);
      updateNoMovementExecutionSummary(summary, fixtureName, mode, snapshot);
      updateTopoXOnlySummary(summary, fixtureName, mode, snapshot);
      updateTopoXOnlyExecutionSummary(summary, fixtureName, mode, snapshot);
      updateFacadeSharedDiagnosticsSummary(summary, fixtureName, mode, snapshot);
      updateDocumentRuleSummary(summary, fixtureName, mode, snapshot);
      updateBranchSummary(summary, fixtureName, mode, snapshot);
      updateTopoSummary(summary, fixtureName, mode, snapshot);
      updateMovementSummary(summary, fixtureName, mode, snapshot);
      updateResolverPlanSummary(summary, fixtureName, mode, snapshot);
      updateExtractionReadinessSummary(summary, fixtureName, mode, snapshot);
      updateCoverageSummary(summary, fixtureName, mode, snapshot);
      const sem = snapshot.sem_diagnostics || {};
      const semText = sem.checked_count
        ? " | SEM " + sem.checked_count + " checked / " + sem.mismatch_count + " mismatch"
        : "";
      console.log((snapshot.ok ? "OK" : "ERR") + " " + fixtureName + " " + mode + semText + " -> " + path.relative(process.cwd(), outPath));
    }
  }

  const summaryPath = writeRunSummary(summary);
  const reportPath = writeSemParityReport(summary);
  const resolverPlanReportPath = writeResolverPlanReport(summary);
  const resolverPlanAssertionsReportPath = writeResolverPlanAssertionsReport(summary);
  const extractionReadinessReportPath = writeExtractionReadinessReport(summary);
  summary.summary_file = path.relative(process.cwd(), summaryPath);
  summary.sem_report_file = path.relative(process.cwd(), reportPath);
  summary.resolver_plan_report_file = path.relative(process.cwd(), resolverPlanReportPath);
  summary.resolver_plan_assertions_report_file = path.relative(process.cwd(), resolverPlanAssertionsReportPath);
  summary.extraction_readiness_report_file = path.relative(process.cwd(), extractionReadinessReportPath);
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + "\n");

  console.log(JSON.stringify(summary, null, 2));
  console.log("SEM parity report -> " + path.relative(process.cwd(), reportPath));
  console.log("Resolver plan report -> " + path.relative(process.cwd(), resolverPlanReportPath));
  console.log("Resolver plan assertions report -> " + path.relative(process.cwd(), resolverPlanAssertionsReportPath));
  console.log("Extraction readiness report -> " + path.relative(process.cwd(), extractionReadinessReportPath));
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
