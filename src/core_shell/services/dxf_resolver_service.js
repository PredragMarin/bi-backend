"use strict";

const { bboxFromShapes, translateShape } = require("../geometry");
const {
  collectLineCandidates,
  applyTrimRejoinToTranslatedLine
} = require("./dxf_line_repair_service");
const {
  buildSharedResolverDiagnostics
} = require("./dxf_resolver_diagnostics_service");

function cloneShapes(shapes) {
  return JSON.parse(JSON.stringify(Array.isArray(shapes) ? shapes : []));
}

function shapeAnchorPoint(shape) {
  if (!shape || typeof shape !== "object") return null;
  if (shape.kind === "circle" || shape.kind === "arc") {
    const x = Number(shape.centerX);
    const y = Number(shape.centerY);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  }
  if (shape.kind === "insert") {
    const x = Number(shape.x);
    const y = Number(shape.y);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  }
  return null;
}

function buildHorizontalBandContext(objects) {
  const context = {
    T: { minX: Number.POSITIVE_INFINITY, maxX: Number.NEGATIVE_INFINITY },
    B: { minX: Number.POSITIVE_INFINITY, maxX: Number.NEGATIVE_INFINITY }
  };
  for (const object of Array.isArray(objects) ? objects : []) {
    const layer = String(object?.primary_layer || "").trim().toUpperCase();
    const bucket = layer === "T" || layer === "TL" || layer === "TR"
      ? context.T
      : layer === "B" || layer === "BL" || layer === "BR"
        ? context.B
        : null;
    if (!bucket) continue;
    for (const shape of Array.isArray(object.shapes) ? object.shapes : []) {
      const shapeBBox = bboxFromShapes([shape]);
      if (!shapeBBox) continue;
      bucket.minX = Math.min(bucket.minX, shapeBBox.minX);
      bucket.maxX = Math.max(bucket.maxX, shapeBBox.maxX);
    }
  }
  for (const key of Object.keys(context)) {
    if (!Number.isFinite(context[key].minX) || !Number.isFinite(context[key].maxX)) {
      context[key] = null;
    }
  }
  return context;
}

function buildVerticalBandContext(objects) {
  const context = {
    L: { minY: Number.POSITIVE_INFINITY, maxY: Number.NEGATIVE_INFINITY },
    R: { minY: Number.POSITIVE_INFINITY, maxY: Number.NEGATIVE_INFINITY }
  };
  for (const object of Array.isArray(objects) ? objects : []) {
    const layer = String(object?.primary_layer || "").trim().toUpperCase();
    const bucket = layer === "L" || layer === "TL" || layer === "BL"
      ? context.L
      : layer === "R" || layer === "TR" || layer === "BR"
        ? context.R
        : null;
    if (!bucket) continue;
    for (const shape of Array.isArray(object.shapes) ? object.shapes : []) {
      const shapeBBox = bboxFromShapes([shape]);
      if (!shapeBBox) continue;
      bucket.minY = Math.min(bucket.minY, shapeBBox.minY);
      bucket.maxY = Math.max(bucket.maxY, shapeBBox.maxY);
    }
  }
  for (const key of Object.keys(context)) {
    if (!Number.isFinite(context[key].minY) || !Number.isFinite(context[key].maxY)) {
      context[key] = null;
    }
  }
  return context;
}

function inferredRigidXOffsetForHorizontalBand(shape, layer, offset, bandContext) {
  const normalizedLayer = String(layer || "").trim().toUpperCase();
  if (normalizedLayer !== "T" && normalizedLayer !== "B") return 0;
  if (!shape || shape.kind === "line") return 0;
  const context = bandContext ? bandContext[normalizedLayer] : null;
  const anchor = shapeAnchorPoint(shape);
  if (!context || !anchor) return 0;
  const leftDistance = Math.abs(Number(anchor.x) - Number(context.minX));
  const rightDistance = Math.abs(Number(context.maxX) - Number(anchor.x));
  if (leftDistance < rightDistance) return Number(offset?.dx_left || 0);
  if (rightDistance < leftDistance) return Number(offset?.dx_right || 0);
  return 0;
}

