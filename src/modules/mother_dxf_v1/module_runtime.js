"use strict";

const crypto = require("crypto");
const path = require("path");
const {
  ALLOWED_PRIMARY_LAYERS,
  sanitizeDocument,
  reindexDocumentSources,
  serializeDocument,
  listRelevantObjects,
  applyPrimaryLayer
} = require("../../core_shell/dxf");
const {
  roundNumber,
  bboxUnion,
  bboxCenter,
  translateShape,
  bboxFromShapes
} = require("../../core_shell/geometry");
const {
  collectLineCandidates,
  applyTrimRejoinToTranslatedLine
} = require("../../core_shell/services/dxf_line_repair_service");
const {
  defaultRoot,
  saveSession,
  deleteSession,
  loadSession,
  listSessions,
  saveExport,
  saveChildExport
} = require("../../core_shell/storage/mother_dxf_store");
const DEFAULT_PARAMETER_CATALOG = require("./contracts/parameter_catalog_legacy_door_v0.json");
const DEFAULT_RULE_CATALOG = require("./contracts/rule_catalog_mxd_door_v0.json");

const DEFAULT_BANDS = {
  left: 80,
  right: 80,
  top: 80,
  bottom: 80
};

const MOTHER_XDATA_APP_NAME = "MOTHERDXF";

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

