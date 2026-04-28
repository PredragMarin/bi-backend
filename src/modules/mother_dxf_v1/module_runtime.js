"use strict";

const crypto = require("crypto");
const {
  ALLOWED_PRIMARY_LAYERS,
  sanitizeDocument,
  reindexDocumentSources,
  serializeDocument,
  listRelevantObjects,
  applyPrimaryLayer
} = require("../../core_shell/dxf");
const {
  bboxUnion,
  bboxCenter
} = require("../../core_shell/geometry");
const {
  defaultRoot,
  saveSession,
  loadSession,
  listSessions,
  saveExport
} = require("../../core_shell/storage/mother_dxf_store");
const DEFAULT_PARAMETER_CATALOG = require("./contracts/parameter_catalog_legacy_door_v0.json");
const DEFAULT_RULE_CATALOG = require("./contracts/rule_catalog_mxd_door_v0.json");

const DEFAULT_BANDS = {
  left: 80,
  right: 80,
  top: 80,
  bottom: 80
};

const SEMANTIC_COLORS = {
  A: "#111827",
  L: "#60a5fa",
  R: "#f87171",
  T: "#34d399",
  B: "#fbbf24",
  TL: "#c084fc",
  TR: "#f472b6",
  BL: "#22d3ee",
  BR: "#fb923c",
  UNCLASSIFIED: "#94a3b8"
};

const DEFAULT_CONFIG_PARAMETER_SET = {
  technology_profile: "OPS_S4P4",
  product_code: "KSKR",
  parameters: {
    BRAVA: "TIP1",
    LIMITATOR: false
  }
};

const ALLOWED_SESSION_STATUSES = new Set(["draft", "in_review", "finished"]);

function clampBand(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return 0;
  return num;
}

function normalizeBands(input) {
  const source = input || {};
  return {
    left: clampBand(source.left ?? DEFAULT_BANDS.left),
    right: clampBand(source.right ?? DEFAULT_BANDS.right),
    top: clampBand(source.top ?? DEFAULT_BANDS.top),
    bottom: clampBand(source.bottom ?? DEFAULT_BANDS.bottom)
  };
}