function inferredRigidYOffsetForVerticalBand(shape, layer, offset, bandContext) {
  const normalizedLayer = String(layer || "").trim().toUpperCase();
  if (normalizedLayer !== "L" && normalizedLayer !== "R") return 0;
  if (!shape || shape.kind === "line") return 0;
  const context = bandContext ? bandContext[normalizedLayer] : null;
  const anchor = shapeAnchorPoint(shape);
  if (!context || !anchor) return 0;
  const bottomDistance = Math.abs(Number(anchor.y) - Number(context.minY));
  const topDistance = Math.abs(Number(context.maxY) - Number(anchor.y));
  if (topDistance < bottomDistance) return Number(offset?.dy_top || 0);
  if (bottomDistance < topDistance) return Number(offset?.dy_bottom || 0);
  return 0;
}

function readNumericParameter(parameters, keys, fallback) {
  for (const key of Array.isArray(keys) ? keys : []) {
    const value = parameters ? parameters[key] : undefined;
    const num = Number(value);
    if (Number.isFinite(num)) return num;
  }
  return fallback;
}

function standardParametricDeltas(parameters) {
  const height = readNumericParameter(parameters, ["VISINA", "VISINA_VRATA"], 2100);
  const width = readNumericParameter(parameters, ["SIRINA", "SIRINA_VRATA"], 900);
  const shortening = readNumericParameter(parameters, ["SKRACENJE"], 0);
  return {
    height_delta: height - 2100,
    width_half_delta: (width - 900) / 2,
    shortening_delta: shortening
  };
}

function standardLayerOffset(layer, deltas) {
  const normalizedLayer = String(layer || "").trim().toUpperCase();
  const dxHeight = -Number(deltas?.height_delta || 0);
  const dxShortening = Number(deltas?.shortening_delta || 0);
  const dyWidth = Number(deltas?.width_half_delta || 0);

  switch (normalizedLayer) {
    case "L":
      return { dx: dxHeight, dy: 0 };
    case "R":
      return { dx: dxShortening, dy: 0 };
    case "T":
      return { dx: 0, dy: dyWidth };
    case "B":
      return { dx: 0, dy: -dyWidth };
    case "TL":
      return { dx: dxHeight, dy: dyWidth };
    case "TR":
      return { dx: dxShortening, dy: dyWidth };
    case "BL":
      return { dx: dxHeight, dy: -dyWidth };
    case "BR":
      return { dx: dxShortening, dy: -dyWidth };
    default:
      return { dx: 0, dy: 0 };
  }
}

function runStandardParametricResizePreview({ objects, parameters }) {
  const deltas = standardParametricDeltas(parameters);
  const bandContext = buildHorizontalBandContext(objects);
  const verticalBandContext = buildVerticalBandContext(objects);
  const lineCandidates = collectLineCandidates(objects);
  const objectMap = new Map();
  const simulatedShapeMap = new Map();

  for (const object of Array.isArray(objects) ? objects : []) {
    const baseOffset = standardLayerOffset(object?.primary_layer, deltas);
    const objectLinePairing = [];
    const originalShapes = cloneShapes(object?.shapes);
    const simulatedShapes = originalShapes.map((shape, shapeIndex) => {
      const inferredX = inferredRigidXOffsetForHorizontalBand(shape, object?.primary_layer, {
        dx_left: -Number(deltas?.height_delta || 0),
        dx_right: Number(deltas?.shortening_delta || 0)
      }, bandContext);
      const inferredY = inferredRigidYOffsetForVerticalBand(shape, object?.primary_layer, {
        dy_top: Number(deltas?.width_half_delta || 0),
        dy_bottom: -Number(deltas?.width_half_delta || 0)
      }, verticalBandContext);
      const translatedShape = translateShape(shape, baseOffset.dx + inferredX, baseOffset.dy + inferredY);
      simulatedShapeMap.set(`${object.id}:${shapeIndex}`, translatedShape);
      return translatedShape;
    });
    objectMap.set(object.id, {
      geometry_simulation_mode: "none_topology_standard_parametric_v0",
      simulated_shapes: simulatedShapes,
      simulated_bbox: simulatedShapes.length ? bboxFromShapes(simulatedShapes) : (object?.bbox ? JSON.parse(JSON.stringify(object.bbox)) : null),
      applied_offset: baseOffset,
      reference_deltas: deltas,
      line_pairing: objectLinePairing
    });
  }

  for (const object of Array.isArray(objects) ? objects : []) {
    const preview = objectMap.get(object.id);
    if (!preview) continue;
    for (let index = 0; index < preview.simulated_shapes.length; index += 1) {
      const originalShape = object?.shapes?.[index];
      const translatedShape = preview.simulated_shapes[index];
      if (!originalShape || originalShape.kind !== "line") continue;
      const resolved = applyTrimRejoinToTranslatedLine(
        originalShape,
        translatedShape,
        lineCandidates,
        { object_id: object.id, shape_index: index },
        simulatedShapeMap
      );
      for (const pairing of resolved.pairings || []) {
        preview.line_pairing.push({
          status: pairing.status,
          paired_vertex: pairing.paired_vertex || null,
          anchor_object_id: pairing.candidate ? pairing.candidate.object_id : null,
          anchor_shape_index: pairing.candidate ? pairing.candidate.shape_index : null,
          anchor_vertex: pairing.candidate_vertex || null,
          intersection: pairing.intersection || null
        });
      }
      preview.simulated_shapes[index] = resolved.shape;
      simulatedShapeMap.set(`${object.id}:${index}`, resolved.shape);
      for (const reciprocal of resolved.reciprocals || []) {
        const reciprocalPreview = objectMap.get(reciprocal.object_id);
        if (reciprocalPreview && reciprocalPreview.simulated_shapes[reciprocal.shape_index]) {
          reciprocalPreview.simulated_shapes[reciprocal.shape_index] = reciprocal.shape;
          simulatedShapeMap.set(`${reciprocal.object_id}:${reciprocal.shape_index}`, reciprocal.shape);
        }
      }
    }
  }

  for (const object of Array.isArray(objects) ? objects : []) {
    const preview = objectMap.get(object.id);
    if (!preview) continue;
    preview.simulated_bbox = preview.simulated_shapes.length
      ? bboxFromShapes(preview.simulated_shapes)
      : (object?.bbox ? JSON.parse(JSON.stringify(object.bbox)) : null);
  }

  return objectMap;
}