const DEFAULT_KSKR_EXECUTION_CHECK_PARAMETER_SET = {
  technology_profile: "OPS_S4P4",
  product_code: "KSKR",
  parameters: {
    SIRINA_VRATA: 750,
    VISINA_VRATA: 2010,
    BRAVA: "CILINDAR",
    LIMITATOR: "DA",
    ELEKTROPRIHVATNIK: "NE",
    TRECA_SPOJNICA: "NE",
    STRANA_OTVARANJA: "Lijeva (SX)",
    METLICA: "JEDNOSTRUKA"
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

function defaultSessionTitleForSource(sourceName) {
  const normalized = String(sourceName || "").trim();
  if (!normalized) return "Untitled Mother DXF Session";
  const baseName = path.basename(normalized).replace(/\.[^.]+$/i, "").trim();
  return baseName || "Untitled Mother DXF Session";
}

function titleLooksLikeDefault(title, sourceName) {
  const normalizedTitle = String(title || "").trim();
  if (!normalizedTitle) return true;
  const defaultTitle = defaultSessionTitleForSource(sourceName);
  const legacyDefault = String(sourceName || "").trim();
  return normalizedTitle === defaultTitle || normalizedTitle === legacyDefault;
}

function sessionHasAuthoringState(session) {
  const documentComments = Array.isArray(session?.document?.preComments) ? session.document.preComments : [];
  const hasDocumentLevelMetadata = documentComments.some((pair) => {
    if (String(pair?.code) !== "999") return false;
    const value = String(pair?.value || "").trim().toUpperCase();
    return value.startsWith("SEM:") || value.startsWith("TOPO:");
  });
  if (hasDocumentLevelMetadata) return true;

  const entities = Array.isArray(session?.document?.entities) ? session.document.entities : [];
  const hasEntityMetadata = entities.some((entity) => {
    const comments = Array.isArray(entity?.preComments) ? entity.preComments : [];
    return comments.some((pair) => {
      if (String(pair?.code) !== "999") return false;
      const value = String(pair?.value || "").trim().toUpperCase();
      return value.startsWith("SEM:") || value.startsWith("TOPO:");
    });
  });
  if (hasEntityMetadata) return true;

  return Boolean(session?.xdata_assignments && Object.keys(session.xdata_assignments).length);
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

function normalizeParameterCatalogSnapshot(input) {
  const source = input && typeof input === "object" ? input : null;
  const parameters = source && source.parameters && typeof source.parameters === "object"
    ? source.parameters
    : null;
  if (!source || !parameters || !Object.keys(parameters).length) {
    return cloneJson(DEFAULT_PARAMETER_CATALOG);
  }
  return cloneJson(source);
}

function normalizeRuleCatalogSnapshot(input) {
  const source = input && typeof input === "object" ? input : null;
  const rules = source && source.rules && typeof source.rules === "object"
    ? source.rules
    : null;
  if (!source || !rules || !Object.keys(rules).length) {
    return cloneJson(DEFAULT_RULE_CATALOG);
  }
  return cloneJson(source);
}

function isEmptyConfigParameterSetInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return true;
  const keys = Object.keys(input);
  if (!keys.length) return true;
  if (keys.length === 1 && keys[0] === "parameters") {
    const parameters = input.parameters;
    return !parameters || typeof parameters !== "object" || !Object.keys(parameters).length;
  }
  if (keys.length === 1 && keys[0] === "configuratorData") {
    const parameters = input.configuratorData;
    return !parameters || typeof parameters !== "object" || !Object.keys(parameters).length;
  }
  return false;
}

function normalizeXdataValue(value) {
  const normalized = String(value || "").trim();
  return normalized || "";
}

function extractMotherXdataValue(entity) {
  const pairs = Array.isArray(entity?.pairs) ? entity.pairs : [];
  for (let index = 0; index < pairs.length; index += 1) {
    const pair = pairs[index];
    if (String(pair?.code) !== "1001") continue;
    if (String(pair?.value || "").trim() !== MOTHER_XDATA_APP_NAME) continue;
    for (let nextIndex = index + 1; nextIndex < pairs.length; nextIndex += 1) {
      const nextPair = pairs[nextIndex];
      if (String(nextPair?.code) === "1001") break;
      if (String(nextPair?.code) === "1000") {
        return normalizeXdataValue(nextPair.value);
      }
    }
  }
  return "";
}

function collectMotherXdataAssignments(document) {
  const assignments = {};
  for (const entity of Array.isArray(document?.entities) ? document.entities : []) {
    const value = extractMotherXdataValue(entity);
    if (!value) continue;
    assignments[entity.id] = {
      app: MOTHER_XDATA_APP_NAME,
      value
    };
  }
  return assignments;
}

function hoistMotherXdataFromDocument(document) {
  const assignments = collectMotherXdataAssignments(document);
  for (const entity of Array.isArray(document?.entities) ? document.entities : []) {
    entity.pairs = stripMotherXdataPairs(entity.pairs);
  }
  return assignments;
}

function normalizeXdataAssignments(document, input) {
  const derived = collectMotherXdataAssignments(document);
  const next = { ...derived };
  const source = input && typeof input === "object" ? input : {};
  for (const [entityId, assignment] of Object.entries(source)) {
    if (!findEntity(document, entityId)) continue;
    const value = normalizeXdataValue(assignment && typeof assignment === "object" ? assignment.value : assignment);
    if (!value) {
      delete next[entityId];
      continue;
    }
    next[entityId] = {
      app: MOTHER_XDATA_APP_NAME,
      value
    };
  }
  return next;
}

function collectEntityXdataMetadata(session, entityId) {
  const assignment = session?.xdata_assignments && session.xdata_assignments[entityId]
    ? session.xdata_assignments[entityId]
    : null;
  if (!assignment || !normalizeXdataValue(assignment.value)) return null;
  return {
    app: MOTHER_XDATA_APP_NAME,
    value: normalizeXdataValue(assignment.value)
  };
}

function stripMotherXdataPairs(pairs) {
  const next = [];
  let skipping = false;
  for (const pair of Array.isArray(pairs) ? pairs : []) {
    const code = String(pair?.code || "");
    const value = String(pair?.value || "");
    if (code === "1001" && value.trim() === MOTHER_XDATA_APP_NAME) {
      skipping = true;
      continue;
    }
    if (skipping && code === "1001") {
      skipping = false;
    }
    if (skipping) continue;
    next.push({ ...pair });
  }
  return next;
}

function applyMotherXdataToPairs(pairs, value) {
  const next = stripMotherXdataPairs(pairs);
  const normalizedValue = normalizeXdataValue(value);
  if (!normalizedValue) return next;
  next.push({ code: "1001", value: MOTHER_XDATA_APP_NAME });
  next.push({ code: "1000", value: normalizedValue });
  return next;
}

function normalizeTopoCommentsInput(input) {
  if (Array.isArray(input)) {
    return input
      .map((value) => String(value || "").trim())
      .filter((value) => value.toUpperCase().startsWith("TOPO:"));
  }

  const text = String(input || "").trim();
  if (!text) return [];
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n").map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return [];

  const comments = [];
  const looksLikePairStream = lines.some((line) => line === "999");
  if (looksLikePairStream) {
    for (let index = 0; index < lines.length; index += 1) {
      if (lines[index] !== "999") continue;
      const value = String(lines[index + 1] || "").trim();
      if (value.toUpperCase().startsWith("TOPO:")) {
        comments.push(value);
      }
      index += 1;
    }
    return comments;
  }

  return lines.filter((line) => line.toUpperCase().startsWith("TOPO:"));
}

function extractTopoCommentsFromDxfText(dxfText) {
  return normalizeTopoCommentsInput(dxfText);
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

function parseComparableNumber(value) {
  const raw = String(value == null ? "" : value).trim().replace(",", ".");
  const match = raw.match(/^(-?\d+(?:\.\d+)?)\s*([A-Za-z%]+)?$/);
  if (!match) return null;
  return {
    value: Number(match[1]),
    unit: String(match[2] || "").trim().toUpperCase() || null
  };
}

function compareInstructionValues(actual, expected, operator) {
  if (operator === "==" || operator === "!=") {
    const equal = valuesEqualForInstruction(actual, expected);
    return operator === "==" ? equal : !equal;
  }
  if (operator === "IN") {
    const expectedValues = Array.isArray(expected)
      ? expected
      : String(expected || "").trim().replace(/^\[/, "").replace(/\]$/, "").split(",").map((item) => item.trim()).filter(Boolean);
    return expectedValues.some((candidate) => valuesEqualForInstruction(actual, candidate));
  }
  const actualNumber = parseComparableNumber(actual);
  const expectedNumber = parseComparableNumber(expected);
  if (!actualNumber || !expectedNumber) return false;
  if (actualNumber.unit && expectedNumber.unit && actualNumber.unit !== expectedNumber.unit) {
    return false;
  }
  if (operator === ">") return actualNumber.value > expectedNumber.value;
  if (operator === ">=") return actualNumber.value >= expectedNumber.value;
  if (operator === "<") return actualNumber.value < expectedNumber.value;
  if (operator === "<=") return actualNumber.value <= expectedNumber.value;
  return false;
}

function parseWhenClause(rawClause) {
  const raw = String(rawClause || "").trim().replace(/^\(/, "").replace(/\)$/, "").trim();
  const inMatch = raw.match(/^(.+?)\s+IN\s+\[(.+)\]$/i);
  if (inMatch) {
    const parameter = String(inMatch[1] || "").trim();
    const expectedValues = String(inMatch[2] || "").split(",").map((item) => item.trim()).filter(Boolean);
    if (!parameter || !expectedValues.length) return null;
    return {
      parameter,
      operator: "IN",
      expected: `[${expectedValues.join(",")}]`,
      expected_values: expectedValues
    };
  }
  const operators = [">=", "<=", "!=", "==", ">", "<"];
  const operator = operators.find((token) => raw.includes(token)) || null;
  if (!operator) return null;
  const idx = raw.indexOf(operator);
  const parameter = raw.slice(0, idx).trim();
  const expected = raw.slice(idx + operator.length).trim();
  if (!parameter || !expected) return null;
  return {
    parameter,
    operator,
    expected
  };
}

function parseWhenExpression(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const logicMatches = Array.from(raw.matchAll(/\s+(AND|OR)\s+/gi)).map((match) => String(match[1] || "").toUpperCase());
  const logicalOperator = logicMatches.length ? logicMatches[0] : null;
  if (logicalOperator && logicMatches.some((token) => token !== logicalOperator)) {
    return null;
  }
  const clauseTokens = logicalOperator
    ? raw.split(new RegExp(`\\s+${logicalOperator}\\s+`, "i"))
    : [raw];
  const clauses = clauseTokens.map(parseWhenClause).filter(Boolean);
  if (!clauses.length || clauses.length !== clauseTokens.length) return null;
  const firstClause = clauses[0];
  return {
    expression: raw,
    logical_operator: logicalOperator,
    clauses,
    parameter: firstClause.parameter,
    operator: firstClause.operator,
    expected: firstClause.expected
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

function coerceDocumentSemNumber(value, fieldName) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error(`Invalid document SEM ${fieldName}.`);
  }
  return numeric;
}

function normalizeDocumentSemPayload(payload) {
  const source = payload && typeof payload === "object" ? payload : {};
  const nominalWidth = coerceDocumentSemNumber(source.nominal_width, "nominal_width");
  const nominalHeight = coerceDocumentSemNumber(source.nominal_height, "nominal_height");
  const family = String(source.family || "").trim();
  const product = String(source.product || "").trim();
  const part = String(source.part || source.product_code || "").trim();
  if (!family) {
    throw new Error("Missing document SEM family.");
  }
  if (!product) {
    throw new Error("Missing document SEM product.");
  }
  if (!part) {
    throw new Error("Missing document SEM part.");
  }
  return {
    nominal_width: nominalWidth,
    nominal_height: nominalHeight,
    family,
    product,
    part
  };
}

function normalizeDocumentSemRuleRefs(value) {
  const source = Array.isArray(value) ? value : value ? [value] : [];
  return Array.from(new Set(source.map((item) => String(item || "").trim()).filter(Boolean)));
}

function formatDocumentSemNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return Number.isInteger(numeric) ? String(numeric) : String(numeric);
}

function buildDocumentSemIdentityComment(payload) {
  const sem = normalizeDocumentSemPayload(payload);
  return [
    "SEM:document=true",
    `nominal_width=${formatDocumentSemNumber(sem.nominal_width)}`,
    `nominal_height=${formatDocumentSemNumber(sem.nominal_height)}`,
    `family=${sem.family}`,
    `product=${sem.product}`,
    `part=${sem.part}`
  ].join(";");
}

function buildDocumentSemRuleComment(ruleRef) {
  const normalizedRuleRef = String(ruleRef || "").trim();
  if (!normalizedRuleRef) {
    throw new Error("Missing document-level rule_ref.");
  }
  return [
    "SEM:document=true",
    `rule_ref=${normalizedRuleRef}`
  ].join(";");
}

function isDocumentSemanticComment(rawComment) {
  const parsed = parseSemanticComment(rawComment);
  if (!parsed) return false;
  return String(parsed.keys?.document || "").trim().toLowerCase() === "true";
}

function parseDocumentSem(parsedDocument) {
  const comments = Array.isArray(parsedDocument?.preComments) ? parsedDocument.preComments : [];
  for (const pair of comments) {
    if (String(pair?.code) !== "999") continue;
    const parsed = parseSemanticComment(pair.value);
    if (!parsed) continue;
    if (String(parsed.keys?.document || "").trim().toLowerCase() === "true") {
      return parsed;
    }
  }
  return null;
}

function collectDocumentSemMetadata(parsedDocument) {
  const comments = Array.isArray(parsedDocument?.preComments) ? parsedDocument.preComments : [];
  const parsedComments = comments
    .filter((pair) => String(pair?.code) === "999")
    .map((pair) => parseSemanticComment(pair.value))
    .filter((parsed) => parsed && String(parsed.keys?.document || "").trim().toLowerCase() === "true");
  if (!parsedComments.length) return null;
  const identity = parsedComments.find((parsed) => {
    const keys = parsed.keys || {};
    return keys.nominal_width || keys.nominal_height || keys.family || keys.product || keys.part;
  }) || null;
  const ruleComments = parsedComments.filter((parsed) => String(parsed.keys?.rule_ref || "").trim());
  const keys = identity?.keys || {};
  const nominalWidth = Number(keys.nominal_width);
  const nominalHeight = Number(keys.nominal_height);
  return {
    identity_raw_comment: identity?.raw_comment || null,
    raw_comments: parsedComments.map((parsed) => parsed.raw_comment),
    nominal_width: Number.isFinite(nominalWidth) ? nominalWidth : null,
    nominal_height: Number.isFinite(nominalHeight) ? nominalHeight : null,
    family: keys.family || null,
    product: keys.product || null,
    part: keys.part || null,
    rule_refs: ruleComments.map((parsed) => String(parsed.keys.rule_ref).trim()),
    rule_comments: ruleComments.map((parsed) => ({
      rule_ref: String(parsed.keys.rule_ref).trim(),
      raw_comment: parsed.raw_comment,
      validation: parsed.validation
    })),
    raw_comment: identity?.raw_comment || null,
    validation: {
      ok: parsedComments.every((parsed) => parsed.validation?.ok !== false),
      errors: parsedComments.flatMap((parsed) => parsed.validation?.errors || []),
      warnings: []
    }
  };
}

function evaluateCatalogRuleCondition(condition, parameters) {
  const source = condition && typeof condition === "object" ? condition : {};
  const parameter = String(source.parameter || "").trim();
  const operator = String(source.operator || "").trim().toUpperCase();
  if (!parameter || !operator) return false;
  const actual = parameters ? parameters[parameter] : undefined;
  if (operator === "==") {
    return String(actual ?? "").trim() === String(source.value ?? "").trim();
  }
  if (operator === "IN") {
    const values = Array.isArray(source.values) ? source.values.map((item) => String(item ?? "").trim()) : [];
    return values.includes(String(actual ?? "").trim());
  }
  return false;
}

function resolveExecutableDocumentRules(session, parameters) {
  const documentSem = collectDocumentSemMetadata(session?.document);
  const ruleRefs = Array.isArray(documentSem?.rule_refs) ? documentSem.rule_refs : [];
  if (!ruleRefs.length) return [];
  const catalog = normalizeRuleCatalogSnapshot(session?.rule_catalog);
  const catalogRules = catalog && catalog.rules && typeof catalog.rules === "object" ? catalog.rules : {};
  const matches = [];
  for (const ruleRef of ruleRefs) {
    const rule = catalogRules[ruleRef];
    if (!rule || typeof rule !== "object") continue;
    const profileScope = String(rule.profile_scope || "").trim().toUpperCase();
    if (profileScope && profileScope !== "MXD") continue;
    if (!evaluateCatalogRuleCondition(rule.condition, parameters)) continue;
    matches.push(rule);
  }
  return matches;
}

function buildObjectsFromSimulationMap(objects, objectMap) {
  return (Array.isArray(objects) ? objects : []).map((object) => {
    const preview = objectMap?.get(object.id);
    return {
      id: object.id,
      primary_layer: object.primary_layer,
      shapes: cloneShapes(preview?.simulated_shapes || object?.shapes),
      bbox: preview?.simulated_bbox ? cloneJson(preview.simulated_bbox) : (object?.bbox ? cloneJson(object.bbox) : null)
    };
  });
}

function adjustEnvelopeVerticalLineToBottom(shape, edgeX, originalBottomY, nextBottomY) {
  if (!shape || shape.kind !== "line") return shape;
  const x1 = Number(shape.x1);
  const y1 = Number(shape.y1);
  const x2 = Number(shape.x2);
  const y2 = Number(shape.y2);
  if (![x1, y1, x2, y2, edgeX, originalBottomY, nextBottomY].every(Number.isFinite)) {
    return shape;
  }
  if (Math.abs(x1 - x2) > 0.5) return shape;
  if (Math.abs(x1 - edgeX) > 2 && Math.abs(x2 - edgeX) > 2) return shape;
  const startTouchesBottom = Math.abs(y1 - originalBottomY) <= 2;
  const endTouchesBottom = Math.abs(y2 - originalBottomY) <= 2;
  if (!startTouchesBottom && !endTouchesBottom) return shape;
  if (startTouchesBottom) {
    return {
      kind: "line",
      x1,
      y1: nextBottomY,
      x2,
      y2
    };
  }
  return {
    kind: "line",
    x1,
    y1,
    x2,
    y2: nextBottomY
  };
}

function applyBottomOffsetEnvelopeVerticalPostPass(objectMap, objects, preRuleShapeSnapshot, offsetY) {
  const preRuleObjects = (Array.isArray(objects) ? objects : []).map((object) => ({
    id: object.id,
    primary_layer: object.primary_layer,
    shapes: cloneShapes(preRuleShapeSnapshot.get(object.id) || object?.shapes),
    bbox: object?.bbox ? cloneJson(object.bbox) : null
  }));
  const envelope = buildTopoPreviewEnvelope(preRuleObjects);
  if (!envelope) return;
  const originalBottomY = Number(envelope.minY);
  const nextBottomY = originalBottomY + Number(offsetY || 0);
  const height = Number(envelope.maxY) - Number(envelope.minY);

  for (const object of Array.isArray(objects) ? objects : []) {
    const preview = objectMap.get(object.id);
    if (!preview || (preview.applied_offset?.dy || 0) !== 0) continue;
    const originalShapes = preRuleShapeSnapshot.get(object.id) || cloneShapes(object?.shapes);
    const currentShapes = Array.isArray(preview.simulated_shapes) ? preview.simulated_shapes : [];
    preview.simulated_shapes = currentShapes.map((shape, index) => {
      const originalShape = originalShapes[index];
      const originalBBox = bboxFromShapes(originalShape ? [originalShape] : []);
      if (!originalShape || !originalBBox) return shape;
      const isTallVertical = originalShape.kind === "line"
        && Math.abs(Number(originalShape.x1) - Number(originalShape.x2)) <= 0.5
        && (Number(originalBBox.maxY) - Number(originalBBox.minY)) >= height * 0.4;
      if (!isTallVertical) return shape;
      let nextShape = adjustEnvelopeVerticalLineToBottom(shape, Number(envelope.minX), originalBottomY, nextBottomY);
      nextShape = adjustEnvelopeVerticalLineToBottom(nextShape, Number(envelope.maxX), originalBottomY, nextBottomY);
      return nextShape;
    });
    preview.simulated_bbox = preview.simulated_shapes.length
      ? bboxFromShapes(preview.simulated_shapes)
      : (object?.bbox ? cloneJson(object.bbox) : null);
  }
}

function applyDocumentRulesToSimulationMap(session, objects, parameters, objectMap, topologyMode) {
  if (!objectMap || !Array.isArray(objects) || !objects.length) {
    return { applied_rules: [] };
  }
  const executableRules = resolveExecutableDocumentRules(session, parameters);
  if (!executableRules.length) {
    return { applied_rules: [] };
  }

  const appliedRules = [];

  for (const rule of executableRules) {
    const action = rule && typeof rule.action === "object" ? rule.action : {};
    const targetScope = rule && typeof rule.target_scope === "object" ? rule.target_scope : {};
    const targetLayer = String(targetScope.layer || "").trim().toUpperCase();
    const geometry = String(action.geometry || "").trim().toLowerCase();
    const axis = String(action.axis || "").trim().toUpperCase();
    const valueMm = Number(action.value_mm);
    const postRepair = String(action.post_repair || "").trim().toLowerCase();

    if (geometry !== "offset" || !targetLayer || !Number.isFinite(valueMm)) continue;

    const affectedObjects = objects.filter((object) => {
      if (String(object?.primary_layer || "").trim().toUpperCase() !== targetLayer) return false;
      return evaluateChildEntityInclusion(object, parameters)?.included !== false;
    });
    if (!affectedObjects.length) continue;

    const dx = axis === "X" ? valueMm : 0;
    const dy = axis === "Y" ? valueMm : 0;
    const preRuleShapeSnapshot = new Map();

    for (const object of objects) {
      const preview = objectMap.get(object.id);
      preRuleShapeSnapshot.set(
        object.id,
        cloneShapes(Array.isArray(preview?.simulated_shapes) ? preview.simulated_shapes : object?.shapes)
      );
    }

    for (const object of affectedObjects) {
      const preview = objectMap.get(object.id);
      if (!preview) continue;
      const currentShapes = Array.isArray(preview.simulated_shapes) ? preview.simulated_shapes : cloneShapes(object?.shapes);
      preview.simulated_shapes = currentShapes.map((shape) => translateShape(shape, dx, dy));
      const priorOffset = preview.applied_offset && typeof preview.applied_offset === "object"
        ? preview.applied_offset
        : { dx: 0, dy: 0 };
      preview.applied_offset = {
        dx: Number(priorOffset.dx || 0) + dx,
        dy: Number(priorOffset.dy || 0) + dy
      };
      preview.document_rule_actions = Array.isArray(preview.document_rule_actions)
        ? preview.document_rule_actions
        : [];
      preview.document_rule_actions.push({
        rule_id: String(rule.rule_id || "").trim() || null,
        axis,
        value_mm: valueMm
      });
      preview.geometry_simulation_mode = `${preview.geometry_simulation_mode || (topologyMode ? `topology_mode:${topologyMode}` : "none_topology_identity")}|document_rules`;
    }

    if (postRepair === "bounded_trim_rejoin") {
      const baseObjects = buildObjectsFromSimulationMap(objects, objectMap);
      const includedObjects = baseObjects.filter((object) => evaluateChildEntityInclusion(object, parameters)?.included !== false);
      const lineCandidates = collectLineCandidates(includedObjects);
      const simulatedShapeMap = new Map();
      for (const object of includedObjects) {
        const preview = objectMap.get(object.id);
        const shapes = Array.isArray(preview?.simulated_shapes) ? preview.simulated_shapes : [];
        for (let index = 0; index < shapes.length; index += 1) {
          simulatedShapeMap.set(`${object.id}:${index}`, shapes[index]);
        }
      }
      const repairEnvelope = buildTopoPreviewEnvelope(includedObjects);
      const repairOptions = {
        bounds: repairEnvelope,
        maxExtension: 30
      };

      for (const object of affectedObjects) {
        const preview = objectMap.get(object.id);
        if (!preview) continue;
        preview.line_pairing = Array.isArray(preview.line_pairing) ? preview.line_pairing : [];
        const preRuleShapes = preRuleShapeSnapshot.get(object.id) || cloneShapes(object?.shapes);
        for (let index = 0; index < preview.simulated_shapes.length; index += 1) {
          const originalShape = preRuleShapes[index];
          const translatedShape = preview.simulated_shapes[index];
          if (!originalShape || originalShape.kind !== "line") continue;
          const resolved = applyTrimRejoinToTranslatedLine(
            originalShape,
            translatedShape,
            lineCandidates,
            { object_id: object.id, shape_index: index },
            simulatedShapeMap,
            repairOptions
          );
          for (const pairing of resolved.pairings || []) {
            preview.line_pairing.push({
              status: pairing.status,
              paired_vertex: pairing.paired_vertex || null,
              anchor_object_id: pairing.candidate ? pairing.candidate.object_id : null,
              anchor_shape_index: pairing.candidate ? pairing.candidate.shape_index : null,
              anchor_vertex: pairing.candidate_vertex || null,
              intersection: pairing.intersection || null,
              document_rule_id: String(rule.rule_id || "").trim() || null
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
    }

    if (axis === "Y" && dy > 0 && targetLayer === "B") {
      applyBottomOffsetEnvelopeVerticalPostPass(objectMap, objects, preRuleShapeSnapshot, dy);
    }

    for (const object of objects) {
      const preview = objectMap.get(object.id);
      if (!preview) continue;
      preview.simulated_bbox = Array.isArray(preview.simulated_shapes) && preview.simulated_shapes.length
        ? bboxFromShapes(preview.simulated_shapes)
        : (object?.bbox ? cloneJson(object.bbox) : null);
    }

    appliedRules.push({
      rule_id: String(rule.rule_id || "").trim() || null,
      target_layer: targetLayer,
      axis,
      value_mm: valueMm,
      affected_count: affectedObjects.length
    });
  }

  return {
    applied_rules: appliedRules
  };
}

function parseTopoComment(commentValue) {
  const raw = String(commentValue || "").trim();
  if (!raw.toUpperCase().startsWith("TOPO:")) return null;
  const body = raw.slice(5).trim();
  const pairs = body ? body.split(";").map((item) => item.trim()).filter(Boolean) : [];
  if (!pairs.length) return null;

  const keys = {};
  for (const pair of pairs) {
    const idx = pair.indexOf("=");
    if (idx <= 0 || idx === pair.length - 1) {
      return null;
    }
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (!key || !value || Object.prototype.hasOwnProperty.call(keys, key)) {
      return null;
    }
    keys[key] = value;
  }

  return {
    family: "TOPO",
    mode: String(keys.mode || "").trim() || null,
    sliding_band: String(keys.sliding_band || "").trim().toUpperCase() || null,
    fixed_dimension: String(keys.fixed_dimension || "").trim().toUpperCase() || null,
    inner_side: String(keys.inner_side || "").trim().toUpperCase() || null,
    outer_side: String(keys.outer_side || "").trim().toUpperCase() || null,
    raw_comment: raw,
    keys
  };
}

function collectTopoMetadata(parsedDocument) {
  const sources = normalizeTopoCommentsInput(parsedDocument?.topo_comments);

  if (Array.isArray(parsedDocument?.fileComments)) {
    sources.push(...parsedDocument.fileComments);
  }
  if (Array.isArray(parsedDocument?.preComments)) {
    sources.push(...parsedDocument.preComments);
  }
  if (Array.isArray(parsedDocument?.comments)) {
    sources.push(...parsedDocument.comments);
  }

  return sources
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (entry && String(entry.code) === "999") return entry.value;
      return null;
    })
    .filter((value) => typeof value === "string")
    .map(parseTopoComment)
    .filter(Boolean);
}

function validateTopoBlock(topoObject) {
  const errors = [];
  const mode = String(topoObject?.mode || "").trim();
  const keys = topoObject?.keys || {};
  const hasExecutableDraftFields = Boolean(
    keys.group || keys.axis
    || keys.lec_parameter || keys.lec_nominal || keys.rec_parameter || keys.rec_nominal
  );

  if (hasExecutableDraftFields) {
    const axis = String(keys.axis || "").trim().toUpperCase();
    if (mode !== "fixed_envelope_slide") {
      errors.push({
        code: "INVALID_TOPO_MODE",
        message: `Unsupported TOPO mode: ${topoObject?.mode}`
      });
    }
    if (!String(keys.group || "").trim()) {
      errors.push({
        code: "MISSING_TOPO_GROUP",
        message: "Missing TOPO group."
      });
    }
    if (axis !== "X") {
      errors.push({
        code: "INVALID_TOPO_AXIS",
        message: `Unsupported TOPO axis: ${keys.axis}`
      });
    }
    const hasLeftInput = Boolean(String(keys.lec_parameter || "").trim()) && Number.isFinite(Number(keys.lec_nominal));
    const hasRightInput = Boolean(String(keys.rec_parameter || "").trim()) && Number.isFinite(Number(keys.rec_nominal));
    if (!(hasLeftInput && hasRightInput)) {
      errors.push({
        code: "MISSING_TOPO_SIDE_INPUTS",
        message: "TOPO requires both LEC and REC parameter/nominal pairs."
      });
    }
    if (String(keys.delta_rule || "").trim() !== "config_minus_nominal") {
      errors.push({
        code: "INVALID_TOPO_DELTA_RULE",
        message: `Unsupported TOPO delta_rule: ${keys.delta_rule}`
      });
    }
    for (const key of ["lec_delta_factor", "rec_delta_factor"]) {
      if (!Number.isFinite(Number(keys[key]))) {
        errors.push({
          code: "INVALID_TOPO_DELTA_FACTOR",
          message: `Invalid TOPO ${key}: ${keys[key]}`
        });
      }
    }
    if (String(keys.trim_policy || "").trim() !== "rejoin") {
      errors.push({
        code: "INVALID_TOPO_TRIM_POLICY",
        message: `Unsupported TOPO trim_policy: ${keys.trim_policy}`
      });
    }
    return {
      ok: errors.length === 0,
      errors
    };
  }

  const slidingBand = String(topoObject?.sliding_band || "").trim().toUpperCase();
  const fixedDimension = String(topoObject?.fixed_dimension || "").trim().toUpperCase();
  const innerSide = String(topoObject?.inner_side || "").trim().toUpperCase();
  const outerSide = String(topoObject?.outer_side || "").trim().toUpperCase();

  if (mode !== "fixed_envelope_slide") {
    errors.push({
      code: "INVALID_TOPO_MODE",
      message: `Unsupported TOPO mode: ${topoObject?.mode}`
    });
  }
  if (!["L", "R", "T", "B"].includes(slidingBand)) {
    errors.push({
      code: "INVALID_TOPO_SLIDING_BAND",
      message: `Unsupported TOPO sliding_band: ${topoObject?.sliding_band}`
    });
  }
  if (!["X", "Y"].includes(fixedDimension)) {
    errors.push({
      code: "INVALID_TOPO_FIXED_DIMENSION",
      message: `Unsupported TOPO fixed_dimension: ${topoObject?.fixed_dimension}`
    });
  }
  if (!["LEFT", "RIGHT", "TOP", "BOTTOM"].includes(innerSide)) {
    errors.push({
      code: "INVALID_TOPO_INNER_SIDE",
      message: `Unsupported TOPO inner_side: ${topoObject?.inner_side}`
    });
  }
  if (!["LEFT", "RIGHT", "TOP", "BOTTOM"].includes(outerSide)) {
    errors.push({
      code: "INVALID_TOPO_OUTER_SIDE",
      message: `Unsupported TOPO outer_side: ${topoObject?.outer_side}`
    });
  }

  return {
    ok: errors.length === 0,
    errors
  };
}

function normalizeTopoRuntimeModel(topoObjects) {
  const items = Array.isArray(topoObjects) ? topoObjects.filter(Boolean) : [];
  if (!items.length) return null;

  const validated = items.map((item) => ({
    topo: item,
    validation: validateTopoBlock(item)
  }));
  const firstValid = validated.find((entry) => entry.validation.ok) || null;
  if (!firstValid) return null;

  return {
    family: "TOPO",
    mode: firstValid.topo.mode,
    sliding_band: firstValid.topo.sliding_band,
    fixed_dimension: firstValid.topo.fixed_dimension,
    inner_side: firstValid.topo.inner_side,
    outer_side: firstValid.topo.outer_side,
    raw_comment: firstValid.topo.raw_comment,
    source_count: items.length,
    validation: firstValid.validation
  };
}

function projectTopoMetadata(session) {
  const raw_comments = normalizeTopoCommentsInput(session?.topo_comments);
  const parsedRecords = raw_comments.map((raw_comment) => ({
    raw_comment,
    parsed: parseTopoComment(raw_comment)
  }));
  const invalid_raw_comments = parsedRecords
    .filter((entry) => !entry.parsed)
    .map((entry) => entry.raw_comment);
  const parsed = parsedRecords.map((entry) => entry.parsed).filter(Boolean);
  const validations = parsed.map((item) => ({
    raw_comment: item.raw_comment,
    validation: validateTopoBlock(item)
  }));
  const validationErrors = validations
    .filter((entry) => !entry.validation.ok)
    .flatMap((entry) => entry.validation.errors);
  const runtime_model = normalizeTopoRuntimeModel(parsed);

  return {
    raw_comments,
    parsed,
    invalid_raw_comments,
    runtime_model,
    validation: {
      ok: invalid_raw_comments.length === 0 && validationErrors.length === 0,
      errors: invalid_raw_comments
        .map((raw_comment) => ({
          code: "INVALID_TOPO_FORMAT",
          message: `Invalid TOPO comment format: ${raw_comment}`
        }))
        .concat(validationErrors),
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

function isFileLevelTopoComment(rawComment) {
  const parsed = parseTopoComment(rawComment);
  return Boolean(parsed && parsed.keys && parsed.keys.mode);
}

function isEntityTopoRoleComment(rawComment) {
  const parsed = parseTopoComment(rawComment);
  return Boolean(parsed && parsed.keys && parsed.keys.role);
}

function upsertFileLevelTopoComment(session, topoString) {
  const rawComment = normalizeTopoCommentsInput(topoString).find((value) => isFileLevelTopoComment(value)) || "";
  if (!rawComment) {
    throw new Error("Missing file-level TOPO comment.");
  }
  const comments = Array.isArray(session.document?.preComments) ? session.document.preComments : [];
  const nextComments = comments.filter((pair) => !(String(pair?.code) === "999" && isFileLevelTopoComment(pair.value)));
  const insertAfterIndex = nextComments.reduce((lastIndex, pair, index) => {
    return String(pair?.code) === "999" && isDocumentSemanticComment(pair.value) ? index : lastIndex;
  }, -1);
  const topoPair = { code: "999", value: rawComment };
  if (insertAfterIndex >= 0) {
    nextComments.splice(insertAfterIndex + 1, 0, topoPair);
  } else {
    nextComments.unshift(topoPair);
  }
  session.document.preComments = nextComments;
  return rawComment;
}

function buildEntityTopoRoleComment({ role, group, zone }) {
  const normalizedRole = String(role || "").trim();
  if (!normalizedRole || normalizedRole === "none") return "";
  const normalizedGroup = String(group || "").trim();
  const normalizedZone = String(zone || "").trim().toUpperCase();
  if (normalizedRole !== "mover") {
    throw new Error(`Unsupported TOPO entity role: ${role}`);
  }
  if (!normalizedGroup) {
    throw new Error("Missing TOPO entity group.");
  }
  if (!["LEC", "REC"].includes(normalizedZone)) {
    throw new Error(`Unsupported TOPO entity zone: ${zone}`);
  }
  return `TOPO:role=${normalizedRole};group=${normalizedGroup};zone=${normalizedZone}`;
}

function upsertEntityTopoComment(session, entityId, topoRoleString) {
  const entity = findEntity(session.document, entityId);
  if (!entity) {
    throw new Error(`Unknown entity id: ${entityId}`);
  }
  const rawComment = String(topoRoleString || "").trim();
  const preComments = Array.isArray(entity.preComments) ? entity.preComments : [];
  const nextPreComments = preComments.filter((pair) => !(String(pair?.code) === "999" && isEntityTopoRoleComment(pair.value)));
  if (rawComment) {
    if (!isEntityTopoRoleComment(rawComment)) {
      throw new Error("Invalid entity-level TOPO role comment.");
    }
    nextPreComments.push({ code: "999", value: rawComment });
  }
  entity.preComments = nextPreComments;
  return rawComment;
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
  const preComments = Array.isArray(entity.preComments) ? entity.preComments : [];
  const nextPreComments = preComments.filter((pair) => {
    if (String(pair?.code) !== "999") return true;
    const value = String(pair?.value || "").trim();
    if (!value.toUpperCase().startsWith("SEM:")) return true;
    return value !== nextComment;
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
  const presenceRecords = (Array.isArray(parsedSemRecords) ? parsedSemRecords : []).filter((record) => {
    const presence = String(record?.keys?.presence || "").trim().toLowerCase();
    return presence === "conditional" || presence === "always" || presence === "never";
  });
  if (!presenceRecords.length) {
    return {
      record: null,
      records: [],
      evaluations: [],
      included: true,
      exclusion_reason: null,
      visibility_reason: "default_visible",
      operation_hint: null,
      conditional_param: null,
      conditional_expected: null,
      conditional_operator: null,
      conditional_actual: null,
      conditional_expression: null
    };
  }

  const evaluations = presenceRecords.map((presenceRecord) => {
    const keys = presenceRecord.keys || {};
    const presence = String(keys.presence || "").trim().toLowerCase();
    const whenExpression = presenceRecord.when_expression || null;
    const clauses = Array.isArray(whenExpression?.clauses) ? whenExpression.clauses : [];
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
        conditional_actual: conditionalActual,
        conditional_expression: whenExpression?.expression || null
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
        conditional_actual: conditionalActual,
        conditional_expression: whenExpression?.expression || null
      };
    }
    if (clauses.length) {
      const clauseResults = clauses.map((clause) => {
        const actual = parameters[clause.parameter];
        const matched = compareInstructionValues(actual, clause.expected, clause.operator);
        return {
          parameter: clause.parameter,
          operator: clause.operator,
          expected: clause.expected,
          actual,
          matched
        };
      });
      const logic = whenExpression.logical_operator || null;
      const included = logic === "OR"
        ? clauseResults.some((item) => item.matched)
        : clauseResults.every((item) => item.matched);
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
        conditional_actual: conditionalActual,
        conditional_expression: whenExpression.expression,
        clause_results: clauseResults,
        logical_operator: logic
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
      conditional_actual: conditionalActual,
      conditional_expression: whenExpression?.expression || null
    };
  });

  const aggregatePresenceEvaluations = (items) => {
    const blocking = items.find((item) => item.operation_hint === "never" || (!item.included && !item.conditional_param));
    if (blocking) return !blocking.included ? { included: false, failed: blocking } : null;

    const groups = new Map();
    for (const item of items) {
      if (item.operation_hint === "always") continue;
      const key = item.conditional_param || "__ungrouped";
      const group = groups.get(key) || [];
      group.push(item);
      groups.set(key, group);
    }

    for (const group of groups.values()) {
      const operators = new Set(group.map((item) => String(item.conditional_operator || "").trim()));
      const groupIncluded = operators.size === 1 && operators.has("!=")
        ? group.every((item) => item.included)
        : group.some((item) => item.included);
      if (!groupIncluded) {
        return {
          included: false,
          failed: group.find((item) => !item.included) || group[0]
        };
      }
    }

    return { included: true, failed: null };
  };

  const aggregate = aggregatePresenceEvaluations(evaluations);
  const firstFailed = aggregate && !aggregate.included
    ? aggregate.failed
    : evaluations.find((item) => !item.included && !item.conditional_param) || null;
  const firstDetailed = firstFailed || evaluations.find((item) => item.conditional_expression) || evaluations[0];
  const included = aggregate ? aggregate.included : evaluations.every((item) => item.included);
  return {
    record: firstDetailed?.record || presenceRecords[0],
    records: presenceRecords,
    evaluations,
    included,
    exclusion_reason: included ? null : "presence",
    visibility_reason: included
      ? (evaluations.length > 1 ? `presence_records_matched:${evaluations.length}` : String(firstDetailed?.visibility_reason || "presence_matched"))
      : String(firstFailed?.visibility_reason || "presence_not_matched"),
    operation_hint: evaluations.map((item) => item.operation_hint).filter(Boolean)[0] || null,
    conditional_param: firstDetailed?.conditional_param || null,
    conditional_expected: firstDetailed?.conditional_expected || null,
    conditional_operator: firstDetailed?.conditional_operator || null,
    conditional_actual: firstDetailed?.conditional_actual || null,
    conditional_expression: firstDetailed?.conditional_expression || null
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
  session.xdata_assignments = normalizeXdataAssignments(session.document, session.xdata_assignments);

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
      semantic_metadata,
      xdata_metadata: collectEntityXdataMetadata(session, item.entityId)
    };
  });
  const topo_metadata = projectTopoMetadata(session);
  const document_sem = collectDocumentSemMetadata(session.document);

  return {
    session_id: session.session_id,
    title: session.title,
    status: session.status,
    artifact_state: session.artifact_state,
    source_name: session.source_name,
    bands: session.bands,
    document_bbox: session.document_bbox,
    config_parameter_set: session.config_parameter_set || cloneJson(DEFAULT_CONFIG_PARAMETER_SET),
    parameter_catalog: normalizeParameterCatalogSnapshot(session.parameter_catalog),
    rule_catalog: normalizeRuleCatalogSnapshot(session.rule_catalog),
    document_sem,
    topo_metadata,
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
  const xdataAssignments = normalizeXdataAssignments(document, session.xdata_assignments);
  for (const entity of Array.isArray(document.entities) ? document.entities : []) {
    const assignment = xdataAssignments[entity.id] || null;
    entity.pairs = applyMotherXdataToPairs(entity.pairs, assignment ? assignment.value : "");
  }
  return document;
}

function serializeCurrentMotherDraft(session) {
  return serializeDocument(materializeDocumentForExport(session));
}

function buildEntityExecutionSummary(object, parameters) {
  const parsedSemRecords = Array.isArray(object?.semantic_metadata?.parsed) ? object.semantic_metadata.parsed : [];
  const presenceEval = evaluatePresenceInstruction(parsedSemRecords, parameters);
  const variantEval = presenceEval.included
    ? evaluateVariantInstruction(parsedSemRecords, parameters)
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
  return {
    entity_id: object.entity_id,
    included: presenceEval.included && variantEval.included,
    exclusion_reason: presenceEval.included ? variantEval.exclusion_reason : presenceEval.exclusion_reason,
    variant: variantEval.variant || null,
    geometry_ops: geometryOps
  };
}

function evaluateChildEntityInclusion(object, parameters) {
  const parsedSemRecords = Array.isArray(object?.semantic_metadata?.parsed) ? object.semantic_metadata.parsed : [];
  const presenceEval = evaluatePresenceInstruction(parsedSemRecords, parameters);
  const variantEval = presenceEval.included
    ? evaluateVariantInstruction(parsedSemRecords, parameters)
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
  return {
    included: presenceEval.included && variantEval.included,
    exclusion_reason: presenceEval.included ? variantEval.exclusion_reason : presenceEval.exclusion_reason,
    presence: presenceEval,
    variant: variantEval,
    geometry_ops: geometryOps
  };
}

function assertNoTopoKskrChildScope(session, config) {
  const productCode = String(config?.product_code || "").trim().toUpperCase();
  if (productCode !== "KSKR") {
    throw new Error(`NO TOPO child POC supports only KSKR product_code, received: ${config?.product_code}`);
  }
  const view = projectViewModel(session);
  const topoRuntime = view.topo_metadata && view.topo_metadata.runtime_model
    ? view.topo_metadata.runtime_model
    : null;
  const topoComments = Array.isArray(view.topo_metadata?.raw_comments) ? view.topo_metadata.raw_comments : [];
  if (topoComments.length) {
    throw new Error("NO TOPO child POC cannot run when TOPO metadata is present.");
  }
  if (topoRuntime && topoRuntime.mode && topoRuntime.mode !== "none") {
    throw new Error(`NO TOPO child POC cannot run with active TOPO mode: ${topoRuntime.mode}`);
  }
  return view;
}

function childPairValue(entity, code, fallback = "") {
  const found = (Array.isArray(entity?.pairs) ? entity.pairs : []).find((pair) => String(pair.code) === String(code));
  return found ? found.value : fallback;
}

function collectUsedBlockNames(document) {
  const byName = new Map((Array.isArray(document?.blocks) ? document.blocks : [])
    .map((block) => [String(block.name || childPairValue({ pairs: block.headerPairs }, "2", "")), block]));
  const used = new Set();
  const visitBlock = (blockName) => {
    const normalized = String(blockName || "").trim();
    if (!normalized || used.has(normalized)) return;
    used.add(normalized);
    const block = byName.get(normalized);
    if (!block) return;
    for (const entity of Array.isArray(block.entities) ? block.entities : []) {
      if (String(entity?.type || "").toUpperCase() === "INSERT") {
        visitBlock(childPairValue(entity, "2", ""));
      }
    }
  };

  for (const entity of Array.isArray(document?.entities) ? document.entities : []) {
    if (String(entity?.type || "").toUpperCase() === "INSERT") {
      visitBlock(childPairValue(entity, "2", ""));
    }
  }
  return used;
}

function pruneUnusedBlocks(document) {
  const usedBlockNames = collectUsedBlockNames(document);
  document.blocks = (Array.isArray(document.blocks) ? document.blocks : [])
    .filter((block) => usedBlockNames.has(String(block.name || childPairValue({ pairs: block.headerPairs }, "2", "")).trim()));
}

function materializeChildDocumentNoTopo(session, config) {
  const view = assertNoTopoKskrChildScope(session, config);
  const parameters = config.parameters || {};
  const outputDocument = cloneJson(session.document);
  const decisionsByEntityId = new Map();
  const excludedEntities = [];
  const includedEntities = [];
  const unsupportedGeometryOps = [];

  for (const object of Array.isArray(view.objects) ? view.objects : []) {
    const decision = evaluateChildEntityInclusion(object, parameters);
    decisionsByEntityId.set(object.entity_id, decision);
    if (!decision.included) {
      excludedEntities.push({
        entity_id: object.entity_id,
        object_id: object.id,
        type: object.type,
        exclusion_reason: decision.exclusion_reason || "excluded"
      });
      continue;
    }

    includedEntities.push({
      entity_id: object.entity_id,
      object_id: object.id,
      type: object.type
    });

    for (const op of decision.geometry_ops || []) {
      unsupportedGeometryOps.push({
        entity_id: object.entity_id,
        object_id: object.id,
        type: object.type,
        operation: op.geometry || null,
        reason: "GEOMETRY_OP_UNSUPPORTED_FOR_NO_TOPO_POC",
        raw_comment: op.raw_comment || null
      });
    }
  }

  outputDocument.entities = (Array.isArray(outputDocument.entities) ? outputDocument.entities : [])
    .filter((entity) => {
      const decision = decisionsByEntityId.get(entity.id);
      return !decision || decision.included;
    });
  pruneUnusedBlocks(outputDocument);

  return {
    document: outputDocument,
    generation_summary: {
      mode: "child_no_topo_poc_v0",
      topology_mode: "none",
      product_code: config.product_code,
      technology_profile: config.technology_profile,
      entity_count: (Array.isArray(view.objects) ? view.objects : []).length,
      included_count: includedEntities.length,
      excluded_count: excludedEntities.length,
      included_entities: includedEntities,
      excluded_entities: excludedEntities,
      unsupported_geometry_ops: unsupportedGeometryOps
    }
  };
}

function generateChildDxfNoTopo(session, parameterSet) {
  const config = normalizeConfigParameterSet(parameterSet || DEFAULT_KSKR_EXECUTION_CHECK_PARAMETER_SET);
  const materialized = materializeChildDocumentNoTopo(session, config);
  return {
    config_parameter_set: config,
    generation_summary: materialized.generation_summary,
    dxf_text: serializeDocument(materialized.document)
  };
}

function firstExecutableTopoComment(session) {
  const comments = []
    .concat(Array.isArray(session?.document?.preComments) ? session.document.preComments : [])
    .concat(normalizeTopoCommentsInput(session?.topo_comments).map((value) => ({ code: "999", value })));
  for (const pair of comments) {
    if (String(pair?.code) !== "999") continue;
    const parsed = parseTopoComment(pair.value);
    if (parsed && parsed.keys && parsed.keys.mode === "fixed_envelope_slide" && parsed.keys.group) {
      return parsed;
    }
  }
  return null;
}

function entityTopoRoleMetadata(entity) {
  const comments = Array.isArray(entity?.preComments) ? entity.preComments : [];
  for (const pair of comments) {
    if (String(pair?.code) !== "999") continue;
    const parsed = parseTopoComment(pair.value);
    if (parsed && parsed.keys && parsed.keys.role) return parsed;
  }
  return null;
}

function translateEntityPairs(entity, dx, dy) {
  const deltaX = Number(dx || 0);
  const deltaY = Number(dy || 0);
  entity.pairs = (Array.isArray(entity?.pairs) ? entity.pairs : []).map((pair) => {
    const code = String(pair?.code || "");
    const value = Number(pair?.value);
    if (!Number.isFinite(value)) return pair;
    if (/^1[0-8]$/.test(code)) {
      return { ...pair, value: String(roundNumber(value + deltaX, 3)) };
    }
    if (/^2[0-8]$/.test(code)) {
      return { ...pair, value: String(roundNumber(value + deltaY, 3)) };
    }
    return pair;
  });
}

function entityMapById(document) {
  const out = new Map();
  for (const entity of Array.isArray(document?.entities) ? document.entities : []) {
    out.set(entity.id, entity);
  }
  for (const block of Array.isArray(document?.blocks) ? document.blocks : []) {
    for (const entity of Array.isArray(block?.entities) ? block.entities : []) {
      out.set(entity.id, entity);
    }
  }
  return out;
}

function zoneDeltaFactor(topoKeys, zone) {
  const key = `${String(zone || "").trim().toLowerCase()}_delta_factor`;
  const factor = Number(topoKeys?.[key]);
  return Number.isFinite(factor) ? factor : null;
}

function topoZoneInputKeys(zone) {
  const normalized = String(zone || "").trim().toUpperCase();
  if (normalized === "LEC") {
    return { parameterKey: "lec_parameter", nominalKey: "lec_nominal", side: "left" };
  }
  if (normalized === "REC") {
    return { parameterKey: "rec_parameter", nominalKey: "rec_nominal", side: "right" };
  }
  return { parameterKey: null, nominalKey: null, side: null };
}

function resolveTopoZoneInput(topoKeys, parameters, zone) {
  const { parameterKey, nominalKey, side } = topoZoneInputKeys(zone);
  const zoneParameter = parameterKey ? String(topoKeys?.[parameterKey] || "").trim() : "";
  const parameter = zoneParameter || "";
  const zoneNominalRaw = nominalKey ? topoKeys?.[nominalKey] : null;
  const nominal = Number(zoneNominalRaw);
  const actual = Number(parameters?.[parameter]);
  return {
    side,
    parameter_key: zoneParameter ? parameterKey : null,
    nominal_key: zoneNominalRaw != null && zoneNominalRaw !== "" ? nominalKey : null,
    parameter: parameter || null,
    nominal: Number.isFinite(nominal) ? nominal : null,
    actual: Number.isFinite(actual) ? actual : null,
    delta: Number.isFinite(nominal) && Number.isFinite(actual) ? actual - nominal : null
  };
}

function materializeChildDocumentTopoPoc(session, config) {
  const view = projectViewModel(session);
  const parameters = config.parameters || {};
  const topo = firstExecutableTopoComment(session);
  if (!topo) {
    throw new Error("TOPO child POC requires executable file-level TOPO metadata.");
  }
  const topoKeys = topo.keys || {};
  const axis = String(topoKeys.axis || "").trim().toUpperCase();
  if (axis !== "X") {
    throw new Error(`TOPO child POC supports only axis=X, received: ${topoKeys.axis}`);
  }
  if (String(topoKeys.delta_rule || "").trim() !== "config_minus_nominal") {
    throw new Error(`Unsupported TOPO delta_rule: ${topoKeys.delta_rule}`);
  }
  const outputDocument = cloneJson(session.document);
  const outputEntities = entityMapById(outputDocument);
  const decisionsByEntityId = new Map();
  const excludedEntities = [];
  const includedEntities = [];
  const movedEntities = [];
  const skippedTopoEntities = [];
  let matchingTopoMoverCount = 0;

  for (const object of Array.isArray(view.objects) ? view.objects : []) {
    const decision = evaluateChildEntityInclusion(object, parameters);
    decisionsByEntityId.set(object.entity_id, decision);
    if (!decision.included) {
      excludedEntities.push({
        entity_id: object.entity_id,
        object_id: object.id,
        type: object.type,
        exclusion_reason: decision.exclusion_reason || "excluded"
      });
      continue;
    }
    includedEntities.push({
      entity_id: object.entity_id,
      object_id: object.id,
      type: object.type
    });

    const sourceEntity = findEntity(session.document, object.entity_id);
    const topoRole = entityTopoRoleMetadata(sourceEntity);
    if (!topoRole || topoRole.keys?.role !== "mover") continue;
    if (String(topoRole.keys?.group || "").trim() !== String(topoKeys.group || "").trim()) {
      skippedTopoEntities.push({
        entity_id: object.entity_id,
        object_id: object.id,
        reason: "TOPO_GROUP_MISMATCH",
        role_group: topoRole.keys?.group || null
      });
      continue;
    }
    matchingTopoMoverCount += 1;
    const zone = String(topoRole.keys?.zone || "").trim().toUpperCase();
    const zoneInput = resolveTopoZoneInput(topoKeys, parameters, zone);
    if (!zoneInput.parameter) {
      skippedTopoEntities.push({
        entity_id: object.entity_id,
        object_id: object.id,
        reason: "MISSING_TOPO_ZONE_PARAMETER",
        zone
      });
      continue;
    }
    if (!Number.isFinite(zoneInput.nominal)) {
      skippedTopoEntities.push({
        entity_id: object.entity_id,
        object_id: object.id,
        reason: "INVALID_TOPO_ZONE_NOMINAL",
        zone,
        nominal_key: zoneInput.nominal_key
      });
      continue;
    }
    if (!Number.isFinite(zoneInput.actual)) {
      skippedTopoEntities.push({
        entity_id: object.entity_id,
        object_id: object.id,
        reason: "MISSING_NUMERIC_TOPO_ZONE_PARAMETER",
        zone,
        parameter: zoneInput.parameter
      });
      continue;
    }
    const factor = zoneDeltaFactor(topoKeys, zone);
    if (!Number.isFinite(factor)) {
      skippedTopoEntities.push({
        entity_id: object.entity_id,
        object_id: object.id,
        reason: "MISSING_ZONE_DELTA_FACTOR",
        zone
      });
      continue;
    }
    const dx = Number(zoneInput.delta) * factor;
    const outputEntity = outputEntities.get(object.entity_id);
    if (!outputEntity) {
      skippedTopoEntities.push({
        entity_id: object.entity_id,
        object_id: object.id,
        reason: "OUTPUT_ENTITY_NOT_FOUND",
        zone
      });
      continue;
    }
    translateEntityPairs(outputEntity, dx, 0);
    movedEntities.push({
      entity_id: object.entity_id,
      object_id: object.id,
      type: object.type,
      group: topoRole.keys.group,
      zone,
      parameter: zoneInput.parameter,
      nominal: zoneInput.nominal,
      actual: zoneInput.actual,
      delta: zoneInput.delta,
      factor,
      dx,
      dy: 0
    });
  }

  if (!matchingTopoMoverCount) {
    throw new Error(`TOPO group ${String(topoKeys.group || "").trim() || "(missing group)"} has no entity-level mover annotations in the current session.`);
  }

  outputDocument.entities = (Array.isArray(outputDocument.entities) ? outputDocument.entities : [])
    .filter((entity) => {
      const decision = decisionsByEntityId.get(entity.id);
      return !decision || decision.included;
    });
  pruneUnusedBlocks(outputDocument);

  return {
    document: outputDocument,
    generation_summary: {
      mode: "child_topo_poc_v0",
      topology_mode: "fixed_envelope_slide",
      product_code: config.product_code,
      technology_profile: config.technology_profile,
      topo_group: topoKeys.group,
      axis,
      parameter: null,
      nominal: null,
      actual: null,
      delta: null,
      zone_inputs: {
        left: resolveTopoZoneInput(topoKeys, parameters, "LEC"),
        right: resolveTopoZoneInput(topoKeys, parameters, "REC")
      },
      trim_policy: topoKeys.trim_policy || null,
      trim_policy_status: topoKeys.trim_policy ? "declared_not_executed" : "none",
      entity_count: (Array.isArray(view.objects) ? view.objects : []).length,
      included_count: includedEntities.length,
      excluded_count: excludedEntities.length,
      moved_count: movedEntities.length,
      included_entities: includedEntities,
      excluded_entities: excludedEntities,
      moved_entities: movedEntities,
      skipped_topo_entities: skippedTopoEntities
    }
  };
}

function generateChildDxfTopoPoc(session, parameterSet) {
  const config = normalizeConfigParameterSet(parameterSet || DEFAULT_KSKR_EXECUTION_CHECK_PARAMETER_SET);
  const materialized = materializeChildDocumentTopoPoc(session, config);
  return {
    config_parameter_set: config,
    generation_summary: materialized.generation_summary,
    dxf_text: serializeDocument(materialized.document)
  };
}

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

function buildStandardGeometrySimulationMap(objects, parameters) {
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
      simulated_bbox: simulatedShapes.length ? bboxFromShapes(simulatedShapes) : (object?.bbox ? cloneJson(object.bbox) : null),
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
          simulatedShapeMap.set(
            `${reciprocal.object_id}:${reciprocal.shape_index}`,
            reciprocal.shape
          );
        }
      }
    }
  }

  for (const object of Array.isArray(objects) ? objects : []) {
    const preview = objectMap.get(object.id);
    if (!preview) continue;
    preview.simulated_bbox = preview.simulated_shapes.length
      ? bboxFromShapes(preview.simulated_shapes)
      : (object?.bbox ? cloneJson(object.bbox) : null);
  }

  return objectMap;
}

function quantileFromSorted(values, p) {
  if (!Array.isArray(values) || !values.length) return null;
  const index = Math.min(values.length - 1, Math.max(0, Math.floor((values.length - 1) * p)));
  const value = Number(values[index]);
  return Number.isFinite(value) ? value : null;
}

function bboxIntersects(a, b, margin = 0) {
  if (!a || !b) return false;
  return Number(a.maxX) >= Number(b.minX) - margin
    && Number(a.minX) <= Number(b.maxX) + margin
    && Number(a.maxY) >= Number(b.minY) - margin
    && Number(a.minY) <= Number(b.maxY) + margin;
}

function normalizeLineForEnvelope(shape, originalBBox, envelope, width, height) {
  if (!shape || shape.kind !== "line" || !originalBBox || !envelope) return shape;
  const x1 = Number(shape.x1);
  const y1 = Number(shape.y1);
  const x2 = Number(shape.x2);
  const y2 = Number(shape.y2);
  if (![x1, y1, x2, y2].every(Number.isFinite)) return shape;
  const horizontal = Math.abs(y1 - y2) <= 0.5;
  const vertical = Math.abs(x1 - x2) <= 0.5;
  const minX = Number(envelope.minX);
  const maxX = Number(envelope.maxX);
  const minY = Number(envelope.minY);
  const maxY = Number(envelope.maxY);
  const lineWidth = Number(originalBBox.maxX) - Number(originalBBox.minX);
  const lineHeight = Number(originalBBox.maxY) - Number(originalBBox.minY);
  const widthThreshold = Number(width) * 0.4;
  const heightThreshold = Number(height) * 0.4;

  if (horizontal && lineWidth >= widthThreshold) {
    if (Math.abs(Number(originalBBox.maxY) - maxY) <= 2 && Math.abs(Number(originalBBox.minY) - maxY) <= 2) {
      return { kind: "line", x1: minX, y1: maxY, x2: maxX, y2: maxY };
    }
    if (Math.abs(Number(originalBBox.maxY) - minY) <= 2 && Math.abs(Number(originalBBox.minY) - minY) <= 2) {
      return { kind: "line", x1: minX, y1: minY, x2: maxX, y2: minY };
    }
  }

  if (vertical && lineHeight >= heightThreshold) {
    if (Math.abs(Number(originalBBox.maxX) - minX) <= 2 && Math.abs(Number(originalBBox.minX) - minX) <= 2) {
      return { kind: "line", x1: minX, y1: minY, x2: minX, y2: maxY };
    }
    if (Math.abs(Number(originalBBox.maxX) - maxX) <= 15 && Math.abs(Number(originalBBox.minX) - maxX) <= 15) {
      return { kind: "line", x1: maxX, y1: minY, x2: maxX, y2: maxY };
    }
  }

  return shape;
}

function buildTopoPreviewEnvelope(objects) {
  const xs = [];
  const ys = [];
  for (const object of Array.isArray(objects) ? objects : []) {
    if (!object?.bbox) continue;
    if ([object.bbox.minX, object.bbox.maxX].every(Number.isFinite)) {
      xs.push(Number(object.bbox.minX), Number(object.bbox.maxX));
    }
    if ([object.bbox.minY, object.bbox.maxY].every(Number.isFinite)) {
      ys.push(Number(object.bbox.minY), Number(object.bbox.maxY));
    }
  }
  if (!xs.length || !ys.length) return null;
  xs.sort((a, b) => a - b);
  ys.sort((a, b) => a - b);
  const minX = quantileFromSorted(xs, 0.05);
  const maxX = quantileFromSorted(xs, 0.95);
  const minY = quantileFromSorted(ys, 0.05);
  const maxY = quantileFromSorted(ys, 0.95);
  if (![minX, maxX, minY, maxY].every(Number.isFinite)) return null;
  return { minX, maxX, minY, maxY };
}

function sustainFixedEnvelopeBoundaries(objectMap, objects, envelope) {
  if (!objectMap || !envelope) return;
  const width = Number(envelope.maxX) - Number(envelope.minX);
  const height = Number(envelope.maxY) - Number(envelope.minY);
  for (const object of Array.isArray(objects) ? objects : []) {
    const preview = objectMap.get(object.id);
    if (!preview || preview.applied_offset?.dx || preview.applied_offset?.dy) continue;
    preview.simulated_shapes = (Array.isArray(preview.simulated_shapes) ? preview.simulated_shapes : []).map((shape, index) => {
      const originalShape = Array.isArray(object.shapes) ? object.shapes[index] : null;
      if (!originalShape || originalShape.kind !== "line") return shape;
      return normalizeLineForEnvelope(shape, object.bbox, envelope, width, height);
    });
  }
}

function buildTopoGeometrySimulationMap(session, objects, parameters, topologyMode) {
  const topo = firstExecutableTopoComment(session);
  if (!topo) {
    return null;
  }
  const topoKeys = topo.keys || {};
  const axis = String(topoKeys.axis || "").trim().toUpperCase();
  if (String(topo.mode || "").trim() !== "fixed_envelope_slide" || axis !== "X") {
    return null;
  }

  const objectsList = Array.isArray(objects) ? objects : [];
  const objectDecisions = new Map();
  const objectMap = new Map();
  const simulatedShapeMap = new Map();
  const repairEnvelope = buildTopoPreviewEnvelope(objectsList);
  const repairOptions = {
    bounds: repairEnvelope,
    maxExtension: 30
  };

  for (const object of objectsList) {
    objectDecisions.set(object.id, evaluateChildEntityInclusion(object, parameters));
  }

  const includedObjects = objectsList.filter((object) => objectDecisions.get(object.id)?.included);
  const lineCandidates = collectLineCandidates(includedObjects);

  for (const object of objectsList) {
    const decision = objectDecisions.get(object.id);
    const originalShapes = cloneShapes(object?.shapes);
    const sourceEntity = findEntity(session.document, object.entity_id);
    const topoRole = decision?.included ? entityTopoRoleMetadata(sourceEntity) : null;
    const sameGroup = topoRole
      && String(topoRole.keys?.role || "").trim() === "mover"
      && String(topoRole.keys?.group || "").trim() === String(topoKeys.group || "").trim();
    const zone = sameGroup ? String(topoRole.keys?.zone || "").trim().toUpperCase() : null;
    const zoneInput = zone ? resolveTopoZoneInput(topoKeys, parameters, zone) : null;
    const factor = zone ? zoneDeltaFactor(topoKeys, zone) : null;
    const dx = zoneInput && Number.isFinite(zoneInput.delta) && Number.isFinite(factor)
      ? Number(zoneInput.delta) * factor
      : 0;
    const dy = 0;
    const objectLinePairing = [];
    const simulatedShapes = originalShapes.map((shape, shapeIndex) => {
      const translatedShape = translateShape(shape, dx, dy);
      simulatedShapeMap.set(`${object.id}:${shapeIndex}`, translatedShape);
      return translatedShape;
    });
    objectMap.set(object.id, {
      geometry_simulation_mode: `topology_mode:${topologyMode}_line_repair_v1`,
      simulated_shapes: simulatedShapes,
      simulated_bbox: simulatedShapes.length ? bboxFromShapes(simulatedShapes) : (object?.bbox ? cloneJson(object.bbox) : null),
      applied_offset: { dx, dy },
      render_visible: repairEnvelope ? bboxIntersects(object?.bbox, repairEnvelope, 15) : true,
      topo_zone: zone,
      topo_group: topoRole?.keys?.group || null,
      topo_reference: zoneInput ? {
        parameter: zoneInput.parameter,
        nominal: zoneInput.nominal,
        actual: zoneInput.actual,
        delta: zoneInput.delta,
        factor
      } : null,
      line_pairing: objectLinePairing
    });
  }

  for (const object of includedObjects) {
    const preview = objectMap.get(object.id);
    if (!preview || !preview.applied_offset || (!preview.applied_offset.dx && !preview.applied_offset.dy)) {
      continue;
    }
    for (let index = 0; index < preview.simulated_shapes.length; index += 1) {
      const originalShape = object?.shapes?.[index];
      const translatedShape = preview.simulated_shapes[index];
      if (!originalShape || originalShape.kind !== "line") continue;
      const resolved = applyTrimRejoinToTranslatedLine(
        originalShape,
        translatedShape,
        lineCandidates,
        { object_id: object.id, shape_index: index },
        simulatedShapeMap,
        repairOptions
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
          simulatedShapeMap.set(
            `${reciprocal.object_id}:${reciprocal.shape_index}`,
            reciprocal.shape
          );
        }
      }
    }
  }

  sustainFixedEnvelopeBoundaries(objectMap, objectsList, repairEnvelope);

  for (const object of objectsList) {
    const preview = objectMap.get(object.id);
    if (!preview) continue;
    preview.simulated_bbox = preview.simulated_shapes.length
      ? bboxFromShapes(preview.simulated_shapes)
      : (object?.bbox ? cloneJson(object.bbox) : null);
  }

  return objectMap;
}

function buildIdentityGeometrySimulation(object, topologyMode) {
  return {
    geometry_simulation_mode: topologyMode ? `topology_mode:${topologyMode}` : "none_topology_identity",
    simulated_shapes: cloneShapes(object?.shapes),
    simulated_bbox: object?.bbox ? cloneJson(object.bbox) : null
  };
}

function simulateChildPreview(session) {
  const view = projectViewModel(session);
  const config = normalizeConfigParameterSet(session.config_parameter_set);
  const topoRuntime = view.topo_metadata && view.topo_metadata.runtime_model
    ? view.topo_metadata.runtime_model
    : null;
  const topologyMode = topoRuntime?.mode || "none";
  const standardSimulationMap = topologyMode === "none"
    ? buildStandardGeometrySimulationMap(view.objects, config.parameters)
    : null;
  const topoSimulationMap = topologyMode !== "none"
    ? buildTopoGeometrySimulationMap(session, view.objects, config.parameters, topologyMode)
    : null;
  const activeSimulationMap = topologyMode === "none" ? standardSimulationMap : topoSimulationMap;
  const documentRuleExecution = applyDocumentRulesToSimulationMap(
    session,
    view.objects,
    config.parameters,
    activeSimulationMap,
    topologyMode
  );
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
    const geometryPreview = topologyMode === "none"
      ? (standardSimulationMap && standardSimulationMap.get(object.id)) || buildIdentityGeometrySimulation(object, topologyMode)
      : (topoSimulationMap && topoSimulationMap.get(object.id)) || buildIdentityGeometrySimulation(object, topologyMode);
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
        topology_mode: topologyMode,
        included: aggregated.included,
        exclusion_reason: aggregated.exclusion_reason,
        geometry_ops: aggregated.geometry_ops,
        geometry_simulation_mode: geometryPreview.geometry_simulation_mode,
        simulated_shapes: geometryPreview.simulated_shapes,
        simulated_bbox: geometryPreview.simulated_bbox,
        applied_offset: geometryPreview.applied_offset || null,
        reference_deltas: geometryPreview.reference_deltas || null,
        render_visible: geometryPreview.render_visible !== false,
        line_pairing: geometryPreview.line_pairing || [],
        document_rule_actions: geometryPreview.document_rule_actions || [],
        preview_actions,
        ready_for_child_planning: object.classification_state === "classified" && Boolean(object.primary_layer)
      }
    };
  });

  return {
    session_id: session.session_id,
    technology_profile: config.technology_profile,
    product_code: config.product_code,
    topology_mode: topologyMode,
    config_parameter_set: config,
    items,
    summary: {
      object_count: items.length,
      classified_count: items.filter((item) => item.classification_state === "classified").length,
      sem_bound_count: items.filter((item) => (item.semantic_metadata?.raw_comments || []).length > 0).length,
      document_rules_applied: documentRuleExecution.applied_rules || []
    }
  };
}