function computeDocumentBBox(relevantObjects) {
  return (Array.isArray(relevantObjects) ? relevantObjects : []).reduce((acc, item) => bboxUnion(acc, item.bbox), null);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeSessionStatus(value) {
  const normalized = String(value || "draft").trim().toLowerCase();
  if (!ALLOWED_SESSION_STATUSES.has(normalized)) {
    throw new Error(`Unsupported session status: ${value}`);
  }
  return normalized;
}

function normalizeSessionTitle(value, fallback) {
  const normalized = String(value || "").trim();
  if (normalized) return normalized;
  return String(fallback || "Untitled Mother DXF Session");
}

function normalizeConfigParameterSet(input) {
  const source = input && typeof input === "object" ? input : {};
  const parameters = source.parameters && typeof source.parameters === "object"
    ? source.parameters
    : source.configuratorData && typeof source.configuratorData === "object"
      ? source.configuratorData
      : {};
  return {
    technology_profile: String(source.technology_profile || DEFAULT_CONFIG_PARAMETER_SET.technology_profile),
    product_code: String(source.product_code || DEFAULT_CONFIG_PARAMETER_SET.product_code),
    parameters: cloneJson({
      ...DEFAULT_CONFIG_PARAMETER_SET.parameters,
      ...parameters
    })
  };
}

function normalizeBooleanLike(value) {
  if (typeof value === "boolean") return value;
  const normalized = String(value || "").trim().toUpperCase();
  if (!normalized) return null;
  if (["TRUE", "1", "YES", "ON", "DA"].includes(normalized)) return true;
  if (["FALSE", "0", "NO", "OFF", "NE"].includes(normalized)) return false;
  return null;
}

function valuesEqualForInstruction(actual, expected) {
  const actualBool = normalizeBooleanLike(actual);
  const expectedBool = normalizeBooleanLike(expected);
  if (actualBool !== null && expectedBool !== null) {
    return actualBool === expectedBool;
  }
  return String(actual == null ? "" : actual).trim().toUpperCase() === String(expected == null ? "" : expected).trim().toUpperCase();
}

function parseWhenExpression(value) {
  const raw = String(value || "").trim();
  const operator = raw.includes("!=") ? "!=" : raw.includes("==") ? "==" : null;
  if (!operator) return null;
  const [parameter, expected] = raw.split(operator);
  const normalizedParameter = String(parameter || "").trim();
  const normalizedExpected = String(expected || "").trim();
  if (!normalizedParameter || !normalizedExpected) return null;
  return {
    parameter: normalizedParameter,
    operator,
    expected: normalizedExpected
  };
}

function parseSemanticComment(rawValue) {
  const raw = String(rawValue || "").trim();
  if (!raw.toUpperCase().startsWith("SEM:")) return null;
  const body = raw.slice(4).trim();
  const pairs = body ? body.split(";").map((item) => item.trim()).filter(Boolean) : [];
  const keys = {};
  const errors = [];

  for (const pair of pairs) {
    const idx = pair.indexOf("=");
    if (idx <= 0 || idx === pair.length - 1) {
      errors.push({
        code: "INVALID_SEM_PAIR",
        message: `Invalid SEM pair: ${pair}`
      });
      continue;
    }
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (!key) {
      errors.push({
        code: "EMPTY_SEM_KEY",
        message: "SEM key is empty."
      });
      continue;
    }
    if (!value) {
      errors.push({
        code: "EMPTY_SEM_VALUE",
        message: `SEM value for key ${key} is empty.`
      });
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(keys, key)) {
      errors.push({
        code: "DUPLICATE_SEM_KEY",
        message: `Duplicate SEM key: ${key}`
      });
      continue;
    }
    keys[key] = value;
  }

  const when_expression = keys.when ? parseWhenExpression(keys.when) : null;
  if (keys.when && !when_expression) {
    errors.push({
      code: "INVALID_SEM_WHEN",
      message: `Invalid SEM when expression: ${keys.when}`
    });
  }

  return {
    namespace: "SEM",
    raw_comment: raw,
    keys,
    when_expression,
    validation: {
      ok: errors.length === 0,
      errors,
      warnings: []
    }
  };
}

function buildSemanticCommentFromRule(rule) {
  const semanticComment = String(rule?.semantic_comment || "").trim();
  if (semanticComment) {
    if (!semanticComment.toUpperCase().startsWith("SEM:")) {
      throw new Error("Semantic comment must start with SEM:.");
    }
    return semanticComment;
  }
  const operation = String(rule?.operation || "show_if").trim();
  const parameter = String(rule?.parameter || "").trim();
  const expectedValue = String(rule?.expected_value || "").trim();
  if (!parameter) {
    throw new Error("Missing metadata parameter.");
  }
  if (!expectedValue) {
    throw new Error("Missing metadata expected value.");
  }
  if (!operation) {
    throw new Error("Missing metadata operation.");
  }
  const operator = operation === "hide_if" ? "!=" : "==";
  return `SEM:feature=${parameter};presence=conditional;when=${parameter}${operator}${expectedValue}`;
}

function semanticCommentFamily(rawComment) {
  const parsed = parseSemanticComment(rawComment);
  if (!parsed) return null;
  const keys = parsed.keys || {};
  if (String(keys.document || "").trim().toLowerCase() === "true") return "document";
  if (keys.operation_ref) return "operation_ref";
  if (keys.geometry) return "geometry";
  if (keys.role) return "geometry_role";
  if (keys.presence) return "presence";
  if (keys.variant) return "variant";
  return `raw:${parsed.raw_comment.toUpperCase()}`;
}

function findEntity(document, entityId) {
  return (document && Array.isArray(document.entities) ? document.entities : []).find((entity) => entity.id === entityId) || null;
}

function upsertSemanticComment(document, entityId, rawComment) {
  const entity = findEntity(document, entityId);
  if (!entity) {
    throw new Error(`Unknown entity id: ${entityId}`);
  }
  const nextComment = String(rawComment || "").trim();
  if (!nextComment) {
    throw new Error("Missing semantic comment.");
  }
  const nextFamily = semanticCommentFamily(nextComment);
  const preComments = Array.isArray(entity.preComments) ? entity.preComments : [];
  const nextPreComments = preComments.filter((pair) => {
    if (String(pair?.code) !== "999") return true;
    const value = String(pair?.value || "").trim();
    if (!value.toUpperCase().startsWith("SEM:")) return true;
    if (value === nextComment) return false;
    const family = semanticCommentFamily(value);
    if (!nextFamily || !family) return true;
    return family !== nextFamily;
  });
  nextPreComments.push({ code: "999", value: nextComment });
  entity.preComments = nextPreComments;
}

function removeSemanticComment(document, entityId) {
  const entity = findEntity(document, entityId);
  if (!entity) {
    throw new Error(`Unknown entity id: ${entityId}`);
  }
  const preComments = Array.isArray(entity.preComments) ? entity.preComments : [];
  entity.preComments = preComments.filter((pair) => {
    const value = String(pair?.value || "").trim().toUpperCase();
    return !(String(pair?.code) === "999" && value.startsWith("SEM:"));
  });
}

function collectSemanticMetadata(document, entityId) {
  const entity = findEntity(document, entityId);
  const comments = Array.isArray(entity?.preComments) ? entity.preComments : [];
  const raw_comments = comments
    .filter((pair) => String(pair.code) === "999")
    .map((pair) => String(pair.value || ""));
  const parsed = raw_comments.map(parseSemanticComment).filter(Boolean);
  const validationErrors = parsed.flatMap((item) => item.validation?.errors || []);
  return {
    raw_comments,
    parsed,
    validation: {
      ok: validationErrors.length === 0,
      errors: validationErrors,
      warnings: []
    }
  };
}

function evaluatePresenceInstruction(parsedSemRecords, parameters) {
  const presenceRecord = (Array.isArray(parsedSemRecords) ? parsedSemRecords : []).find((record) => {
    const presence = String(record?.keys?.presence || "").trim().toLowerCase();
    return presence === "conditional" || presence === "always" || presence === "never";
  }) || null;
  if (!presenceRecord) {
    return {
      record: null,
      included: true,
      exclusion_reason: null,
      visibility_reason: "default_visible",
      operation_hint: null,
      conditional_param: null,
      conditional_expected: null,
      conditional_operator: null,
      conditional_actual: null
    };
  }
  const keys = presenceRecord.keys || {};
  const presence = String(keys.presence || "").trim().toLowerCase();
  const whenExpression = presenceRecord.when_expression || null;
  const conditionalParamName = whenExpression?.parameter || keys.feature || null;
  const conditionalExpected = whenExpression?.expected || null;
  const conditionalOperator = whenExpression?.operator || null;
  const conditionalActual = conditionalParamName ? parameters[conditionalParamName] : null;
  if (presence === "never") {
    return {
      record: presenceRecord,
      included: false,
      exclusion_reason: "presence",
      visibility_reason: "presence_never",
      operation_hint: presence,
      conditional_param: conditionalParamName,
      conditional_expected: conditionalExpected,
      conditional_operator: conditionalOperator,
      conditional_actual: conditionalActual
    };
  }
  if (presence === "always") {
    return {
      record: presenceRecord,
      included: true,
      exclusion_reason: null,
      visibility_reason: "presence_always",
      operation_hint: presence,
      conditional_param: conditionalParamName,
      conditional_expected: conditionalExpected,
      conditional_operator: conditionalOperator,
      conditional_actual: conditionalActual
    };
  }
  if (conditionalParamName && conditionalExpected !== null && conditionalOperator) {
    const equal = valuesEqualForInstruction(conditionalActual, conditionalExpected);
    const included = conditionalOperator === "!=" ? !equal : equal;
    return {
      record: presenceRecord,
      included,
      exclusion_reason: included ? null : "presence",
      visibility_reason: included
        ? `condition_matched:${conditionalParamName}`
        : `condition_not_matched:${conditionalParamName}`,
      operation_hint: presence,
      conditional_param: conditionalParamName,
      conditional_expected: conditionalExpected,
      conditional_operator: conditionalOperator,
      conditional_actual: conditionalActual
    };
  }
  return {
    record: presenceRecord,
    included: true,
    exclusion_reason: null,
    visibility_reason: "presence_without_condition",
    operation_hint: presence,
    conditional_param: conditionalParamName,
    conditional_expected: conditionalExpected,
    conditional_operator: conditionalOperator,
    conditional_actual: conditionalActual
  };
}

function evaluateVariantInstruction(parsedSemRecords, parameters) {
  const variantRecord = (Array.isArray(parsedSemRecords) ? parsedSemRecords : []).find((record) => {
    const variant = String(record?.keys?.variant || "").trim();
    return Boolean(variant);
  }) || null;
  if (!variantRecord) {
    return {
      record: null,
      included: true,
      exclusion_reason: null,
      variant: null,
      feature: null,
      actual: null
    };
  }
  const keys = variantRecord.keys || {};
  const feature = String(keys.feature || "").trim() || null;
  const expectedVariant = String(keys.variant || "").trim() || null;
  const actualValue = feature ? parameters[feature] : null;
  const included = feature && expectedVariant
    ? valuesEqualForInstruction(actualValue, expectedVariant)
    : true;
  return {
    record: variantRecord,
    included,
    exclusion_reason: included ? null : "variant",
    variant: expectedVariant,
    feature,
    actual: actualValue
  };
}

function collectGeometryOperations(parsedSemRecords) {
  return (Array.isArray(parsedSemRecords) ? parsedSemRecords : [])
    .filter((record) => {
      const geometry = String(record?.keys?.geometry || "").trim().toLowerCase();
      return geometry === "offset";
    })
    .map((record) => ({
      geometry: record.keys.geometry,
      axis: record.keys.axis || null,
      ref: record.keys.ref || null,
      raw_comment: record.raw_comment
    }));
}

function suggestLayerForBBox(objectBBox, documentBBox, bands) {
  if (!objectBBox || !documentBBox) return null;
  const center = bboxCenter(objectBBox);
  if (!center) return null;

  const inLeft = center.x <= documentBBox.minX + bands.left;
  const inRight = center.x >= documentBBox.maxX - bands.right;
  const inTop = center.y >= documentBBox.maxY - bands.top;
  const inBottom = center.y <= documentBBox.minY + bands.bottom;

  if (inLeft && inTop) return "TL";
  if (inRight && inTop) return "TR";
  if (inLeft && inBottom) return "BL";
  if (inRight && inBottom) return "BR";
  if (inLeft) return "L";
  if (inRight) return "R";
  if (inTop) return "T";
  if (inBottom) return "B";
  return "A";
}

function buildRelevantState(document, bands, priorAssignments) {
  const relevantObjects = listRelevantObjects(document);
  const documentBBox = computeDocumentBBox(relevantObjects);
  const assignments = {};

  for (const item of relevantObjects) {
    const previous = priorAssignments && priorAssignments[item.id] ? priorAssignments[item.id] : null;
    const suggested = suggestLayerForBBox(item.bbox, documentBBox, bands);
    if (previous && previous.origin === "manual" && previous.layer) {
      assignments[item.id] = {
        state: "classified",
        layer: previous.layer,
        origin: "manual",
        suggested_layer: suggested
      };
      continue;
    }
    assignments[item.id] = suggested
      ? {
          state: "classified",
          layer: suggested,
          origin: "auto",
          suggested_layer: suggested
        }
      : {
          state: "unclassified",
          layer: null,
          origin: "none",
          suggested_layer: null
        };
  }

  return {
    document_bbox: documentBBox,
    relevant_objects: relevantObjects,
    assignments
  };
}

function projectViewModel(session) {
  reindexDocumentSources(session.document);
  const state = buildRelevantState(session.document, session.bands, session.assignments);
  session.assignments = state.assignments;
  session.document_bbox = state.document_bbox;

  const objects = state.relevant_objects.map((item) => {
    const assignment = session.assignments[item.id] || {
      state: "unclassified",
      layer: null,
      origin: "none",
      suggested_layer: null
    };
    const semantic_metadata = collectSemanticMetadata(session.document, item.entityId);
    return {
      id: item.id,
      display_label: item.type === "INSERT" && item.blockName
        ? `${item.id} | ${item.type} | block=${item.blockName}`
        : `${item.id} | ${item.type}`,
      entity_id: item.entityId,
      type: item.type,
      bbox: item.bbox,
      shapes: item.shapes,
      block_name: item.blockName || null,
      source: item.source || null,
      classification_state: assignment.state,
      primary_layer: assignment.layer,
      assignment_origin: assignment.origin,
      suggested_layer: assignment.suggested_layer,
      semantic_color: assignment.layer ? SEMANTIC_COLORS[assignment.layer] : SEMANTIC_COLORS.UNCLASSIFIED,
      semantic_metadata
    };
  });

  return {
    session_id: session.session_id,
    title: session.title,
    status: session.status,
    artifact_state: session.artifact_state,
    source_name: session.source_name,
    bands: session.bands,
    document_bbox: session.document_bbox,
    config_parameter_set: session.config_parameter_set || cloneJson(DEFAULT_CONFIG_PARAMETER_SET),
    parameter_catalog: cloneJson(session.parameter_catalog || DEFAULT_PARAMETER_CATALOG),
    rule_catalog: cloneJson(session.rule_catalog || DEFAULT_RULE_CATALOG),
    objects,
    allowed_layers: Array.from(ALLOWED_PRIMARY_LAYERS.values()),
    semantic_colors: SEMANTIC_COLORS
  };
}

function buildSessionSummary(session) {
  return {
    session_id: session.session_id,
    title: session.title || "Untitled Mother DXF Session",
    status: session.status || "draft",
    artifact_state: session.artifact_state || null,
    source_name: session.source_name || null,
    created_at: session.created_at || null,
    updated_at: session.updated_at || null
  };
}

function validateSession(session) {
  const view = projectViewModel(session);
  const errors = [];
  for (const object of view.objects) {
    if (object.classification_state !== "classified" || !object.primary_layer) {
      errors.push({
        code: "UNCLASSIFIED_OBJECT",
        object_id: object.id,
        message: `Relevant object ${object.id} is not classified.`
      });
      continue;
    }
    if (!ALLOWED_PRIMARY_LAYERS.has(object.primary_layer)) {
      errors.push({
        code: "INVALID_PRIMARY_LAYER",
        object_id: object.id,
        message: `Object ${object.id} has invalid layer ${object.primary_layer}.`
      });
    }
    if (object.type === "INSERT" && object.primary_layer === null) {
      errors.push({
        code: "INSERT_SEMANTIC_MISSING",
        object_id: object.id,
        message: `INSERT ${object.id} must carry whole-block primary semantics.`
      });
    }
  }
  return {
    ok: errors.length === 0,
    errors
  };
}

function materializeDocumentForExport(session) {
  const document = JSON.parse(JSON.stringify(session.document));
  for (const [entityId, assignment] of Object.entries(session.assignments || {})) {
    if (assignment && assignment.state === "classified" && assignment.layer) {
      applyPrimaryLayer(document, entityId, assignment.layer);
    }
  }
  return document;
}

function simulateChildPreview(session) {
  const view = projectViewModel(session);
  const config = normalizeConfigParameterSet(session.config_parameter_set);
  const limitator = normalizeBooleanLike(config.parameters.LIMITATOR);
  const brava = config.parameters.BRAVA == null ? null : String(config.parameters.BRAVA);
  const items = view.objects.map((object) => {
    const parsedSemRecords = Array.isArray(object.semantic_metadata?.parsed) ? object.semantic_metadata.parsed : [];
    const firstSem = parsedSemRecords.length ? parsedSemRecords[0] : null;
    const semKeys = firstSem?.keys || {};
    const partHint = semKeys.part || semKeys.target || config.product_code || null;
    const presenceEval = evaluatePresenceInstruction(parsedSemRecords, config.parameters);
    const variantEval = presenceEval.included
      ? evaluateVariantInstruction(parsedSemRecords, config.parameters)
      : {
          record: null,
          included: true,
          exclusion_reason: null,
          variant: null,
          feature: null,
          actual: null
        };
    const geometryOps = presenceEval.included && variantEval.included
      ? collectGeometryOperations(parsedSemRecords)
      : [];
    const aggregated = {
      included: presenceEval.included && variantEval.included,
      exclusion_reason: presenceEval.included ? variantEval.exclusion_reason : presenceEval.exclusion_reason,
      geometry_ops: geometryOps
    };
    const opHint = presenceEval.operation_hint || semKeys.presence || null;
    const conditionalParamName = presenceEval.conditional_param;
    const conditionalExpected = presenceEval.conditional_expected;
    const conditionalOperator = presenceEval.conditional_operator;
    const conditionalActual = presenceEval.conditional_actual;
    const visible = aggregated.included;
    const visibilityReason = presenceEval.visibility_reason;
    const preview_actions = [];
    if (object.primary_layer) preview_actions.push(`LAYER=${object.primary_layer}`);
    if (partHint) preview_actions.push(`PART=${partHint}`);
    if (brava) preview_actions.push(`BRAVA=${brava}`);
    if (limitator !== null) preview_actions.push(`LIMITATOR=${limitator ? "TRUE" : "FALSE"}`);
    if (opHint) preview_actions.push(`OP=${opHint}`);
    if (conditionalParamName) preview_actions.push(`PARAM=${conditionalParamName}`);
    if (conditionalExpected !== null) preview_actions.push(`EQ=${conditionalExpected}`);
    if (variantEval.variant) preview_actions.push(`VARIANT=${variantEval.variant}`);
    if (geometryOps.length) preview_actions.push(`GEOMETRY_OPS=${geometryOps.length}`);
    preview_actions.push(`VISIBLE=${visible ? "TRUE" : "FALSE"}`);
    return {
      entity_id: object.entity_id,
      object_id: object.id,
      display_label: object.display_label,
      type: object.type,
      primary_layer: object.primary_layer,
      classification_state: object.classification_state,
      semantic_metadata: object.semantic_metadata,
      config_snapshot: {
        technology_profile: config.technology_profile,
        product_code: config.product_code,
        parameters: cloneJson(config.parameters)
      },
      preview: {
        part_hint: partHint,
        operation_hint: opHint,
        conditional_param: conditionalParamName,
        conditional_expected: conditionalExpected,
        conditional_operator: conditionalOperator,
        conditional_actual: conditionalActual,
        visible,
        visibility_reason: visibilityReason,
        included: aggregated.included,
        exclusion_reason: aggregated.exclusion_reason,
        geometry_ops: aggregated.geometry_ops,
        preview_actions,
        ready_for_child_planning: object.classification_state === "classified" && Boolean(object.primary_layer)
      }
    };
  });

  return {
    session_id: session.session_id,
    technology_profile: config.technology_profile,
    product_code: config.product_code,
    config_parameter_set: config,
    items,
    summary: {
      object_count: items.length,
      classified_count: items.filter((item) => item.classification_state === "classified").length,
      sem_bound_count: items.filter((item) => (item.semantic_metadata?.raw_comments || []).length > 0).length
    }
  };
}

async function createSession({ dxfText, sourceName, bands, storeRoot }) {
  const document = sanitizeDocument(dxfText);
  const session = {
    session_id: crypto.randomUUID(),
    use_case: "mother_dxf_v1",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    title: normalizeSessionTitle(sourceName, "Untitled Mother DXF Session"),
    status: "draft",
    artifact_state: "sanitized",
    source_name: String(sourceName || "mother_dxf_input.dxf"),
    bands: normalizeBands(bands),
    config_parameter_set: cloneJson(DEFAULT_CONFIG_PARAMETER_SET),
    assignments: {},
    document
  };
  projectViewModel(session);
  await saveSession({ rootDir: storeRoot || defaultRoot(), session });
  return session;
}

async function getSession({ sessionId, storeRoot }) {
  const session = await loadSession({ rootDir: storeRoot || defaultRoot(), sessionId });
  session.title = normalizeSessionTitle(session.title, session.source_name);
  session.status = normalizeSessionStatus(session.status || "draft");
  projectViewModel(session);
  return session;
}

async function listSessionSummaries({ storeRoot }) {
  const sessions = await listSessions({ rootDir: storeRoot || defaultRoot() });
  return sessions
    .map((session) => buildSessionSummary(session))
    .sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
}

async function assignPrimaryLayer({ sessionId, ids, layer, storeRoot }) {
  const normalizedLayer = String(layer || "").trim().toUpperCase();
  if (!ALLOWED_PRIMARY_LAYERS.has(normalizedLayer)) {
    throw new Error(`Unsupported primary layer: ${layer}`);
  }
  const session = await getSession({ sessionId, storeRoot });
  for (const id of Array.isArray(ids) ? ids : []) {
    if (!session.assignments[id]) continue;
    session.assignments[id] = {
      state: "classified",
      layer: normalizedLayer,
      origin: "manual",
      suggested_layer: session.assignments[id].suggested_layer || normalizedLayer
    };
  }
  session.updated_at = new Date().toISOString();
  session.artifact_state = "mother_draft";
  await saveSession({ rootDir: storeRoot || defaultRoot(), session });
  return session;
}

async function updateBands({ sessionId, bands, storeRoot }) {
  const session = await getSession({ sessionId, storeRoot });
  session.bands = normalizeBands(bands);
  projectViewModel(session);
  session.updated_at = new Date().toISOString();
  await saveSession({ rootDir: storeRoot || defaultRoot(), session });
  return session;
}

async function updateConfigParameterSet({ sessionId, configParameterSet, storeRoot }) {
  const session = await getSession({ sessionId, storeRoot });
  session.config_parameter_set = normalizeConfigParameterSet(configParameterSet);
  session.updated_at = new Date().toISOString();
  await saveSession({ rootDir: storeRoot || defaultRoot(), session });
  return session;
}

async function updateSessionMeta({ sessionId, title, status, storeRoot }) {
  const session = await getSession({ sessionId, storeRoot });
  if (title !== undefined) {
    session.title = normalizeSessionTitle(title, session.source_name);
  }
  if (status !== undefined) {
    session.status = normalizeSessionStatus(status);
  }
  session.updated_at = new Date().toISOString();
  await saveSession({ rootDir: storeRoot || defaultRoot(), session });
  return session;
}

async function authorSemanticMetadata({ sessionId, entityId, operation, parameter, expectedValue, semanticComment, storeRoot }) {
  const session = await getSession({ sessionId, storeRoot });
  const rawComment = buildSemanticCommentFromRule({
    operation,
    parameter,
    expected_value: expectedValue,
    semantic_comment: semanticComment
  });
  upsertSemanticComment(session.document, entityId, rawComment);
  session.updated_at = new Date().toISOString();
  session.artifact_state = "mother_draft";
  await saveSession({ rootDir: storeRoot || defaultRoot(), session });
  return {
    session,
    semantic_comment: rawComment
  };
}

async function clearSemanticMetadata({ sessionId, entityId, storeRoot }) {
  const session = await getSession({ sessionId, storeRoot });
  removeSemanticComment(session.document, entityId);
  session.updated_at = new Date().toISOString();
  session.artifact_state = "mother_draft";
  await saveSession({ rootDir: storeRoot || defaultRoot(), session });
  return session;
}

async function simulateSession({ sessionId, configParameterSet, storeRoot }) {
  const session = await getSession({ sessionId, storeRoot });
  if (configParameterSet) {
    session.config_parameter_set = normalizeConfigParameterSet(configParameterSet);
    session.updated_at = new Date().toISOString();
    await saveSession({ rootDir: storeRoot || defaultRoot(), session });
  }
  return {
    session,
    simulation: simulateChildPreview(session)
  };
}

async function validateMotherDraft({ sessionId, storeRoot }) {
  const session = await getSession({ sessionId, storeRoot });
  const validation = validateSession(session);
  session.updated_at = new Date().toISOString();
  session.validation = validation;
  if (validation.ok) {
    session.artifact_state = "mother_validated";
  }
  await saveSession({ rootDir: storeRoot || defaultRoot(), session });
  return { session, validation };
}

async function exportMotherDraft({ sessionId, storeRoot }) {
  const session = await getSession({ sessionId, storeRoot });
  const validation = validateSession(session);
  if (!validation.ok) {
    const err = new Error("Mother draft validation failed.");
    err.validation = validation;
    throw err;
  }
  const outputDocument = materializeDocumentForExport(session);
  const dxfText = serializeDocument(outputDocument);
  const exportInfo = await saveExport({
    rootDir: storeRoot || defaultRoot(),
    sessionId,
    dxfText
  });
  return {
    validation,
    dxf_text: dxfText,
    export_file: exportInfo.filePath
  };
}

module.exports = {
  use_case: "mother_dxf_v1",
  createSession,
  getSession,
  listSessionSummaries,
  assignPrimaryLayer,
  updateBands,
  updateConfigParameterSet,
  updateSessionMeta,
  authorSemanticMetadata,
  clearSemanticMetadata,
  simulateSession,
  validateMotherDraft,
  exportMotherDraft,
  projectViewModel,
  serializeDocument
};