function runResolverPreview({ profile, objects, configParameterSet, parameters }) {
  const normalizedProfile = String(profile || "").trim().toLowerCase();
  const effectiveParameters = parameters || configParameterSet?.parameters || {};
  if (normalizedProfile === "standard_parametric_resize") {
    return runStandardParametricResizePreview({
      objects,
      parameters: effectiveParameters
    });
  }
  throw new Error(`Unsupported resolver preview profile: ${profile}`);
}

function nowIso() {
  return new Date().toISOString();
}

function modePhaseNames(mode) {
  const normalizedMode = String(mode || "").trim();
  if (normalizedMode === "preview_combined") {
    return [
      "projectViewModel",
      "config_normalization",
      "document_rules",
      "topo_simulation",
      "post_topo_rules",
      "sem_visibility",
      "preview_validation"
    ];
  }
  if (normalizedMode === "child_topo_poc") {
    return [
      "projectViewModel",
      "config_normalization",
      "branch_selection",
      "document_rules",
      "sem_inclusion",
      "topo_materialization",
      "topo_repair",
      "post_topo_rules",
      "sem_deletion",
      "finalization",
      "child_serialization"
    ];
  }
  if (normalizedMode === "child_topo_poc_preview") {
    return [
      "projectViewModel",
      "config_normalization",
      "branch_selection",
      "document_rules",
      "sem_inclusion",
      "topo_materialization",
      "topo_repair",
      "post_topo_rules",
      "sem_deletion",
      "finalization",
      "materialized_preview",
      "preview_validation"
    ];
  }
  if (normalizedMode === "child_no_topo") {
    return [
      "projectViewModel",
      "config_normalization",
      "document_rules",
      "sem_inclusion",
      "sem_deletion",
      "finalization",
      "child_serialization"
    ];
  }
  return [];
}