function runExecutionCheck(session, configParameterSet) {
  const view = projectViewModel(session);
  const config = normalizeConfigParameterSet(configParameterSet || DEFAULT_KSKR_EXECUTION_CHECK_PARAMETER_SET);
  const execution_summary = (Array.isArray(view.objects) ? view.objects : [])
    .map((object) => buildEntityExecutionSummary(object, config.parameters))
    .sort((a, b) => String(a.entity_id || "").localeCompare(String(b.entity_id || ""), undefined, { numeric: true }));
  return {
    session_id: session.session_id,
    technology_profile: config.technology_profile,
    product_code: config.product_code,
    parameters: cloneJson(config.parameters),
    execution_summary
  };
}

async function createSession({ dxfText, sourceName, bands, storeRoot }) {
  const normalizedSourceName = String(sourceName || "mother_dxf_input.dxf");
  const nowIso = new Date().toISOString();
  const existingSessions = await listSessions({ rootDir: storeRoot || defaultRoot() });
  const matchingSessions = existingSessions
    .filter((item) => String(item?.source_name || "").trim() === normalizedSourceName)
    .sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
  const currentSession = matchingSessions[0] || null;
  const preserveCustomTitle = currentSession && !titleLooksLikeDefault(currentSession.title, currentSession.source_name);
  if (currentSession && sessionHasAuthoringState(currentSession)) {
    currentSession.bands = normalizeBands(bands);
    currentSession.updated_at = nowIso;
    currentSession.title = preserveCustomTitle
      ? normalizeSessionTitle(currentSession.title, defaultSessionTitleForSource(normalizedSourceName))
      : defaultSessionTitleForSource(normalizedSourceName);
    currentSession.source_name = normalizedSourceName;
    currentSession.status = normalizeSessionStatus(currentSession.status || "draft");
    currentSession.parameter_catalog = normalizeParameterCatalogSnapshot(currentSession.parameter_catalog);
    currentSession.rule_catalog = normalizeRuleCatalogSnapshot(currentSession.rule_catalog);
    currentSession.xdata_assignments = normalizeXdataAssignments(currentSession.document, currentSession.xdata_assignments);
    projectViewModel(currentSession);
    await saveSession({ rootDir: storeRoot || defaultRoot(), session: currentSession });
    for (const duplicate of matchingSessions.slice(1)) {
      await deleteSession({ rootDir: storeRoot || defaultRoot(), sessionId: duplicate.session_id });
    }
    return {
      session: currentSession,
      action: "reused_existing_preserved"
    };
  }

  const document = sanitizeDocument(dxfText);
  const importedXdataAssignments = hoistMotherXdataFromDocument(document);
  const session = {
    session_id: currentSession?.session_id || crypto.randomUUID(),
    use_case: "mother_dxf_v1",
    created_at: currentSession?.created_at || nowIso,
    updated_at: nowIso,
    title: preserveCustomTitle
      ? normalizeSessionTitle(currentSession.title, defaultSessionTitleForSource(normalizedSourceName))
      : defaultSessionTitleForSource(normalizedSourceName),
    status: "draft",
    artifact_state: "sanitized",
    source_name: normalizedSourceName,
    bands: normalizeBands(bands),
    config_parameter_set: cloneJson(DEFAULT_CONFIG_PARAMETER_SET),
    parameter_catalog: cloneJson(DEFAULT_PARAMETER_CATALOG),
    rule_catalog: cloneJson(DEFAULT_RULE_CATALOG),
    topo_comments: extractTopoCommentsFromDxfText(dxfText),
    assignments: {},
    xdata_assignments: normalizeXdataAssignments(document, importedXdataAssignments),
    document
  };
  projectViewModel(session);
  await saveSession({ rootDir: storeRoot || defaultRoot(), session });
  for (const duplicate of matchingSessions.slice(1)) {
    await deleteSession({ rootDir: storeRoot || defaultRoot(), sessionId: duplicate.session_id });
  }
  return {
    session,
    action: currentSession ? "refreshed_existing" : "created_new"
  };
}

