"use strict";

const { bboxFromShapes, roundNumber, translateShape } = require("../geometry");
const { parseWhenExpression } = require("./sem_evaluator_service");
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

function normalizeResolverBranchMode(mode) {
  return String(mode || "ALL").trim() || "ALL";
}

function branchModeFromConfigParameters(parameters) {
  const tip = String(parameters?.MODEL_VRATA || parameters?.TIP_VRATA || "").trim().toUpperCase();
  if (tip === "ECO") return "ECO";
  if (tip) return "BASE";
  return "ALL";
}

function branchModeFromConfigParameterSet(config, explicitMode = null) {
  const explicit = String(explicitMode || "").trim();
  if (explicit && explicit !== "ALL") return normalizeResolverBranchMode(explicit);
  const configMode = String(config?.branch_mode || "").trim();
  if (configMode && configMode !== "ALL") return normalizeResolverBranchMode(configMode);
  return normalizeResolverBranchMode(branchModeFromConfigParameters(config?.parameters || {}));
}

function resolverBranchMetadataMatchesMode(metadata, branchMode) {
  const mode = normalizeResolverBranchMode(branchMode);
  if (mode === "ALL") return true;
  const geometryVariant = String(metadata?.geometry_variant || "").trim();
  if (mode === "BASE") return !geometryVariant;
  return geometryVariant === mode;
}

function filterResolverObjectsByBranchMode(objects, branchMode) {
  const mode = normalizeResolverBranchMode(branchMode);
  if (mode === "ALL") return Array.isArray(objects) ? objects : [];
  return (Array.isArray(objects) ? objects : []).filter((object) => resolverBranchMetadataMatchesMode(object?.xdata_metadata, mode));
}