function normalizeFacadeConfig(session, configParameterSet) {
  if (configParameterSet && typeof configParameterSet === "object") {
    return JSON.parse(JSON.stringify(configParameterSet));
  }
  if (session?.config_parameter_set && typeof session.config_parameter_set === "object") {
    return JSON.parse(JSON.stringify(session.config_parameter_set));
  }
  return null;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function resultConfig(result, fallback) {
  return result?.config_parameter_set
    || result?.simulation?.config_parameter_set
    || fallback
    || null;
}

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

function previewItemsFromFacadeResult(result) {
  if (Array.isArray(result?.simulation?.items)) return result.simulation.items;
  if (Array.isArray(result?.resolver_preview?.items)) return result.resolver_preview.items;
  return [];
}

function sourceObjectsFromFacadeResult(result) {
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

function compactSharedSemResult(result) {
  return {
    included: Boolean(result?.included),
    reason: result?.exclusion_reason || null,
    geometry_ops_count: Array.isArray(result?.geometry_ops) ? result.geometry_ops.length : 0,
    raw: result || null
  };
}

function buildSharedSemDiagnostics({ result, configParameterSet }) {
  const sharedSem = loadSharedSemEvaluatorService();
  const parameters = configParameterSet?.parameters || {};
  const previewItems = previewItemsFromFacadeResult(result);
  const previewByObjectId = new Map(previewItems.map((item) => [String(item.object_id || ""), item]));
  const previewByEntityId = new Map(previewItems.map((item) => [String(item.entity_id || ""), item]));
  const objects = sourceObjectsFromFacadeResult(result);
  const diagnostics = [];
  let mismatchCount = 0;

  for (const object of objects) {
    const parsed = object?.semantic_metadata?.parsed;
    if (!Array.isArray(parsed) || !parsed.length) continue;
    const sharedRaw = sharedSem.evaluateChildEntityInclusion(object, parameters);
    const shared = compactSharedSemResult(sharedRaw);
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
    enabled: true,
    mode: "shared_sem_preview_diagnostic_v1",
    checked_count: diagnostics.length,
    mismatch_count: mismatchCount,
    items: diagnostics
  };
}

function supportsSharedSemPreviewMode(mode) {
  const normalizedMode = String(mode || "").trim();
  return normalizedMode === "preview_combined" || normalizedMode === "child_topo_poc_preview";
}

function applySharedSemPreviewOverlay({ result, configParameterSet }) {
  const sharedSem = loadSharedSemEvaluatorService();
  const parameters = configParameterSet?.parameters || {};
  const nextResult = cloneJson(result);
  const previewItems = previewItemsFromFacadeResult(nextResult);
  let updatedCount = 0;
  let skippedCount = 0;

  for (const item of previewItems) {
    const parsed = item?.semantic_metadata?.parsed;
    if (!Array.isArray(parsed) || !parsed.length || !item.preview) {
      skippedCount += 1;
      continue;
    }
    const sharedRaw = sharedSem.evaluateChildEntityInclusion(item, parameters);
    item.preview.included = Boolean(sharedRaw?.included);
    item.preview.exclusion_reason = sharedRaw?.exclusion_reason || null;
    item.preview.geometry_ops = Array.isArray(sharedRaw?.geometry_ops) ? sharedRaw.geometry_ops : [];
    item.preview.sem_evaluator = "shared_sem_evaluator_service";
    updatedCount += 1;
  }

  return {
    result: nextResult,
    activation: {
      mode: "shared_preview_overlay_v1",
      updated_count: updatedCount,
      skipped_count: skippedCount
    }
  };
}

function loadSharedSemEvaluatorService() {
  // Inactive hook for extraction slice 1A. The facade still delegates runtime
  // behavior to mother_dxf_v1; callers may use this for parity diagnostics.
  return require("./sem_evaluator_service");
}

function loadMotherDxfRuntime() {
  // Lazy load keeps the historical circular dependency stable:
  // mother_dxf_v1 already imports runResolverPreview from this service.
  return require("../../modules/mother_dxf_v1/module_runtime");
}

async function callMotherRuntime({ runtime, session, configParameterSet, mode, branchMode }) {
  if (!session || typeof session !== "object") {
    throw new Error("resolveMotherDxfRuntimePlan requires a session object.");
  }
  const normalizedMode = String(mode || "").trim();
  const sessionId = String(session.session_id || "").trim();

  if (normalizedMode === "preview_combined") {
    if (typeof runtime.simulateChildPreview === "function") {
      return runtime.simulateChildPreview(session);
    }
    if (!sessionId || typeof runtime.simulateSession !== "function") {
      throw new Error("preview_combined requires simulateChildPreview or simulateSession.");
    }
    return runtime.simulateSession({
      sessionId,
      configParameterSet
    });
  }

  if (normalizedMode === "child_topo_poc") {
    return runtime.generateChildDxfTopoPoc(session, configParameterSet, { branchMode });
  }

  if (normalizedMode === "child_topo_poc_preview") {
    if (typeof runtime.materializeChildDocumentTopoPoc === "function"
      && typeof runtime.buildResolverMaterializedSimulation === "function") {
      const materialized = runtime.materializeChildDocumentTopoPoc(session, configParameterSet, { branchMode });
      return {
        config_parameter_set: configParameterSet,
        generation_summary: materialized.generation_summary,
        dxf_text: runtime.serializeDocument(materialized.document),
        resolver_preview: runtime.buildResolverMaterializedSimulation(session, configParameterSet, materialized)
      };
    }
    if (!sessionId || typeof runtime.generateChildDxfTopoPocPreviewForSession !== "function") {
      throw new Error("child_topo_poc_preview requires exported preview materialization support.");
    }
    return runtime.generateChildDxfTopoPocPreviewForSession({
      sessionId,
      parameterSet: configParameterSet,
      branchMode
    });
  }

  if (normalizedMode === "child_no_topo") {
    return runtime.generateChildDxfNoTopo(session, configParameterSet);
  }

  throw new Error(`Unsupported Mother DXF resolver mode: ${mode}`);
}

async function resolveMotherDxfRuntimePlan({
  session,
  configParameterSet,
  mode,
  branchMode,
  semDiagnostics = false,
  semEvaluatorMode = "runtime",
  resolverDiagnostics = false,
  sharedResolverMode = "runtime"
}) {
  const normalizedMode = String(mode || "").trim();
  const normalizedSemEvaluatorMode = String(semEvaluatorMode || "runtime").trim();
  const normalizedSharedResolverMode = String(sharedResolverMode || "runtime").trim();
  const allowedSharedResolverModes = new Set(["runtime", "activation_candidate_shadow"]);
  if (!allowedSharedResolverModes.has(normalizedSharedResolverMode)) {
    throw new Error(`Unsupported shared resolver mode: ${sharedResolverMode}`);
  }
  const normalizedConfig = normalizeFacadeConfig(session, configParameterSet);
  const runtime = loadMotherDxfRuntime();
  const start = nowIso();
  const startedAtMs = Date.now();
  let result;
  let caughtError = null;

  try {
    result = await callMotherRuntime({
      runtime,
      session,
      configParameterSet: normalizedConfig,
      mode: normalizedMode,
      branchMode
    });
  } catch (err) {
    caughtError = err;
  }

  const end = nowIso();
  const durationMs = Date.now() - startedAtMs;
  const entrypointNameByMode = {
    preview_combined: typeof runtime.simulateChildPreview === "function"
      ? "simulateChildPreview"
      : "simulateSession",
    child_topo_poc: "generateChildDxfTopoPoc",
    child_topo_poc_preview: typeof runtime.materializeChildDocumentTopoPoc === "function"
      && typeof runtime.buildResolverMaterializedSimulation === "function"
      ? "materializeChildDocumentTopoPoc+buildResolverMaterializedSimulation"
      : "generateChildDxfTopoPocPreviewForSession",
    child_no_topo: "generateChildDxfNoTopo"
  };
  const phases = modePhaseNames(normalizedMode).map((name) => ({
    name,
    start,
    end,
    duration_ms: durationMs,
    delegated: true
  }));
  const pipelineTrace = {
    mode: normalizedMode,
    entrypoint: entrypointNameByMode[normalizedMode] || null,
    parameters: {
      branchMode: branchMode || null,
      has_config_parameter_set: Boolean(normalizedConfig),
      session_id: session?.session_id || null,
      sem_evaluator_mode: normalizedSemEvaluatorMode,
      shared_resolver_mode: normalizedSharedResolverMode
    },
    steps: [
      {
        name: entrypointNameByMode[normalizedMode] || "unknown_entrypoint",
        start,
        end,
        duration_ms: durationMs
      },
      ...phases
    ]
  };

  if (caughtError) {
    caughtError.pipeline_trace = pipelineTrace;
    throw caughtError;
  }

  const shouldRunSharedResolverShadow = normalizedSharedResolverMode === "activation_candidate_shadow";
  let sharedResolverActivation = null;
  if (shouldRunSharedResolverShadow) {
    sharedResolverActivation = {
      mode: "activation_candidate_shadow_v1",
      active: false,
      diagnostic_only: true,
      reason: "Shared resolver execution flag is present but not activated; Mother runtime remains source of behavior."
    };
    pipelineTrace.steps.push({
      name: "shared_resolver_activation_candidate_shadow",
      start: nowIso(),
      end: nowIso(),
      duration_ms: 0,
      delegated: false,
      active: false,
      diagnostic_only: true
    });
  }

  const sharedSemPreviewSupported = supportsSharedSemPreviewMode(normalizedMode);
  const shouldRunSharedSemShadow = normalizedSemEvaluatorMode === "shared_preview_shadow";
  const shouldRunSharedSemOverlay = normalizedSemEvaluatorMode === "shared_preview_overlay";
  if (normalizedSemEvaluatorMode !== "runtime"
    && !shouldRunSharedSemShadow
    && !shouldRunSharedSemOverlay) {
    throw new Error(`Unsupported SEM evaluator mode: ${semEvaluatorMode}`);
  }
  if ((shouldRunSharedSemShadow || shouldRunSharedSemOverlay) && !sharedSemPreviewSupported) {
    throw new Error(`SEM evaluator mode ${normalizedSemEvaluatorMode} is only supported for preview modes.`);
  }

  const resultForSemDiagnostics = result;
  let effectiveResult = result;
  let sharedSemActivation = null;
  const shouldRunSemDiagnostics = (Boolean(semDiagnostics) || shouldRunSharedSemShadow || shouldRunSharedSemOverlay)
    && sharedSemPreviewSupported;
  const semDiagnosticStart = shouldRunSemDiagnostics ? nowIso() : null;
  const semDiagnosticStartedAtMs = shouldRunSemDiagnostics ? Date.now() : 0;
  const sem_diagnostics = shouldRunSemDiagnostics
    ? buildSharedSemDiagnostics({ result: resultForSemDiagnostics, configParameterSet: resultConfig(result, normalizedConfig) })
    : null;
  if (shouldRunSemDiagnostics) {
    pipelineTrace.steps.push({
      name: "shared_sem_diagnostics",
      start: semDiagnosticStart,
      end: nowIso(),
      duration_ms: Date.now() - semDiagnosticStartedAtMs,
      delegated: false,
      active: false,
      diagnostic_only: true
    });
  }

  const shouldRunResolverDiagnostics = Boolean(resolverDiagnostics);
  const resolverDiagnosticStart = shouldRunResolverDiagnostics ? nowIso() : null;
  const resolverDiagnosticStartedAtMs = shouldRunResolverDiagnostics ? Date.now() : 0;
  const shared_resolver_diagnostics = shouldRunResolverDiagnostics
    ? buildSharedResolverDiagnostics({ result })
    : null;
  if (shouldRunResolverDiagnostics) {
    pipelineTrace.steps.push({
      name: "shared_resolver_diagnostics",
      start: resolverDiagnosticStart,
      end: nowIso(),
      duration_ms: Date.now() - resolverDiagnosticStartedAtMs,
      delegated: false,
      active: false,
      diagnostic_only: true
    });
  }

  if (shouldRunSharedSemOverlay) {
    const overlayStart = nowIso();
    const overlayStartedAtMs = Date.now();
    const overlay = applySharedSemPreviewOverlay({
      result,
      configParameterSet: resultConfig(result, normalizedConfig)
    });
    effectiveResult = overlay.result;
    sharedSemActivation = overlay.activation;
    pipelineTrace.steps.push({
      name: "shared_sem_preview_overlay",
      start: overlayStart,
      end: nowIso(),
      duration_ms: Date.now() - overlayStartedAtMs,
      delegated: false,
      active: true,
      diagnostic_only: false
    });
  } else if (shouldRunSharedSemShadow) {
    sharedSemActivation = {
      mode: "shared_preview_shadow_v1",
      updated_count: 0,
      skipped_count: 0
    };
    pipelineTrace.steps.push({
      name: "shared_sem_preview_shadow",
      start: nowIso(),
      end: nowIso(),
      duration_ms: 0,
      delegated: false,
      active: false,
      diagnostic_only: true
    });
  }

  return {
    result: effectiveResult,
    pipeline_trace: pipelineTrace,
    config_parameter_set: resultConfig(effectiveResult, normalizedConfig),
    sem_evaluator_mode: normalizedSemEvaluatorMode,
    shared_resolver_mode: normalizedSharedResolverMode,
    shared_resolver_activation: sharedResolverActivation,
    shared_sem_activation: sharedSemActivation,
    sem_diagnostics,
    shared_resolver_diagnostics,
    warnings: collectResultWarnings(effectiveResult),
    errors: collectResultErrors(effectiveResult)
  };
}

module.exports = {
  loadSharedSemEvaluatorService,
  resolveMotherDxfRuntimePlan,
  runResolverPreview,
  runStandardParametricResizePreview
};
