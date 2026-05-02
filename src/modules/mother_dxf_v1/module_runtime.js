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
  bboxCenter,
  translateShape,
  bboxFromShapes,
  lineLineIntersection,
  trimLineToPoint
} = require("../../core_shell/geometry");
const {
  defaultRoot,
  saveSession,
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
  const raw = String(rawClause || "").trim();
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

function formatDocumentSemNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return Number.isInteger(numeric) ? String(numeric) : String(numeric);
}

function buildDocumentSemComment(payload) {
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
  const parsed = parseDocumentSem(parsedDocument);
  if (!parsed) return null;
  const keys = parsed.keys || {};
  const nominalWidth = Number(keys.nominal_width);
  const nominalHeight = Number(keys.nominal_height);
  return {
    nominal_width: Number.isFinite(nominalWidth) ? nominalWidth : null,
    nominal_height: Number.isFinite(nominalHeight) ? nominalHeight : null,
    family: keys.family || null,
    product: keys.product || null,
    part: keys.part || null,
    raw_comment: parsed.raw_comment,
    validation: parsed.validation
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
    parameter_catalog: cloneJson(session.parameter_catalog || DEFAULT_PARAMETER_CATALOG),
    rule_catalog: cloneJson(session.rule_catalog || DEFAULT_RULE_CATALOG),
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
  return document;
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

function cloneShapes(shapes) {
  return JSON.parse(JSON.stringify(Array.isArray(shapes) ? shapes : []));
}

function lineShapeToPoints(shape) {
  if (!shape || shape.kind !== "line") return null;
  const x1 = Number(shape.x1);
  const y1 = Number(shape.y1);
  const x2 = Number(shape.x2);
  const y2 = Number(shape.y2);
  if (![x1, y1, x2, y2].every(Number.isFinite)) return null;
  return {
    startPoint: { x: x1, y: y1 },
    endPoint: { x: x2, y: y2 }
  };
}

function linePointsToShape(line) {
  if (!line || !line.startPoint || !line.endPoint) return null;
  return {
    kind: "line",
    x1: Number(line.startPoint.x),
    y1: Number(line.startPoint.y),
    x2: Number(line.endPoint.x),
    y2: Number(line.endPoint.y)
  };
}

function lineOrientation(line, tolerance = 0.001) {
  const x1 = Number(line?.startPoint?.x);
  const y1 = Number(line?.startPoint?.y);
  const x2 = Number(line?.endPoint?.x);
  const y2 = Number(line?.endPoint?.y);
  if (![x1, y1, x2, y2].every(Number.isFinite)) return null;
  const dx = Math.abs(x2 - x1);
  const dy = Math.abs(y2 - y1);
  if (dx <= tolerance && dy <= tolerance) return null;
  if (dx <= tolerance) return "vertical";
  if (dy <= tolerance) return "horizontal";
  return dx >= dy ? "horizontal" : "vertical";
}

function pointsOverlap(a, b, tolerance = 0.001) {
  const ax = Number(a?.x);
  const ay = Number(a?.y);
  const bx = Number(b?.x);
  const by = Number(b?.y);
  if (![ax, ay, bx, by].every(Number.isFinite)) return false;
  return Math.abs(ax - bx) <= tolerance && Math.abs(ay - by) <= tolerance;
}

function collectLineCandidates(objects) {
  return (Array.isArray(objects) ? objects : []).flatMap((object) => {
    return (Array.isArray(object.shapes) ? object.shapes : [])
      .map((shape, index) => ({ shape, index }))
      .filter((entry) => entry.shape && entry.shape.kind === "line")
      .map((entry) => ({
        object_id: object.id,
        entity_id: object.entity_id,
        primary_layer: object.primary_layer,
        shape_index: entry.index,
        line: lineShapeToPoints(entry.shape)
      }))
      .filter((entry) => entry.line);
  });
}

function resolveSlidingLineVertexPairing(originalLineShape, lineCandidates, selfRef, vertexName) {
  const originalLine = lineShapeToPoints(originalLineShape);
  const originalOrientation = lineOrientation(originalLine);
  const targetVertex = vertexName === "end" ? "end" : "start";
  if (!originalLine) {
    return {
      status: "invalid_line",
      candidate: null,
      paired_vertex: targetVertex,
      candidate_vertex: null
    };
  }

  const matches = [];
  for (const candidate of Array.isArray(lineCandidates) ? lineCandidates : []) {
    if (
      candidate &&
      selfRef &&
      candidate.object_id === selfRef.object_id &&
      candidate.shape_index === selfRef.shape_index
    ) {
      continue;
    }
    const candidateLine = candidate.line;
    if (!candidateLine) continue;
    if (targetVertex === "start" && pointsOverlap(originalLine.startPoint, candidateLine.startPoint)) {
      matches.push({
        paired_vertex: "start",
        candidate_vertex: "start",
        candidate_orientation: lineOrientation(candidateLine),
        candidate
      });
    }
    if (targetVertex === "start" && pointsOverlap(originalLine.startPoint, candidateLine.endPoint)) {
      matches.push({
        paired_vertex: "start",
        candidate_vertex: "end",
        candidate_orientation: lineOrientation(candidateLine),
        candidate
      });
    }
    if (targetVertex === "end" && pointsOverlap(originalLine.endPoint, candidateLine.startPoint)) {
      matches.push({
        paired_vertex: "end",
        candidate_vertex: "start",
        candidate_orientation: lineOrientation(candidateLine),
        candidate
      });
    }
    if (targetVertex === "end" && pointsOverlap(originalLine.endPoint, candidateLine.endPoint)) {
      matches.push({
        paired_vertex: "end",
        candidate_vertex: "end",
        candidate_orientation: lineOrientation(candidateLine),
        candidate
      });
    }
  }

  if (!matches.length) {
    return {
      status: "none",
      candidate: null,
      paired_vertex: targetVertex,
      candidate_vertex: null
    };
  }

  const perpendicularMatches = originalOrientation
    ? matches.filter((item) => item.candidate_orientation && item.candidate_orientation !== originalOrientation)
    : [];
  const effectiveMatches = perpendicularMatches.length ? perpendicularMatches : matches;

  const uniqueMatches = new Set(effectiveMatches.map((item) => `${item.paired_vertex}:${item.candidate_vertex}:${item.candidate.object_id}:${item.candidate.shape_index}`));
  if (uniqueMatches.size > 1) {
    return {
      status: "unresolved",
        candidate: null,
        paired_vertex: targetVertex,
        candidate_vertex: null
    };
  }

  return {
    status: "paired",
    candidate: effectiveMatches[0].candidate,
    paired_vertex: effectiveMatches[0].paired_vertex,
    candidate_vertex: effectiveMatches[0].candidate_vertex
  };
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

function buildReciprocalTrim(pairing, simulatedShapeMap, intersection) {
  const candidateRef = pairing.candidate
    ? `${pairing.candidate.object_id}:${pairing.candidate.shape_index}`
    : null;
  const candidateShape = candidateRef ? simulatedShapeMap.get(candidateRef) : null;
  const candidateLine = lineShapeToPoints(candidateShape);
  if (!candidateLine) return null;
  const reciprocalTrimmed = trimLineToPoint(
    candidateLine,
    intersection,
    pairing.candidate_vertex === "start" ? "end" : "start"
  );
  return reciprocalTrimmed
    ? {
        object_id: pairing.candidate.object_id,
        shape_index: pairing.candidate.shape_index,
        shape: linePointsToShape(reciprocalTrimmed),
        entity_id: pairing.candidate.entity_id
      }
    : null;
}

function applyTrimRejoinToTranslatedLine(originalLineShape, translatedLineShape, lineCandidates, selfRef, simulatedShapeMap) {
  const pairings = [
    resolveSlidingLineVertexPairing(originalLineShape, lineCandidates, selfRef, "start"),
    resolveSlidingLineVertexPairing(originalLineShape, lineCandidates, selfRef, "end")
  ];
  let currentLine = lineShapeToPoints(translatedLineShape);
  if (!currentLine) {
    return {
      shape: translatedLineShape,
      pairings,
      reciprocals: []
    };
  }

  const resolvedPairings = [];
  const reciprocals = [];
  for (const pairing of pairings) {
    if (pairing.status !== "paired") {
      resolvedPairings.push(pairing);
      continue;
    }
    const candidateRef = pairing.candidate
      ? `${pairing.candidate.object_id}:${pairing.candidate.shape_index}`
      : null;
    const candidateShape = candidateRef ? simulatedShapeMap.get(candidateRef) : null;
    const candidateLine = lineShapeToPoints(candidateShape);
    if (!candidateLine) {
      resolvedPairings.push({
        ...pairing,
        status: "unresolved"
      });
      continue;
    }
    const intersection = lineLineIntersection(currentLine, candidateLine);
    if (!intersection) {
      resolvedPairings.push({
        ...pairing,
        status: "unresolved"
      });
      continue;
    }
    const trimmed = trimLineToPoint(
      currentLine,
      intersection,
      pairing.paired_vertex === "start" ? "end" : "start"
    );
    if (!trimmed) {
      resolvedPairings.push({
        ...pairing,
        status: "unresolved"
      });
      continue;
    }
    currentLine = trimmed;
    resolvedPairings.push({
      ...pairing,
      intersection
    });
    const reciprocal = buildReciprocalTrim(pairing, simulatedShapeMap, intersection);
    if (reciprocal) reciprocals.push(reciprocal);
  }

  return {
    shape: linePointsToShape(currentLine) || translatedLineShape,
    pairings: resolvedPairings,
    reciprocals
  };
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
      : buildIdentityGeometrySimulation(object, topologyMode);
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
        line_pairing: geometryPreview.line_pairing || [],
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
      sem_bound_count: items.filter((item) => (item.semantic_metadata?.raw_comments || []).length > 0).length
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
    topo_comments: extractTopoCommentsFromDxfText(dxfText),
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
  session.topo_comments = normalizeTopoCommentsInput(session.topo_comments);
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
  const rawComment = buildDocumentSemComment(payload);
  const documentComments = Array.isArray(session.document?.preComments) ? session.document.preComments : [];
  session.document.preComments = documentComments
    .filter((pair) => !(String(pair?.code) === "999" && isDocumentSemanticComment(pair.value)))
    .concat([{ code: "999", value: rawComment }]);

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
  session.topo_comments = normalizeTopoCommentsInput(topoText);
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
  const result = generateChildDxfNoTopo(session, parameterSet);
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
  updateSessionMeta,
  authorSemanticMetadata,
  clearSemanticMetadata,
  simulateSession,
  runKskrExecutionCheck,
  generateChildDxfNoTopo,
  generateChildDxfNoTopoForSession,
  validateMotherDraft,
  exportMotherDraft,
  projectViewModel,
  serializeDocument,
  parseDocumentSem,
  collectDocumentSemMetadata,
  parseTopoComment,
  collectTopoMetadata,
  validateTopoBlock,
  normalizeTopoRuntimeModel
};