async function getSession({ sessionId, storeRoot }) {
  const session = await loadSession({ rootDir: storeRoot || defaultRoot(), sessionId });
  const importedXdataAssignments = hoistMotherXdataFromDocument(session.document);
  session.title = normalizeSessionTitle(session.title, defaultSessionTitleForSource(session.source_name));
  session.status = normalizeSessionStatus(session.status || "draft");
  session.topo_comments = normalizeTopoCommentsInput(session.topo_comments);
  session.parameter_catalog = normalizeParameterCatalogSnapshot(session.parameter_catalog);
  session.rule_catalog = normalizeRuleCatalogSnapshot(session.rule_catalog);
  session.xdata_assignments = normalizeXdataAssignments(session.document, {
    ...importedXdataAssignments,
    ...(session.xdata_assignments || {})
  });
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

async function updateDocumentSemMetadata({ sessionId, payload, storeRoot }) {
  const session = await getSession({ sessionId, storeRoot });
  const rawComment = buildDocumentSemIdentityComment(payload);
  const ruleRefs = normalizeDocumentSemRuleRefs(payload?.rule_refs);
  const ruleComments = ruleRefs.map((ruleRef) => buildDocumentSemRuleComment(ruleRef));
  const documentComments = Array.isArray(session.document?.preComments) ? session.document.preComments : [];
  const nextDocumentComments = documentComments
    .filter((pair) => !(String(pair?.code) === "999" && isDocumentSemanticComment(pair.value)));
  const firstTopoIndex = nextDocumentComments.findIndex((pair) => String(pair?.code) === "999" && isFileLevelTopoComment(pair.value));
  const semPairs = [
    { code: "999", value: rawComment },
    ...ruleComments.map((value) => ({ code: "999", value }))
  ];
  if (firstTopoIndex >= 0) {
    nextDocumentComments.splice(firstTopoIndex, 0, ...semPairs);
  } else {
    nextDocumentComments.unshift(...semPairs);
  }
  session.document.preComments = nextDocumentComments;

  for (const entity of session.document?.entities || []) {
    const comments = Array.isArray(entity.preComments) ? entity.preComments : [];
    entity.preComments = comments.filter((pair) => !(String(pair?.code) === "999" && isDocumentSemanticComment(pair.value)));
  }
  for (const block of session.document?.blocks || []) {
    for (const entity of block.entities || []) {
      const comments = Array.isArray(entity.preComments) ? entity.preComments : [];
      entity.preComments = comments.filter((pair) => !(String(pair?.code) === "999" && isDocumentSemanticComment(pair.value)));
    }
  }

  session.updated_at = new Date().toISOString();
  session.artifact_state = "mother_draft";
  await saveSession({ rootDir: storeRoot || defaultRoot(), session });
  return session;
}

async function updateTopoMetadata({ sessionId, topoText, storeRoot }) {
  const session = await getSession({ sessionId, storeRoot });
  const rawComment = upsertFileLevelTopoComment(session, topoText);
  session.topo_comments = [rawComment];
  session.updated_at = new Date().toISOString();
  session.artifact_state = "mother_draft";
  await saveSession({ rootDir: storeRoot || defaultRoot(), session });
  return session;
}

async function updateEntityTopoRoleMetadata({ sessionId, entityId, role, group, zone, storeRoot }) {
  const session = await getSession({ sessionId, storeRoot });
  const rawComment = buildEntityTopoRoleComment({ role, group, zone });
  upsertEntityTopoComment(session, entityId, rawComment);
  session.updated_at = new Date().toISOString();
  session.artifact_state = "mother_draft";
  await saveSession({ rootDir: storeRoot || defaultRoot(), session });
  return {
    session,
    topo_comment: rawComment || null
  };
}

async function updateSessionMeta({ sessionId, title, status, storeRoot }) {
  const session = await getSession({ sessionId, storeRoot });
  if (title !== undefined) {
    session.title = normalizeSessionTitle(title, defaultSessionTitleForSource(session.source_name));
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

async function updateEntityXdataMetadata({ sessionId, entityIds, value, previousValue, storeRoot }) {
  const session = await getSession({ sessionId, storeRoot });
  const normalizedIds = Array.from(new Set((Array.isArray(entityIds) ? entityIds : []).map((entityId) => String(entityId || "").trim()).filter(Boolean)));
  if (!normalizedIds.length) {
    throw new Error("Select one or more entities before assigning XDATA.");
  }
  for (const entityId of normalizedIds) {
    if (!findEntity(session.document, entityId)) {
      throw new Error(`Unknown entity id: ${entityId}`);
    }
  }
  session.xdata_assignments = normalizeXdataAssignments(session.document, session.xdata_assignments);
  const nextValue = normalizeXdataValue(value);
  const previousGroupValue = normalizeXdataValue(previousValue);
  if (previousGroupValue) {
    for (const [entityId, assignment] of Object.entries(session.xdata_assignments || {})) {
      if (normalizeXdataValue(assignment?.value) !== previousGroupValue) continue;
      if (normalizedIds.includes(entityId)) continue;
      delete session.xdata_assignments[entityId];
    }
  }
  for (const entityId of normalizedIds) {
    if (nextValue) {
      session.xdata_assignments[entityId] = {
        app: MOTHER_XDATA_APP_NAME,
        value: nextValue
      };
    } else {
      delete session.xdata_assignments[entityId];
    }
  }
  session.updated_at = new Date().toISOString();
  session.artifact_state = "mother_draft";
  await saveSession({ rootDir: storeRoot || defaultRoot(), session });
  return {
    session,
    xdata_value: nextValue || null,
    previous_value: previousGroupValue || null,
    affected_entity_ids: normalizedIds
  };
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

async function persistSessionConfigParameterSet(session, parameterSet, storeRoot) {
  if (!parameterSet || isEmptyConfigParameterSetInput(parameterSet)) {
    return normalizeConfigParameterSet(session.config_parameter_set);
  }
  const config = normalizeConfigParameterSet(parameterSet);
  session.config_parameter_set = config;
  session.updated_at = new Date().toISOString();
  await saveSession({ rootDir: storeRoot || defaultRoot(), session });
  return config;
}

async function runKskrExecutionCheck({ sessionId, parameterSet, storeRoot }) {
  const session = await getSession({ sessionId, storeRoot });
  return {
    session,
    execution_check: runExecutionCheck(session, {
      technology_profile: "OPS_S4P4",
      product_code: "KSKR",
      parameters: {
        ...DEFAULT_KSKR_EXECUTION_CHECK_PARAMETER_SET.parameters,
        ...(parameterSet && typeof parameterSet === "object" ? parameterSet : {})
      }
    })
  };
}

async function generateChildDxfNoTopoForSession({ sessionId, parameterSet, storeRoot }) {
  const session = await getSession({ sessionId, storeRoot });
  const config = await persistSessionConfigParameterSet(session, parameterSet, storeRoot);
  const result = generateChildDxfNoTopo(session, config);
  const childInfo = await saveChildExport({
    rootDir: storeRoot || defaultRoot(),
    sessionId,
    dxfText: result.dxf_text,
    suffix: "child_no_topo"
  });
  return {
    session,
    ...result,
    child_file: childInfo.filePath
  };
}

async function generateChildDxfTopoPocForSession({ sessionId, parameterSet, storeRoot }) {
  const session = await getSession({ sessionId, storeRoot });
  const config = await persistSessionConfigParameterSet(session, parameterSet, storeRoot);
  const result = generateChildDxfTopoPoc(session, config);
  const childInfo = await saveChildExport({
    rootDir: storeRoot || defaultRoot(),
    sessionId,
    dxfText: result.dxf_text,
    suffix: "child_topo_poc"
  });
  return {
    session,
    ...result,
    child_file: childInfo.filePath
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
  updateDocumentSemMetadata,
  updateTopoMetadata,
  updateEntityTopoRoleMetadata,
  updateSessionMeta,
  authorSemanticMetadata,
  clearSemanticMetadata,
  updateEntityXdataMetadata,
  simulateSession,
  runKskrExecutionCheck,
  generateChildDxfNoTopo,
  generateChildDxfNoTopoForSession,
  generateChildDxfTopoPoc,
  generateChildDxfTopoPocForSession,
  validateMotherDraft,
  exportMotherDraft,
  projectViewModel,
  serializeCurrentMotherDraft,
  serializeDocument,
  parseDocumentSem,
  collectDocumentSemMetadata,
  upsertFileLevelTopoComment,
  upsertEntityTopoComment,
  parseTopoComment,
  collectTopoMetadata,
  validateTopoBlock,
  normalizeTopoRuntimeModel
};