function resolverRuleMatchesGeometryBranch(rule, branchMode) {
  const scope = rule && typeof rule.target_scope === "object" ? rule.target_scope : {};
  const targetBranch = String(scope.geometry_branch || scope.branch || "").trim();
  if (!targetBranch) return true;
  return normalizeResolverBranchMode(branchMode).toUpperCase() === targetBranch.toUpperCase();
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

function normalizeFourBandResizeContract(topoRuntimeModel) {
  const mode = String(topoRuntimeModel?.mode || "").trim();
  const keys = topoRuntimeModel?.keys && typeof topoRuntimeModel.keys === "object"
    ? topoRuntimeModel.keys
    : {};
  if (mode !== "4_band_parameter_resize") return null;

  const errors = [];
  const profile = String(topoRuntimeModel?.profile || keys.profile || "standard_parametric_resize").trim();
  if (profile !== "standard_parametric_resize") {
    errors.push({
      code: "INVALID_TOPO_4BAND_PROFILE",
      message: "Unsupported 4-band resolver profile: " + (profile || "(missing)")
    });
  }

  const bands = {};
  for (const band of ["l", "r", "t", "b"]) {
    const upperBand = band.toUpperCase();
    const expectedAxis = band === "l" || band === "r" ? "X" : "Y";
    const parameterKey = band + "_parameter";
    const nominalKey = band + "_nominal";
    const axisKey = band + "_axis";
    const deltaFactorKey = band + "_delta_factor";
    const parameter = String(keys[parameterKey] || "").trim();
    const nominal = Number(keys[nominalKey]);
    const axis = String(keys[axisKey] || "").trim().toUpperCase();
    const deltaFactor = Number(keys[deltaFactorKey]);
    if (!parameter) {
      errors.push({
        code: "MISSING_TOPO_4BAND_PARAMETER",
        message: "Missing 4-band " + upperBand + " parameter."
      });
    }
    if (!Number.isFinite(nominal)) {
      errors.push({
        code: "INVALID_TOPO_4BAND_NOMINAL",
        message: "Invalid 4-band " + upperBand + " nominal: " + keys[nominalKey]
      });
    }
    if (axis !== expectedAxis) {
      errors.push({
        code: "INVALID_TOPO_4BAND_AXIS",
        message: "Invalid 4-band " + upperBand + " axis: " + keys[axisKey]
      });
    }
    if (!Number.isFinite(deltaFactor)) {
      errors.push({
        code: "INVALID_TOPO_4BAND_DELTA_FACTOR",
        message: "Invalid 4-band " + upperBand + " delta factor: " + keys[deltaFactorKey]
      });
    }
    bands[upperBand] = {
      parameter,
      nominal: Number.isFinite(nominal) ? nominal : null,
      axis: axis || null,
      delta_factor: Number.isFinite(deltaFactor) ? deltaFactor : null
    };
  }

  return {
    mode,
    profile,
    corner_behavior: String(keys.corner_behavior || "derived_from_adjacent_bands").trim(),
    bands,
    validation: {
      ok: errors.length === 0,
      errors
    },
    raw_comment: topoRuntimeModel?.raw_comment || null
  };
}

function fourBandOffsetForBand(parameters, band, contract) {
  const bandContract = contract?.bands?.[band];
  if (!bandContract) return { dx: 0, dy: 0 };
  const actual = Number(parameters?.[bandContract.parameter]);
  const nominal = Number(bandContract.nominal);
  const factor = Number(bandContract.delta_factor);
  const delta = Number.isFinite(actual) && Number.isFinite(nominal) && Number.isFinite(factor)
    ? (actual - nominal) * factor
    : 0;
  return {
    dx: bandContract.axis === "X" ? delta : 0,
    dy: bandContract.axis === "Y" ? delta : 0,
    parameter: bandContract.parameter,
    nominal: Number.isFinite(nominal) ? nominal : null,
    actual: Number.isFinite(actual) ? actual : null,
    delta: Number.isFinite(actual) && Number.isFinite(nominal) ? actual - nominal : null,
    delta_factor: Number.isFinite(factor) ? factor : null
  };
}

function conditionMatches(condition, parameters) {
  if (!condition || typeof condition !== "object") return true;
  const parameter = String(condition.parameter || "").trim();
  const operator = String(condition.operator || "").trim().toUpperCase();
  if (!parameter || !operator) return false;
  const expected = Object.prototype.hasOwnProperty.call(condition, "value")
    ? condition.value
    : Array.isArray(condition.values)
      ? condition.values
      : condition.expected;
  const expression = operator === "IN" && Array.isArray(expected)
    ? parameter + " IN [" + expected.join(",") + "]"
    : parameter + operator + String(expected == null ? "" : expected);
  const parsed = parseWhenExpression(expression);
  if (!parsed || !Array.isArray(parsed.clauses) || !parsed.clauses.length) return false;
  return parsed.clauses.every((clause) => {
    const actual = parameters?.[clause.parameter];
    if (clause.operator === "IN") {
      const candidates = Array.isArray(clause.expected_values)
        ? clause.expected_values
        : String(clause.expected || "").replace(/^\[/, "").replace(/\]$/, "").split(",").map((item) => item.trim()).filter(Boolean);
      return candidates.some((candidate) => String(actual == null ? "" : actual).trim().toUpperCase() === String(candidate).trim().toUpperCase());
    }
    if (clause.operator === "==" || clause.operator === "!=") {
      const equal = String(actual == null ? "" : actual).trim().toUpperCase() === String(clause.expected == null ? "" : clause.expected).trim().toUpperCase();
      return clause.operator === "==" ? equal : !equal;
    }
    const actualNumber = Number(actual);
    const expectedNumber = Number(clause.expected);
    if (!Number.isFinite(actualNumber) || !Number.isFinite(expectedNumber)) return false;
    if (clause.operator === ">") return actualNumber > expectedNumber;
    if (clause.operator === ">=") return actualNumber >= expectedNumber;
    if (clause.operator === "<") return actualNumber < expectedNumber;
    if (clause.operator === "<=") return actualNumber <= expectedNumber;
    return false;
  });
}

function topologyDeltaModifierRules(ruleContext) {
  const rules = ruleContext?.rule_catalog?.rules || ruleContext?.rules || {};
  const entries = Array.isArray(rules) ? rules : Object.values(rules || {});
  return entries.filter((rule) => String(rule?.action?.stage || rule?.stage || "").trim().toLowerCase() === "topology_delta_modifier");
}

function scopeValueMatches(scopeValue, actual) {
  const normalizedActual = String(actual == null ? "" : actual).trim().toUpperCase();
  if (!scopeValue) return true;
  const candidates = Array.isArray(scopeValue) ? scopeValue : [scopeValue];
  return candidates.some((candidate) => {
    const normalized = String(candidate == null ? "" : candidate).trim().toUpperCase();
    return normalized === "*" || normalized === normalizedActual;
  });
}

function topologyDeltaRuleProfileMatches(rule, ruleContext) {
  const profileScope = String(rule?.profile_scope || "").trim().toUpperCase();
  if (!profileScope) return true;
  const config = ruleContext?.configParameterSet || ruleContext?.config || {};
  const profile = String(ruleContext?.technology_profile ?? config.technology_profile ?? "").trim().toUpperCase();
  return Boolean(profile) && profile === profileScope;
}

function topologyDeltaRuleScopeMatches(rule, ruleContext) {
  const scope = rule?.target_scope && typeof rule.target_scope === "object" ? rule.target_scope : null;
  if (!scope) return true;
  const config = ruleContext?.configParameterSet || ruleContext?.config || {};
  const family = ruleContext?.family ?? config.family;
  const product = ruleContext?.product ?? config.product ?? config.product_code;
  const part = ruleContext?.part ?? config.part ?? config.product_code;
  return scopeValueMatches(scope.family ?? scope.families, family)
    && scopeValueMatches(scope.product ?? scope.products, product)
    && scopeValueMatches(scope.part ?? scope.parts, part);
}

function applyTopologyDeltaModifiers(bandOffsets, parameters, ruleContext) {
  const modifiers = [];
  const warnings = [];
  const next = JSON.parse(JSON.stringify(bandOffsets || {}));
  for (const rule of topologyDeltaModifierRules(ruleContext)) {
    const action = rule.action || rule;
    const targetBand = String(action.target_band || rule.target_band || "").trim().toUpperCase();
    const axis = String(action.axis || rule.axis || "").trim().toUpperCase();
    const delta = Number(action.delta ?? action.value_mm ?? rule.delta);
    const cornerScope = String(action.corner_scope || rule.corner_scope || "derived_adjacent").trim();
    if (!next[targetBand] || !["L", "R", "T", "B"].includes(targetBand) || !["X", "Y"].includes(axis) || !Number.isFinite(delta)) {
      modifiers.push({ rule_id: rule.rule_id || null, applied: false, reason: "invalid_topology_delta_modifier" });
      continue;
    }
    if (!topologyDeltaRuleProfileMatches(rule, ruleContext)) {
      modifiers.push({ rule_id: rule.rule_id || null, applied: false, reason: "profile_not_matched" });
      continue;
    }
    if (!topologyDeltaRuleScopeMatches(rule, ruleContext)) {
      modifiers.push({ rule_id: rule.rule_id || null, applied: false, reason: "scope_not_matched" });
      continue;
    }
    if (!conditionMatches(rule.condition, parameters)) {
      modifiers.push({ rule_id: rule.rule_id || null, applied: false, reason: "condition_not_matched" });
      continue;
    }
    const offsetKey = axis === "X" ? "dx" : "dy";
    const baseOffset = Number(next[targetBand][offsetKey] || 0);
    const warnOnSuperposition = action.warning_on_superposition === true || rule.warning_on_superposition === true;
    if (warnOnSuperposition && baseOffset !== 0 && delta !== 0 && Math.sign(baseOffset) === Math.sign(delta)) {
      warnings.push({
        code: "SUPERPOSED_TOPOLOGY_DELTA",
        severity: "warning",
        message: "Topology delta modifier " + (rule.rule_id || "(anonymous)") + " adds " + delta + " mm to existing " + targetBand + "." + axis + " offset " + baseOffset + " mm. Review local clearance before production use.",
        rule_id: rule.rule_id || null,
        target_band: targetBand,
        axis,
        base_offset: baseOffset,
        modifier_delta: delta,
        final_offset: baseOffset + delta
      });
    }
    next[targetBand][offsetKey] = baseOffset + delta;
    modifiers.push({
      rule_id: rule.rule_id || null,
      applied: true,
      target_band: targetBand,
      axis,
      delta,
      corner_scope: cornerScope
    });
  }
  return { band_offsets: next, modifiers, warnings };
}

function fourBandParametricDeltas(parameters, contract, ruleContext) {
  const bandOffsets = {
    L: fourBandOffsetForBand(parameters, "L", contract),
    R: fourBandOffsetForBand(parameters, "R", contract),
    T: fourBandOffsetForBand(parameters, "T", contract),
    B: fourBandOffsetForBand(parameters, "B", contract)
  };
  const modified = applyTopologyDeltaModifiers(bandOffsets, parameters, ruleContext);
  return {
    profile: "standard_parametric_resize",
    mapping_source: "topo_metadata_4_band",
    inference_policy: "explicit_layer_only",
    topo_contract: contract,
    band_offsets: modified.band_offsets,
    base_band_offsets: bandOffsets,
    topology_delta_modifiers: modified.modifiers,
    topology_delta_warnings: modified.warnings
  };
}

function standardParametricDeltas(parameters, topoRuntimeModel, ruleContext) {
  const fourBandContract = normalizeFourBandResizeContract(topoRuntimeModel);
  if (fourBandContract) {
    if (!fourBandContract.validation.ok) {
      const error = new Error("Invalid 4-band standard_parametric_resize TOPO contract.");
      error.code = "INVALID_TOPO_4BAND_CONTRACT";
      error.validation = fourBandContract.validation;
      throw error;
    }
    return fourBandParametricDeltas(parameters, fourBandContract, ruleContext);
  }

  const height = readNumericParameter(parameters, ["VISINA", "VISINA_VRATA"], 2100);
  const width = readNumericParameter(parameters, ["SIRINA", "SIRINA_VRATA"], 900);
  const shortening = readNumericParameter(parameters, ["SKRACENJE"], 0);
  return {
    profile: "standard_parametric_resize",
    mapping_source: "legacy_standard_defaults",
    height_delta: height - 2100,
    width_half_delta: (width - 900) / 2,
    shortening_delta: shortening
  };
}

function standardLayerOffset(layer, deltas) {
  const normalizedLayer = String(layer || "").trim().toUpperCase();
  if (deltas?.mapping_source === "topo_metadata_4_band") {
    const offsets = deltas.band_offsets || {};
    const l = offsets.L || { dx: 0, dy: 0 };
    const r = offsets.R || { dx: 0, dy: 0 };
    const t = offsets.T || { dx: 0, dy: 0 };
    const b = offsets.B || { dx: 0, dy: 0 };
    switch (normalizedLayer) {
      case "L":
        return { dx: Number(l.dx || 0), dy: Number(l.dy || 0) };
      case "R":
        return { dx: Number(r.dx || 0), dy: Number(r.dy || 0) };
      case "T":
        return { dx: Number(t.dx || 0), dy: Number(t.dy || 0) };
      case "B":
        return { dx: Number(b.dx || 0), dy: Number(b.dy || 0) };
      case "TL":
        return { dx: Number(l.dx || 0) + Number(t.dx || 0), dy: Number(l.dy || 0) + Number(t.dy || 0) };
      case "TR":
        return { dx: Number(r.dx || 0) + Number(t.dx || 0), dy: Number(r.dy || 0) + Number(t.dy || 0) };
      case "BL":
        return { dx: Number(l.dx || 0) + Number(b.dx || 0), dy: Number(l.dy || 0) + Number(b.dy || 0) };
      case "BR":
        return { dx: Number(r.dx || 0) + Number(b.dx || 0), dy: Number(r.dy || 0) + Number(b.dy || 0) };
      default:
        return { dx: 0, dy: 0 };
    }
  }
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

function horizontalInferenceOffsets(deltas) {
  if (deltas?.mapping_source === "topo_metadata_4_band") {
    return { dx_left: 0, dx_right: 0 };
  }
  return {
    dx_left: -Number(deltas?.height_delta || 0),
    dx_right: Number(deltas?.shortening_delta || 0)
  };
}

function verticalInferenceOffsets(deltas) {
  if (deltas?.mapping_source === "topo_metadata_4_band") {
    return { dy_top: 0, dy_bottom: 0 };
  }
  return {
    dy_top: Number(deltas?.width_half_delta || 0),
    dy_bottom: -Number(deltas?.width_half_delta || 0)
  };
}

function runStandardParametricResizePreview({ objects, parameters, topoRuntimeModel, ruleContext }) {
  const deltas = standardParametricDeltas(parameters, topoRuntimeModel, ruleContext);
  const bandContext = buildHorizontalBandContext(objects);
  const verticalBandContext = buildVerticalBandContext(objects);
  const lineCandidates = collectLineCandidates(objects);
  const objectMap = new Map();
  const simulatedShapeMap = new Map();
  const horizontalOffsets = horizontalInferenceOffsets(deltas);
  const verticalOffsets = verticalInferenceOffsets(deltas);

  for (const object of Array.isArray(objects) ? objects : []) {
    const baseOffset = standardLayerOffset(object?.primary_layer, deltas);
    const objectLinePairing = [];
    const originalShapes = cloneShapes(object?.shapes);
    const simulatedShapes = originalShapes.map((shape, shapeIndex) => {
      const inferredX = inferredRigidXOffsetForHorizontalBand(shape, object?.primary_layer, {
        dx_left: horizontalOffsets.dx_left,
        dx_right: horizontalOffsets.dx_right
      }, bandContext);
      const inferredY = inferredRigidYOffsetForVerticalBand(shape, object?.primary_layer, {
        dy_top: verticalOffsets.dy_top,
        dy_bottom: verticalOffsets.dy_bottom
      }, verticalBandContext);
      const translatedShape = translateShape(shape, baseOffset.dx + inferredX, baseOffset.dy + inferredY);
      simulatedShapeMap.set(`${object.id}:${shapeIndex}`, translatedShape);
      return translatedShape;
    });
    objectMap.set(object.id, {
      geometry_simulation_mode: deltas?.mapping_source === "topo_metadata_4_band"
        ? "core_shell_4_band_parameter_resize_shadow_visualization_v1"
        : "none_topology_standard_parametric_v0",
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

function runResolverPreview({ profile, objects, configParameterSet, parameters, topoRuntimeModel, ruleContext }) {
  const normalizedProfile = String(profile || "").trim().toLowerCase();
  const effectiveParameters = parameters || configParameterSet?.parameters || {};
  if (normalizedProfile === "standard_parametric_resize") {
    return runStandardParametricResizePreview({
      objects,
      parameters: effectiveParameters,
      topoRuntimeModel,
      ruleContext
    });
  }
  throw new Error(`Unsupported resolver preview profile: ${profile}`);
}

function offsetDiff(left, right) {
  return {
    dx: roundNumber(Number(left?.dx || 0) - Number(right?.dx || 0), 6),
    dy: roundNumber(Number(left?.dy || 0) - Number(right?.dy || 0), 6)
  };
}

function summarizeFourBandShadowPreview({ shadowMap, activeSimulationMap, objects }) {
  const items = [];
  let mismatchCount = 0;
  let referenceDeltas = null;
  for (const object of Array.isArray(objects) ? objects : []) {
    const shadow = shadowMap?.get(object.id) || null;
    if (!referenceDeltas && shadow?.reference_deltas) {
      referenceDeltas = shadow.reference_deltas;
    }
    const active = activeSimulationMap?.get ? activeSimulationMap.get(object.id) : null;
    const shadowOffset = shadow?.applied_offset || { dx: 0, dy: 0 };
    const activeOffset = active?.applied_offset || { dx: 0, dy: 0 };
    const diff = offsetDiff(shadowOffset, activeOffset);
    const mismatch = diff.dx !== 0 || diff.dy !== 0;
    if (mismatch) mismatchCount += 1;
    items.push({
      object_id: object.id || null,
      entity_id: object.entity_id || null,
      primary_layer: object.primary_layer || null,
      shadow_offset: shadowOffset,
      active_offset: active?.applied_offset || null,
      offset_diff: diff,
      mismatch
    });
  }
  return {
    mode: "core_shell_4_band_parameter_resize_shadow_v1",
    active: false,
    diagnostic_only: true,
    behavior_change: false,
    checked_count: items.length,
    mismatch_count: mismatchCount,
    parity_target: "current_runtime_preview",
    production_activation_status: "not_approved",
    cleanup_approval: "no",
    reference_deltas: referenceDeltas,
    topology_delta_modifiers: referenceDeltas?.topology_delta_modifiers || [],
    topology_delta_warnings: referenceDeltas?.topology_delta_warnings || [],
    items
  };
}

function runFourBandParameterResizeShadowPreview({ objects, parameters, configParameterSet, topoRuntimeModel, activeSimulationMap, ruleContext }) {
  const shadowMap = runResolverPreview({
    profile: "standard_parametric_resize",
    objects,
    parameters,
    configParameterSet,
    topoRuntimeModel,
    ruleContext
  });
  return {
    shadow_map: shadowMap,
    summary: summarizeFourBandShadowPreview({
      shadowMap,
      activeSimulationMap,
      objects
    })
  };
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

function envFlagEnabled(name) {
  const value = String(process.env[name] || "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function isCoreShellStrictMode(sharedResolverMode) {
  return String(sharedResolverMode || "").trim() === "core_shell_strict" || envFlagEnabled("CORE_RESOLVER_STRICT");
}

function coreShellStrictUnsupportedError({ session, configParameterSet, mode, branchMode }) {
  const error = new Error("Core Shell strict resolver refused legacy Mother DXF fallback: native session projection is not implemented for this mode yet.");
  error.code = "CORE_RESOLVER_STRICT_UNSUPPORTED";
  error.resolver_entrypoint = "core_shell";
  error.execution_owner = "core_shell_native";
  error.legacy_fallback_used = false;
  error.legacy_fallback_reason = null;
  error.strict_mode = true;
  error.unsupported_reason = "native_session_projection_not_implemented";
  error.mode = String(mode || "").trim() || null;
  error.session_id = session?.session_id || null;
  error.has_config_parameter_set = Boolean(configParameterSet);
  error.branch_mode = branchMode || null;
  return error;
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
  const normalizedSharedResolverMode = isCoreShellStrictMode(sharedResolverMode)
    ? "core_shell_strict"
    : String(sharedResolverMode || "runtime").trim();
  const allowedSharedResolverModes = new Set(["runtime", "activation_candidate_shadow", "core_shell_strict"]);
  if (!allowedSharedResolverModes.has(normalizedSharedResolverMode)) {
    throw new Error(`Unsupported shared resolver mode: ${sharedResolverMode}`);
  }
  const normalizedConfig = normalizeFacadeConfig(session, configParameterSet);
  const start = nowIso();
  const startedAtMs = Date.now();
  if (normalizedSharedResolverMode === "core_shell_strict") {
    const strictError = coreShellStrictUnsupportedError({
      session,
      configParameterSet: normalizedConfig,
      mode: normalizedMode,
      branchMode
    });
    const end = nowIso();
    strictError.pipeline_trace = {
      mode: normalizedMode,
      entrypoint: "core_shell_strict",
      parameters: {
        branchMode: branchMode || null,
        has_config_parameter_set: Boolean(normalizedConfig),
        session_id: session?.session_id || null,
        sem_evaluator_mode: normalizedSemEvaluatorMode,
        shared_resolver_mode: normalizedSharedResolverMode,
        core_resolver_strict: true
      },
      steps: [
        {
          name: "core_shell_strict_native_entrypoint",
          start,
          end,
          duration_ms: Date.now() - startedAtMs,
          delegated: false,
          active: true,
          diagnostic_only: false
        },
        {
          name: "legacy_fallback_guard",
          start,
          end,
          duration_ms: 0,
          delegated: false,
          active: true,
          legacy_fallback_used: false
        },
        {
          name: "native_session_projection",
          start,
          end,
          duration_ms: 0,
          delegated: false,
          active: false,
          status: "not_implemented"
        }
      ]
    };
    throw strictError;
  }
  const runtime = loadMotherDxfRuntime();
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
      shared_resolver_mode: normalizedSharedResolverMode,
      core_resolver_strict: false
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
    resolver_entrypoint: "core_shell_facade",
    execution_owner: "mother_runtime_legacy",
    legacy_fallback_used: true,
    legacy_fallback_reason: normalizedSharedResolverMode === "runtime" ? "configured_runtime_mode" : "activation_candidate_shadow_delegates_to_runtime",
    shared_resolver_activation: sharedResolverActivation,
    shared_sem_activation: sharedSemActivation,
    sem_diagnostics,
    shared_resolver_diagnostics,
    warnings: collectResultWarnings(effectiveResult),
    errors: collectResultErrors(effectiveResult)
  };
}

module.exports = {
  branchModeFromConfigParameterSet,
  branchModeFromConfigParameters,
  filterResolverObjectsByBranchMode,
  normalizeResolverBranchMode,
  resolverBranchMetadataMatchesMode,
  resolverRuleMatchesGeometryBranch,
  loadSharedSemEvaluatorService,
  normalizeFourBandResizeContract,
  resolveMotherDxfRuntimePlan,
  runFourBandParameterResizeShadowPreview,
  runResolverPreview,
  runStandardParametricResizePreview
};
