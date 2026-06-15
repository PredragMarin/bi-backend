"use strict";

if (process.env.MOTHER_IO_LEGACY_DISABLED === "1") {
  throw new Error(
    "Legacy Mother DXF I/O path is DISABLED. " +
    "All durable I/O MUST go through src/core_shell/io/mother_dxf/* adapters."
  );
}

const crypto = require("crypto");
const path = require("path");
const {
  ALLOWED_PRIMARY_LAYERS,
  sanitizeDocument,
  reindexDocumentSources,
  serializeDocument,
  listRelevantObjects,
  applyPrimaryLayer,
  pairValue
} = require("../../core_shell/dxf");
const {
  roundNumber,
  bboxUnion,
  bboxCenter,
  translateShape,
  bboxFromShapes,
  transformPoint,
  arcEndpoints,
  lineLineIntersection,
  trimLineToPoint
} = require("../../core_shell/geometry");
const {
  collectLineCandidates,
  applyTrimRejoinToTranslatedLine
} = require("../../core_shell/services/dxf_line_repair_service");
const {
  runFourBandParameterResizeShadowPreview,
  runResolverPreview,
  branchModeFromConfigParameterSet: coreBranchModeFromConfigParameterSet,
  filterResolverObjectsByBranchMode: coreFilterObjectsByBranchMode,
  normalizeResolverBranchMode: coreNormalizeBranchMode,
  resolverBranchMetadataMatchesMode: coreBranchMetadataMatchesMode,
  resolverRuleMatchesGeometryBranch: coreRuleMatchesGeometryBranch
} = require("../../core_shell/services/dxf_resolver_service");
const {
  buildSanitizeReview
} = require("../../core_shell/services/dxf_geometry_hygiene_service");
const {
  defaultRoot,
  saveExport,
  saveChildExport,
  saveRawDxf,
  saveRuleCatalogSnapshot,
  saveChildDxf
} = require("../../core_shell/storage/mother_dxf_store");
const { appendEvent } = require("../../core_shell/io/mother_dxf/events/event_stream");
const { writeChildMetadata } = require("../../core_shell/io/mother_dxf/child/child_metadata");
const { savePreview } = require("../../core_shell/io/mother_dxf/preview/preview_io");
const { saveParamSet } = require("../../core_shell/io/mother_dxf/catalogs/param_set");
const {
  saveSessionEnvelope,
  loadSessionEnvelope,
  deleteSessionEnvelope,
  listSessionEnvelopes,
  saveMotherJson
} = require("../../core_shell/io/mother_dxf/session/session_store");
const { buildSessionStorageKey } = require("../../core_shell/io/mother_dxf/session/session_locator");
const {
  registerArtifact,
  loadArtifactRegistry,
  resolveArtifactPath
} = require("../../core_shell/io/mother_dxf/session/artifact_registry");
// Session persistence is envelope-backed; runtime code intentionally reads/writes legacy payloads.
async function saveSession({ rootDir, session }) {
  return saveSessionEnvelope(session.session_id, session, rootDir);
}

async function loadSession({ rootDir, sessionId }) {
  return loadSessionEnvelope(sessionId, rootDir);
}

async function deleteSession({ rootDir, sessionId }) {
  return deleteSessionEnvelope(sessionId, rootDir);
}

async function listSessions({ rootDir }) {
  return listSessionEnvelopes(rootDir);
}

const DEFAULT_PARAMETER_CATALOG = require("./contracts/parameter_catalog_legacy_door_v0.json");
const PARAMETER_CATALOG_INOX_V0 = require("./contracts/parameter_catalog_inox_v0.json");
const DEFAULT_RULE_CATALOG = require("./contracts/rule_catalog_mxd_door_v0.json");
const RULE_CATALOG_INOX_SUD_SPLO_V0 = require("./contracts/rule_catalog_inox_sud_splo_v0.json");
const NOMINAL_VALUE_SET_MXD_V0 = require("./contracts/nominal_value_set_mxd_v0.json");
const NOMINAL_VALUE_SET_INOX_SUDOPERI_DUMMY_V0 = require("./contracts/nominal_value_set_inox_sudoperi_dummy_v0.json");
const NOMINAL_VALUE_SET_INOX_SUD_SPLO_DUMMY_V0 = require("./contracts/nominal_value_set_inox_sud_splo_dummy_v0.json");
const PARAMETER_CATALOG_REGISTRY = {
  [String(DEFAULT_PARAMETER_CATALOG.catalog_id || "").trim()]: DEFAULT_PARAMETER_CATALOG,
  [String(PARAMETER_CATALOG_INOX_V0.catalog_id || "").trim()]: PARAMETER_CATALOG_INOX_V0
};
const RULE_CATALOG_REGISTRY = {
  [String(DEFAULT_RULE_CATALOG.catalog_id || "").trim()]: DEFAULT_RULE_CATALOG,
  [String(RULE_CATALOG_INOX_SUD_SPLO_V0.catalog_id || "").trim()]: RULE_CATALOG_INOX_SUD_SPLO_V0
};
const NOMINAL_VALUE_SET_REGISTRY = {
  [String(NOMINAL_VALUE_SET_MXD_V0.nominal_value_set_id || "").trim()]: NOMINAL_VALUE_SET_MXD_V0,
  [String(NOMINAL_VALUE_SET_INOX_SUDOPERI_DUMMY_V0.nominal_value_set_id || "").trim()]: NOMINAL_VALUE_SET_INOX_SUDOPERI_DUMMY_V0,
  [String(NOMINAL_VALUE_SET_INOX_SUD_SPLO_DUMMY_V0.nominal_value_set_id || "").trim()]: NOMINAL_VALUE_SET_INOX_SUD_SPLO_DUMMY_V0
};
const CHILD_DXF_999_SET_MXD = require("./contracts/child_dxf_999_set_mxd_v1.json");
const CHILD_DXF_999_SET_INOX = require("./contracts/child_dxf_999_set_inox_v1.json");
const DOMAIN_AWARE_REGISTRY = require("./contracts/motherfile_domain_aware_registry_v1.json");

const DEFAULT_BANDS = {
  left: 80,
  right: 80,
  top: 80,
  bottom: 80
};

const GEOMETRY_SLOT_WIDTH_MM = 3000;

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

const DEFAULT_CONFIG_CONTEXT = {
  family: "VRATA",
  product: "PPV",
  part: "",
  technology_profile: "OPS_S4P4"
};

function inferPartFromSourceName(sourceName) {
  const baseName = String(sourceName || "")
    .trim()
    .replace(/\.[^.]+$/, "")
    .split(/[\s_-]+/)[0]
    .trim()
    .toUpperCase();
  return /^[A-Z]+$/.test(baseName) ? baseName : "";
}

function defaultConfigContextForSource(sourceName, overrides = {}) {
  const sourcePart = inferPartFromSourceName(sourceName);
  const source = overrides && typeof overrides === "object" ? overrides : {};
  return {
    ...DEFAULT_CONFIG_CONTEXT,
    ...source,
    part: String(source.part || sourcePart || DEFAULT_CONFIG_CONTEXT.part || "").trim()
  };
}

function scopeListIncludes(value, expected) {
  const normalizedExpected = String(expected || "").trim().toUpperCase();
  if (!normalizedExpected) return true;
  if (value == null) return true;
  const list = Array.isArray(value) ? value : [value];
  return list.some((item) => {
    const normalized = String(item || "").trim().toUpperCase();
    return normalized === "*" || normalized === normalizedExpected;
  });
}

function catalogParameterAppliesToContext(parameter, context = {}) {
  const scope = parameter && typeof parameter.scope === "object" ? parameter.scope : null;
  if (!scope) return true;
  const family = scope.family ?? scope.families;
  return scopeListIncludes(family, context.family)
    && scopeListIncludes(scope.products, context.product)
    && scopeListIncludes(scope.parts, context.part);
}

function catalogParameterDefaultValue(parameter) {
  if (!parameter || typeof parameter !== "object") return undefined;
  if (Object.prototype.hasOwnProperty.call(parameter, "default")) return cloneJson(parameter.default);
  if (String(parameter.type || "").trim().toLowerCase() === "number") {
    const min = Number(parameter.min);
    const max = Number(parameter.max);
    if (Number.isFinite(min) && Number.isFinite(max)) return roundNumber((min + max) / 2, 3);
    if (Number.isFinite(min)) return min;
    return 0;
  }
  if (Array.isArray(parameter.values) && parameter.values.length) return parameter.values[0];
  return undefined;
}

function buildDefaultConfigFromParameterCatalog(catalogInput, context = {}) {
  const catalog = normalizeParameterCatalogSnapshot(catalogInput || DEFAULT_PARAMETER_CATALOG);
  const effectiveContext = {
    ...DEFAULT_CONFIG_CONTEXT,
    ...(context && typeof context === "object" ? context : {})
  };
  const parameters = {};
  for (const [key, parameter] of Object.entries(catalog.parameters || {})) {
    if (!catalogParameterAppliesToContext(parameter, effectiveContext)) continue;
    const value = catalogParameterDefaultValue(parameter);
    if (value !== undefined) parameters[key] = value;
  }
  return {
    technology_profile: String(effectiveContext.technology_profile || DEFAULT_CONFIG_CONTEXT.technology_profile),
    family: String(effectiveContext.family || DEFAULT_CONFIG_CONTEXT.family),
    product: String(effectiveContext.product || DEFAULT_CONFIG_CONTEXT.product),
    part: String(effectiveContext.part || ""),
    product_code: String(effectiveContext.product_code || effectiveContext.product || ""),
    parameter_catalog_id: catalog.catalog_id || null,
    parameter_scope: {
      family: String(effectiveContext.family || DEFAULT_CONFIG_CONTEXT.family),
      product: String(effectiveContext.product || DEFAULT_CONFIG_CONTEXT.product),
      part: String(effectiveContext.part || "")
    },
    parameters
  };
}

function requireRegisteredDomainArtifact(registry, artifactId, field, artifactType) {
  const normalizedId = String(artifactId || "").trim();
  const artifact = normalizedId ? registry[normalizedId] : null;
  if (artifact) return cloneJson(artifact);
  const error = new Error(`Unknown or missing ${artifactType}: ${normalizedId || "-"}. Select a valid artifact before continuing.`);
  error.code = "SESSION_CONTEXT_ARTIFACT_INVALID";
  error.validation = {
    ok: false,
    errors: [{
      code: "SESSION_CONTEXT_ARTIFACT_INVALID",
      field,
      artifact_type: artifactType,
      artifact_id: normalizedId || null,
      message: error.message
    }]
  };
  throw error;
}

function resolveRuleCatalogSnapshotById(catalogId, fallback = null) {
  const normalizedId = String(catalogId || "").trim();
  if (normalizedId && RULE_CATALOG_REGISTRY[normalizedId]) {
    return cloneJson(RULE_CATALOG_REGISTRY[normalizedId]);
  }
  return fallback ? normalizeRuleCatalogSnapshot(fallback) : cloneJson(DEFAULT_RULE_CATALOG);
}

function resolveNominalValueSetById(valueSetId) {
  const normalizedId = String(valueSetId || "").trim();
  return normalizedId && NOMINAL_VALUE_SET_REGISTRY[normalizedId]
    ? cloneJson(NOMINAL_VALUE_SET_REGISTRY[normalizedId])
    : null;
}

function configContextFromSessionContext(sessionContext = {}, nominalValueSet = null, sourceName = "") {
  const defaults = nominalValueSet?.defaults && typeof nominalValueSet.defaults === "object"
    ? nominalValueSet.defaults
    : {};
  return defaultConfigContextForSource(sourceName, {
    family: String(sessionContext.family_id || "").trim(),
    product: String(sessionContext.product_id || "").trim(),
    part: String(sessionContext.part_id || "").trim(),
    product_code: String(defaults?.parameters?.model_code || sessionContext.product_id || "").trim(),
    technology_profile: String(defaults.technology_profile || "").trim()
  });
}

function buildDomainArtifactsForContext(sessionContext = {}, sourceName = "") {
  const parameterCatalog = requireRegisteredDomainArtifact(PARAMETER_CATALOG_REGISTRY, sessionContext.parameter_catalog_id, "parameter_catalog_id", "parameter catalog");
  const ruleCatalog = requireRegisteredDomainArtifact(RULE_CATALOG_REGISTRY, sessionContext.rule_set_id, "rule_set_id", "rule set");
  const nominalValueSet = requireRegisteredDomainArtifact(NOMINAL_VALUE_SET_REGISTRY, sessionContext.nominal_value_set_id, "nominal_value_set_id", "nominal value set");
  const configContext = configContextFromSessionContext(sessionContext, nominalValueSet, sourceName);
  const catalogConfig = buildDefaultConfigFromParameterCatalog(parameterCatalog, configContext);
  const nominalParameters = nominalValueSet?.defaults?.parameters && typeof nominalValueSet.defaults.parameters === "object"
    ? nominalValueSet.defaults.parameters
    : {};
  return {
    parameter_catalog: parameterCatalog,
    rule_catalog: ruleCatalog,
    nominal_value_set: nominalValueSet,
    config_parameter_set: {
      ...catalogConfig,
      technology_profile: String(nominalValueSet?.defaults?.technology_profile || catalogConfig.technology_profile || ""),
      family: String(sessionContext.family_id || catalogConfig.family || ""),
      product: String(sessionContext.product_id || catalogConfig.product || ""),
      part: String(sessionContext.part_id || catalogConfig.part || ""),
      product_code: String(nominalParameters.model_code || catalogConfig.product_code || sessionContext.product_id || ""),
      parameter_catalog_id: parameterCatalog.catalog_id || sessionContext.parameter_catalog_id || null,
      parameter_scope: {
        family: String(sessionContext.family_id || ""),
        product: String(sessionContext.product_id || ""),
        part: String(sessionContext.part_id || "")
      },
      parameters: {
        ...(catalogConfig.parameters || {}),
        ...cloneJson(nominalParameters)
      }
    }
  };
}

function reconcileSessionDomainArtifacts(session) {
  if (!sessionContextIsLocked(session?.session_context_v1)) return false;
  const artifacts = buildDomainArtifactsForContext(session.session_context_v1, session.raw_source_name || session.source_name);
  const allowedParameterKeys = new Set(Object.keys(artifacts.parameter_catalog?.parameters || {}));
  const existingParameters = session.config_parameter_set?.parameters && typeof session.config_parameter_set.parameters === "object"
    ? session.config_parameter_set.parameters
    : {};
  const preservedParameters = {};
  for (const [key, value] of Object.entries(existingParameters)) {
    if (allowedParameterKeys.has(key)) preservedParameters[key] = cloneJson(value);
  }
  const nextConfig = {
    ...artifacts.config_parameter_set,
    technology_profile: String(session.config_parameter_set?.technology_profile || artifacts.config_parameter_set.technology_profile || ""),
    parameters: {
      ...(artifacts.config_parameter_set.parameters || {}),
      ...preservedParameters
    }
  };
  const reconciledVariantKey = readConfigVariantKey(nextConfig);
  if (reconciledVariantKey) nextConfig.parameters.variant_key = reconciledVariantKey;
  const before = JSON.stringify({
    config_parameter_set: session.config_parameter_set || null,
    parameter_catalog_id: session.parameter_catalog?.catalog_id || null,
    rule_catalog_id: session.rule_catalog?.catalog_id || null
  });
  session.config_parameter_set = nextConfig;
  session.parameter_catalog = artifacts.parameter_catalog;
  session.rule_catalog = artifacts.rule_catalog;
  const after = JSON.stringify({
    config_parameter_set: session.config_parameter_set,
    parameter_catalog_id: session.parameter_catalog?.catalog_id || null,
    rule_catalog_id: session.rule_catalog?.catalog_id || null
  });
  return before !== after;
}

const DEFAULT_CONFIG_PARAMETER_SET = (() => {
  const config = buildDefaultConfigFromParameterCatalog(DEFAULT_PARAMETER_CATALOG, DEFAULT_CONFIG_CONTEXT);
  const nonNullParameters = Object.fromEntries(Object.entries(config.parameters || {}).filter(([key, value]) => key !== "MODEL_VRATA" && value != null));
  config.parameters = { MODEL_VRATA: 1, ...nonNullParameters };
  return config;
})();

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
const SESSION_LIFECYCLE_STATES = new Set([
  "context_draft",
  "context_locked",
  "raw_loaded",
  "geometry_projected",
  "domain_validated",
  "authoring_ready",
  "preview_ready",
  "child_ready",
  "export_ready"
]);


const SESSION_CONTEXT_REQUIRED_FIELDS = [
  "production_program_id",
  "family_id",
  "product_id",
  "part_id",
  "nominal_value_set_id",
  "rule_set_id",
  "parameter_catalog_id",
  "branch_mode"
];

function normalizeExpectedVariantPolicy(input) {
  const source = input && typeof input === "object" ? input : {};
  const mode = String(source.mode || "none").trim() || "none";
  return {
    mode: ["none", "optional", "required"].includes(mode) ? mode : "none",
    expected_variant_keys: Array.isArray(source.expected_variant_keys)
      ? source.expected_variant_keys.map((value) => String(value || "").trim()).filter(Boolean)
      : []
  };
}

function validateSessionContextV1(context) {
  const errors = [];
  const warnings = [];
  const source = context && typeof context === "object" ? context : {};
  for (const field of SESSION_CONTEXT_REQUIRED_FIELDS) {
    if (!String(source[field] || "").trim()) {
      errors.push({
        code: "SESSION_CONTEXT_FIELD_REQUIRED",
        field,
        message: "Session context field is required: " + field
      });
    }
  }
  const artifactChecks = [
    ["parameter_catalog_id", PARAMETER_CATALOG_REGISTRY, "parameter catalog"],
    ["rule_set_id", RULE_CATALOG_REGISTRY, "rule set"],
    ["nominal_value_set_id", NOMINAL_VALUE_SET_REGISTRY, "nominal value set"]
  ];
  for (const [field, registry, label] of artifactChecks) {
    const artifactId = String(source[field] || "").trim();
    if (artifactId && !registry[artifactId]) {
      errors.push({
        code: "SESSION_CONTEXT_ARTIFACT_UNKNOWN",
        field,
        artifact_type: label,
        artifact_id: artifactId,
        message: `Selected ${label} is not registered for Mother DXF: ${artifactId}`
      });
    }
  }
  const policy = normalizeExpectedVariantPolicy(source.expected_variant_policy);
  if (policy.mode === "required" && policy.expected_variant_keys.length === 0) {
    errors.push({
      code: "EXPECTED_VARIANT_KEYS_REQUIRED",
      field: "expected_variant_policy.expected_variant_keys",
      message: "Expected variant keys are required when expected variant policy mode is required."
    });
  }
  if (String(source.branch_mode || "").trim().toUpperCase() === "ALL" && policy.mode === "required") {
    warnings.push({
      code: "BRANCH_ALL_WITH_REQUIRED_VARIANT_POLICY",
      field: "branch_mode",
      message: "Branch mode ALL is selected while expected variant policy requires variants."
    });
  }
  return {
    ok: errors.length === 0,
    errors,
    warnings
  };
}

function normalizeSessionContextV1(input, options = {}) {
  const source = input && typeof input === "object" ? input : {};
  const locked = typeof options.locked === "boolean"
    ? options.locked
    : String(source.status || "").trim() === "context_locked";
  const context = {
    version: 1,
    status: locked ? "context_locked" : "context_draft",
    production_program_id: String(source.production_program_id || "").trim(),
    family_id: String(source.family_id || "").trim(),
    product_id: String(source.product_id || "").trim(),
    part_id: String(source.part_id || "").trim(),
    nominal_value_set_id: String(source.nominal_value_set_id || "").trim(),
    rule_set_id: String(source.rule_set_id || "").trim(),
    parameter_catalog_id: String(source.parameter_catalog_id || "").trim(),
    branch_mode: String(source.branch_mode || "ALL").trim() || "ALL",
    expected_variant_policy: normalizeExpectedVariantPolicy(source.expected_variant_policy),
    selected_by: source.selected_by == null ? null : String(source.selected_by || "").trim() || null,
    locked_at: locked ? (source.locked_at || new Date().toISOString()) : null,
    validation: { ok: true, errors: [], warnings: [] }
  };
  const validation = validateSessionContextV1(context);
  context.validation = validation;
  if (locked && !validation.ok) {
    context.status = "context_draft";
    context.locked_at = null;
  }
  return context;
}

function sessionContextIsLocked(sessionOrContext) {
  const context = sessionOrContext?.session_context_v1 || sessionOrContext;
  return Boolean(context && String(context.status || "") === "context_locked" && context.validation?.ok !== false);
}

function lifecycleStateForSession(session) {
  if (!sessionContextIsLocked(session?.session_context_v1)) return "context_draft";
  const current = String(session?.session_lifecycle_v1?.state || "").trim();
  if (SESSION_LIFECYCLE_STATES.has(current) && current !== "context_draft") return current;
  return "context_locked";
}

function lifecycleTransitionsForState(state) {
  switch (state) {
    case "context_draft":
      return ["context_locked"];
    case "context_locked":
      return ["context_draft", "raw_loaded", "geometry_projected"];
    case "raw_loaded":
      return ["context_draft", "geometry_projected"];
    case "geometry_projected":
      return ["context_draft", "domain_validated", "authoring_ready"];
    case "domain_validated":
      return ["context_draft", "geometry_projected", "authoring_ready"];
    case "authoring_ready":
      return ["context_draft", "geometry_projected", "preview_ready"];
    case "preview_ready":
      return ["context_draft", "geometry_projected", "authoring_ready", "child_ready"];
    case "child_ready":
      return ["context_draft", "geometry_projected", "authoring_ready", "preview_ready", "export_ready"];
    case "export_ready":
      return ["context_draft", "geometry_projected", "authoring_ready", "preview_ready", "child_ready"];
    default:
      return ["context_draft", "context_locked"];
  }
}

function ensureSessionContextShape(session) {
  session.session_context_v1 = normalizeSessionContextV1(session?.session_context_v1 || {}, {
    locked: String(session?.session_context_v1?.status || "") === "context_locked"
  });
  const state = lifecycleStateForSession(session);
  session.session_lifecycle_v1 = {
    version: 1,
    state,
    allowed_transitions: lifecycleTransitionsForState(state)
  };
  return session;
}

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

function computeGeometrySlotIndex(objectBBox, slotWidth = GEOMETRY_SLOT_WIDTH_MM) {
  const minX = Number(objectBBox?.minX);
  const width = Number(slotWidth);
  if (!Number.isFinite(minX) || !Number.isFinite(width) || width <= 0) return null;
  return Math.floor(minX / width);
}

function projectSlotIndexOnRelevantObjects(relevantObjects, slotWidth = GEOMETRY_SLOT_WIDTH_MM) {
  const warnings = [];
  const projected = (Array.isArray(relevantObjects) ? relevantObjects : []).map((object) => {
    const slotIndex = computeGeometrySlotIndex(object?.bbox, slotWidth);
    const next = {
      ...object,
      slot_index: slotIndex
    };
    const maxX = Number(object?.bbox?.maxX);
    if (Number.isInteger(slotIndex) && Number.isFinite(maxX)) {
      const slotBoundaryX = (slotIndex + 1) * slotWidth;
      if (maxX > slotBoundaryX) {
        warnings.push({
          code: "SLOT_BOUNDARY_CROSSING",
          severity: "warning",
          object_id: object.id,
          entity_id: object.entityId || object.entity_id || null,
          slot_index: slotIndex,
          slot_width: slotWidth,
          boundary_x: slotBoundaryX,
          bbox: object.bbox || null,
          message: "Object " + object.id + " crosses geometry slot " + slotIndex + " boundary at x=" + slotBoundaryX + "."
        });
      }
    }
    return next;
  });

  return {
    relevant_objects: projected,
    slot_validation: {
      version: 1,
      mode: "passive",
      slot_width: slotWidth,
      ok: warnings.length === 0,
      warnings
    }
  };
}

function groupObjectsBySlot(objects, slotWidth = GEOMETRY_SLOT_WIDTH_MM) {
  const bySlot = new Map();
  for (const object of Array.isArray(objects) ? objects : []) {
    const slotIndex = object?.slot_index;
    if (!Number.isInteger(slotIndex)) continue;
    if (!bySlot.has(slotIndex)) {
      bySlot.set(slotIndex, {
        slot_index: slotIndex,
        slot_width: slotWidth,
        objects: []
      });
    }
    bySlot.get(slotIndex).objects.push(object);
  }
  return Array.from(bySlot.values()).sort((left, right) => left.slot_index - right.slot_index);
}

function computeSlotBBox(slotObjects) {
  const bbox = (Array.isArray(slotObjects) ? slotObjects : []).reduce((acc, object) => bboxUnion(acc, object?.bbox), null);
  if (!bbox) return null;
  const minX = Number(bbox.minX);
  const minY = Number(bbox.minY);
  const maxX = Number(bbox.maxX);
  const maxY = Number(bbox.maxY);
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Number.isFinite(minX) && Number.isFinite(maxX) ? maxX - minX : null,
    height: Number.isFinite(minY) && Number.isFinite(maxY) ? maxY - minY : null
  };
}

function computeSlotHygiene(slotObjects) {
  return analyzeGeometryHygiene(null, null, Array.isArray(slotObjects) ? slotObjects : []);
}

function classifySlotBands(slotObjects, slotBBox, bands = DEFAULT_BANDS) {
  const assignments = {};
  const warnings = [];
  if (!Array.isArray(slotObjects) || slotObjects.length === 0 || !slotBBox) {
    return {
      version: 1,
      mode: "passive",
      assignments,
      validation: { ok: false, warnings: [{ code: "EMPTY_SLOT_BANDS", severity: "warning" }] }
    };
  }

  for (const object of slotObjects) {
    const suggested = suggestSlotLayerForObject(object, slotBBox, bands);
    if (!suggested) {
      warnings.push({
        code: "BAND_ASSIGNMENT_WARNING_IN_SLOT",
        severity: "warning",
        object_id: object?.id || null,
        entity_id: object?.entity_id || object?.entityId || null,
        message: "Slot band assignment could not classify object."
      });
    }
    assignments[object.id] = suggested
      ? {
          state: "classified",
          layer: suggested,
          origin: "slot_projection",
          suggested_layer: suggested
        }
      : {
          state: "unclassified",
          layer: null,
          origin: "slot_projection",
          suggested_layer: null
        };
  }

  return {
    version: 1,
    mode: "passive",
    assignments,
    validation: {
      ok: warnings.length === 0,
      warnings
    }
  };
}

function buildGeometrySlotModelProjection(objects, slotValidation, slotWidth = GEOMETRY_SLOT_WIDTH_MM, bands = DEFAULT_BANDS, config = null, branchModeOverride = null) {
  const slots = groupObjectsBySlot(objects, slotWidth).map((slot) => ({
    ...slot,
    bbox: computeSlotBBox(slot.objects),
    hygiene: computeSlotHygiene(slot.objects),
    band_assignments: classifySlotBands(slot.objects, computeSlotBBox(slot.objects), bands)
  }));
  const warnings = Array.isArray(slotValidation?.warnings) ? slotValidation.warnings.slice() : [];
  for (const slot of slots) {
    const slotWarnings = [];
    const addSlotWarning = (warning) => {
      slotWarnings.push(warning);
      warnings.push(warning);
    };

    if (!Array.isArray(slot.objects) || slot.objects.length === 0 || !slot.bbox) {
      addSlotWarning({
        code: "EMPTY_SLOT_BBOX",
        severity: "warning",
        slot_index: slot.slot_index,
        slot_width: slotWidth,
        message: "Geometry slot " + slot.slot_index + " has no bbox."
      });
      slot.validation = {
        version: 1,
        mode: "passive",
        ok: slotWarnings.length === 0,
        warnings: slotWarnings
      };
      continue;
    }

    if (!slot.hygiene) {
      addSlotWarning({
        code: "EMPTY_SLOT_HYGIENE",
        severity: "warning",
        slot_index: slot.slot_index,
        slot_width: slotWidth,
        message: "Geometry slot " + slot.slot_index + " has no hygiene result."
      });
    } else {
      const hygieneIssues = Array.isArray(slot.hygiene.issues) ? slot.hygiene.issues : [];
      const hygieneWarnings = Array.isArray(slot.hygiene.warnings) ? slot.hygiene.warnings : [];
      if (slot.hygiene.ok === false || hygieneIssues.length > 0) {
        addSlotWarning({
          code: "HYGIENE_ERROR_IN_SLOT",
          severity: "warning",
          slot_index: slot.slot_index,
          slot_width: slotWidth,
          issue_count: hygieneIssues.length,
          message: "Geometry slot " + slot.slot_index + " has hygiene issue(s)."
        });
      }
      if (hygieneWarnings.length > 0) {
        addSlotWarning({
          code: "HYGIENE_WARNING_IN_SLOT",
          severity: "warning",
          slot_index: slot.slot_index,
          slot_width: slotWidth,
          warning_count: hygieneWarnings.length,
          message: "Geometry slot " + slot.slot_index + " has hygiene warning(s)."
        });
      }
    }

    const bandValidation = slot.band_assignments && slot.band_assignments.validation ? slot.band_assignments.validation : null;
    const bandWarnings = Array.isArray(bandValidation?.warnings) ? bandValidation.warnings : [];
    for (const warning of bandWarnings) {
      const code = String(warning?.code || "");
      addSlotWarning({
        ...warning,
        code: code === "EMPTY_SLOT_BANDS" ? "EMPTY_SLOT_BANDS" : "BAND_ASSIGNMENT_WARNING_IN_SLOT",
        severity: "warning",
        slot_index: slot.slot_index,
        slot_width: slotWidth
      });
    }
    if (bandValidation && bandValidation.ok === false && !bandWarnings.length) {
      addSlotWarning({
        code: "BAND_ASSIGNMENT_ERROR_IN_SLOT",
        severity: "warning",
        slot_index: slot.slot_index,
        slot_width: slotWidth,
        message: "Geometry slot " + slot.slot_index + " has band assignment error."
      });
    }

    const maxX = Number(slot.bbox.maxX);
    const boundaryX = (slot.slot_index + 1) * slotWidth;
    if (Number.isFinite(maxX) && maxX > boundaryX) {
      addSlotWarning({
        code: "SLOT_BOUNDARY_CROSSING",
        severity: "warning",
        slot_index: slot.slot_index,
        slot_width: slotWidth,
        boundary_x: boundaryX,
        bbox: slot.bbox,
        message: "Geometry slot " + slot.slot_index + " bbox crosses boundary at x=" + boundaryX + "."
      });
    }

    const width = Number(slot.bbox.width);
    const height = Number(slot.bbox.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 0 || height < 0) {
      addSlotWarning({
        code: "NEGATIVE_SLOT_BBOX",
        severity: "warning",
        slot_index: slot.slot_index,
        slot_width: slotWidth,
        bbox: slot.bbox,
        message: "Geometry slot " + slot.slot_index + " has invalid bbox dimensions."
      });
    }

    slot.validation = {
      version: 1,
      mode: "passive",
      ok: slotWarnings.length === 0,
      warnings: slotWarnings
    };
  }

  const branchMode = normalizeBranchMode(branchModeOverride || effectiveBranchModeForConfig(config));
  const branchSelectedObjects = filterObjectsByBranchMode(objects, branchMode);
  if (branchMode !== "ALL") {
    warnings.push({
      code: "LEGACY_BRANCH_MODE_ACTIVE",
      severity: "warning",
      branch_mode: branchMode,
      message: "Legacy branch mode is active for geometry slot model comparison."
    });
  }
  warnings.push({
    code: "SLOT_MODEL_NOT_ACTIVE",
    severity: "warning",
    message: "Geometry slot model is passive; slot-based authoritative selection is not active."
  });
  warnings.push({
    code: "PREFER_SLOT_MODE_DISABLED",
    severity: "info",
    message: "Prefer-slot mode is disabled."
  });
  warnings.push({
    code: "PREFER_SLOT_MODE_AVAILABLE",
    severity: "info",
    message: "Prefer-slot mode infrastructure is available for future activation."
  });

  return {
    version: 1,
    mode: "passive",
    slot_width: slotWidth,
    slots,
    validation: {
      version: 1,
      mode: "passive",
      slot_width: slotWidth,
      ok: warnings.length === 0,
      warnings
    },
    legacy_comparison: {
      branch_mode: branchMode,
      branch_selected_object_count: branchSelectedObjects.length,
      slot_selected_object_count: 0,
      mismatch_count: 0
    },
    authoritative_selection: {
      mode: "passive",
      candidate_slot_index: null,
      candidate_variant_key: null,
      reason: "passive_mode",
      prefer_slot_mode_enabled: false,
      prefer_slot_mode_available: true
    },
    fallback: {
      used: false,
      reason: null
    }
  };
}

function objectSemVariantKeys(object) {
  const records = Array.isArray(object?.semantic_metadata?.parsed) ? object.semantic_metadata.parsed : [];
  const keys = [];
  for (const record of records) {
    const values = record && record.keys && typeof record.keys === "object" ? record.keys : {};
    for (const key of ["variant", "variant_key", "geometry_variant"]) {
      const value = String(values[key] || "").trim();
      if (value) keys.push(value);
    }
  }
  return Array.from(new Set(keys)).sort();
}

function buildSlotCompletenessMetrics(slot, slotWidth) {
  const objects = Array.isArray(slot?.objects) ? slot.objects : [];
  const boundaryX = (Number(slot?.slot_index || 0) + 1) * slotWidth;
  const crossSlotObjects = objects.filter((object) => {
    const maxX = Number(object?.bbox?.maxX);
    return Number.isFinite(maxX) && maxX > boundaryX;
  }).length;
  const unexpectedObjects = objects.filter((object) => !object || !object.bbox || !Number.isInteger(object.slot_index)).length;
  return {
    missing_objects: 0,
    unexpected_objects: unexpectedObjects,
    cross_slot_objects: crossSlotObjects
  };
}

function buildGeometryContextV1Projection(geometrySlotModel) {
  const source = geometrySlotModel && typeof geometrySlotModel === "object" ? geometrySlotModel : {};
  const slotWidth = source.slot_width || GEOMETRY_SLOT_WIDTH_MM;
  const slots = (Array.isArray(source.slots) ? source.slots : []).map((slot) => {
    const objects = Array.isArray(slot.objects) ? slot.objects : [];
    const xdataVariantKeys = Array.from(new Set(objects.map((object) => String(object?.xdata_metadata?.geometry_variant || "").trim()).filter(Boolean))).sort();
    const observedXdataHintMap = new Map();
    for (const object of objects) {
      const metadata = object?.xdata_metadata;
      const hint = String(metadata?.observed_xdata_hint || "").trim();
      if (!hint) continue;
      const current = observedXdataHintMap.get(hint) || {
        hint,
        app: String(metadata?.app || MOTHER_XDATA_APP_NAME),
        attributes: metadata?.attributes && typeof metadata.attributes === "object" ? cloneJson(metadata.attributes) : {},
        object_count: 0,
        coverage: 0
      };
      current.object_count += 1;
      observedXdataHintMap.set(hint, current);
    }
    const observedXdataHints = Array.from(observedXdataHintMap.values())
      .map((entry) => ({
        ...entry,
        coverage: objects.length ? roundNumber(entry.object_count / objects.length, 4) : 0
      }))
      .sort((a, b) => a.hint.localeCompare(b.hint));
    const semVariantKeys = Array.from(new Set(objects.flatMap((object) => objectSemVariantKeys(object)))).sort();
    const hasXdata = xdataVariantKeys.length > 0;
    const hasSem = semVariantKeys.length > 0;
    const hasMismatch = hasXdata && hasSem && !xdataVariantKeys.some((key) => semVariantKeys.includes(key));
    return {
      slot_index: slot.slot_index,
      role: slot.slot_index === 0 ? "base" : "variant",
      variant_key: xdataVariantKeys[0] || semVariantKeys[0] || null,
      xdata_variant_keys: xdataVariantKeys,
      observed_xdata_hints: observedXdataHints,
      sem_variant_keys: semVariantKeys,
      has_xdata_variant: hasXdata,
      has_sem_variant: hasSem,
      has_variant_mismatch: hasMismatch,
      bbox: slot.bbox || null,
      object_ids: objects.map((object) => object?.id).filter(Boolean),
      slot_completeness: buildSlotCompletenessMetrics(slot, slotWidth),
      hygiene: slot.hygiene || null,
      band_assignments: slot.band_assignments || null,
      validation: slot.validation || { version: 1, mode: "passive", ok: true, warnings: [] }
    };
  });

  return {
    version: 1,
    mode: "passive",
    slot_width: slotWidth,
    base_slot_index: 0,
    slots,
    authoritative_slot_index: null,
    authoritative_variant_key: null,
    validation: source.validation || { version: 1, mode: "passive", ok: true, warnings: [] }
  };
}

function buildSlotContextProjectionV1(geometryContext) {
  const slots = Array.isArray(geometryContext?.slots) ? geometryContext.slots : [];
  return {
    version: 1,
    mode: "passive",
    slot_width: geometryContext?.slot_width || GEOMETRY_SLOT_WIDTH_MM,
    base_slot_index: geometryContext?.base_slot_index ?? 0,
    slots: slots.map((slot) => ({
      slot_index: slot.slot_index,
      role: slot.role,
      variant_key: slot.variant_key || null,
      object_ids: Array.isArray(slot.object_ids) ? slot.object_ids.slice() : [],
      bbox: slot.bbox || null,
      slot_completeness: slot.slot_completeness || { missing_objects: 0, unexpected_objects: 0, cross_slot_objects: 0 },
      validation: slot.validation || { version: 1, mode: "passive", ok: true, warnings: [] }
    })),
    validation: geometryContext?.validation || { version: 1, mode: "passive", ok: true, warnings: [] }
  };
}

function buildVariantToSlotMapProjectionV1(geometryContext) {
  const entries = [];
  for (const slot of Array.isArray(geometryContext?.slots) ? geometryContext.slots : []) {
    const keys = Array.from(new Set([
      ...(Array.isArray(slot.xdata_variant_keys) ? slot.xdata_variant_keys : []),
      ...(Array.isArray(slot.sem_variant_keys) ? slot.sem_variant_keys : []),
      slot.variant_key || null
    ].map((value) => String(value || "").trim()).filter(Boolean))).sort();
    for (const key of keys) {
      entries.push({
        variant_key: key,
        slot_index: slot.slot_index,
        source: (slot.xdata_variant_keys || []).includes(key) ? "xdata" : (slot.sem_variant_keys || []).includes(key) ? "sem" : "slot",
        confidence: "passive"
      });
    }
  }
  return {
    version: 1,
    mode: "passive",
    entries,
    ambiguous_variant_keys: entries
      .filter((entry, index, list) => list.some((other, otherIndex) => otherIndex !== index && other.variant_key === entry.variant_key && other.slot_index !== entry.slot_index))
      .map((entry) => entry.variant_key)
      .filter((value, index, list) => list.indexOf(value) === index)
  };
}

function buildResolverInputV2ExtendedSkeleton(session, geometryContext, domainContext) {
  const slotContext = buildSlotContextProjectionV1(geometryContext);
  const variantToSlotMap = buildVariantToSlotMapProjectionV1(geometryContext);
  const config = normalizeConfigParameterSet(session.config_parameter_set);
  const candidateVariantKey = readConfigVariantKey(config);
  const candidateEntry = candidateVariantKey
    ? variantToSlotMap.entries.find((entry) => entry.variant_key === candidateVariantKey) || null
    : null;
  return {
    version: 2,
    schema: "resolver_input_v2_extended",
    mode: "prepared_disabled",
    active: false,
    session_id: session.session_id,
    execution_authority: "core_shell_resolver",
    geometry_authority: "slot_model_candidate_only",
    slot_context: slotContext,
    variant_to_slot_map: variantToSlotMap,
    candidate_authoritative_slot_index: candidateEntry ? candidateEntry.slot_index : null,
    candidate_variant_key: candidateVariantKey || null,
    domain_context_v1: cloneJson(domainContext || null),
    activation_blocked_reason: "slot_authority_not_active_in_task_6"
  };
}

function registryPartDefinitionForSession(session, config) {
  const programId = activeProgramIdForSession(session, config);
  const registryProgram = DOMAIN_AWARE_REGISTRY.programs && DOMAIN_AWARE_REGISTRY.programs[programId]
    ? DOMAIN_AWARE_REGISTRY.programs[programId]
    : null;
  if (!registryProgram) return null;
  const familyId = String(session?.session_context_v1?.family_id || config?.family || "").trim();
  const productId = String(session?.session_context_v1?.product_id || config?.product || "").trim();
  const partId = String(session?.session_context_v1?.part_id || config?.part || config?.product_code || "").trim();
  return registryProgram?.families?.[familyId]?.products?.[productId]?.parts?.[partId] || null;
}

function readConfigParameterValue(parameters, key) {
  const source = parameters && typeof parameters === "object" ? parameters : {};
  const rawKey = String(key || "").trim();
  if (!rawKey) return undefined;
  const variants = [rawKey, rawKey.toUpperCase(), rawKey.toLowerCase()];
  for (const candidate of variants) {
    if (Object.prototype.hasOwnProperty.call(source, candidate)) return source[candidate];
  }
  return undefined;
}

function readExecutionVariantDriver(config) {
  const parameters = config && config.parameters && typeof config.parameters === "object" ? config.parameters : {};
  for (const key of ["pjover", "PJOVER"]) {
    const value = String(parameters[key] || "").trim();
    if (value) {
      const upper = value.toUpperCase();
      if (["DA", "YES", "TRUE", "1"].includes(upper)) return { key, value, derived_variant_key: "PJOVER", source: "config.parameters.derived" };
      if (["NE", "NO", "FALSE", "0"].includes(upper)) return { key, value, derived_variant_key: "BASE", source: "config.parameters.derived" };
      return { key, value, source: "config.parameters.derived_unknown" };
    }
  }
  for (const key of ["variant_key", "VARIANT_KEY", "GEOMETRY_VARIANT", "geometry_variant"]) {
    const value = String(parameters[key] || "").trim();
    if (value) return { key, value, source: "config.parameters.explicit" };
  }
  return null;
}

function readConfigVariantKey(config) {
  const driver = readExecutionVariantDriver(config);
  if (!driver) return null;
  return String(driver.derived_variant_key || driver.value || "").trim() || null;
}

function inferExecutionIntentRuleDefaults(variantKey) {
  const normalized = String(variantKey || "").trim().toUpperCase();
  if (!normalized) {
    return {
      activation_mode: "always",
      parameter_key: "",
      operator: "==",
      expected_value: "",
      derived_meaning: "always include"
    };
  }
  if (normalized === "BASE" || normalized.endsWith("_BASE")) {
    return {
      activation_mode: "parameter_rule",
      parameter_key: "pjover",
      operator: "==",
      expected_value: "Ne",
      derived_meaning: "include when BASE branch is selected"
    };
  }
  if (normalized.includes("PJOVER")) {
    return {
      activation_mode: "parameter_rule",
      parameter_key: "pjover",
      operator: "==",
      expected_value: "Da",
      derived_meaning: "include when PJOVER branch is selected"
    };
  }
  return {
    activation_mode: "always",
    parameter_key: "",
    operator: "==",
    expected_value: "",
    derived_meaning: "always include"
  };
}

function defaultExecutionIntentAuthoringRows(session, geometryContext, partDefinition, config) {
  const geometrySlots = Array.isArray(geometryContext?.slots) ? geometryContext.slots : [];
  const registryProfiles = Array.isArray(partDefinition?.slot_profiles) ? partDefinition.slot_profiles : [];
  const fallbackTechnology = String(config?.technology_profile || "").trim() || null;
  return geometrySlots.map((slot) => {
    const registryProfile = registryProfiles[Number(slot.slot_index)] || null;
    const observedXdataHint = String(slot?.observed_xdata_hints?.[0]?.hint || "").trim() || null;
    const variantKey = String(
      registryProfile?.variant_key
      || slot?.variant_key
      || (Array.isArray(slot?.xdata_variant_keys) && slot.xdata_variant_keys[0])
      || (Array.isArray(slot?.sem_variant_keys) && slot.sem_variant_keys[0])
      || (Number(slot?.slot_index) === 0 ? "BASE" : ("SLOT_" + Number(slot?.slot_index)))
    ).trim();
    const ruleDefaults = inferExecutionIntentRuleDefaults(variantKey);
    const note = registryProfile?.note
      || (observedXdataHint
        ? ("Observed XDATA hint: " + observedXdataHint)
        : (variantKey ? ("Observed variant " + variantKey) : ("Observed slot " + Number(slot?.slot_index))));
    return {
      slot_index: Number(slot?.slot_index),
      slot_role: String(registryProfile?.slot_role || slot?.role || (Number(slot?.slot_index) === 0 ? "base" : "variant")).trim() || "variant",
      variant_key: variantKey || null,
      technology_profile: String(registryProfile?.technology_profile || fallbackTechnology || "").trim() || null,
      evidence_source: String(
        registryProfile?.evidence_source
        || (Array.isArray(slot?.xdata_variant_keys) && slot.xdata_variant_keys.length ? "xdata" : "")
        || (observedXdataHint ? "xdata_hint" : "")
        || (Array.isArray(slot?.sem_variant_keys) && slot.sem_variant_keys.length ? "sem" : "manual")
      ).trim() || "manual",
      observed_xdata_hint: observedXdataHint,
      note,
      activation_mode: ruleDefaults.activation_mode,
      parameter_key: ruleDefaults.parameter_key,
      operator: ruleDefaults.operator,
      expected_value: ruleDefaults.expected_value,
      derived_meaning: ruleDefaults.derived_meaning
    };
  });
}

function normalizeExecutionIntentAuthoringV1(session, geometryContext, partDefinition, config) {
  const defaults = defaultExecutionIntentAuthoringRows(session, geometryContext, partDefinition, config);
  const savedRows = Array.isArray(session?.execution_intent_authoring_v1?.slots)
    ? session.execution_intent_authoring_v1.slots
    : [];
  const savedBySlot = new Map(savedRows.map((row) => [Number(row?.slot_index), row]));
  return defaults.map((row) => {
    const saved = savedBySlot.get(Number(row.slot_index)) || {};
    return {
      slot_index: Number(row.slot_index),
      slot_role: String(saved.slot_role || row.slot_role || "variant").trim() || "variant",
      variant_key: String(saved.variant_key || row.variant_key || "").trim() || null,
      technology_profile: String(saved.technology_profile || row.technology_profile || "").trim() || null,
      evidence_source: String(saved.evidence_source || row.evidence_source || "manual").trim() || "manual",
      observed_xdata_hint: String(saved.observed_xdata_hint || row.observed_xdata_hint || "").trim() || null,
      note: String(saved.note || row.note || "").trim(),
      activation_mode: String(saved.activation_mode || row.activation_mode || "always").trim() || "always",
      parameter_key: String(saved.parameter_key || row.parameter_key || "").trim(),
      operator: String(saved.operator || row.operator || "==").trim() || "==",
      expected_value: String(saved.expected_value || row.expected_value || "").trim(),
      derived_meaning: String(saved.derived_meaning || row.derived_meaning || "").trim()
    };
  });
}

function compareExecutionIntentValue(actual, operator, expected) {
  const actualText = String(actual == null ? "" : actual).trim();
  const expectedText = String(expected == null ? "" : expected).trim();
  switch (String(operator || "==").trim()) {
    case "!=":
      return actualText !== expectedText;
    case "IN": {
      const expectedValues = expectedText.split(",").map((item) => item.trim()).filter(Boolean);
      return expectedValues.includes(actualText);
    }
    case "==":
    default:
      return actualText === expectedText;
  }
}

function evaluateExecutionIntentRule(row, configParameters) {
  const activationMode = String(row?.activation_mode || "always").trim() || "always";
  if (activationMode === "always") {
    return {
      active: true,
      actual_value: null,
      warning: null
    };
  }
  const parameterKey = String(row?.parameter_key || "").trim();
  if (!parameterKey) {
    return {
      active: false,
      actual_value: null,
      warning: {
        code: "EXECUTION_INTENT_PARAMETER_KEY_MISSING",
        severity: "warning",
        message: "Activation rule has no parameter key."
      }
    };
  }
  const actualValue = readConfigParameterValue(configParameters, parameterKey);
  if (actualValue === undefined) {
    return {
      active: false,
      actual_value: null,
      warning: {
        code: "EXECUTION_INTENT_PARAMETER_MISSING",
        severity: "warning",
        slot_index: Number(row?.slot_index),
        parameter_key: parameterKey,
        message: "Activation parameter " + parameterKey + " is missing from config parameter set."
      }
    };
  }
  return {
    active: compareExecutionIntentValue(actualValue, row?.operator, row?.expected_value),
    actual_value: actualValue,
    warning: null
  };
}

function buildExecutionIntentProjectionV1(session, geometryContext, variantToSlotMap) {
  const config = normalizeConfigParameterSet(session.config_parameter_set);
  const partDefinition = registryPartDefinitionForSession(session, config);
  const slotAuthoringRows = normalizeExecutionIntentAuthoringV1(session, geometryContext, partDefinition, config);
  const geometrySlots = Array.isArray(geometryContext?.slots) ? geometryContext.slots : [];
  const geometrySlotByIndex = new Map(geometrySlots.map((slot) => [Number(slot.slot_index), slot]));
  const warnings = [];
  const activeSlotSet = [];
  const suppressedSlotSet = [];
  const simulationParameterKeys = Array.from(new Set(slotAuthoringRows
    .map((row) => String(row?.parameter_key || "").trim())
    .filter(Boolean)));
  for (const row of slotAuthoringRows) {
    const geometrySlot = geometrySlotByIndex.get(Number(row.slot_index)) || null;
    const evaluation = evaluateExecutionIntentRule(row, config?.parameters || {});
    if (evaluation.warning) warnings.push(evaluation.warning);
    const slotRecord = {
      slot_index: Number(row.slot_index),
      slot_role: row.slot_role || geometrySlot?.role || null,
      variant_key: row.variant_key || geometrySlot?.variant_key || null,
      technology_profile: row.technology_profile || null,
      evidence_source: row.evidence_source || null,
      observed_xdata_hint: row.observed_xdata_hint || geometrySlot?.observed_xdata_hints?.[0]?.hint || null,
      note: row.note || "",
      activation_mode: row.activation_mode || "always",
      parameter_key: row.parameter_key || "",
      operator: row.operator || "==",
      expected_value: row.expected_value || "",
      derived_meaning: row.derived_meaning || "",
      activation_actual_value: evaluation.actual_value,
      bbox: geometrySlot?.bbox || null,
      object_count: Array.isArray(geometrySlot?.object_ids) ? geometrySlot.object_ids.length : 0,
      source: "execution_intent_authoring"
    };
    if (evaluation.active) {
      activeSlotSet.push(slotRecord);
    } else {
      suppressedSlotSet.push(slotRecord);
    }
  }
  const driver = readExecutionVariantDriver(config);
  const technologyProfilesAvailable = Array.from(new Set(slotAuthoringRows.map((row) => String(row.technology_profile || "").trim()).filter(Boolean)));
  const activeVariantKey = String(driver?.derived_variant_key || driver?.value || "").trim()
    || (activeSlotSet.length === 1 ? String(activeSlotSet[0].variant_key || "").trim() : "")
    || null;
  const discoveredSlots = geometrySlots.map((slot) => ({
    slot_index: Number(slot.slot_index),
    bbox: cloneJson(slot.bbox || null),
    object_count: Array.isArray(slot.object_ids) ? slot.object_ids.length : 0,
    observed_xdata: Array.isArray(slot.xdata_variant_keys) ? slot.xdata_variant_keys.slice() : [],
    observed_xdata_hints: Array.isArray(slot.observed_xdata_hints) ? cloneJson(slot.observed_xdata_hints) : [],
    observed_sem: Array.isArray(slot.sem_variant_keys) ? slot.sem_variant_keys.slice() : [],
    hygiene: cloneJson(slot.hygiene || null),
    slot_completeness: cloneJson(slot.slot_completeness || null),
    validation: cloneJson(slot.validation || null)
  }));
  if (slotAuthoringRows.length && geometrySlots.length && slotAuthoringRows.length !== geometrySlots.length) {
    warnings.push({
      code: "EXECUTION_INTENT_SLOT_COUNT_MISMATCH",
      severity: "warning",
      message: "Execution intent authoring rows (" + String(slotAuthoringRows.length) + ") differ from observed slot count (" + String(geometrySlots.length) + ")."
    });
  }
  if (!activeSlotSet.length) {
    warnings.push({
      code: "EXECUTION_INTENT_EMPTY_ACTIVE_SET",
      severity: "warning",
      message: "Current parameter simulation resolves zero active slots."
    });
  }
  return {
    version: 1,
    mode: "slot_first_authoring",
    active_variant_key: activeVariantKey,
    active_slot_index: activeSlotSet.length === 1 ? Number(activeSlotSet[0].slot_index) : null,
    active_slot_indices: activeSlotSet.map((slot) => Number(slot.slot_index)),
    parameter_driver: driver ? cloneJson(driver) : null,
    selected_technology_profile: String(config?.technology_profile || "").trim() || null,
    technology_profiles_available: technologyProfilesAvailable,
    slot_profiles: slotAuthoringRows.map((row) => ({
      slot_index: Number(row.slot_index),
      slot_role: row.slot_role || null,
      variant_key: row.variant_key || null,
      technology_profile: row.technology_profile || null
    })),
    discovered_slots: discoveredSlots,
    slot_authoring_rows: slotAuthoringRows,
    simulation_parameters: simulationParameterKeys.map((key) => ({
      key,
      value: readConfigParameterValue(config?.parameters || {}, key) ?? null
    })),
    active_slot_set: activeSlotSet,
    suppressed_slot_set: suppressedSlotSet,
    warnings,
    variant_to_slot_map: cloneJson(variantToSlotMap || null)
  };
}

function buildDomainContextV1Projection(documentSem, configParameterSet, xdataContext, sessionContext = null) {
  const config = normalizeConfigParameterSet(configParameterSet);
  const xdataVariantKeys = Array.from(new Set((Array.isArray(xdataContext?.geometry_variants) ? xdataContext.geometry_variants : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean))).sort();
  const variantKey = readConfigVariantKey(config);
  const branchMode = normalizeBranchMode(sessionContext?.branch_mode || effectiveBranchModeForConfig(config));
  const warnings = [];

  if (!documentSem) {
    warnings.push({
      code: "MISSING_SEM_DATA",
      severity: "warning",
      message: "Document SEM data is missing; domain identity is resolved from the locked session context and parameter set."
    });
  }
  if (!variantKey && xdataVariantKeys.length === 0) {
    warnings.push({
      code: "MISSING_VARIANT_KEY",
      severity: "warning",
      message: "No config variant key or XDATA geometry variant key is present."
    });
  }
  if (xdataVariantKeys.length > 1) {
    warnings.push({
      code: "MULTIPLE_XDATA_VARIANTS",
      severity: "warning",
      variant_keys: xdataVariantKeys,
      message: "Multiple XDATA geometry variant keys are present."
    });
  }
  if (branchMode !== "ALL") {
    warnings.push({
      code: "LEGACY_BRANCH_MODE_ACTIVE",
      severity: "warning",
      branch_mode: branchMode,
      message: "Legacy branch mode is active."
    });
  }

  return {
    version: 1,
    mode: "passive",
    family: documentSem?.family || config.family || null,
    product: documentSem?.product || config.product || null,
    part: documentSem?.part || config.part || config.product_code || null,
    technology_unit_id: config.technology_unit_id || null,
    parameter_catalog_id: config.parameter_catalog_id || null,
    variant_key: variantKey,
    branch_mode: branchMode,
    xdata_variant_keys: xdataVariantKeys,
    validation: {
      version: 1,
      mode: "passive",
      ok: warnings.length === 0,
      warnings
    }
  };
}


function normalizeDomainToken(value) {
  return String(value || "").trim().toUpperCase();
}

function extractSemVariantKeys(documentSem) {
  const comments = Array.isArray(documentSem?.raw_comments) ? documentSem.raw_comments : [];
  const keys = [];
  for (const comment of comments) {
    const raw = String(comment || "");
    const pairs = raw.replace(/^SEM:/i, "").split(";");
    for (const pair of pairs) {
      const index = pair.indexOf("=");
      if (index < 0) continue;
      const key = pair.slice(0, index).trim().toLowerCase();
      const value = pair.slice(index + 1).trim();
      if (["variant", "variant_key", "geometry_variant"].includes(key) && value) keys.push(value);
    }
  }
  return Array.from(new Set(keys));
}

function buildGeometryValidationV1(session, view) {
  const geometryContext = view?.geometry_context_v1 || null;
  const slotModel = view?.geometry_slot_model || null;
  const documentBBox = view?.document_bbox || null;
  const warnings = [];
  const errors = [];
  const addWarning = (item) => warnings.push({ severity: "warning", ...item });
  const addError = (item) => errors.push({ severity: "error", blocking: true, ...item });
  const slots = Array.isArray(geometryContext?.slots) ? geometryContext.slots : [];
  if (!geometryContext) {
    addError({ code: "GEOMETRY_CONTEXT_MISSING", message: "geometry_context_v1 is missing." });
  }
  if (!slots.length) {
    addError({ code: "GEOMETRY_SLOTS_MISSING", message: "No geometry slots were projected from raw DXF." });
  }
  const globalWidth = Number(documentBBox?.width);
  const slotWidth = Number(geometryContext?.slot_width || GEOMETRY_SLOT_WIDTH_MM);
  const globalSpansMultipleSlots = Number.isFinite(globalWidth) && Number.isFinite(slotWidth) && slotWidth > 0 && globalWidth > slotWidth;
  if (globalSpansMultipleSlots) {
    addWarning({
      code: "SLOT_MODEL_GLOBAL_BBOX_LEAK",
      message: "Global document bbox spans multiple slot widths; per-slot classification should be preferred for diagnostics.",
      document_bbox: documentBBox,
      slot_width: slotWidth
    });
  }
  for (const slot of slots) {
    const completeness = slot.slot_completeness || {};
    if (Number(completeness.cross_slot_objects || 0) > 0) {
      addError({
        code: "SLOT_BOUNDARY_CROSSING",
        slot_index: slot.slot_index,
        cross_slot_objects: completeness.cross_slot_objects,
        message: "One or more objects cross the physical slot boundary."
      });
    }
    if (slot.has_variant_mismatch) {
      addWarning({
        code: "SLOT_VARIANT_EVIDENCE_MISMATCH",
        slot_index: slot.slot_index,
        xdata_variant_keys: slot.xdata_variant_keys || [],
        sem_variant_keys: slot.sem_variant_keys || [],
        message: "Slot SEM variant evidence and XDATA variant evidence do not overlap."
      });
    }
    const slotWarnings = Array.isArray(slot.validation?.warnings) ? slot.validation.warnings : [];
    for (const warning of slotWarnings) {
      addWarning({
        code: warning?.code || "SLOT_VALIDATION_WARNING",
        slot_index: slot.slot_index,
        message: warning?.message || "Slot validation warning.",
        details: warning
      });
    }
  }
  const slotWarnings = Array.isArray(slotModel?.validation?.warnings) ? slotModel.validation.warnings : [];
  for (const warning of slotWarnings) {
    if (String(warning?.code || "") === "SLOT_BOUNDARY_CROSSING") continue;
    addWarning({
      code: warning?.code || "GEOMETRY_SLOT_MODEL_WARNING",
      message: warning?.message || "Geometry slot model warning.",
      details: warning
    });
  }
  return {
    version: 1,
    status: errors.length === 0 ? "projected" : "blocked",
    ok: errors.length === 0,
    blocking_error_count: errors.length,
    warning_count: warnings.length,
    global_bbox: documentBBox ? cloneJson(documentBBox) : null,
    slot_width: geometryContext?.slot_width || GEOMETRY_SLOT_WIDTH_MM,
    slot_count: slots.length,
    global_spans_multiple_slots: globalSpansMultipleSlots,
    geometry_context_v1: geometryContext ? cloneJson(geometryContext) : null,
    geometry_slot_model: slotModel ? cloneJson(slotModel) : null,
    legacy_comparison: slotModel?.legacy_comparison ? cloneJson(slotModel.legacy_comparison) : null,
    errors,
    warnings
  };
}

function buildDomainValidationV1(session, view) {
  const sessionContext = view?.session_context_v1 || session?.session_context_v1 || normalizeSessionContextV1({});
  const domainContext = view?.domain_context_v1 || null;
  const semEvidence = view?.document_sem || null;
  const xdataEvidence = view?.xdata_context || null;
  const geometryContext = view?.geometry_context_v1 || null;
  const warnings = [];
  const errors = [];
  const addWarning = (item) => warnings.push({ severity: "warning", ...item });
  const addError = (item) => errors.push({ severity: "error", blocking: true, ...item });

  if (!sessionContextIsLocked(sessionContext)) {
    addError({
      code: "SESSION_CONTEXT_INVALID",
      message: "Session context must be locked before domain validation."
    });
  }
  const lifecycleState = String(session?.session_lifecycle_v1?.state || "");
  const geometryValidationOk = session?.geometry_validation_v1?.ok === true;
  const postGeometryLifecycle = ["geometry_projected", "domain_validated", "authoring_ready", "preview_ready", "child_ready", "export_ready"].includes(lifecycleState);
  if (!geometryValidationOk && !postGeometryLifecycle) {
    addError({
      code: "GEOMETRY_CONTEXT_INVALID",
      lifecycle_state: lifecycleState || null,
      message: "Geometry context must be projected before domain validation."
    });
  }

  const semFields = ["family", "product", "part"];
  if (semEvidence) {
    for (const field of semFields) {
      const semValue = normalizeDomainToken(semEvidence[field]);
      const sessionValue = normalizeDomainToken(sessionContext[`${field}_id`]);
      if (semValue && sessionValue && semValue !== sessionValue) {
        addError({
          code: "SEM_CONTEXT_MISMATCH",
          field,
          session_value: sessionContext[`${field}_id`] || null,
          sem_value: semEvidence[field] || null,
          message: `Document SEM ${field} does not match locked session context.`
        });
      }
    }
  }

  const policy = normalizeExpectedVariantPolicy(sessionContext.expected_variant_policy);
  const xdataVariantKeys = Array.isArray(xdataEvidence?.geometry_variants) ? xdataEvidence.geometry_variants : [];
  const normalizedXdataKeys = new Set(xdataVariantKeys.map(normalizeDomainToken).filter(Boolean));
  const semVariantKeys = extractSemVariantKeys(semEvidence);
  const normalizedSemVariantKeys = new Set(semVariantKeys.map(normalizeDomainToken).filter(Boolean));
  const geometrySlotIndexes = new Set((Array.isArray(geometryContext?.slots) ? geometryContext.slots : []).map((slot) => Number(slot?.slot_index)));
  const intentRows = Array.isArray(session?.execution_intent_authoring_v1?.slots) ? session.execution_intent_authoring_v1.slots : [];
  const authorizedIntentRows = intentRows.filter((row) =>
    geometrySlotIndexes.has(Number(row?.slot_index))
    && String(row?.variant_key || "").trim()
    && ["manual", "xdata", "xdata_hint", "sem"].includes(String(row?.evidence_source || "manual").trim().toLowerCase())
  );
  const intentVariantKeys = Array.from(new Set(authorizedIntentRows.map((row) => String(row.variant_key).trim()).filter(Boolean)));
  const normalizedIntentKeys = new Set(intentVariantKeys.map(normalizeDomainToken).filter(Boolean));
  const authorizedVariantKeys = new Set([...normalizedIntentKeys, ...normalizedXdataKeys, ...normalizedSemVariantKeys]);
  const expectedKeys = policy.expected_variant_keys || [];
  const normalizedExpectedKeys = new Set(expectedKeys.map(normalizeDomainToken).filter(Boolean));
  if (policy.mode === "required" && expectedKeys.length > 0) {
    for (const expectedKey of expectedKeys) {
      if (!authorizedVariantKeys.has(normalizeDomainToken(expectedKey))) {
        addError({
          code: "EXPECTED_VARIANT_UNMAPPED",
          expected_variant_key: expectedKey,
          slot_intent_variant_keys: intentVariantKeys,
          xdata_variant_keys: xdataVariantKeys,
          sem_variant_keys: semVariantKeys,
          message: "Expected variant key is not mapped by Slot Intent, XDATA, or SEM evidence."
        });
      }
    }
  }
  if (policy.mode !== "none" && normalizedExpectedKeys.size > 0) {
    for (const xdataKey of xdataVariantKeys) {
      if (!normalizedExpectedKeys.has(normalizeDomainToken(xdataKey))) {
        addWarning({
          code: "XDATA_VARIANT_UNMAPPED",
          xdata_variant_key: xdataKey,
          expected_variant_keys: expectedKeys,
          message: "XDATA variant key is outside the expected variant policy."
        });
      }
    }
  }

  if (normalizedSemVariantKeys.size > 0 && normalizedXdataKeys.size > 0) {
    const overlap = Array.from(normalizedSemVariantKeys).some((key) => normalizedXdataKeys.has(key));
    if (!overlap) {
      const item = {
        code: "SEM_XDATA_CONTRADICTION",
        sem_variant_keys: semVariantKeys,
        xdata_variant_keys: xdataVariantKeys,
        message: "SEM variant evidence contradicts XDATA variant evidence."
      };
      if (policy.mode === "optional") addWarning(item);
      else addError(item);
    }
  }

  const sessionBranchMode = normalizeBranchMode(sessionContext.branch_mode);
  const rawBranchMode = normalizeDomainToken(sessionContext.branch_mode || "ALL");
  if (sessionBranchMode !== rawBranchMode) {
    addError({
      code: "BRANCH_MODE_INVALID",
      session_branch_mode: sessionContext.branch_mode || null,
      normalized_branch_mode: sessionBranchMode,
      message: "Session branch mode is not a supported branch mode."
    });
  }
  if (domainContext?.branch_mode && sessionBranchMode !== normalizeBranchMode(domainContext.branch_mode)) {
    addWarning({
      code: "LEGACY_BRANCH_MODE_CONTEXT_MISMATCH",
      session_branch_mode: sessionContext.branch_mode || null,
      legacy_branch_mode: domainContext.branch_mode,
      message: "Legacy config branch mode differs from locked session context branch mode."
    });
  }

  const sessionParameterCatalogId = normalizeDomainToken(sessionContext.parameter_catalog_id);
  const domainParameterCatalogId = normalizeDomainToken(domainContext?.parameter_catalog_id);
  if (sessionParameterCatalogId && domainParameterCatalogId && sessionParameterCatalogId !== domainParameterCatalogId) {
    addError({
      code: "PARAMETER_CATALOG_SCOPE_MISMATCH",
      session_parameter_catalog_id: sessionContext.parameter_catalog_id || null,
      active_parameter_catalog_id: domainContext?.parameter_catalog_id || null,
      message: "Active parameter catalog does not match locked session context."
    });
  }

  const selectedRuleSetId = normalizeDomainToken(sessionContext.rule_set_id);
  const documentRuleRefs = Array.isArray(semEvidence?.rule_refs) ? semEvidence.rule_refs : [];
  if (selectedRuleSetId && documentRuleRefs.length > 0) {
    const hasSelectedRule = documentRuleRefs.some((ruleRef) => normalizeDomainToken(ruleRef) === selectedRuleSetId);
    if (!hasSelectedRule) {
      addError({
        code: "RULE_SET_SCOPE_MISMATCH",
        session_rule_set_id: sessionContext.rule_set_id || null,
        document_rule_refs: documentRuleRefs,
        message: "Document SEM rule refs do not include the locked session rule set."
      });
    }
  }

  const domainWarnings = Array.isArray(domainContext?.validation?.warnings) ? domainContext.validation.warnings : [];
  for (const warning of domainWarnings) {
    addWarning({
      code: warning?.code || "DOMAIN_CONTEXT_WARNING",
      message: warning?.message || "Domain context warning.",
      source: "domain_context_v1",
      details: warning
    });
  }

  return {
    version: 1,
    status: errors.length === 0 ? "valid" : "blocked",
    ok: errors.length === 0,
    blocking_error_count: errors.length,
    warning_count: warnings.length,
    session_context_v1: cloneJson(sessionContext),
    sem_evidence: semEvidence ? cloneJson(semEvidence) : null,
    xdata_evidence: xdataEvidence ? cloneJson(xdataEvidence) : null,
    domain_context_v1: domainContext ? cloneJson(domainContext) : null,
    geometry_context_v1_summary: geometryContext ? {
      version: geometryContext.version || 1,
      slot_width: geometryContext.slot_width || null,
      slot_count: Array.isArray(geometryContext.slots) ? geometryContext.slots.length : 0,
      validation_ok: geometryContext.validation ? Boolean(geometryContext.validation.ok) : null
    } : null,
    errors,
    warnings
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function stableJsonValue(value) {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = stableJsonValue(value[key]);
      return acc;
    }, {});
  }
  return value;
}

function hashJson(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stableJsonValue(value))).digest("hex");
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
    return value.startsWith("SEM:") || value.startsWith("TOPO:") || value.startsWith("RULE:");
  });
  if (hasDocumentLevelMetadata) return true;

  const entities = Array.isArray(session?.document?.entities) ? session.document.entities : [];
  const hasEntityMetadata = entities.some((entity) => {
    const comments = Array.isArray(entity?.preComments) ? entity.preComments : [];
    return comments.some((pair) => {
      if (String(pair?.code) !== "999") return false;
      const value = String(pair?.value || "").trim().toUpperCase();
      return value.startsWith("SEM:") || value.startsWith("TOPO:") || value.startsWith("RULE:");
    });
  });
  if (hasEntityMetadata) return true;

  return Boolean(session?.xdata_assignments && Object.keys(session.xdata_assignments).length);
}

function normalizeConfigParameterSet(input) {
  const source = input && typeof input === "object" ? input : {};
  const parameterCatalog = resolveParameterCatalogSnapshotById(source.parameter_catalog_id, DEFAULT_PARAMETER_CATALOG);
  const configContext = {
    family: String(source.family || DEFAULT_CONFIG_CONTEXT.family),
    product: String(source.product || DEFAULT_CONFIG_CONTEXT.product),
    part: String(source.part || source.product_code || ""),
    product_code: String(source.product_code || source.part || source.product || ""),
    technology_profile: String(source.technology_profile || DEFAULT_CONFIG_CONTEXT.technology_profile)
  };
  const catalogDefaults = buildDefaultConfigFromParameterCatalog(parameterCatalog, configContext);
  const baseDefaults = !source.parameter_catalog_id || source.parameter_catalog_id === DEFAULT_PARAMETER_CATALOG.catalog_id
    ? DEFAULT_CONFIG_PARAMETER_SET
    : catalogDefaults;
  const parameters = source.parameters && typeof source.parameters === "object"
    ? source.parameters
    : source.configuratorData && typeof source.configuratorData === "object"
      ? source.configuratorData
      : {};
  return {
    technology_profile: String(source.technology_profile || baseDefaults.technology_profile),
    family: String(source.family || baseDefaults.family),
    product: String(source.product || baseDefaults.product),
    part: String(source.part || baseDefaults.part || source.product_code || ""),
    product_code: String(source.product_code || source.part || baseDefaults.product_code),
    parameter_catalog_id: source.parameter_catalog_id || baseDefaults.parameter_catalog_id || null,
    parameter_scope: cloneJson(source.parameter_scope || baseDefaults.parameter_scope || {}),
    parameters: cloneJson({
      ...(baseDefaults.parameters || {}),
      ...parameters
    })
  };
}

function activeProgramIdForSession(session, config) {
  const explicitProgram = String(session?.session_context_v1?.production_program_id || "").trim().toUpperCase();
  if (explicitProgram) return explicitProgram;
  const family = String(config?.family || "").trim().toUpperCase();
  if (family === "VRATA") return "MXD";
  if (family === "SUDOPERI") return "INOX";
  return "";
}

function selectChildDxf999MetadataSet(session, config) {
  const programId = activeProgramIdForSession(session, config);
  if (programId === "INOX") return cloneJson(CHILD_DXF_999_SET_INOX);
  return cloneJson(CHILD_DXF_999_SET_MXD);
}

function has999Value(value) {
  if (value == null) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function normalize999Value(value) {
  if (!has999Value(value)) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return String(roundNumber(value, 3));
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value).trim();
}

function readPathLike(source, ref) {
  if (!source || typeof source !== "object") return undefined;
  const rawRef = String(ref || "").trim();
  if (!rawRef) return undefined;
  const directVariants = [rawRef, rawRef.toUpperCase(), rawRef.toLowerCase()];
  for (const key of directVariants) {
    if (Object.prototype.hasOwnProperty.call(source, key)) return source[key];
  }
  const segments = rawRef.split(".").filter(Boolean);
  let current = source;
  for (const segment of segments) {
    if (!current || typeof current !== "object") return undefined;
    const variants = [segment, segment.toUpperCase(), segment.toLowerCase()];
    let nextValue;
    let found = false;
    for (const key of variants) {
      if (Object.prototype.hasOwnProperty.call(current, key)) {
        nextValue = current[key];
        found = true;
        break;
      }
    }
    if (!found) return undefined;
    current = nextValue;
  }
  return current;
}

function computeChildDxfBbox(dxfText) {
  const objects = listRelevantObjects(String(dxfText || ""));
  const boxes = objects.map((object) => object?.bbox).filter(Boolean);
  if (!boxes.length) return null;
  const bbox = boxes.reduce((acc, current) => (acc ? bboxUnion(acc, current) : current), null);
  if (!bbox) return null;
  return {
    minX: roundNumber(bbox.minX),
    minY: roundNumber(bbox.minY),
    maxX: roundNumber(bbox.maxX),
    maxY: roundNumber(bbox.maxY),
    width: roundNumber(bbox.width),
    height: roundNumber(bbox.height)
  };
}

function buildChildDxf999SourceScope(session, config, dxfText) {
  const params = config?.parameters && typeof config.parameters === "object" ? config.parameters : {};
  const view = projectViewModel(session);
  const bbox = computeChildDxfBbox(dxfText);
  const selectedVariantKey = String(
    session?.execution_intent_v1?.active_variant_key
    || session?.resolver_input_v2_extended?.candidate_variant_key
    || view?.domain_context_v1?.variant_key
    || readConfigVariantKey(config)
    || ""
  ).trim() || null;
  const selectedSlotIndex = session?.execution_intent_v1?.active_slot_index
    ?? session?.resolver_input_v2_extended?.candidate_authoritative_slot_index
    ?? view?.geometry_context_v1?.authoritative_slot_index
    ?? ((Array.isArray(view?.geometry_context_v1?.slots) && view.geometry_context_v1.slots.length === 1) ? Number(view.geometry_context_v1.base_slot_index ?? 0) : null);
  const technologyProfile = String(config?.technology_profile || session?.session_context_v1?.technology_profile || "").trim() || null;
  const batchContext = {
    batch_id: readPathLike(params, "SOURCE_BATCH_ID") ?? readPathLike(params, "batch_id") ?? session?.batch_id ?? null,
    row_index: readPathLike(params, "SOURCE_ROW_INDEX") ?? readPathLike(params, "row_index") ?? session?.row_index ?? null,
    row_id: readPathLike(params, "SOURCE_ROW_ID") ?? readPathLike(params, "row_id") ?? session?.row_id ?? null,
    gosoft_document_id: readPathLike(params, "SOURCE_GOSOFT_DOCUMENT_ID") ?? readPathLike(params, "gosoft_document_id") ?? session?.gosoft_document_id ?? null,
    source_reference: readPathLike(params, "SOURCE_REFERENCE") ?? readPathLike(params, "source_reference") ?? session?.source_reference ?? null
  };
  return {
    resolver_output: {
      selected_variant_key: selectedVariantKey,
      selected_slot_index: selectedSlotIndex,
      selected_technology_profile: technologyProfile
    },
    dbr_row: cloneJson(params),
    batch_context: batchContext,
    session_context: {
      program_id: session?.session_context_v1?.production_program_id || null,
      family_id: session?.session_context_v1?.family_id || null,
      product_id: session?.session_context_v1?.product_id || null,
      part_id: session?.session_context_v1?.part_id || config?.part || null
    },
    geometry_context: {
      active_child_bbox: bbox
    }
  };
}

function parseSimpleFormulaArguments(text) {
  const args = [];
  let current = "";
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === ",") {
      args.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim() || text.endsWith(",")) args.push(current.trim());
  return args;
}

function resolveFormulaToken(token, resolvedMap, sourceScope) {
  const raw = String(token || "").trim();
  if (!raw) return "";
  if (Object.prototype.hasOwnProperty.call(resolvedMap, raw)) return resolvedMap[raw];
  if (/^-?\d+(?:\.\d+)?$/.test(raw)) return Number(raw);
  for (const key of ["resolver_output", "dbr_row", "batch_context", "session_context", "geometry_context"]) {
    const value = readPathLike(sourceScope[key], raw);
    if (value !== undefined) return value;
  }
  return raw;
}

function evaluateChildDxf999Formula(formula, resolvedMap, sourceScope) {
  const raw = String(formula || "").trim();
  const match = raw.match(/^([A-Za-z_][A-Za-z0-9_]*)\((.*)\)$/);
  if (!match) return { ok: false, error: "Unsupported formula syntax." };
  const op = match[1];
  const args = parseSimpleFormulaArguments(match[2]).map((token) => resolveFormulaToken(token, resolvedMap, sourceScope));
  switch (op) {
    case "concat":
      return { ok: true, value: args.map((value) => normalize999Value(value) || "").join("") };
    case "add": {
      const numbers = args.map((value) => Number(value));
      if (!numbers.every(Number.isFinite)) return { ok: false, error: "add expects numeric operands." };
      return { ok: true, value: numbers.reduce((sum, value) => sum + value, 0) };
    }
    case "sub": {
      const numbers = args.map((value) => Number(value));
      if (!numbers.every(Number.isFinite) || numbers.length < 2) return { ok: false, error: "sub expects at least two numeric operands." };
      return { ok: true, value: numbers.slice(1).reduce((result, value) => result - value, numbers[0]) };
    }
    case "coalesce": {
      const picked = args.find((value) => has999Value(value));
      return { ok: true, value: picked == null ? null : picked };
    }
    case "format_dim":
      return { ok: true, value: `${normalize999Value(args[0]) || ""}x${normalize999Value(args[1]) || ""}`.replace(/^x|x$/g, "") };
    default:
      return { ok: false, error: `Unsupported formula op: ${op}` };
  }
}

function resolveChildDxf999Field(field, sourceScope, resolvedMap) {
  if (String(field?.source_kind || "") === "derived") {
    return evaluateChildDxf999Formula(field?.formula, resolvedMap, sourceScope);
  }
  const explicitValue = readPathLike(sourceScope[String(field?.source_kind || "")], field?.source_ref);
  if (explicitValue !== undefined) return { ok: true, value: explicitValue, source_kind: field.source_kind, source_ref: field.source_ref };
  for (const key of ["resolver_output", "dbr_row", "batch_context", "session_context", "geometry_context"]) {
    if (key === String(field?.source_kind || "")) continue;
    const value = readPathLike(sourceScope[key], field?.source_ref || field?.key);
    if (value !== undefined) return { ok: true, value, source_kind: key, source_ref: field?.source_ref || field?.key, fallback: true };
  }
  return { ok: true, value: null, source_kind: field?.source_kind || null, source_ref: field?.source_ref || null };
}

function buildChildDxf999SerializedLines(resolvedFields) {
  const lines = [];
  for (const field of resolvedFields) {
    lines.push("999", `${field.key}:${field.value}`);
  }
  return lines;
}

function insert999LinesIntoDxfText(dxfText, serializedLines) {
  const normalized = String(dxfText || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.endsWith("\n") ? normalized.slice(0, -1).split("\n") : normalized.split("\n");
  const insertionIndex = lines.findIndex((line, index) => line === "0" && lines[index + 1] === "ENDSEC");
  if (insertionIndex >= 0) {
    const next = lines.slice(0, insertionIndex + 2).concat(serializedLines, lines.slice(insertionIndex + 2));
    return { dxf_text: next.join("\n").concat("\n"), inserted_after_first_endsec: true };
  }
  return { dxf_text: serializedLines.concat(lines).join("\n").concat("\n"), inserted_after_first_endsec: false };
}

function buildChildDxf999Enrichment(session, config, dxfText) {
  const metadataSet = selectChildDxf999MetadataSet(session, config);
  const sourceScope = buildChildDxf999SourceScope(session, config, dxfText);
  const resolvedMap = {};
  const resolvedFields = [];
  const errors = [];
  const warnings = [];
  for (const field of Array.isArray(metadataSet?.fields) ? metadataSet.fields : []) {
    const result = resolveChildDxf999Field(field, sourceScope, resolvedMap);
    if (!result.ok) {
      errors.push({ code: "CHILD_DXF_999_DERIVED_EVAL_FAILED", key: field.key, message: result.error || "Derived field evaluation failed." });
      continue;
    }
    const normalizedValue = normalize999Value(result.value);
    if (!has999Value(normalizedValue)) {
      if (field.required) {
        errors.push({ code: "CHILD_DXF_999_REQUIRED_MISSING", key: field.key, source_ref: field.source_ref || null, message: `Required 999 field ${field.key} is missing.` });
      }
      continue;
    }
    resolvedMap[field.key] = normalizedValue;
    resolvedFields.push({
      key: field.key,
      value: normalizedValue,
      source_kind: result.source_kind || field.source_kind || null,
      source_ref: result.source_ref || field.source_ref || null,
      derived: String(field?.source_kind || "") === "derived",
      fallback: result.fallback === true
    });
  }
  const serializedLines = buildChildDxf999SerializedLines(resolvedFields);
  const insertion = insert999LinesIntoDxfText(dxfText, serializedLines);
  if (!insertion.inserted_after_first_endsec) {
    warnings.push({ code: "CHILD_DXF_999_INSERTION_FALLBACK", message: "First ENDSEC not found; 999 block was prepended." });
  }
  if (errors.length > 0) {
    warnings.push({ code: "CHILD_DXF_999_INCOMPLETE", message: "One or more required 999 fields were missing; partial enrichment was still emitted." });
  }
  return {
    version: 1,
    metadata_set_id: metadataSet?.metadata_set_id || null,
    program_scope: metadataSet?.metadata?.program_scope || activeProgramIdForSession(session, config) || null,
    validation: {
      ok: errors.length === 0,
      errors,
      warnings
    },
    resolved_fields: resolvedFields,
    serialized_lines: serializedLines,
    enriched_dxf_text: insertion.dxf_text,
    insertion: {
      inserted_after_first_endsec: insertion.inserted_after_first_endsec,
      inserted_line_count: serializedLines.length
    }
  };
}

function isModuleOwnedParameterCatalog(source) {
  const catalogId = String(source?.catalog_id || "").trim();
  return !catalogId || catalogId === String(DEFAULT_PARAMETER_CATALOG.catalog_id || "").trim();
}

function resolveParameterCatalogSnapshotById(catalogId, fallback = null) {
  const normalizedId = String(catalogId || "").trim();
  if (normalizedId && PARAMETER_CATALOG_REGISTRY[normalizedId]) {
    return cloneJson(PARAMETER_CATALOG_REGISTRY[normalizedId]);
  }
  return fallback ? normalizeParameterCatalogSnapshot(fallback) : cloneJson(DEFAULT_PARAMETER_CATALOG);
}

function resolveActiveParameterCatalog(session = null, config = null, fallback = null) {
  const sessionCatalogId = String(session?.session_context_v1?.parameter_catalog_id || "").trim();
  if (sessionContextIsLocked(session?.session_context_v1)) {
    return requireRegisteredDomainArtifact(PARAMETER_CATALOG_REGISTRY, sessionCatalogId, "parameter_catalog_id", "parameter catalog");
  }
  const configCatalogId = String(config?.parameter_catalog_id || session?.config_parameter_set?.parameter_catalog_id || "").trim();
  const persistedCatalogId = String(session?.parameter_catalog?.catalog_id || "").trim();
  return resolveParameterCatalogSnapshotById(sessionCatalogId || configCatalogId || persistedCatalogId, fallback || session?.parameter_catalog || null);
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

function isModuleOwnedRuleCatalog(source) {
  const catalogId = String(source?.catalog_id || "").trim();
  return !catalogId || catalogId === String(DEFAULT_RULE_CATALOG.catalog_id || "").trim();
}

function normalizeRuleCatalogSnapshot(input) {
  const source = input && typeof input === "object" ? input : null;
  const rules = source && source.rules && typeof source.rules === "object"
    ? source.rules
    : null;
  if (!source || !rules || !Object.keys(rules).length) {
    return cloneJson(DEFAULT_RULE_CATALOG);
  }
  if (isModuleOwnedRuleCatalog(source)) {
    const normalized = cloneJson({
      ...DEFAULT_RULE_CATALOG,
      ...source,
      rules: {
        ...(source.rules || {}),
        ...(DEFAULT_RULE_CATALOG.rules || {})
      }
    });
    return normalized;
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

function parseMotherXdataAttributes(value) {
  const normalized = normalizeXdataValue(value);
  if (!normalized) return {};
  const attributes = {};
  const tokens = normalized
    .split(/[;\n]+/)
    .map((token) => String(token || "").trim())
    .filter(Boolean);
  for (const token of tokens) {
    const separatorIndex = token.indexOf("=");
    if (separatorIndex <= 0) continue;
    const key = String(token.slice(0, separatorIndex) || "").trim().toUpperCase();
    const attributeValue = String(token.slice(separatorIndex + 1) || "").trim();
    if (!key || !attributeValue) continue;
    attributes[key] = attributeValue;
  }
  return attributes;
}

function buildObservedXdataHint(attributes) {
  const source = attributes && typeof attributes === "object" ? attributes : {};
  const levelEntries = Object.entries(source)
    .filter(([key, value]) => /^RAZINA\d+$/i.test(String(key || "")) && String(value || "").trim())
    .sort(([left], [right]) => {
      const leftLevel = Number(String(left).replace(/\D+/g, ""));
      const rightLevel = Number(String(right).replace(/\D+/g, ""));
      return leftLevel - rightLevel;
    });
  if (!levelEntries.length) return null;
  return levelEntries.map(([, value]) => String(value).trim()).join("/");
}

function extractMotherXdataValue(entity) {
  const pairs = Array.isArray(entity?.pairs) ? entity.pairs : [];
  for (let index = 0; index < pairs.length; index += 1) {
    const pair = pairs[index];
    if (String(pair?.code) !== "1001") continue;
    if (String(pair?.value || "").trim() !== MOTHER_XDATA_APP_NAME) continue;
    const values = [];
    for (let nextIndex = index + 1; nextIndex < pairs.length; nextIndex += 1) {
      const nextPair = pairs[nextIndex];
      if (String(nextPair?.code) === "1001") break;
      if (String(nextPair?.code) === "1000") {
        const value = normalizeXdataValue(nextPair.value);
        if (value) values.push(value);
      }
    }
    return normalizeXdataValue(values.join(";"));
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

function mergeImportedXdataAssignments(document, input) {
  const derived = collectMotherXdataAssignments(document);
  const next = {};
  const source = input && typeof input === "object" ? input : {};
  for (const [entityId, assignment] of Object.entries(source)) {
    if (!findEntity(document, entityId)) continue;
    if (Object.prototype.hasOwnProperty.call(derived, entityId)) continue;
    const value = normalizeXdataValue(assignment && typeof assignment === "object" ? assignment.value : assignment);
    if (!value) continue;
    next[entityId] = {
      app: MOTHER_XDATA_APP_NAME,
      value
    };
  }
  for (const [entityId, assignment] of Object.entries(derived)) {
    next[entityId] = {
      app: MOTHER_XDATA_APP_NAME,
      value: normalizeXdataValue(assignment && typeof assignment === "object" ? assignment.value : assignment)
    };
  }
  return normalizeXdataAssignments(document, next);
}

function collectEntityXdataMetadata(session, entityId) {
  const assignment = session?.xdata_assignments && session.xdata_assignments[entityId]
    ? session.xdata_assignments[entityId]
    : null;
  if (!assignment || !normalizeXdataValue(assignment.value)) return null;
  const value = normalizeXdataValue(assignment.value);
  const attributes = parseMotherXdataAttributes(value);
  const keys = Object.keys(attributes);
  const rawGeometryVariant = String(attributes.GEOMETRY_VARIANT || "").trim() || null;
  const observedXdataHint = buildObservedXdataHint(attributes);
  let branchIssue = null;
  if (!rawGeometryVariant && !observedXdataHint) {
    branchIssue = "missing_geometry_variant";
  } else if (keys.length !== 1 && rawGeometryVariant) {
    branchIssue = "unexpected_branch_attributes";
  }
  return {
    app: MOTHER_XDATA_APP_NAME,
    value,
    attributes,
    geometry_variant: branchIssue ? null : rawGeometryVariant,
    raw_geometry_variant: rawGeometryVariant,
    observed_xdata_hint: observedXdataHint,
    xdata_classification: rawGeometryVariant
      ? (branchIssue ? "invalid_branch_variant" : "branch_variant")
      : (observedXdataHint ? "classification_hint" : "unrecognized"),
    branch_valid: rawGeometryVariant ? !branchIssue : (observedXdataHint ? null : false),
    branch_issue: branchIssue
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
  return normalizeTopoCommentsInput(dxfText).filter((value) => isFileLevelTopoComment(value));
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

function trimWrappingParens(rawClause) {
  const text = String(rawClause || "").trim();
  if (!text.startsWith("(") || !text.endsWith(")")) return text;
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (depth < 0) return text;
    if (depth === 0 && index < text.length - 1) return text;
  }
  return depth === 0 ? text.slice(1, -1).trim() : text;
}

function parseWhenClause(rawClause) {
  const raw = trimWrappingParens(rawClause);
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

function parseRuleComment(rawValue) {
  const raw = String(rawValue || "").trim();
  if (!raw.toUpperCase().startsWith("RULE:")) return null;
  const body = raw.slice(5).trim();
  const pairs = body ? body.split(";").map((item) => item.trim()).filter(Boolean) : [];
  const keys = {};
  const errors = [];

  for (const pair of pairs) {
    const idx = pair.indexOf("=");
    if (idx <= 0 || idx === pair.length - 1) {
      errors.push({
        code: "INVALID_RULE_PAIR",
        message: `Invalid RULE pair: ${pair}`
      });
      continue;
    }
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (!key) {
      errors.push({
        code: "EMPTY_RULE_KEY",
        message: "RULE key is empty."
      });
      continue;
    }
    if (!value) {
      errors.push({
        code: "EMPTY_RULE_VALUE",
        message: `RULE value for key ${key} is empty.`
      });
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(keys, key)) {
      errors.push({
        code: "DUPLICATE_RULE_KEY",
        message: `Duplicate RULE key: ${key}`
      });
      continue;
    }
    keys[key] = value;
  }

  const when_expression = keys.when ? parseWhenExpression(keys.when) : null;
  if (keys.when && !when_expression) {
    errors.push({
      code: "INVALID_RULE_WHEN",
      message: `Invalid RULE when expression: ${keys.when}`
    });
  }

  return {
    namespace: "RULE",
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
  const suppliedDimensions = source.nominal_dimensions && typeof source.nominal_dimensions === "object"
    ? source.nominal_dimensions
    : {};
  const legacyDimensions = {
    ...(source.nominal_length != null ? { length: source.nominal_length } : {}),
    ...(source.nominal_width != null ? { width: source.nominal_width } : {}),
    ...(source.nominal_height != null ? { height: source.nominal_height } : {})
  };
  const dimensionSource = Object.keys(suppliedDimensions).length ? suppliedDimensions : legacyDimensions;
  const nominalDimensions = {};
  for (const [rawSemantic, rawValue] of Object.entries(dimensionSource)) {
    const semantic = String(rawSemantic || "").trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_");
    if (!semantic) continue;
    nominalDimensions[semantic] = coerceDocumentSemNumber(rawValue, "nominal_dimensions." + semantic);
  }
  if (!Object.keys(nominalDimensions).length) {
    throw new Error("Missing document SEM nominal_dimensions.");
  }
  const family = String(source.family || "").trim();
  const product = String(source.product || "").trim();
  const part = String(source.part || source.product_code || "").trim();
  if (!family) throw new Error("Missing document SEM family.");
  if (!product) throw new Error("Missing document SEM product.");
  if (!part) throw new Error("Missing document SEM part.");
  return {
    nominal_dimensions: nominalDimensions,
    nominal_length: nominalDimensions.length ?? null,
    nominal_width: nominalDimensions.width ?? null,
    nominal_height: nominalDimensions.height ?? null,
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
  const preferredOrder = ["length", "width", "height"];
  const dimensionKeys = Object.keys(sem.nominal_dimensions || {}).sort((a, b) => {
    const ai = preferredOrder.indexOf(a);
    const bi = preferredOrder.indexOf(b);
    if (ai >= 0 || bi >= 0) return (ai >= 0 ? ai : preferredOrder.length) - (bi >= 0 ? bi : preferredOrder.length);
    return a.localeCompare(b);
  });
  return [
    "SEM:document=true",
    ...dimensionKeys.map((key) => "nominal_" + key + "=" + formatDocumentSemNumber(sem.nominal_dimensions[key])),
    "family=" + sem.family,
    "product=" + sem.product,
    "part=" + sem.part
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
    return Object.keys(keys).some((key) => key.startsWith("nominal_")) || keys.family || keys.product || keys.part;
  }) || null;
  const ruleComments = parsedComments.filter((parsed) => String(parsed.keys?.rule_ref || "").trim());
  const keys = identity?.keys || {};
  const nominalDimensions = {};
  for (const [key, value] of Object.entries(keys)) {
    if (!key.startsWith("nominal_")) continue;
    const semantic = key.slice("nominal_".length);
    const numeric = Number(value);
    if (semantic && Number.isFinite(numeric)) nominalDimensions[semantic] = numeric;
  }
  return {
    nominal_dimensions: nominalDimensions,
    nominal_length: nominalDimensions.length ?? null,
    identity_raw_comment: identity?.raw_comment || null,
    raw_comments: parsedComments.map((parsed) => parsed.raw_comment),
    nominal_width: nominalDimensions.width ?? null,
    nominal_height: nominalDimensions.height ?? null,
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

function collectDocumentRuleMetadata(parsedDocument) {
  const comments = Array.isArray(parsedDocument?.preComments) ? parsedDocument.preComments : [];
  const parsedRules = comments
    .filter((pair) => String(pair?.code) === "999")
    .map((pair) => parseRuleComment(pair.value))
    .filter(Boolean);
  const validationErrors = parsedRules.flatMap((item) => item.validation?.errors || []);
  return {
    raw_comments: parsedRules.map((item) => item.raw_comment),
    parsed: parsedRules,
    validation: {
      ok: validationErrors.length === 0,
      errors: validationErrors,
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

function ruleMatchesGeometryBranch(rule, branchMode) {
  return coreRuleMatchesGeometryBranch(rule, branchMode);
}

function resolveExecutableDocumentRules(session, parameters, branchMode = "ALL") {
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
    if (!ruleMatchesGeometryBranch(rule, branchMode)) continue;
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

function lineShapeToPointsLocal(shape) {
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

function linePointsToShapeLocal(line) {
  if (!line?.startPoint || !line?.endPoint) return null;
  return {
    kind: "line",
    x1: Number(line.startPoint.x),
    y1: Number(line.startPoint.y),
    x2: Number(line.endPoint.x),
    y2: Number(line.endPoint.y)
  };
}

function lineOrientationLocal(shape, tolerance = 0.5) {
  const line = lineShapeToPointsLocal(shape);
  if (!line) return null;
  const dx = Math.abs(Number(line.endPoint.x) - Number(line.startPoint.x));
  const dy = Math.abs(Number(line.endPoint.y) - Number(line.startPoint.y));
  if (dx <= tolerance && dy <= tolerance) return null;
  if (dx <= tolerance) return "vertical";
  if (dy <= tolerance) return "horizontal";
  return dx >= dy ? "horizontal" : "vertical";
}

function strictOrthogonalLineOrientation(shape, tolerance = 0.5) {
  const line = lineShapeToPointsLocal(shape);
  if (!line) return null;
  const dx = Math.abs(Number(line.endPoint.x) - Number(line.startPoint.x));
  const dy = Math.abs(Number(line.endPoint.y) - Number(line.startPoint.y));
  if (dx <= tolerance && dy <= tolerance) return null;
  if (dx <= tolerance) return "vertical";
  if (dy <= tolerance) return "horizontal";
  return null;
}

function pointsOverlapLocal(a, b, tolerance = 0.5) {
  const ax = Number(a?.x);
  const ay = Number(a?.y);
  const bx = Number(b?.x);
  const by = Number(b?.y);
  if (![ax, ay, bx, by].every(Number.isFinite)) return false;
  return Math.abs(ax - bx) <= tolerance && Math.abs(ay - by) <= tolerance;
}

function collectMovedLineJoinPairs(objects, preRuleShapeSnapshot, affectedObjectIds) {
  const pairs = [];
  const objectList = Array.isArray(objects) ? objects : [];
  for (const object of objectList) {
    if (!affectedObjectIds.has(object.id)) continue;
    const objectShapes = preRuleShapeSnapshot.get(object.id) || cloneShapes(object?.shapes);
    for (let shapeIndex = 0; shapeIndex < objectShapes.length; shapeIndex += 1) {
      const shape = objectShapes[shapeIndex];
      if (!shape || shape.kind !== "line") continue;
      if (lineOrientationLocal(shape) !== "horizontal") continue;
      const line = lineShapeToPointsLocal(shape);
      if (!line) continue;
      const movedVertices = [
        { moved_vertex: "start", point: line.startPoint },
        { moved_vertex: "end", point: line.endPoint }
      ];
      for (const candidateObject of objectList) {
        if (candidateObject.id === object.id) continue;
        const candidateShapes = preRuleShapeSnapshot.get(candidateObject.id) || cloneShapes(candidateObject?.shapes);
        for (let candidateShapeIndex = 0; candidateShapeIndex < candidateShapes.length; candidateShapeIndex += 1) {
          const candidateShape = candidateShapes[candidateShapeIndex];
          if (!candidateShape || candidateShape.kind !== "line") continue;
          if (lineOrientationLocal(candidateShape) !== "vertical") continue;
          const candidateLine = lineShapeToPointsLocal(candidateShape);
          if (!candidateLine) continue;
          const candidateVertices = [
            { candidate_vertex: "start", point: candidateLine.startPoint },
            { candidate_vertex: "end", point: candidateLine.endPoint }
          ];
          for (const movedVertex of movedVertices) {
            for (const candidateVertex of candidateVertices) {
              if (!pointsOverlapLocal(movedVertex.point, candidateVertex.point)) continue;
              pairs.push({
                moved_object_id: object.id,
                moved_shape_index: shapeIndex,
                moved_vertex: movedVertex.moved_vertex,
                candidate_object_id: candidateObject.id,
                candidate_shape_index: candidateShapeIndex,
                candidate_vertex: candidateVertex.candidate_vertex
              });
            }
          }
        }
      }
    }
  }
  return pairs;
}

function trimVerticalLineEndpointToPoint(shape, vertexName, point) {
  if (!shape || shape.kind !== "line") return shape;
  const x1 = Number(shape.x1);
  const y1 = Number(shape.y1);
  const x2 = Number(shape.x2);
  const y2 = Number(shape.y2);
  const px = Number(point?.x);
  const py = Number(point?.y);
  if (![x1, y1, x2, y2, px, py].every(Number.isFinite)) return shape;
  if (Math.abs(x1 - x2) > 0.5) return shape;
  if (vertexName === "start") {
    return { kind: "line", x1: px, y1: py, x2, y2 };
  }
  return { kind: "line", x1, y1, x2: px, y2: py };
}

function applyBottomOffsetArcEndpointVerticalTrimPostPass(objectMap, objects, preRuleShapeSnapshot, offsetY) {
  const movedArcEndpoints = [];
  for (const object of Array.isArray(objects) ? objects : []) {
    if (String(object?.primary_layer || "").trim().toUpperCase() !== "B") continue;
    const preview = objectMap.get(object.id);
    if (!preview || Math.abs(Number(preview.applied_offset?.dy || 0)) <= 0) continue;
    const originalShapes = preRuleShapeSnapshot.get(object.id) || cloneShapes(object?.shapes);
    const currentShapes = Array.isArray(preview.simulated_shapes) ? preview.simulated_shapes : [];
    const limit = Math.min(originalShapes.length, currentShapes.length);
    for (let index = 0; index < limit; index += 1) {
      const originalShape = originalShapes[index];
      const currentShape = currentShapes[index];
      if (!originalShape || !currentShape) continue;
      if (originalShape.kind !== "arc" || currentShape.kind !== "arc") continue;
      const originalEndpoints = arcEndpoints(originalShape);
      const currentEndpoints = arcEndpoints(currentShape);
      if (!originalEndpoints?.start || !originalEndpoints?.end || !currentEndpoints?.start || !currentEndpoints?.end) continue;
      movedArcEndpoints.push({
        object_id: object.id,
        shape_index: index,
        original_bbox: object?.bbox ? cloneJson(object.bbox) : null,
        current_bbox: preview?.simulated_bbox ? cloneJson(preview.simulated_bbox) : (object?.bbox ? cloneJson(object.bbox) : null),
        start: { original: originalEndpoints.start, current: currentEndpoints.start },
        end: { original: originalEndpoints.end, current: currentEndpoints.end }
      });
    }
  }

  if (!movedArcEndpoints.length) return;
  const gapLimit = Math.abs(Number(offsetY || 0)) + 2;
  const originalEndpointTolerance = 1.5;

  for (const object of Array.isArray(objects) ? objects : []) {
    const preview = objectMap.get(object.id);
    if (!preview || Math.abs(Number(preview.applied_offset?.dy || 0)) > 0) continue;
    const originalShapes = preRuleShapeSnapshot.get(object.id) || cloneShapes(object?.shapes);
    const currentShapes = Array.isArray(preview.simulated_shapes) ? preview.simulated_shapes : [];
    preview.simulated_shapes = currentShapes.map((shape, index) => {
      const originalShape = originalShapes[index];
      if (!shape || shape.kind !== "line" || !originalShape || originalShape.kind !== "line") return shape;
      const originalShapeBBox = bboxFromShapes([originalShape]);
      const ox1 = Number(originalShape.x1);
      const oy1 = Number(originalShape.y1);
      const ox2 = Number(originalShape.x2);
      const oy2 = Number(originalShape.y2);
      if (![ox1, oy1, ox2, oy2].every(Number.isFinite)) return shape;
      if (Math.abs(ox1 - ox2) > 0.5) return shape;

      const originalVertices = [
        { vertex: "start", point: { x: ox1, y: oy1 } },
        { vertex: "end", point: { x: ox2, y: oy2 } }
      ];

      for (const originalVertex of originalVertices) {
        const matches = [];
        for (const candidate of movedArcEndpoints) {
          const localNeighbor = bboxIntersects(originalShapeBBox, candidate.original_bbox || candidate.current_bbox, 12)
            || bboxIntersects(originalShapeBBox, candidate.current_bbox || candidate.original_bbox, 12);
          if (!localNeighbor) continue;
          for (const endpointName of ["start", "end"]) {
            const endpoint = candidate[endpointName];
            if (!endpoint?.original || !endpoint?.current) continue;
            const sameOriginalColumn = Math.abs(originalVertex.point.x - endpoint.original.x) <= originalEndpointTolerance;
            if (!sameOriginalColumn) continue;
            const currentVertex = originalVertex.vertex === "start"
              ? { x: Number(shape.x1), y: Number(shape.y1) }
              : { x: Number(shape.x2), y: Number(shape.y2) };
            const dx = Math.abs(currentVertex.x - endpoint.current.x);
            const dy = Math.abs(currentVertex.y - endpoint.current.y);
            if (dx > 2 || dy > gapLimit) continue;
            matches.push(endpoint.current);
          }
        }
        const unique = Array.from(new Map(matches.map((point) => [`${roundNumber(point.x, 3)}:${roundNumber(point.y, 3)}`, point])).values());
        if (unique.length === 1) {
          return trimVerticalLineEndpointToPoint(shape, originalVertex.vertex, unique[0]);
        }
      }
      return shape;
    });
    preview.simulated_bbox = preview.simulated_shapes.length
      ? bboxFromShapes(preview.simulated_shapes)
      : (object?.bbox ? cloneJson(object.bbox) : null);
  }
}

function applyMovedLineJoinRestorePostPass(objectMap, movedJoinPairs) {
  for (const pair of Array.isArray(movedJoinPairs) ? movedJoinPairs : []) {
    const movedPreview = objectMap.get(pair.moved_object_id);
    const candidatePreview = objectMap.get(pair.candidate_object_id);
    if (!movedPreview || !candidatePreview) continue;
    const movedShape = Array.isArray(movedPreview.simulated_shapes) ? movedPreview.simulated_shapes[pair.moved_shape_index] : null;
    const candidateShape = Array.isArray(candidatePreview.simulated_shapes) ? candidatePreview.simulated_shapes[pair.candidate_shape_index] : null;
    const movedLine = lineShapeToPointsLocal(movedShape);
    const candidateLine = lineShapeToPointsLocal(candidateShape);
    if (!movedLine || !candidateLine) continue;
    const intersection = lineLineIntersection(movedLine, candidateLine);
    if (!intersection) continue;
    const trimmedCandidate = trimLineToPoint(
      candidateLine,
      intersection,
      pair.candidate_vertex === "start" ? "end" : "start"
    );
    if (!trimmedCandidate) continue;
    candidatePreview.simulated_shapes[pair.candidate_shape_index] = linePointsToShapeLocal(trimmedCandidate) || candidateShape;
  }
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

function applyDocumentRulesToSimulationMap(session, objects, parameters, objectMap, topologyMode, branchMode = "ALL") {
  if (!objectMap || !Array.isArray(objects) || !objects.length) {
    return { applied_rules: [] };
  }
  const executableRules = resolveExecutableDocumentRules(session, parameters, branchMode);
  if (!executableRules.length) {
    return { applied_rules: [] };
  }

  const appliedRules = [];

  for (const rule of executableRules) {
    const action = rule && typeof rule.action === "object" ? rule.action : {};
    const targetScope = rule && typeof rule.target_scope === "object" ? rule.target_scope : {};
    const targetLayer = String(targetScope.layer || "").trim().toUpperCase();
    const targetBranch = String(targetScope.geometry_branch || targetScope.branch || "").trim();
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
    const affectedObjectIds = new Set(affectedObjects.map((object) => object.id));

    for (const object of objects) {
      const preview = objectMap.get(object.id);
      preRuleShapeSnapshot.set(
        object.id,
        cloneShapes(Array.isArray(preview?.simulated_shapes) ? preview.simulated_shapes : object?.shapes)
      );
    }
    const movedLineJoinPairs = axis === "Y" && dy > 0 && targetLayer === "B"
      ? collectMovedLineJoinPairs(objects, preRuleShapeSnapshot, affectedObjectIds)
      : [];

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
      applyBottomOffsetArcEndpointVerticalTrimPostPass(objectMap, objects, preRuleShapeSnapshot, dy);
      applyMovedLineJoinRestorePostPass(objectMap, movedLineJoinPairs);
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
      target_branch: targetBranch || null,
      axis,
      value_mm: valueMm,
      affected_count: affectedObjects.length
    });
  }

  return {
    applied_rules: appliedRules
  };
}

function evaluateWhenExpression(whenExpression, parameters) {
  const clauses = Array.isArray(whenExpression?.clauses) ? whenExpression.clauses : [];
  if (!clauses.length) return true;
  const clauseResults = clauses.map((clause) => {
    return compareInstructionValues(parameters?.[clause.parameter], clause.expected, clause.operator);
  });
  return whenExpression.logical_operator === "OR"
    ? clauseResults.some(Boolean)
    : clauseResults.every(Boolean);
}

function evaluateNumericValueExpression(expression, parameters, defaultValue = 0) {
  const raw = String(expression ?? "").trim();
  const fallback = Number(defaultValue);
  if (!raw) return Number.isFinite(fallback) ? fallback : 0;
  const direct = Number(raw);
  if (Number.isFinite(direct)) return direct;
  let missingParameter = false;
  const substituted = raw.replace(/\b[A-Za-z_][A-Za-z0-9_]*\b/g, (name) => {
    const value = Number(parameters?.[name]);
    if (!Number.isFinite(value)) {
      missingParameter = true;
      return "NaN";
    }
    return String(value);
  });
  if (missingParameter || /[^0-9+\-*/().\s]/.test(substituted)) {
    return Number.isFinite(fallback) ? fallback : 0;
  }
  try {
    const value = Function(`"use strict"; return (${substituted});`)();
    return Number.isFinite(Number(value)) ? Number(value) : (Number.isFinite(fallback) ? fallback : 0);
  } catch (_err) {
    return Number.isFinite(fallback) ? fallback : 0;
  }
}

function executablePostTopoRules(session, parameters) {
  const directRules = collectDocumentRuleMetadata(session?.document).parsed || [];
  const normalizedDirectRules = directRules
    .filter((rule) => rule.validation?.ok !== false)
    .map((rule) => {
      const keys = rule.keys || {};
      const stage = String(keys.stage || "").trim().toLowerCase();
      const geometry = String(keys.geometry || "").trim().toLowerCase();
      const targetGroup = String(keys.target_group || "").trim();
      const axis = String(keys.axis || "").trim().toUpperCase();
      if (stage !== "post_topo" || geometry !== "offset" || !targetGroup || !["X", "Y"].includes(axis)) {
        return null;
      }
      if (rule.when_expression && !evaluateWhenExpression(rule.when_expression, parameters)) {
        return null;
      }
      const defaultValue = Number(keys.default || 0);
      const valueMm = evaluateNumericValueExpression(
        keys.value_expr || keys.value_mm,
        parameters,
        Number.isFinite(defaultValue) ? defaultValue : 0
      );
      return {
        rule_id: String(keys.id || "").trim() || null,
        raw_comment: rule.raw_comment,
        target_group: targetGroup,
        axis,
        value_mm: valueMm,
        dx: axis === "X" ? valueMm : 0,
        dy: axis === "Y" ? valueMm : 0,
        value_expr: keys.value_expr || null,
        post_repair: String(keys.post_repair || "").trim().toLowerCase() || null
      };
    })
    .filter(Boolean);
  const catalogRules = resolveExecutablePostTopoCatalogRules(session, parameters);
  return normalizedDirectRules.concat(catalogRules);
}

function resolveExecutablePostTopoCatalogRules(session, parameters) {
  const documentSem = collectDocumentSemMetadata(session?.document);
  const ruleRefs = Array.isArray(documentSem?.rule_refs) ? documentSem.rule_refs : [];
  if (!ruleRefs.length) return [];
  const catalog = normalizeRuleCatalogSnapshot(session?.rule_catalog);
  const catalogRules = catalog && catalog.rules && typeof catalog.rules === "object" ? catalog.rules : {};
  const activeProfile = String(catalog?.profile_id || "").trim().toUpperCase();
  const rules = [];

  for (const ruleRef of ruleRefs) {
    const rule = catalogRules[ruleRef];
    if (!rule || typeof rule !== "object") continue;
    const action = rule.action && typeof rule.action === "object" ? rule.action : {};
    const targetScope = rule.target_scope && typeof rule.target_scope === "object" ? rule.target_scope : {};
    const profileScope = String(rule.profile_scope || "").trim().toUpperCase();
    const stage = String(action.stage || "").trim().toLowerCase();
    const geometry = String(action.geometry || "").trim().toLowerCase();
    const targetGroup = String(targetScope.post_topo_group || targetScope.target_group || "").trim();
    const axis = String(action.axis || "").trim().toUpperCase();
    if (profileScope && activeProfile && !activeProfile.includes(profileScope)) continue;
    if (stage !== "post_topo" || geometry !== "offset" || !targetGroup || !["X", "Y"].includes(axis)) continue;
    if (rule.condition && !evaluateCatalogRuleCondition(rule.condition, parameters)) continue;
    const defaultValue = Number(action.default || 0);
    const valueMm = evaluateNumericValueExpression(
      action.value_expr || action.value_mm,
      parameters,
      Number.isFinite(defaultValue) ? defaultValue : 0
    );
    rules.push({
      rule_id: String(rule.rule_id || ruleRef).trim() || null,
      raw_comment: null,
      catalog_rule_ref: ruleRef,
      target_group: targetGroup,
      axis,
      value_mm: valueMm,
      dx: axis === "X" ? valueMm : 0,
      dy: axis === "Y" ? valueMm : 0,
      value_expr: action.value_expr || null,
      post_repair: String(action.post_repair || "").trim().toLowerCase() || null
    });
  }

  return rules;
}

function objectHasPostTopoGroup(object, targetGroup) {
  const normalizedTarget = String(targetGroup || "").trim();
  if (!normalizedTarget) return false;
  const parsed = Array.isArray(object?.semantic_metadata?.parsed) ? object.semantic_metadata.parsed : [];
  return parsed.some((record) => {
    const group = String(record?.keys?.post_topo_group || "").trim();
    return group === normalizedTarget;
  });
}

function applyBoundedTrimRejoinPostPass(objectMap, objects, parameters, affectedObjects, preRuleShapeSnapshot, ruleId) {
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
          post_topo_rule_id: ruleId || null
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

function applyPostTopoRulesToSimulationMap(session, objects, parameters, objectMap) {
  if (!objectMap || !Array.isArray(objects) || !objects.length) {
    return { applied_rules: [] };
  }
  const rules = executablePostTopoRules(session, parameters);
  const appliedRules = [];

  for (const rule of rules) {
    const affectedObjects = objects.filter((object) => {
      if (!objectHasPostTopoGroup(object, rule.target_group)) return false;
      return evaluateChildEntityInclusion(object, parameters)?.included !== false;
    });
    if (!affectedObjects.length) continue;
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
      preview.simulated_shapes = currentShapes.map((shape) => translateShape(shape, rule.dx, rule.dy));
      const priorOffset = preview.applied_offset && typeof preview.applied_offset === "object"
        ? preview.applied_offset
        : { dx: 0, dy: 0 };
      preview.applied_offset = {
        dx: Number(priorOffset.dx || 0) + rule.dx,
        dy: Number(priorOffset.dy || 0) + rule.dy
      };
      preview.post_topo_rule_actions = Array.isArray(preview.post_topo_rule_actions)
        ? preview.post_topo_rule_actions
        : [];
      preview.post_topo_rule_actions.push({
        rule_id: rule.rule_id,
        target_group: rule.target_group,
        axis: rule.axis,
        value_mm: rule.value_mm,
        value_expr: rule.value_expr
      });
      preview.geometry_simulation_mode = `${preview.geometry_simulation_mode || "identity"}|post_topo_rules`;
    }
    if (rule.post_repair === "bounded_trim_rejoin") {
      applyBoundedTrimRejoinPostPass(objectMap, objects, parameters, affectedObjects, preRuleShapeSnapshot, rule.rule_id);
    }
    for (const object of objects) {
      const preview = objectMap.get(object.id);
      if (!preview) continue;
      preview.simulated_bbox = Array.isArray(preview.simulated_shapes) && preview.simulated_shapes.length
        ? bboxFromShapes(preview.simulated_shapes)
        : (object?.bbox ? cloneJson(object.bbox) : null);
    }
    appliedRules.push({
      rule_id: rule.rule_id,
      target_group: rule.target_group,
      axis: rule.axis,
      value_mm: rule.value_mm,
      value_expr: rule.value_expr,
      post_repair: rule.post_repair,
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
  const sources = normalizeTopoCommentsInput(parsedDocument?.topo_comments).filter((value) => isFileLevelTopoComment(value));

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

function isEntityLevelTopoRole(topoObject) {
  const role = String(topoObject?.keys?.role || "").trim();
  return Boolean(role);
}

function isFileLevelTopoDefinition(topoObject) {
  return Boolean(topoObject) && !isEntityLevelTopoRole(topoObject);
}

function validateTopoBlock(topoObject) {
  const errors = [];
  const mode = String(topoObject?.mode || "").trim();
  const keys = topoObject?.keys || {};
  const role = String(keys.role || "").trim();
  if (role) {
    if (role !== "mover") {
      errors.push({
        code: "INVALID_TOPO_ROLE",
        message: `Unsupported entity TOPO role: ${keys.role}`
      });
    }
    if (!String(keys.group || "").trim()) {
      errors.push({
        code: "MISSING_TOPO_ROLE_GROUP",
        message: "Missing entity TOPO role group."
      });
    }
    const zone = String(keys.zone || "").trim().toUpperCase();
    if (!["LEC", "REC"].includes(zone)) {
      errors.push({
        code: "INVALID_TOPO_ROLE_ZONE",
        message: `Unsupported entity TOPO role zone: ${keys.zone}`
      });
    }
    return {
      ok: errors.length === 0,
      errors
    };
  }
  if (mode === "4_band_parameter_resize") {
    const profile = String(keys.profile || "standard_parametric_resize").trim();
    if (profile !== "standard_parametric_resize") {
      errors.push({
        code: "INVALID_TOPO_4BAND_PROFILE",
        message: "Unsupported 4-band TOPO profile: " + keys.profile
      });
    }
    for (const band of ["l", "r", "t", "b"]) {
      const upperBand = band.toUpperCase();
      const parameterKey = band + "_parameter";
      const nominalKey = band + "_nominal";
      const axisKey = band + "_axis";
      const deltaFactorKey = band + "_delta_factor";
      if (!String(keys[parameterKey] || "").trim()) {
        errors.push({
          code: "MISSING_TOPO_4BAND_PARAMETER",
          message: "Missing 4-band " + upperBand + " parameter."
        });
      }
      if (!Number.isFinite(Number(keys[nominalKey]))) {
        errors.push({
          code: "INVALID_TOPO_4BAND_NOMINAL",
          message: "Invalid 4-band " + upperBand + " nominal: " + keys[nominalKey]
        });
      }
      const axis = String(keys[axisKey] || "").trim().toUpperCase();
      const expectedAxis = band === "l" || band === "r" ? "X" : "Y";
      if (axis !== expectedAxis) {
        errors.push({
          code: "INVALID_TOPO_4BAND_AXIS",
          message: "Invalid 4-band " + upperBand + " axis: " + keys[axisKey]
        });
      }
      if (!Number.isFinite(Number(keys[deltaFactorKey]))) {
        errors.push({
          code: "INVALID_TOPO_4BAND_DELTA_FACTOR",
          message: "Invalid 4-band " + upperBand + " delta factor: " + keys[deltaFactorKey]
        });
      }
    }
    return {
      ok: errors.length === 0,
      errors
    };
  }

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
  const items = Array.isArray(topoObjects) ? topoObjects.filter(isFileLevelTopoDefinition) : [];
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
    profile: firstValid.topo.keys?.profile || null,
    sliding_band: firstValid.topo.sliding_band,
    fixed_dimension: firstValid.topo.fixed_dimension,
    inner_side: firstValid.topo.inner_side,
    outer_side: firstValid.topo.outer_side,
    raw_comment: firstValid.topo.raw_comment,
    keys: cloneJson(firstValid.topo.keys || {}),
    source_count: items.length,
    validation: firstValid.validation
  };
}

function projectTopoMetadata(session) {
  const raw_comments = normalizeTopoCommentsInput(session?.topo_comments).filter((value) => isFileLevelTopoComment(value));
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
  const file_level = parsed.filter(isFileLevelTopoDefinition);
  const entity_roles = parsed.filter(isEntityLevelTopoRole);
  const runtime_model = normalizeTopoRuntimeModel(parsed);

  return {
    raw_comments,
    parsed,
    file_level,
    entity_roles,
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

function entityHandle(entity) {
  return String(pairValue(entity || {}, "5", "") || "").trim().toUpperCase() || null;
}

function rawReferenceForEntity(entity, extra = {}) {
  if (!entity) return null;
  return {
    handle: entityHandle(entity),
    line_start: Number(entity?.source?.line_start || 0) || null,
    line_end: Number(entity?.source?.line_end || 0) || null,
    block_name: extra.block_name || entity?.blockName || entity?.block_name || null,
    parent_insert_id: extra.parent_insert_id || null,
    parent_insert_handle: extra.parent_insert_handle || null
  };
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

function clearFileLevelTopoComment(session) {
  const comments = Array.isArray(session?.document?.preComments) ? session.document.preComments : [];
  session.document.preComments = comments.filter((pair) => !(String(pair?.code) === "999" && isFileLevelTopoComment(pair.value)));
  session.topo_comments = [];
}

function upsertSemanticComment(document, entityId, rawComment, replaceComment = "") {
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
    const oldComment = String(replaceComment || "").trim();
    if (oldComment && value === oldComment) return false;
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

function nextRuntimeEntityId(document) {
  const nums = (Array.isArray(document?.entities) ? document.entities : [])
    .map((entity) => /^ent_(\d+)$/i.exec(String(entity?.id || "")))
    .filter(Boolean)
    .map((match) => Number(match[1]))
    .filter(Number.isFinite);
  return `ent_${(nums.length ? Math.max(...nums) : 0) + 1}`;
}

function makeRuntimeLineEntity({ id, x1, y1, x2, y2, layer = "0", preComments = [] }) {
  const pairs = [
    { code: "0", value: "LINE" },
    { code: "8", value: String(layer || "0") },
    { code: "10", value: String(roundNumber(Number(x1), 3)) },
    { code: "20", value: String(roundNumber(Number(y1), 3)) },
    { code: "30", value: "0" },
    { code: "11", value: String(roundNumber(Number(x2), 3)) },
    { code: "21", value: String(roundNumber(Number(y2), 3)) },
    { code: "31", value: "0" }
  ];
  return {
    id,
    type: "LINE",
    pairs,
    preComments: clonePairsForRuntime(preComments),
    section: "ENTITIES",
    blockName: null,
    source: null
  };
}

function labelAnchorComment({ ruleId, width, height, rotation, coordinateSpace = "raw_part" }) {
  return [
    `SEM:label_anchor=${String(ruleId || "").trim()}`,
    "role=envelope",
    `coordinate_space=${String(coordinateSpace || "raw_part").trim()}`,
    `width=${roundNumber(Number(width || 0), 3)}`,
    `height=${roundNumber(Number(height || 0), 3)}`,
    `rotation=${roundNumber(Number(rotation || 0), 3)}`
  ].join(";");
}

function isLabelAnchorEntityForRule(entity, ruleId) {
  const target = String(ruleId || "").trim();
  if (!target) return false;
  const comments = Array.isArray(entity?.preComments) ? entity.preComments : [];
  return comments.some((pair) => {
    if (String(pair?.code) !== "999") return false;
    const parsed = parseSemanticComment(pair.value);
    return parsed && String(parsed.keys?.label_anchor || "").trim() === target;
  });
}

function labelAnchorObjects(objects) {
  return (Array.isArray(objects) ? objects : []).filter((object) => {
    const records = Array.isArray(object?.semantic_metadata?.parsed) ? object.semantic_metadata.parsed : [];
    return records.some((record) => String(record?.keys?.label_anchor || "").trim());
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

function suggestSlotLayerForBBox(objectBBox, slotBBox, bands) {
  if (!objectBBox || !slotBBox) return null;
  const center = bboxCenter(objectBBox);
  if (!center) return null;

  const inLeft = center.x <= Number(slotBBox.minX) + Number(bands.left || 0);
  const inRight = center.x >= Number(slotBBox.maxX) - Number(bands.right || 0);
  const inTop = center.y >= Number(slotBBox.maxY) - Number(bands.top || 0);
  const inBottom = center.y <= Number(slotBBox.minY) + Number(bands.bottom || 0);

  if (inLeft && inTop) return "TL";
  if (inRight && inTop) return "TR";
  if (inLeft && inBottom) return "BL";
  if (inRight && inBottom) return "BR";
  if (inTop) return "T";
  if (inBottom) return "B";
  if (inLeft) return "L";
  if (inRight) return "R";
  return "A";
}

function suggestSlotLayerForObject(object, slotBBox, bands) {
  if (!object?.bbox || !slotBBox) return null;
  return suggestSlotLayerForBBox(object.bbox, slotBBox, bands);
}

function buildRelevantState(document, bands, priorAssignments) {
  const slotProjection = projectSlotIndexOnRelevantObjects(listRelevantObjects(document));
  const relevantObjects = slotProjection.relevant_objects;
  const documentBBox = computeDocumentBBox(relevantObjects);
  const slotObjects = new Map();
  for (const object of relevantObjects) {
    const slotIndex = Number(object?.slot_index);
    if (!Number.isInteger(slotIndex)) continue;
    if (!slotObjects.has(slotIndex)) slotObjects.set(slotIndex, []);
    slotObjects.get(slotIndex).push(object);
  }
  const slotBBoxes = new Map(Array.from(slotObjects.entries()).map(([slotIndex, objects]) => [slotIndex, computeSlotBBox(objects)]));
  const assignments = {};

  for (const item of relevantObjects) {
    const previous = priorAssignments && priorAssignments[item.id] ? priorAssignments[item.id] : null;
    const slotBBox = slotBBoxes.get(Number(item?.slot_index)) || null;
    const suggested = slotBBox
      ? suggestSlotLayerForBBox(item.bbox, slotBBox, bands)
      : suggestLayerForBBox(item.bbox, documentBBox, bands);
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
    assignments,
    slot_validation: slotProjection.slot_validation
  };
}

function lineGeometrySummary(object) {
  if (String(object?.type || "").toUpperCase() !== "LINE") return null;
  const shape = Array.isArray(object?.shapes) ? object.shapes.find((item) => item?.kind === "line") : null;
  if (!shape) return null;
  const x1 = Number(shape.x1);
  const y1 = Number(shape.y1);
  const x2 = Number(shape.x2);
  const y2 = Number(shape.y2);
  if (![x1, y1, x2, y2].every(Number.isFinite)) return null;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy);
  const orientation = Math.abs(dx) <= 0.001
    ? "vertical"
    : Math.abs(dy) <= 0.001
      ? "horizontal"
      : "other";
  return { x1, y1, x2, y2, dx, dy, length, orientation };
}

function lineBBox(summary) {
  if (!summary) return null;
  return {
    minX: Math.min(summary.x1, summary.x2),
    minY: Math.min(summary.y1, summary.y2),
    maxX: Math.max(summary.x1, summary.x2),
    maxY: Math.max(summary.y1, summary.y2)
  };
}

function collectBlockInternalLineObjects(session, document) {
  const blockMap = new Map((Array.isArray(document?.blocks) ? document.blocks : []).map((block) => [String(block?.name || ""), block]));
  const topEntities = Array.isArray(document?.entities) ? document.entities : [];
  const out = [];
  for (const entity of topEntities) {
    if (String(entity?.type || "").toUpperCase() !== "INSERT") continue;
    const blockName = String(pairValue(entity, "2", "") || "").trim();
    const block = blockMap.get(blockName);
    if (!block) continue;
    const tx = Number(pairValue(entity, "10", "0"));
    const ty = Number(pairValue(entity, "20", "0"));
    const scaleX = Number(pairValue(entity, "41", "1"));
    const scaleY = Number(pairValue(entity, "42", "1"));
    const rotationDeg = Number(pairValue(entity, "50", "0"));
    const parentXdataMetadata = collectEntityXdataMetadata(session, entity.id);
    const parentInsertHandle = entityHandle(entity);
    for (const child of Array.isArray(block.entities) ? block.entities : []) {
      if (String(child?.type || "").toUpperCase() !== "LINE") continue;
      const x1 = Number(pairValue(child, "10", "NaN"));
      const y1 = Number(pairValue(child, "20", "NaN"));
      const x2 = Number(pairValue(child, "11", "NaN"));
      const y2 = Number(pairValue(child, "21", "NaN"));
      if (![x1, y1, x2, y2].every(Number.isFinite)) continue;
      const p1 = transformPoint({ x: x1, y: y1 }, { tx, ty, scaleX, scaleY, rotationDeg });
      const p2 = transformPoint({ x: x2, y: y2 }, { tx, ty, scaleX, scaleY, rotationDeg });
      out.push({
        id: `${entity.id}::${child.id}`,
        entity_id: child.id,
        parent_insert_id: entity.id,
        block_name: blockName || null,
        type: "LINE",
        source: child.source || null,
        raw_ref: rawReferenceForEntity(child, {
          block_name: blockName || null,
          parent_insert_id: entity.id,
          parent_insert_handle: parentInsertHandle
        }),
        primary_layer: String(pairValue(child, "8", "") || "").trim() || null,
        shapes: [{ kind: "line", x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y }],
        hygiene_context: "block_child",
        xdata_metadata: collectEntityXdataMetadata(session, child.id) || parentXdataMetadata
      });
    }
  }
  return out;
}

function classifyOverlapIssue(clusterEntries) {
  const members = clusterEntries.map((entry) => entry.object);
  const geometryVariants = new Set(
    members
      .map((object) => String(object?.xdata_metadata?.geometry_variant || "").trim())
      .filter(Boolean)
  );
  const hasBaseGeometry = members.some((object) => !String(object?.xdata_metadata?.geometry_variant || "").trim());
  if (geometryVariants.size >= 2 || (geometryVariants.size >= 1 && hasBaseGeometry)) {
    return {
      issue_type: "expected_variant_overlap",
      suggestion: "Expected branch alternative. BASE and tagged geometry branches are mutually exclusive and should stay distinguished upstream."
    };
  }
  return {
    issue_type: "collinear_overlap_cluster",
    suggestion: clusterEntries.some((entry) => entry.summary.length <= 2)
      ? "Inspect cluster and remove micro fragments from TOPO mover selection."
      : "Inspect duplicated/overlapping line cluster before authoring TOPO."
  };
}

function sameBranchContext(a, b) {
  const aVariant = String(a?.object?.xdata_metadata?.geometry_variant || "").trim();
  const bVariant = String(b?.object?.xdata_metadata?.geometry_variant || "").trim();
  return aVariant === bVariant;
}

function pointDistance(a, b) {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  return Math.hypot(Number(a.x) - Number(b.x), Number(a.y) - Number(b.y));
}

function lineEndpoints(summary) {
  if (!summary) return [];
  return [
    { x: summary.x1, y: summary.y1, role: "start" },
    { x: summary.x2, y: summary.y2, role: "end" }
  ];
}

function geometryVariantKey(object) {
  return String(object?.xdata_metadata?.geometry_variant || "").trim();
}

function normalizeBranchMode(mode) {
  return coreNormalizeBranchMode(mode);
}

function effectiveBranchModeForConfig(config, explicitMode = null) {
  return coreBranchModeFromConfigParameterSet(config, explicitMode);
}

function effectiveBranchModeForSession(session, config = null, explicitMode = null) {
  return normalizeBranchMode(explicitMode || session?.session_context_v1?.branch_mode || effectiveBranchModeForConfig(config || session?.config_parameter_set || {}, null));
}

function branchMetadataMatchesMode(metadata, branchMode) {
  return coreBranchMetadataMatchesMode(metadata, branchMode);
}

function objectMatchesBranchMode(object, branchMode) {
  return branchMetadataMatchesMode(object?.xdata_metadata, branchMode);
}

function filterObjectsByBranchMode(objects, branchMode) {
  return coreFilterObjectsByBranchMode(objects, branchMode);
}

function hasExplicitBranchMetadata(metadata) {
  if (!metadata || typeof metadata !== "object") return false;
  if (String(metadata.geometry_variant || "").trim()) return true;
  if (metadata.branch_valid === false) return true;
  if (String(metadata.raw_geometry_variant || "").trim()) return true;
  if (String(metadata.raw_value || "").trim()) return true;
  return false;
}

function filterDocumentByBranchMode(session, document, branchMode) {
  const mode = normalizeBranchMode(branchMode);
  if (mode === "ALL") {
    return { branch_mode: mode, top_level_removed: 0, block_child_removed: 0 };
  }
  const topEntities = Array.isArray(document?.entities) ? document.entities : [];
  let topLevelRemoved = 0;
  document.entities = topEntities.filter((entity) => {
    const keep = branchMetadataMatchesMode(collectEntityXdataMetadata(session, entity.id), mode);
    if (!keep) topLevelRemoved += 1;
    return keep;
  });
  let blockChildRemoved = 0;
  for (const block of Array.isArray(document?.blocks) ? document.blocks : []) {
    const blockEntities = Array.isArray(block?.entities) ? block.entities : [];
    block.entities = blockEntities.filter((entity) => {
      const metadata = collectEntityXdataMetadata(session, entity.id);
      if (!hasExplicitBranchMetadata(metadata)) return true;
      const keep = branchMetadataMatchesMode(metadata, mode);
      if (!keep) blockChildRemoved += 1;
      return keep;
    });
  }
  return {
    branch_mode: mode,
    top_level_removed: topLevelRemoved,
    block_child_removed: blockChildRemoved
  };
}

function connectionPointsForObject(object, summaryOverride = null) {
  const lineSummary = summaryOverride || lineGeometrySummary(object);
  if (lineSummary) return lineEndpoints(lineSummary);
  const shapes = Array.isArray(object?.shapes) ? object.shapes : [];
  const points = [];
  for (const shape of shapes) {
    if (shape?.kind === "arc") {
      const endpoints = arcEndpoints(shape);
      if (endpoints?.start) points.push(endpoints.start);
      if (endpoints?.end) points.push(endpoints.end);
    }
  }
  return points.filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y));
}

function pointHasSameBranchConnection(point, sourceObjects, variantKey, excludedObjectIds, tolerance) {
  const excluded = excludedObjectIds instanceof Set ? excludedObjectIds : new Set(excludedObjectIds || []);
  for (const object of Array.isArray(sourceObjects) ? sourceObjects : []) {
    if (!object || excluded.has(String(object.id || ""))) continue;
    if (geometryVariantKey(object) !== variantKey) continue;
    const connectionPoints = connectionPointsForObject(object);
    if (connectionPoints.some((candidatePoint) => pointDistance(point, candidatePoint) <= tolerance)) {
      return true;
    }
  }
  return false;
}

function nearestObjectEndpoint(object, projected, summaryOverride = null, tolerance = Number.POSITIVE_INFINITY) {
  if (!projected || !object) return null;
  const endpoints = connectionPointsForObject(object, summaryOverride);
  let best = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const point of endpoints) {
    const distance = pointDistance(projected, point);
    if (distance < bestDistance) {
      best = point;
      bestDistance = distance;
    }
  }
  if (!best || bestDistance > tolerance) return null;
  return best;
}

function collectOpenContourGapCandidates(lineObjects, sourceObjects) {
  const issues = [];
  const seen = new Set();
  const axisTolerance = 1.5;
  const connectedEndpointTolerance = 0.75;
  const notchAllowanceMm = 5;
  const gapToleranceMax = 12;
  for (const entry of Array.isArray(lineObjects) ? lineObjects : []) {
    const { object, summary } = entry;
    if (!summary || !["horizontal", "vertical"].includes(summary.orientation)) continue;
    const variantKey = geometryVariantKey(object);
    const endpoints = lineEndpoints(summary);
    for (const endpoint of endpoints) {
      if (pointHasSameBranchConnection(endpoint, sourceObjects, variantKey, new Set([String(object.id || "")]), connectedEndpointTolerance)) {
        continue;
      }
      for (const candidate of lineObjects) {
        if (candidate === entry) continue;
        if (!sameBranchContext(entry, candidate)) continue;
        const other = candidate.summary;
        if (!other || other.orientation === summary.orientation) continue;
        let projected = null;
        let gap = null;
        if (summary.orientation === "horizontal" && other.orientation === "vertical") {
          const minY = Math.min(other.y1, other.y2) - axisTolerance;
          const maxY = Math.max(other.y1, other.y2) + axisTolerance;
          if (endpoint.y < minY || endpoint.y > maxY) continue;
          gap = Math.abs(endpoint.x - other.x1);
          if (!(gap > notchAllowanceMm && gap <= gapToleranceMax)) continue;
          projected = { x: other.x1, y: endpoint.y };
        } else if (summary.orientation === "vertical" && other.orientation === "horizontal") {
          const minX = Math.min(other.x1, other.x2) - axisTolerance;
          const maxX = Math.max(other.x1, other.x2) + axisTolerance;
          if (endpoint.x < minX || endpoint.x > maxX) continue;
          gap = Math.abs(endpoint.y - other.y1);
          if (!(gap > notchAllowanceMm && gap <= gapToleranceMax)) continue;
          projected = { x: endpoint.x, y: other.y1 };
        }
        if (!projected) continue;
        const candidateEndpoint = nearestObjectEndpoint(candidate.object, projected, other, connectedEndpointTolerance);
        if (!candidateEndpoint) continue;
        if (pointHasSameBranchConnection(candidateEndpoint, sourceObjects, variantKey, new Set([String(object.id || ""), String(candidate.object?.id || "")]), connectedEndpointTolerance)) {
          continue;
        }
        const key = [
          String(object.id || ""),
          String(candidate.object?.id || ""),
          roundNumber(endpoint.x, 3),
          roundNumber(endpoint.y, 3),
          roundNumber(projected.x, 3),
          roundNumber(projected.y, 3)
        ].sort().join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        issues.push({
          issue_type: "open_contour_gap_candidate",
          orientation: summary.orientation,
          object_id: object.id,
          entity_id: object.entity_id,
          parent_insert_id: object.parent_insert_id || null,
          block_name: object.block_name || null,
          source_line: object?.source?.line_start || null,
          raw_handle: object?.raw_ref?.handle || null,
          parent_insert_handle: object?.raw_ref?.parent_insert_handle || null,
          gap_mm: roundNumber(gap, 3),
          bbox: {
            minX: Math.min(endpoint.x, projected.x),
            minY: Math.min(endpoint.y, projected.y),
            maxX: Math.max(endpoint.x, projected.x),
            maxY: Math.max(endpoint.y, projected.y)
          },
          members: [
            {
              object_id: object.id,
              entity_id: object.entity_id,
              parent_insert_id: object.parent_insert_id || null,
              block_name: object.block_name || null,
              source_line: object?.source?.line_start || null,
              raw_handle: object?.raw_ref?.handle || null,
              parent_insert_handle: object?.raw_ref?.parent_insert_handle || null,
              geometry_variant: String(object?.xdata_metadata?.geometry_variant || "").trim() || null
            },
            {
              object_id: candidate.object?.id || null,
              entity_id: candidate.object?.entity_id || null,
              parent_insert_id: candidate.object?.parent_insert_id || null,
              block_name: candidate.object?.block_name || null,
              source_line: candidate.object?.source?.line_start || null,
              raw_handle: candidate.object?.raw_ref?.handle || null,
              parent_insert_handle: candidate.object?.raw_ref?.parent_insert_handle || null,
              geometry_variant: String(candidate.object?.xdata_metadata?.geometry_variant || "").trim() || null
            }
          ],
          suggestion: "Likely open contour near-miss. Inspect whether these orthogonal lines should meet in the same geometry branch."
        });
      }
    }
  }
  return issues;
}

function collectInvalidBranchXdataIssues(objects) {
  const issues = [];
  for (const object of Array.isArray(objects) ? objects : []) {
    const metadata = object?.xdata_metadata;
    if (!metadata || metadata.branch_valid !== false) continue;
    issues.push({
      object_id: object.id,
      entity_id: object.entity_id,
      parent_insert_id: object.parent_insert_id || null,
      block_name: object.block_name || null,
      source_line: object?.source?.line_start || null,
      raw_handle: object?.raw_ref?.handle || null,
      parent_insert_handle: object?.raw_ref?.parent_insert_handle || null,
      issue_type: "invalid_branch_xdata",
      raw_value: metadata.value,
      branch_issue: metadata.branch_issue,
      bbox: object.bbox || null,
      suggestion: "Fix upstream XDATA to the strict syntax GEOMETRY_VARIANT=<VALUE>. Invalid branch XDATA is ignored by branch filtering."
    });
  }
  return issues;
}

function analyzeGeometryHygiene(session, document, objects) {
  const blockInternalObjects = collectBlockInternalLineObjects(session, document);
  const sourceObjects = [
    ...(Array.isArray(objects) ? objects : []),
    ...blockInternalObjects
  ];
  const issues = [];
  const invalidBranchXdata = collectInvalidBranchXdataIssues(sourceObjects);
  const microLines = [];
  const degenerateLines = [];
  const overlapGroups = [];
  const expectedVariantOverlaps = [];
  const openContourGaps = [];
  const lineObjects = [];

  for (const object of sourceObjects) {
    const summary = lineGeometrySummary(object);
    if (!summary) continue;
    lineObjects.push({ object, summary });
    if (summary.length <= 0.001) {
      degenerateLines.push({
        object_id: object.id,
        entity_id: object.entity_id,
        parent_insert_id: object.parent_insert_id || null,
        block_name: object.block_name || null,
        source_line: object?.source?.line_start || null,
        raw_handle: object?.raw_ref?.handle || null,
        parent_insert_handle: object?.raw_ref?.parent_insert_handle || null,
        layer: object?.primary_layer || null,
        issue_type: "degenerate_line",
        length_mm: roundNumber(summary.length, 3),
        bbox: lineBBox(summary),
        suggestion: "Inspect and likely remove from TOPO mover selection."
      });
    } else if (summary.length <= 2) {
      microLines.push({
        object_id: object.id,
        entity_id: object.entity_id,
        parent_insert_id: object.parent_insert_id || null,
        block_name: object.block_name || null,
        source_line: object?.source?.line_start || null,
        raw_handle: object?.raw_ref?.handle || null,
        parent_insert_handle: object?.raw_ref?.parent_insert_handle || null,
        layer: object?.primary_layer || null,
        issue_type: "micro_line",
        length_mm: roundNumber(summary.length, 3),
        orientation: summary.orientation,
        bbox: lineBBox(summary),
        suggestion: "Inspect whether this is a bridge fragment; likely exclude from TOPO mover selection."
      });
    }
  }

  const buckets = new Map();
  for (const entry of lineObjects) {
    const { object, summary } = entry;
    if (summary.orientation === "vertical") {
      const key = `vertical:${roundNumber(summary.x1, 3)}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push({ object, summary });
    } else if (summary.orientation === "horizontal") {
      const key = `horizontal:${roundNumber(summary.y1, 3)}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push({ object, summary });
    }
  }

  for (const group of buckets.values()) {
    if (group.length < 2) continue;
    const sorted = group.slice().sort((a, b) => {
      if (a.summary.orientation === "vertical") return a.summary.y2 - b.summary.y2;
      return a.summary.x1 - b.summary.x1;
    });
    const clustered = [];
    for (const entry of sorted) {
      if (!clustered.length) {
        clustered.push([entry]);
        continue;
      }
      const currentCluster = clustered[clustered.length - 1];
      const previous = currentCluster[currentCluster.length - 1];
      const overlap = entry.summary.orientation === "vertical"
        ? Math.min(previous.summary.y1, previous.summary.y2, entry.summary.y1, entry.summary.y2) !== undefined
          && Math.max(Math.min(previous.summary.y1, previous.summary.y2), Math.min(entry.summary.y1, entry.summary.y2))
            <= Math.min(Math.max(previous.summary.y1, previous.summary.y2), Math.max(entry.summary.y1, entry.summary.y2)) + 1.5
        : Math.max(Math.min(previous.summary.x1, previous.summary.x2), Math.min(entry.summary.x1, entry.summary.x2))
            <= Math.min(Math.max(previous.summary.x1, previous.summary.x2), Math.max(entry.summary.x1, entry.summary.x2)) + 1.5;
      if (overlap) {
        currentCluster.push(entry);
      } else {
        clustered.push([entry]);
      }
    }
    for (const cluster of clustered) {
      if (cluster.length < 2) continue;
      const classification = classifyOverlapIssue(cluster);
      const issue = {
        issue_type: classification.issue_type,
        orientation: cluster[0].summary.orientation,
        block_name: cluster.every((entry) => String(entry.object?.block_name || "") === String(cluster[0].object?.block_name || ""))
          ? (cluster[0].object?.block_name || null)
          : null,
        members: cluster.map((entry) => ({
          object_id: entry.object.id,
          entity_id: entry.object.entity_id,
          parent_insert_id: entry.object?.parent_insert_id || null,
          block_name: entry.object?.block_name || null,
          source_line: entry.object?.source?.line_start || null,
          raw_handle: entry.object?.raw_ref?.handle || null,
          parent_insert_handle: entry.object?.raw_ref?.parent_insert_handle || null,
          layer: entry.object?.primary_layer || null,
          length_mm: roundNumber(entry.summary.length, 3),
          bbox: lineBBox(entry.summary),
          geometry_variant: String(entry.object?.xdata_metadata?.geometry_variant || "").trim() || null
        })),
        suggestion: classification.suggestion
      };
      if (classification.issue_type === "expected_variant_overlap") {
        expectedVariantOverlaps.push(issue);
      } else {
        overlapGroups.push(issue);
      }
    }
  }

  openContourGaps.push(...collectOpenContourGapCandidates(lineObjects, sourceObjects));

  issues.push(...invalidBranchXdata, ...degenerateLines, ...microLines, ...overlapGroups, ...expectedVariantOverlaps, ...openContourGaps);
  return {
    ok: issues.length === 0,
    counts: {
      invalid_branch_xdata: invalidBranchXdata.length,
      degenerate_lines: degenerateLines.length,
      micro_lines: microLines.length,
      collinear_overlap_clusters: overlapGroups.length,
      expected_variant_overlaps: expectedVariantOverlaps.length,
      open_contour_gaps: openContourGaps.length,
      total_issues: issues.length
    },
    issues
  };
}

function collectXdataContext(objects, extraObjects = []) {
  const topLevelObjects = Array.isArray(objects) ? objects : [];
  const extraSourceObjects = Array.isArray(extraObjects) ? extraObjects : [];
  const sourceObjects = [...topLevelObjects, ...extraSourceObjects];
  const geometryVariants = new Set();
  const blockInternalGeometryVariants = new Set();
  const observedXdataHints = new Map();
  const blockInternalXdataHints = new Map();
  let taggedObjectCount = 0;
  let baseObjectCount = 0;
  let invalidBranchXdataCount = 0;
  for (const object of sourceObjects) {
    const metadata = object?.xdata_metadata;
    const observedHint = String(metadata?.observed_xdata_hint || "").trim();
    const isBlockChild = String(object?.hygiene_context || "") === "block_child";
    if (observedHint) {
      const target = isBlockChild ? blockInternalXdataHints : observedXdataHints;
      const current = target.get(observedHint) || {
        hint: observedHint,
        app: String(metadata?.app || MOTHER_XDATA_APP_NAME),
        attributes: metadata?.attributes && typeof metadata.attributes === "object" ? cloneJson(metadata.attributes) : {},
        object_count: 0
      };
      current.object_count += 1;
      target.set(observedHint, current);
    }
    const geometryVariant = String(metadata?.geometry_variant || "").trim();
    if (geometryVariant && isBlockChild) blockInternalGeometryVariants.add(geometryVariant);
    if (metadata?.branch_valid === false) invalidBranchXdataCount += 1;
  }
  for (const object of topLevelObjects) {
    const metadata = object?.xdata_metadata;
    const geometryVariant = String(metadata?.geometry_variant || "").trim();
    if (geometryVariant) {
      geometryVariants.add(geometryVariant);
      taggedObjectCount += 1;
      continue;
    }
    if (metadata?.branch_valid === false) continue;
    baseObjectCount += 1;
  }
  return {
    geometry_variants: Array.from(geometryVariants.values()).sort(),
    block_internal_geometry_variants: Array.from(blockInternalGeometryVariants.values()).sort(),
    observed_xdata_hints: Array.from(observedXdataHints.values()).sort((a, b) => a.hint.localeCompare(b.hint)),
    block_internal_xdata_hints: Array.from(blockInternalXdataHints.values()).sort((a, b) => a.hint.localeCompare(b.hint)),
    tagged_object_count: taggedObjectCount,
    base_object_count: baseObjectCount,
    invalid_branch_xdata_count: invalidBranchXdataCount,
    branch_filtering_ready: geometryVariants.size > 0,
    branch_filtering_block_limited: geometryVariants.size === 0 && blockInternalGeometryVariants.size > 0
  };
}

function normalizeSessionActivityLog(input) {
  const items = Array.isArray(input) ? input : [];
  return items
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      ts: String(item.ts || new Date().toISOString()),
      severity: String(item.severity || "info"),
      type: String(item.type || "session_event"),
      summary: String(item.summary || "Session event"),
      details: item.details && typeof item.details === "object" ? cloneJson(item.details) : {}
    }))
    .slice(-200);
}

function appendSessionActivity(session, event) {
  if (!session || !event || typeof event !== "object") return null;
  const entry = {
    ts: new Date().toISOString(),
    severity: String(event.severity || "info"),
    type: String(event.type || "session_event"),
    summary: String(event.summary || "Session event"),
    details: event.details && typeof event.details === "object" ? cloneJson(event.details) : {}
  };
  session.activity_log = normalizeSessionActivityLog(session.activity_log).concat(entry).slice(-200);
  return entry;
}

function sampleValues(values, limit = 8) {
  return Array.from(new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean))).slice(0, limit);
}

function buildSessionArrangementSnapshot(session, context = {}) {
  const objects = Array.isArray(context.objects) ? context.objects : [];
  const documentSem = context.document_sem || collectDocumentSemMetadata(session?.document);
  const topoMetadata = context.topo_metadata || projectTopoMetadata(session || {});
  const config = normalizeConfigParameterSet(session?.config_parameter_set);
  const ruleCatalog = normalizeRuleCatalogSnapshot(session?.rule_catalog);
  const parameterCatalog = normalizeParameterCatalogSnapshot(session?.parameter_catalog);
  const semTargets = objects.filter((object) => Array.isArray(object.semantic_metadata?.raw_comments) && object.semantic_metadata.raw_comments.length > 0);
  const microShiftTargets = objects.filter((object) => {
    const records = Array.isArray(object.semantic_metadata?.parsed) ? object.semantic_metadata.parsed : [];
    return records.some((record) => String(record?.keys?.post_topo_group || "").trim() === "MICRO_SHIFT_SET");
  });
  const topoTargets = objects.filter((object) => object.topo_role_metadata?.keys?.role);
  const labelAnchors = labelAnchorObjects(objects);
  const labelAnchorRules = Array.from(new Set(labelAnchors.flatMap((object) => {
    const records = Array.isArray(object.semantic_metadata?.parsed) ? object.semantic_metadata.parsed : [];
    return records.map((record) => String(record?.keys?.label_anchor || "").trim()).filter(Boolean);
  })));
  const topoGroups = new Map();
  for (const object of topoTargets) {
    const keys = object.topo_role_metadata?.keys || {};
    const group = String(keys.group || "").trim() || "(missing group)";
    const zone = String(keys.zone || "").trim().toUpperCase() || "UNKNOWN";
    if (!topoGroups.has(group)) topoGroups.set(group, { group, total: 0, LEC: 0, REC: 0, UNKNOWN: 0 });
    const item = topoGroups.get(group);
    item.total += 1;
    item[zone] = Number(item[zone] || 0) + 1;
  }
  return {
    source_name: session?.source_name || null,
    artifact_state: session?.artifact_state || null,
    status: session?.status || null,
    family: documentSem?.family || config.family || null,
    product: documentSem?.product || config.product || null,
    part: documentSem?.part || config.part || config.product_code || null,
    nominal_width: documentSem?.nominal_width || null,
    nominal_height: documentSem?.nominal_height || null,
    parameter_catalog_id: parameterCatalog.catalog_id || config.parameter_catalog_id || null,
    rule_catalog_id: ruleCatalog.catalog_id || null,
    rule_profile_id: ruleCatalog.profile_id || null,
    document_rules: Array.isArray(documentSem?.rule_refs) ? documentSem.rule_refs : [],
    topo_file_level: Array.isArray(topoMetadata?.file_level) ? topoMetadata.file_level.map((item) => item.raw_comment) : [],
    topo_groups: Array.from(topoGroups.values()),
    object_count: objects.length,
    semantic_target_count: semTargets.length,
    micro_shift_set_count: microShiftTargets.length,
    micro_shift_set_sample: sampleValues(microShiftTargets.map((object) => object.entity_id)),
    label_anchor_count: labelAnchors.length,
    label_anchor_rules: labelAnchorRules,
    label_anchor_sample: sampleValues(labelAnchors.map((object) => object.entity_id)),
    topo_target_count: topoTargets.length,
    config_parameter_count: Object.keys(config.parameters || {}).length,
    last_validation_ok: session?.validation ? Boolean(session.validation.ok) : null
  };
}

function projectViewModel(session) {
  ensureSessionContextShape(session);
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
    const sourceEntity = findEntity(session.document, item.entityId);
    return {
      id: item.id,
      display_label: item.type === "INSERT" && item.blockName
        ? `${item.id} | ${item.type} | block=${item.blockName}`
        : `${item.id} | ${item.type}`,
      entity_id: item.entityId,
      type: item.type,
      bbox: item.bbox,
      slot_index: item.slot_index,
      shapes: item.shapes,
      block_name: item.blockName || null,
      source: item.source || null,
      raw_ref: rawReferenceForEntity(sourceEntity, {
        block_name: item.blockName || null
      }),
      classification_state: assignment.state,
      primary_layer: assignment.layer,
      assignment_origin: assignment.origin,
      suggested_layer: assignment.suggested_layer,
      semantic_color: assignment.layer ? SEMANTIC_COLORS[assignment.layer] : SEMANTIC_COLORS.UNCLASSIFIED,
      semantic_metadata,
      topo_role_metadata: entityTopoRoleMetadata(sourceEntity),
      xdata_metadata: collectEntityXdataMetadata(session, item.entityId)
    };
  });
  const geometry_slot_model = buildGeometrySlotModelProjection(objects, state.slot_validation, GEOMETRY_SLOT_WIDTH_MM, session.bands, session.config_parameter_set, session.session_context_v1?.branch_mode || null);
  const geometry_context_v1 = buildGeometryContextV1Projection(geometry_slot_model);
  const topo_metadata = projectTopoMetadata(session);
  const document_sem = collectDocumentSemMetadata(session.document);
  const document_rules = collectDocumentRuleMetadata(session.document);
  const blockInternalObjects = collectBlockInternalLineObjects(session, session.document);
  const geometry_hygiene = analyzeGeometryHygiene(session, session.document, objects);
  const xdata_context = collectXdataContext(objects, blockInternalObjects);
  const domain_context_v1 = buildDomainContextV1Projection(document_sem, session.config_parameter_set, xdata_context, session.session_context_v1);
  const slot_context = buildSlotContextProjectionV1(geometry_context_v1);
  const variant_to_slot_map = buildVariantToSlotMapProjectionV1(geometry_context_v1);
  const execution_intent_v1 = buildExecutionIntentProjectionV1(session, geometry_context_v1, variant_to_slot_map);
  const resolver_input_v2_extended = buildResolverInputV2ExtendedSkeleton(session, geometry_context_v1, domain_context_v1);
  session.activity_log = normalizeSessionActivityLog(session.activity_log);
  const arrangement_snapshot = buildSessionArrangementSnapshot(session, {
    objects,
    document_sem,
    topo_metadata
  });

  return {
    session_id: session.session_id,
    title: session.title,
    status: session.status,
    artifact_state: session.artifact_state,
    session_context_v1: session.session_context_v1,
    session_lifecycle_v1: session.session_lifecycle_v1,
    source_name: session.source_name,
    raw_source_name: session.raw_source_name || session.source_name,
    storage_key: session.storage_key || null,
    bands: session.bands,
    document_bbox: session.document_bbox,
    config_parameter_set: session.config_parameter_set || null,
    parameter_catalog: normalizeParameterCatalogSnapshot(session.parameter_catalog),
    rule_catalog: normalizeRuleCatalogSnapshot(session.rule_catalog),
    document_sem,
    document_rules,
    topo_metadata,
    geometry_hygiene,
    slot_validation: state.slot_validation,
    prefer_slot_mode: false,
    geometry_slot_model,
    geometry_context_v1,
    slot_context,
    variant_to_slot_map,
    execution_intent_authoring_v1: cloneJson(session.execution_intent_authoring_v1 || null),
    execution_intent_v1,
    resolver_input_v2_extended,
    domain_context_v1,
    domain_validation_v1: session.domain_validation_v1 || null,
    geometry_validation_v1: session.geometry_validation_v1 || null,
    geometry_strategy_v1: cloneJson(session.geometry_strategy_v1 || null),
    resolver_input_v1_minimal: session.resolver_input_v1_minimal || null,
    resolver_preview_v1: session.resolver_preview_v1 || null,
    resolver_child_v1: session.resolver_child_v1 || null,
    resolver_export_v1: session.resolver_export_v1 || null,
    wysiwyg_gate_v1: session.wysiwyg_gate_v1 || null,
    artifact_lineage_v1: session.artifact_lineage_v1 || buildArtifactLineageV1(session),
    xdata_context,
    arrangement_snapshot,
    activity_log: session.activity_log,
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
    raw_source_name: session.raw_source_name || session.source_name || null,
    storage_key: session.storage_key || null,
    created_at: session.created_at || null,
    updated_at: session.updated_at || null,
    has_authoring_state: sessionHasAuthoringState(session)
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

function buildSemEffectiveGeometryFilter(objects, parameters) {
  const inclusionByObjectId = new Map();
  const includedObjects = [];
  const excludedObjects = [];
  for (const object of Array.isArray(objects) ? objects : []) {
    const inclusion = evaluateChildEntityInclusion(object, parameters);
    inclusionByObjectId.set(object.id, inclusion);
    if (inclusion.included) {
      includedObjects.push(object);
    } else {
      excludedObjects.push({
        object_id: object.id,
        entity_id: object.entity_id,
        exclusion_reason: inclusion.exclusion_reason,
        presence_reason: inclusion.presence?.visibility_reason || null,
        variant: inclusion.variant?.variant || null,
        variant_feature: inclusion.variant?.feature || null
      });
    }
  }
  return {
    mode: "sem_effective_geometry_before_topo_v1",
    inclusion_by_object_id: inclusionByObjectId,
    included_objects: includedObjects,
    excluded_objects: excludedObjects,
    summary: {
      mode: "sem_effective_geometry_before_topo_v1",
      input_count: Array.isArray(objects) ? objects.length : 0,
      included_count: includedObjects.length,
      excluded_count: excludedObjects.length,
      excluded_objects: excludedObjects.slice(0, 25)
    }
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
  const branchMode = effectiveBranchModeForConfig(config);
  const sourceObjects = filterObjectsByBranchMode(Array.isArray(view.objects) ? view.objects : [], branchMode);
  const outputDocument = cloneJson(session.document);
  const branchFilterExecution = filterDocumentByBranchMode(session, outputDocument, branchMode);
  const documentRuleExecution = materializeDocumentRulesOnDocument(outputDocument, session, sourceObjects, parameters, branchMode);
  const decisionsByEntityId = new Map();
  const excludedEntities = [];
  const includedEntities = [];
  const unsupportedGeometryOps = [];

  for (const object of Array.isArray(sourceObjects) ? sourceObjects : []) {
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
  const finalChildExecution = finalizeChildDocument(outputDocument, session, config, null);

  return {
    document: outputDocument,
    generation_summary: {
      mode: "child_no_topo_poc_v0",
      topology_mode: "none",
      product_code: config.product_code,
      technology_profile: config.technology_profile,
      branch_mode: branchMode,
      branch_filter: branchFilterExecution,
      document_rules_applied: documentRuleExecution.applied_rules || [],
      entity_count: sourceObjects.length,
      included_count: includedEntities.length,
      excluded_count: excludedEntities.length,
      included_entities: includedEntities,
      excluded_entities: excludedEntities,
      unsupported_geometry_ops: unsupportedGeometryOps,
      block_explosion: finalChildExecution.block_explosion,
      final_orientation_rules_applied: finalChildExecution.final_orientation.applied_rules || [],
      bbox_normalization: finalChildExecution.bbox_normalization,
      final_gap_repair: finalChildExecution.final_gap_repair,
      child_label_rules_applied: finalChildExecution.child_label.applied_rules || [],
      child_label_removed_anchor_entities: finalChildExecution.child_label.removed_anchor_entities || [],
      child_label_emitted_text_entities: finalChildExecution.child_label.emitted_text_entities || [],
      layer_policy: finalChildExecution.layer_policy,
      metadata_cleanup: finalChildExecution.metadata_cleanup
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
    .concat(normalizeTopoCommentsInput(session?.topo_comments).filter((value) => isFileLevelTopoComment(value)).map((value) => ({ code: "999", value })));
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

function materializeDocumentRulesOnDocument(outputDocument, session, sourceObjects, parameters, branchMode = "ALL") {
  const outputEntities = entityMapById(outputDocument);
  const rules = resolveExecutableDocumentRules(session, parameters, branchMode);
  const appliedRules = [];

  for (const rule of rules) {
    const action = rule && typeof rule.action === "object" ? rule.action : {};
    const targetScope = rule && typeof rule.target_scope === "object" ? rule.target_scope : {};
    const targetLayer = String(targetScope.layer || "").trim().toUpperCase();
    const targetBranch = String(targetScope.geometry_branch || targetScope.branch || "").trim();
    const geometry = String(action.geometry || "").trim().toLowerCase();
    const axis = String(action.axis || "").trim().toUpperCase();
    const valueMm = Number(action.value_mm);
    const postRepair = String(action.post_repair || "").trim().toLowerCase();
    if (geometry !== "offset" || !targetLayer || !Number.isFinite(valueMm) || !["X", "Y"].includes(axis)) continue;

    const affectedObjects = (Array.isArray(sourceObjects) ? sourceObjects : []).filter((object) => {
      if (String(object?.primary_layer || "").trim().toUpperCase() !== targetLayer) return false;
      return evaluateChildEntityInclusion(object, parameters)?.included !== false;
    });
    if (!affectedObjects.length) continue;

    const dx = axis === "X" ? valueMm : 0;
    const dy = axis === "Y" ? valueMm : 0;
    const affectedEntities = [];
    for (const object of affectedObjects) {
      const outputEntity = outputEntities.get(object.entity_id);
      if (!outputEntity) continue;
      translateEntityPairs(outputEntity, dx, dy);
      affectedEntities.push({
        entity_id: object.entity_id,
        object_id: object.id,
        type: object.type
      });
    }

    appliedRules.push({
      rule_id: String(rule.rule_id || "").trim() || null,
      target_layer: targetLayer,
      target_branch: targetBranch || null,
      axis,
      value_mm: valueMm,
      post_repair: postRepair || null,
      post_repair_status: postRepair === "bounded_trim_rejoin" ? "deferred_to_final_gap_repair" : "none",
      affected_count: affectedEntities.length,
      affected_entities: affectedEntities
    });
  }

  return {
    applied_rules: appliedRules
  };
}

function applyPostTopoBoundedTrimRejoinOnDocument(outputDocument, sourceObjects, preRuleShapeSnapshot, movedEntities, rule) {
  if (String(rule?.post_repair || "").trim().toLowerCase() !== "bounded_trim_rejoin") {
    return { status: "none", applied_count: 0, touched_entities: [] };
  }
  if (String(rule?.axis || "").trim().toUpperCase() !== "X") {
    return { status: "skipped_unsupported_axis", applied_count: 0, touched_entities: [] };
  }

  const outputEntities = entityMapById(outputDocument);
  const movedByEntityId = new Map((Array.isArray(movedEntities) ? movedEntities : []).map((entry) => [entry.entity_id, entry]));
  const movedEndpoints = [];
  const tolerance = 1.5;

  for (const moved of movedByEntityId.values()) {
    const originalShape = preRuleShapeSnapshot.get(moved.entity_id);
    if (!originalShape || lineOrientationLocal(originalShape) !== "vertical") continue;
    const currentEntity = outputEntities.get(moved.entity_id);
    const currentShape = lineShapeFromRuntimeEntity(currentEntity);
    if (!currentShape || strictOrthogonalLineOrientation(currentShape) !== "vertical") continue;
    for (const endpointName of ["start", "end"]) {
      const original = lineEndpointPoint(originalShape, endpointName);
      const current = lineEndpointPoint(currentShape, endpointName);
      const oppositeEndpointName = endpointName === "start" ? "end" : "start";
      const oppositeOriginal = lineEndpointPoint(originalShape, oppositeEndpointName);
      const oppositeCurrent = lineEndpointPoint(currentShape, oppositeEndpointName);
      if (!original || !current) continue;
      movedEndpoints.push({
        entity_id: moved.entity_id,
        object_id: moved.object_id,
        endpoint: endpointName,
        original,
        current,
        opposite_original: oppositeOriginal,
        opposite_current: oppositeCurrent
      });
    }
  }

  if (!movedEndpoints.length) {
    return { status: "no_vertical_mover_endpoints", applied_count: 0, touched_entities: [] };
  }

  const touched = [];
  for (const object of Array.isArray(sourceObjects) ? sourceObjects : []) {
    if (movedByEntityId.has(object.entity_id)) continue;
    const originalShape = preRuleShapeSnapshot.get(object.entity_id);
    if (!originalShape || strictOrthogonalLineOrientation(originalShape) !== "horizontal") continue;
    const outputEntity = outputEntities.get(object.entity_id);
    if (!outputEntity || String(outputEntity.type || "").toUpperCase() !== "LINE") continue;

    let nextShape = lineShapeFromRuntimeEntity(outputEntity) || cloneJson(originalShape);
    const changes = [];
    for (const endpointName of ["start", "end"]) {
      const originalEndpoint = lineEndpointPoint(originalShape, endpointName);
      if (!originalEndpoint) continue;
      const matches = findMatchingMovedVerticals(originalEndpoint, movedEndpoints, tolerance);
      if (matches.length !== 1) continue;
      const match = matches[0];
      const currentEndpoint = lineEndpointPoint(nextShape, endpointName);
      let followPoint = match.current;
      if (currentEndpoint && Math.abs(Number(currentEndpoint.y) - Number(match.current.y)) > tolerance) {
        const projectedPoint = buildProjectedFollowerPoint(
          currentEndpoint,
          match.current,
          match.opposite_current,
          tolerance
        );
        if (!projectedPoint) continue;
        followPoint = projectedPoint;
      }
      nextShape = setLineEndpointPoint(nextShape, endpointName, followPoint);
      changes.push({
        endpoint: endpointName,
        followed_mover_entity_id: match.entity_id,
        x: roundNumber(followPoint.x, 3),
        y: roundNumber(followPoint.y, 3)
      });
    }

    if (!changes.length) continue;
    const length = shapeLineLength(nextShape);
    if (!Number.isFinite(length) || length <= 0.5) continue;
    if (!setLineRuntimeEntityShape(outputEntity, nextShape)) continue;
    touched.push({
      entity_id: object.entity_id,
      object_id: object.id,
      changes
    });
  }

  return {
    status: touched.length ? "executed_endpoint_follower" : "no_matching_line_endpoints",
    applied_count: touched.length,
    touched_entities: touched
  };
}

function materializePostTopoRulesOnDocument(outputDocument, sourceSession, sourceObjects, parameters) {
  const outputEntities = entityMapById(outputDocument);
  const rules = executablePostTopoRules(sourceSession, parameters);
  const appliedRules = [];

  for (const rule of rules) {
    const preRuleShapeSnapshot = new Map();
    for (const object of Array.isArray(sourceObjects) ? sourceObjects : []) {
      const outputEntity = outputEntities.get(object.entity_id);
      if (!outputEntity || String(outputEntity.type || "").toUpperCase() !== "LINE") continue;
      const outputShape = lineShapeFromRuntimeEntity(outputEntity);
      if (outputShape) preRuleShapeSnapshot.set(object.entity_id, cloneJson(outputShape));
    }
    const affectedObjects = (Array.isArray(sourceObjects) ? sourceObjects : []).filter((object) => {
      if (!objectHasPostTopoGroup(object, rule.target_group)) return false;
      return evaluateChildEntityInclusion(object, parameters)?.included !== false;
    });
    if (!affectedObjects.length) continue;
    const affectedEntities = [];
    for (const object of affectedObjects) {
      const outputEntity = outputEntities.get(object.entity_id);
      if (!outputEntity) continue;
      translateEntityPairs(outputEntity, rule.dx, rule.dy);
      affectedEntities.push({
        entity_id: object.entity_id,
        object_id: object.id,
        type: object.type
      });
    }
    const postRepairExecution = applyPostTopoBoundedTrimRejoinOnDocument(
      outputDocument,
      sourceObjects,
      preRuleShapeSnapshot,
      affectedEntities,
      rule
    );
    appliedRules.push({
      rule_id: rule.rule_id,
      target_group: rule.target_group,
      axis: rule.axis,
      value_mm: rule.value_mm,
      value_expr: rule.value_expr,
      post_repair: rule.post_repair,
      post_repair_status: rule.post_repair ? postRepairExecution.status : "none",
      post_repair_result: postRepairExecution,
      affected_count: affectedEntities.length,
      affected_entities: affectedEntities
    });
  }

  return {
    applied_rules: appliedRules
  };
}

function setRuntimePairValue(entity, code, value) {
  const codeText = String(code);
  const nextValue = String(value);
  const pairs = Array.isArray(entity?.pairs) ? entity.pairs : [];
  const idx = pairs.findIndex((pair) => String(pair?.code) === codeText);
  if (idx >= 0) {
    pairs[idx] = { ...pairs[idx], code: codeText, value: nextValue };
    return;
  }
  pairs.splice(1, 0, { code: codeText, value: nextValue });
}

function clonePairsForRuntime(pairs) {
  return (Array.isArray(pairs) ? pairs : []).map((pair) => ({
    code: String(pair?.code || ""),
    value: String(pair?.value || "")
  }));
}

function collectUsedHandles(document) {
  const handles = new Set();
  const collectFrom = (entity) => {
    const handle = String(pairValue(entity || {}, "5", "") || "").trim().toUpperCase();
    if (handle) handles.add(handle);
  };
  for (const entity of Array.isArray(document?.entities) ? document.entities : []) {
    collectFrom(entity);
  }
  for (const block of Array.isArray(document?.blocks) ? document.blocks : []) {
    for (const entity of Array.isArray(block?.entities) ? block.entities : []) {
      collectFrom(entity);
    }
  }
  return handles;
}

function nextExplodedHandle(usedHandles) {
  let nextHandle = "";
  do {
    nextHandle = crypto.randomBytes(4).toString("hex").toUpperCase();
  } while (usedHandles.has(nextHandle));
  usedHandles.add(nextHandle);
  return nextHandle;
}

function nextExplodedEntityCounter(document) {
  let maxId = 0;
  const inspect = (entity) => {
    const raw = String(entity?.id || "");
    const match = raw.match(/(?:^|_)(\d+)$/);
    if (!match) return;
    const numeric = Number(match[1]);
    if (Number.isFinite(numeric) && numeric > maxId) maxId = numeric;
  };
  for (const entity of Array.isArray(document?.entities) ? document.entities : []) inspect(entity);
  for (const block of Array.isArray(document?.blocks) ? document.blocks : []) {
    for (const entity of Array.isArray(block?.entities) ? block.entities : []) inspect(entity);
  }
  return maxId + 1;
}

function normalizeInsertTransform(entity) {
  return {
    tx: Number(pairValue(entity || {}, "10", "0")) || 0,
    ty: Number(pairValue(entity || {}, "20", "0")) || 0,
    scaleX: Number(pairValue(entity || {}, "41", "1")) || 1,
    scaleY: Number(pairValue(entity || {}, "42", "1")) || 1,
    rotationDeg: Number(pairValue(entity || {}, "50", "0")) || 0
  };
}

function applyTransformChain(point, chain) {
  let next = { x: Number(point?.x || 0), y: Number(point?.y || 0) };
  for (const transform of Array.isArray(chain) ? chain : []) {
    next = transformPoint(next, transform);
  }
  return next;
}

function chainScaleX(chain) {
  return (Array.isArray(chain) ? chain : []).reduce((acc, transform) => acc * (Number(transform?.scaleX || 1) || 1), 1);
}

function chainRotation(chain) {
  return (Array.isArray(chain) ? chain : []).reduce((acc, transform) => acc + (Number(transform?.rotationDeg || 0) || 0), 0);
}

function transformExplodedEntity(entity, chain, nextIdRef, usedHandles) {
  const type = String(entity?.type || "").toUpperCase();
  if (!["LINE", "ARC", "CIRCLE"].includes(type)) return null;
  const next = {
    id: `ent_${nextIdRef.value}`,
    type,
    pairs: clonePairsForRuntime(entity?.pairs),
    preComments: clonePairsForRuntime(entity?.preComments),
    section: "ENTITIES",
    blockName: null,
    source: null
  };
  nextIdRef.value += 1;
  setRuntimePairValue(next, "5", nextExplodedHandle(usedHandles));

  if (type === "LINE") {
    const p1 = applyTransformChain({
      x: Number(pairValue(entity, "10", "0")) || 0,
      y: Number(pairValue(entity, "20", "0")) || 0
    }, chain);
    const p2 = applyTransformChain({
      x: Number(pairValue(entity, "11", "0")) || 0,
      y: Number(pairValue(entity, "21", "0")) || 0
    }, chain);
    setRuntimePairValue(next, "10", String(roundNumber(p1.x, 3)));
    setRuntimePairValue(next, "20", String(roundNumber(p1.y, 3)));
    setRuntimePairValue(next, "11", String(roundNumber(p2.x, 3)));
    setRuntimePairValue(next, "21", String(roundNumber(p2.y, 3)));
    return next;
  }

  const center = applyTransformChain({
    x: Number(pairValue(entity, "10", "0")) || 0,
    y: Number(pairValue(entity, "20", "0")) || 0
  }, chain);
  setRuntimePairValue(next, "10", String(roundNumber(center.x, 3)));
  setRuntimePairValue(next, "20", String(roundNumber(center.y, 3)));
  const radius = Math.abs((Number(pairValue(entity, "40", "0")) || 0) * chainScaleX(chain));
  setRuntimePairValue(next, "40", String(roundNumber(radius, 3)));

  if (type === "ARC") {
    const rotation = chainRotation(chain);
    const startAngle = (Number(pairValue(entity, "50", "0")) || 0) + rotation;
    const endAngle = (Number(pairValue(entity, "51", "0")) || 0) + rotation;
    setRuntimePairValue(next, "50", String(roundNumber(startAngle, 3)));
    setRuntimePairValue(next, "51", String(roundNumber(endAngle, 3)));
  }
  return next;
}

function explodeInsertChildren(document, entity, chain, nextIdRef, usedHandles) {
  const type = String(entity?.type || "").toUpperCase();
  if (type === "INSERT") {
    const blockName = String(pairValue(entity || {}, "2", "") || "").trim();
    const block = (Array.isArray(document?.blocks) ? document.blocks : []).find((item) => String(item?.name || "").trim() === blockName);
    if (!block) {
      throw new Error(`Missing block definition for INSERT ${entity?.id || "(unknown)"}: ${blockName || "(unnamed block)"}`);
    }
    const nextChain = [...chain, normalizeInsertTransform(entity)];
    return (Array.isArray(block.entities) ? block.entities : []).flatMap((child) =>
      explodeInsertChildren(document, child, nextChain, nextIdRef, usedHandles)
    );
  }
  const transformed = transformExplodedEntity(entity, chain, nextIdRef, usedHandles);
  return transformed ? [transformed] : [];
}

async function explodeBlockInsert({ sessionId, entityId, storeRoot }) {
  const session = await getSession({ sessionId, storeRoot });
  const sourceEntity = findEntity(session.document, entityId);
  if (!sourceEntity) {
    throw new Error(`Unknown entity id: ${entityId}`);
  }
  if (String(sourceEntity.type || "").toUpperCase() !== "INSERT") {
    throw new Error(`Entity ${entityId} is not an INSERT and cannot be exploded.`);
  }

  const existingIndex = (Array.isArray(session.document.entities) ? session.document.entities : []).findIndex((entity) => entity.id === entityId);
  if (existingIndex < 0) {
    throw new Error(`Only top-level INSERT entities can be exploded. Missing entity: ${entityId}`);
  }

  const usedHandles = collectUsedHandles(session.document);
  const nextIdRef = { value: nextExplodedEntityCounter(session.document) };
  const explodedEntities = explodeInsertChildren(session.document, sourceEntity, [], nextIdRef, usedHandles);
  if (!explodedEntities.length) {
    throw new Error(`INSERT ${entityId} did not produce any explodable child entities.`);
  }

  const originalAssignment = session.assignments?.[entityId] ? { ...session.assignments[entityId] } : null;
  const originalXdata = session.xdata_assignments?.[entityId] ? { ...session.xdata_assignments[entityId] } : null;
  session.document.entities.splice(existingIndex, 1, ...explodedEntities);
  pruneUnusedBlocks(session.document);

  delete session.assignments[entityId];
  delete session.xdata_assignments[entityId];
  for (const entity of explodedEntities) {
    if (originalAssignment) {
      session.assignments[entity.id] = { ...originalAssignment };
    }
    if (originalXdata) {
      session.xdata_assignments[entity.id] = { ...originalXdata };
    }
  }

  reindexDocumentSources(session.document);
  projectViewModel(session);
  session.updated_at = new Date().toISOString();
  session.artifact_state = "mother_draft";
  await saveSession({ rootDir: storeRoot || defaultRoot(), session });
  return {
    session,
    removed_entity_id: entityId,
    exploded_entity_ids: explodedEntities.map((entity) => entity.id),
    block_name: String(pairValue(sourceEntity, "2", "") || "").trim() || null
  };
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

function setEntityRuntimeLayer(entity, layer) {
  if (!entity) return;
  setRuntimePairValue(entity, "8", String(layer || "0"));
}

function makeRuntimeTextEntity({ id, x, y, z = 0, layer = "0", height = 1, rotation = 0, color = 1, hAlign = 1, vAlign = 2, text = "" }) {
  return {
    id,
    type: "TEXT",
    pairs: [
      { code: "0", value: "TEXT" },
      { code: "8", value: String(layer || "0") },
      { code: "10", value: String(roundNumber(Number(x || 0), 3)) },
      { code: "11", value: String(roundNumber(Number(x || 0), 3)) },
      { code: "20", value: String(roundNumber(Number(y || 0), 3)) },
      { code: "21", value: String(roundNumber(Number(y || 0), 3)) },
      { code: "30", value: String(roundNumber(Number(z || 0), 3)) },
      { code: "40", value: String(roundNumber(Number(height || 1), 3)) },
      { code: "1", value: String(text || "") },
      { code: "50", value: String(roundNumber(Number(rotation || 0), 3)) },
      { code: "62", value: String(Number(color || 1)) },
      { code: "72", value: String(Number(hAlign || 1)) },
      { code: "73", value: String(Number(vAlign || 2)) }
    ],
    preComments: [],
    section: "ENTITIES",
    blockName: null,
    source: null
  };
}

function activeRuleRefs(session) {
  const sem = collectDocumentSemMetadata(session?.document);
  return Array.isArray(sem?.rule_refs) ? sem.rule_refs.map((item) => String(item || "").trim()).filter(Boolean) : [];
}

function ruleCatalogRule(session, ruleId) {
  const catalog = normalizeRuleCatalogSnapshot(session?.rule_catalog);
  const rules = catalog?.rules && typeof catalog.rules === "object" ? catalog.rules : {};
  return rules[String(ruleId || "").trim()] || null;
}

function labelAnchorInfoFromEntity(entity) {
  const comments = Array.isArray(entity?.preComments) ? entity.preComments : [];
  for (const pair of comments) {
    if (String(pair?.code) !== "999") continue;
    const parsed = parseSemanticComment(pair.value);
    const ruleId = String(parsed?.keys?.label_anchor || "").trim();
    if (!ruleId) continue;
    return { rule_id: ruleId, keys: parsed.keys || {}, raw_comment: parsed.raw_comment };
  }
  return null;
}

function lineRuntimeBBox(entity) {
  const shape = lineShapeFromRuntimeEntity(entity);
  if (!shape) return null;
  return {
    minX: Math.min(shape.x1, shape.x2),
    minY: Math.min(shape.y1, shape.y2),
    maxX: Math.max(shape.x1, shape.x2),
    maxY: Math.max(shape.y1, shape.y2)
  };
}

function normalizeChildAngleDeg(angle) {
  let out = Number(angle || 0) % 360;
  if (out < 0) out += 360;
  return roundNumber(out, 3);
}

function mirrorAngleAcrossYAxis(angle) {
  return normalizeChildAngleDeg(180 - Number(angle || 0));
}

function mirrorAngleAcrossXAxis(angle) {
  return normalizeChildAngleDeg(360 - Number(angle || 0));
}

function mirrorEntityAcrossYAxis(entity) {
  const type = String(entity?.type || "").toUpperCase();
  if (type === "LINE") {
    for (const code of ["10", "11"]) {
      const value = Number(pairValue(entity, code, "NaN"));
      if (Number.isFinite(value)) setRuntimePairValue(entity, code, String(roundNumber(-value, 3)));
    }
    return true;
  }
  if (type === "CIRCLE") {
    const value = Number(pairValue(entity, "10", "NaN"));
    if (Number.isFinite(value)) setRuntimePairValue(entity, "10", String(roundNumber(-value, 3)));
    return Number.isFinite(value);
  }
  if (type === "ARC") {
    const value = Number(pairValue(entity, "10", "NaN"));
    const start = Number(pairValue(entity, "50", "NaN"));
    const end = Number(pairValue(entity, "51", "NaN"));
    if (Number.isFinite(value)) setRuntimePairValue(entity, "10", String(roundNumber(-value, 3)));
    if (Number.isFinite(start) && Number.isFinite(end)) {
      setRuntimePairValue(entity, "50", String(mirrorAngleAcrossYAxis(end)));
      setRuntimePairValue(entity, "51", String(mirrorAngleAcrossYAxis(start)));
    }
    return Number.isFinite(value);
  }
  if (type === "TEXT") {
    for (const code of ["10", "11"]) {
      const value = Number(pairValue(entity, code, "NaN"));
      if (Number.isFinite(value)) setRuntimePairValue(entity, code, String(roundNumber(-value, 3)));
    }
    const rotation = Number(pairValue(entity, "50", "NaN"));
    if (Number.isFinite(rotation)) setRuntimePairValue(entity, "50", String(mirrorAngleAcrossYAxis(rotation)));
    return true;
  }
  return false;
}

function mirrorEntityAcrossXAxis(entity) {
  const type = String(entity?.type || "").toUpperCase();
  if (type === "LINE") {
    for (const code of ["20", "21"]) {
      const value = Number(pairValue(entity, code, "NaN"));
      if (Number.isFinite(value)) setRuntimePairValue(entity, code, String(roundNumber(-value, 3)));
    }
    return true;
  }
  if (type === "CIRCLE") {
    const value = Number(pairValue(entity, "20", "NaN"));
    if (Number.isFinite(value)) setRuntimePairValue(entity, "20", String(roundNumber(-value, 3)));
    return Number.isFinite(value);
  }
  if (type === "ARC") {
    const value = Number(pairValue(entity, "20", "NaN"));
    const start = Number(pairValue(entity, "50", "NaN"));
    const end = Number(pairValue(entity, "51", "NaN"));
    if (Number.isFinite(value)) setRuntimePairValue(entity, "20", String(roundNumber(-value, 3)));
    if (Number.isFinite(start) && Number.isFinite(end)) {
      setRuntimePairValue(entity, "50", String(mirrorAngleAcrossXAxis(end)));
      setRuntimePairValue(entity, "51", String(mirrorAngleAcrossXAxis(start)));
    }
    return Number.isFinite(value);
  }
  if (type === "TEXT") {
    for (const code of ["20", "21"]) {
      const value = Number(pairValue(entity, code, "NaN"));
      if (Number.isFinite(value)) setRuntimePairValue(entity, code, String(roundNumber(-value, 3)));
    }
    const rotation = Number(pairValue(entity, "50", "NaN"));
    if (Number.isFinite(rotation)) setRuntimePairValue(entity, "50", String(mirrorAngleAcrossXAxis(rotation)));
    return true;
  }
  return false;
}

function mirrorEntityAcrossAxis(entity, axis) {
  return String(axis || "").trim().toUpperCase() === "X"
    ? mirrorEntityAcrossXAxis(entity)
    : mirrorEntityAcrossYAxis(entity);
}

function mirrorPreviewShapeAcrossAxis(shape, axis) {
  const normalizedAxis = String(axis || "").trim().toUpperCase();
  if (!shape || typeof shape !== "object") return shape;
  if (normalizedAxis === "X") {
    if (shape.kind === "line") return { ...shape, y1: -Number(shape.y1), y2: -Number(shape.y2) };
    if (shape.kind === "circle") return { ...shape, centerY: -Number(shape.centerY) };
    if (shape.kind === "arc") return {
      ...shape,
      centerY: -Number(shape.centerY),
      startAngle: mirrorAngleAcrossXAxis(shape.endAngle),
      endAngle: mirrorAngleAcrossXAxis(shape.startAngle)
    };
    if (shape.kind === "insert") return { ...shape, y: -Number(shape.y) };
    return { ...shape };
  }
  if (shape.kind === "line") return { ...shape, x1: -Number(shape.x1), x2: -Number(shape.x2) };
  if (shape.kind === "circle") return { ...shape, centerX: -Number(shape.centerX) };
  if (shape.kind === "arc") return {
    ...shape,
    centerX: -Number(shape.centerX),
    startAngle: mirrorAngleAcrossYAxis(shape.endAngle),
    endAngle: mirrorAngleAcrossYAxis(shape.startAngle)
  };
  if (shape.kind === "insert") return { ...shape, x: -Number(shape.x) };
  return { ...shape };
}

function simulationMapBBox(simulationMap) {
  const shapes = [];
  for (const preview of simulationMap?.values ? simulationMap.values() : []) {
    shapes.push(...(Array.isArray(preview?.simulated_shapes) ? preview.simulated_shapes : []));
  }
  return bboxFromShapes(shapes);
}

function clonePreviewWithShapes(preview, shapes, appliedOffset = null) {
  const nextShapes = cloneShapes(shapes);
  return {
    ...preview,
    simulated_shapes: nextShapes,
    simulated_bbox: nextShapes.length ? bboxFromShapes(nextShapes) : null,
    final_orientation_offset: appliedOffset || preview?.final_orientation_offset || null
  };
}

function applyFinalOrientationRulesToSimulationMap(session, config, sourceMap) {
  const rules = executableFinalOrientationRules(session, config);
  if (!rules.length || !sourceMap?.entries) {
    return { simulation_map: sourceMap, applied_rules: [], bbox_normalization: { applied: false, dx: 0, dy: 0, bbox_before: null, bbox_after: null } };
  }
  let nextMap = new Map(sourceMap);
  const appliedRules = [];
  for (const rule of rules) {
    let affectedCount = 0;
    const mirrored = new Map();
    for (const [objectId, preview] of nextMap.entries()) {
      const shapes = Array.isArray(preview?.simulated_shapes) ? preview.simulated_shapes : [];
      const nextShapes = shapes.map((shape) => mirrorPreviewShapeAcrossAxis(shape, rule.axis));
      affectedCount += nextShapes.length ? 1 : 0;
      mirrored.set(objectId, clonePreviewWithShapes(preview, nextShapes));
    }
    nextMap = mirrored;
    appliedRules.push({
      rule_id: rule.rule_id,
      geometry: "mirror",
      axis: rule.axis,
      affected_count: affectedCount,
      normalize_bbox: rule.normalize_bbox,
      text_policy: rule.text_policy
    });
  }
  const bboxBefore = simulationMapBBox(nextMap);
  const dx = bboxBefore ? -Number(bboxBefore.minX || 0) : 0;
  const dy = bboxBefore ? -Number(bboxBefore.minY || 0) : 0;
  const shouldNormalize = bboxBefore && (Math.abs(dx) > 0.0005 || Math.abs(dy) > 0.0005);
  if (shouldNormalize) {
    const normalized = new Map();
    for (const [objectId, preview] of nextMap.entries()) {
      const shapes = Array.isArray(preview?.simulated_shapes) ? preview.simulated_shapes : [];
      normalized.set(objectId, clonePreviewWithShapes(preview, shapes.map((shape) => translateShape(shape, dx, dy)), { dx, dy }));
    }
    nextMap = normalized;
  }
  const bboxAfter = simulationMapBBox(nextMap);
  return {
    simulation_map: nextMap,
    applied_rules: appliedRules,
    bbox_normalization: {
      applied: Boolean(shouldNormalize),
      dx: roundNumber(dx, 3),
      dy: roundNumber(dy, 3),
      bbox_before: bboxBefore,
      bbox_after: bboxAfter
    }
  };
}

function documentRuntimeBBox(document, options = {}) {
  const excludeLabelAnchors = options && options.excludeLabelAnchors === true;
  const entitiesById = new Map((Array.isArray(document?.entities) ? document.entities : []).map((entity) => [entity.id, entity]));
  return listRelevantObjects(document)
    .filter((object) => {
      if (!excludeLabelAnchors) return true;
      return !labelAnchorInfoFromEntity(entitiesById.get(object.entity_id || object.id));
    })
    .reduce((acc, object) => bboxUnion(acc, object.bbox), null);
}

function explodeAllBlockInsertsOnDocument(document) {
  const entities = Array.isArray(document?.entities) ? document.entities : [];
  const usedHandles = collectUsedHandles(document);
  const nextIdRef = { value: nextExplodedEntityCounter(document) };
  const nextEntities = [];
  const exploded = [];
  for (const entity of entities) {
    if (String(entity?.type || "").toUpperCase() !== "INSERT") {
      nextEntities.push(entity);
      continue;
    }
    const children = explodeInsertChildren(document, entity, [], nextIdRef, usedHandles);
    nextEntities.push(...children);
    exploded.push({
      entity_id: entity.id,
      block_name: String(pairValue(entity, "2", "") || "").trim() || null,
      emitted_count: children.length,
      emitted_entity_ids: children.map((child) => child.id)
    });
  }
  document.entities = nextEntities;
  pruneUnusedBlocks(document);
  return {
    exploded_insert_count: exploded.length,
    exploded_entities: exploded
  };
}

function scopeMatchesValue(scopeValue, actualValue) {
  const actual = String(actualValue || "").trim().toUpperCase();
  if (!actual) return true;
  if (scopeValue == null) return true;
  const values = Array.isArray(scopeValue) ? scopeValue : [scopeValue];
  return values.some((item) => {
    const candidate = String(item || "").trim().toUpperCase();
    return candidate === "*" || candidate === actual;
  });
}

function catalogRuleTargetMatchesContext(rule, documentSem, config) {
  const scope = rule && typeof rule.target_scope === "object" ? rule.target_scope : {};
  return scopeMatchesValue(scope.family || scope.families, documentSem?.family || config?.family)
    && scopeMatchesValue(scope.products, documentSem?.product || config?.product)
    && scopeMatchesValue(scope.parts, documentSem?.part || config?.part);
}

function finalOrientationRuleCandidates(session, config) {
  const catalog = normalizeRuleCatalogSnapshot(session?.rule_catalog);
  const catalogRules = catalog && catalog.rules && typeof catalog.rules === "object" ? catalog.rules : {};
  const documentSem = collectDocumentSemMetadata(session?.document);
  const parameters = config?.parameters || {};
  const technologyProfile = String(config?.technology_profile || DEFAULT_CONFIG_CONTEXT.technology_profile || "").trim().toUpperCase();
  const candidates = [];
  for (const rule of Object.values(catalogRules)) {
    if (!rule || typeof rule !== "object") continue;
    const action = rule.action && typeof rule.action === "object" ? rule.action : {};
    const stage = String(action.stage || "").trim().toLowerCase();
    const geometry = String(action.geometry || "").trim().toLowerCase();
    const axis = String(action.axis || "").trim().toUpperCase();
    const profileScope = String(rule.profile_scope || "").trim().toUpperCase();
    if (rule.ui_hidden === true || String(rule.status || "").trim().toLowerCase() === "deprecated") continue;
    if (stage !== "final_orientation" || geometry !== "mirror" || !["X", "Y"].includes(axis)) continue;
    if (profileScope && technologyProfile && profileScope !== technologyProfile) continue;
    if (!catalogRuleTargetMatchesContext(rule, documentSem, config)) continue;
    if (rule.condition && !evaluateCatalogRuleCondition(rule.condition, parameters)) continue;
    candidates.push({
      rule_id: String(rule.rule_id || "").trim(),
      axis,
      normalize_bbox: action.normalize_bbox !== false,
      text_policy: String(action.text_policy || "").trim() || null,
      label: rule.label || null
    });
  }
  return candidates.filter((rule) => rule.rule_id);
}

function executableFinalOrientationRules(session, config) {
  const activeRefs = new Set(activeRuleRefs(session));
  return finalOrientationRuleCandidates(session, config)
    .filter((rule) => activeRefs.has(rule.rule_id))
    .map((rule) => ({
      rule_id: rule.rule_id,
      axis: rule.axis,
      normalize_bbox: rule.normalize_bbox,
      text_policy: rule.text_policy
    }));
}

function missingFinalOrientationWarnings(session, config, appliedRules = []) {
  if (Array.isArray(appliedRules) && appliedRules.length) return [];
  const activeRefs = new Set(activeRuleRefs(session));
  const candidates = finalOrientationRuleCandidates(session, config)
    .filter((rule) => !activeRefs.has(rule.rule_id));
  if (!candidates.length) return [];
  return [{
    code: "MISSING_FINAL_ORIENTATION_RULE",
    severity: "warning",
    message: "Opening side matches final orientation mirror rule(s), but none are active in Document SEM. Add one explicit document rule_ref before trusting Combined Child Preview.",
    candidate_rule_refs: candidates.map((rule) => rule.rule_id),
    candidate_axes: candidates.map((rule) => ({ rule_id: rule.rule_id, axis: rule.axis })),
    active_rule_refs: Array.from(activeRefs)
  }];
}

function materializeFinalOrientationRulesOnDocument(outputDocument, session, config) {
  const rules = executableFinalOrientationRules(session, config);
  const applied = [];
  for (const rule of rules) {
    let affectedCount = 0;
    for (const entity of Array.isArray(outputDocument?.entities) ? outputDocument.entities : []) {
      if (mirrorEntityAcrossAxis(entity, rule.axis)) affectedCount += 1;
    }
    applied.push({
      rule_id: rule.rule_id,
      geometry: "mirror",
      axis: rule.axis,
      affected_count: affectedCount,
      normalize_bbox: rule.normalize_bbox,
      text_policy: rule.text_policy
    });
  }
  return { applied_rules: applied };
}

function normalizeChildDocumentBBoxToOrigin(outputDocument) {
  const bbox = documentRuntimeBBox(outputDocument, { excludeLabelAnchors: true });
  if (!bbox) {
    return { applied: false, dx: 0, dy: 0, bbox_before: null, bbox_after: null };
  }
  const dx = -Number(bbox.minX || 0);
  const dy = -Number(bbox.minY || 0);
  if (Math.abs(dx) > 0.0005 || Math.abs(dy) > 0.0005) {
    for (const entity of Array.isArray(outputDocument?.entities) ? outputDocument.entities : []) {
      translateEntityPairs(entity, dx, dy);
    }
  }
  const nextBBox = documentRuntimeBBox(outputDocument, { excludeLabelAnchors: true });
  return {
    applied: Math.abs(dx) > 0.0005 || Math.abs(dy) > 0.0005,
    dx: roundNumber(dx, 3),
    dy: roundNumber(dy, 3),
    bbox_before: bbox,
    bbox_after: nextBBox
  };
}

function isMotherAuthoringComment(pair) {
  if (String(pair?.code) !== "999") return false;
  return /^(SEM|TOPO|RULE):/i.test(String(pair?.value || "").trim());
}

function stripMotherAuthoringMetadataFromDocument(document) {
  let removed = 0;
  const stripPairs = (pairs) => {
    const source = Array.isArray(pairs) ? pairs : [];
    const next = source.filter((pair) => !isMotherAuthoringComment(pair));
    removed += source.length - next.length;
    return next;
  };
  document.preComments = stripPairs(document.preComments);
  for (const entity of Array.isArray(document?.entities) ? document.entities : []) {
    entity.preComments = stripPairs(entity.preComments);
    entity.pairs = stripPairs(entity.pairs);
  }
  for (const block of Array.isArray(document?.blocks) ? document.blocks : []) {
    block.headerPairs = stripPairs(block.headerPairs);
    block.endblkPairs = stripPairs(block.endblkPairs);
    for (const entity of Array.isArray(block?.entities) ? block.entities : []) {
      entity.preComments = stripPairs(entity.preComments);
      entity.pairs = stripPairs(entity.pairs);
    }
  }
  return { removed_999_count: removed };
}

function collectRuntimeLineEntries(outputDocument) {
  const entries = [];
  for (const entity of Array.isArray(outputDocument?.entities) ? outputDocument.entities : []) {
    if (String(entity?.type || "").toUpperCase() !== "LINE") continue;
    const shape = lineShapeFromRuntimeEntity(entity);
    const orientation = strictOrthogonalLineOrientation(shape);
    if (!shape || !["horizontal", "vertical"].includes(orientation)) continue;
    entries.push({ entity, shape, orientation });
  }
  return entries;
}

function runtimeLineEndpointsConnected(endpoint, selfEntityId, entries, tolerance = 0.75) {
  for (const entry of entries) {
    if (String(entry.entity?.id || "") === String(selfEntityId || "")) continue;
    for (const endpointName of ["start", "end"]) {
      const otherPoint = lineEndpointPoint(entry.shape, endpointName);
      if (otherPoint && pointsOverlapLocal(endpoint, otherPoint, tolerance)) return true;
    }
  }
  return false;
}

function expectedGapMatchesRepairContext(gap, expectedGapValues, tolerance = 1.5) {
  const numericGap = Math.abs(Number(gap || 0));
  if (!Number.isFinite(numericGap) || numericGap <= 0) return false;
  const values = Array.isArray(expectedGapValues) ? expectedGapValues : [];
  if (!values.length) return true;
  return values.some((value) => Math.abs(numericGap - Number(value || 0)) <= tolerance);
}

function buildRepairDisciplineContext(documentRuleExecution, movedEntities, postTopoRuleExecution) {
  const protectedEntityIds = new Set();
  const expectedGapValues = new Set();
  const recordExpectedGap = (value) => {
    const numeric = Math.abs(Number(value || 0));
    if (Number.isFinite(numeric) && numeric > 0.0005) expectedGapValues.add(roundNumber(numeric, 3));
  };
  for (const moved of Array.isArray(movedEntities) ? movedEntities : []) {
    protectedEntityIds.add(String(moved.entity_id || ""));
    recordExpectedGap(moved.dx);
    recordExpectedGap(moved.dy);
  }
  for (const rule of Array.isArray(postTopoRuleExecution?.applied_rules) ? postTopoRuleExecution.applied_rules : []) {
    recordExpectedGap(rule.value_mm);
    for (const entity of Array.isArray(rule.affected_entities) ? rule.affected_entities : []) {
      protectedEntityIds.add(String(entity.entity_id || ""));
    }
  }
  for (const rule of Array.isArray(documentRuleExecution?.applied_rules) ? documentRuleExecution.applied_rules : []) {
    recordExpectedGap(rule.value_mm);
  }
  return {
    protected_entity_ids: Array.from(protectedEntityIds).filter(Boolean),
    protected_entity_id_set: protectedEntityIds,
    expected_gap_values: Array.from(expectedGapValues).sort((a, b) => a - b)
  };
}

function applyFinalOpenContourGapRepair(outputDocument, repairContext = null) {
  const entries = collectRuntimeLineEntries(outputDocument);
  const axisTolerance = 1.5;
  const endpointTolerance = 0.75;
  const minGap = 0.5;
  const maxGap = 12;
  const touched = [];
  const skippedProtected = [];
  const skippedUnexpectedGap = [];
  const protectedEntityIds = repairContext?.protected_entity_id_set instanceof Set
    ? repairContext.protected_entity_id_set
    : new Set(Array.isArray(repairContext?.protected_entity_ids) ? repairContext.protected_entity_ids.map((id) => String(id || "")) : []);
  const expectedGapValues = Array.isArray(repairContext?.expected_gap_values) ? repairContext.expected_gap_values : [];

  for (const entry of entries) {
    if (protectedEntityIds.has(String(entry.entity?.id || ""))) {
      skippedProtected.push(String(entry.entity?.id || ""));
      continue;
    }
    let nextShape = entry.shape;
    const changes = [];
    for (const endpointName of ["start", "end"]) {
      const endpoint = lineEndpointPoint(nextShape, endpointName);
      if (!endpoint) continue;
      if (runtimeLineEndpointsConnected(endpoint, entry.entity.id, entries, endpointTolerance)) continue;
      const candidates = [];
      for (const candidate of entries) {
        if (String(candidate.entity?.id || "") === String(entry.entity?.id || "")) continue;
        if (candidate.orientation === entry.orientation) continue;
        let projected = null;
        let gap = null;
        if (entry.orientation === "horizontal" && candidate.orientation === "vertical") {
          const minY = Math.min(candidate.shape.y1, candidate.shape.y2) - axisTolerance;
          const maxY = Math.max(candidate.shape.y1, candidate.shape.y2) + axisTolerance;
          if (endpoint.y < minY || endpoint.y > maxY) continue;
          gap = Math.abs(endpoint.x - candidate.shape.x1);
          if (!(gap > minGap && gap <= maxGap)) continue;
          if (!expectedGapMatchesRepairContext(gap, expectedGapValues, axisTolerance)) {
            skippedUnexpectedGap.push({ entity_id: entry.entity.id, candidate_entity_id: candidate.entity.id, gap_mm: roundNumber(gap, 3) });
            continue;
          }
          projected = { x: candidate.shape.x1, y: endpoint.y };
        } else if (entry.orientation === "vertical" && candidate.orientation === "horizontal") {
          const minX = Math.min(candidate.shape.x1, candidate.shape.x2) - axisTolerance;
          const maxX = Math.max(candidate.shape.x1, candidate.shape.x2) + axisTolerance;
          if (endpoint.x < minX || endpoint.x > maxX) continue;
          gap = Math.abs(endpoint.y - candidate.shape.y1);
          if (!(gap > minGap && gap <= maxGap)) continue;
          if (!expectedGapMatchesRepairContext(gap, expectedGapValues, axisTolerance)) {
            skippedUnexpectedGap.push({ entity_id: entry.entity.id, candidate_entity_id: candidate.entity.id, gap_mm: roundNumber(gap, 3) });
            continue;
          }
          projected = { x: endpoint.x, y: candidate.shape.y1 };
        }
        if (!projected) continue;
        const candidateEndpoint = nearestObjectEndpoint({ shapes: [candidate.shape] }, projected, {
          x1: candidate.shape.x1,
          y1: candidate.shape.y1,
          x2: candidate.shape.x2,
          y2: candidate.shape.y2
        }, endpointTolerance);
        if (!candidateEndpoint) continue;
        candidates.push({ candidate, projected, gap });
      }
      if (candidates.length !== 1) continue;
      const match = candidates[0];
      nextShape = setLineEndpointPoint(nextShape, endpointName, match.projected);
      changes.push({
        endpoint: endpointName,
        gap_mm: roundNumber(match.gap, 3),
        projected_x: roundNumber(match.projected.x, 3),
        projected_y: roundNumber(match.projected.y, 3),
        anchor_entity_id: match.candidate.entity.id
      });
    }
    if (!changes.length) continue;
    const length = shapeLineLength(nextShape);
    if (!Number.isFinite(length) || length <= 0.5) continue;
    if (!setLineRuntimeEntityShape(entry.entity, nextShape)) continue;
    entry.shape = nextShape;
    touched.push({ entity_id: entry.entity.id, changes });
  }

  return {
    status: touched.length ? "executed_final_gap_repair" : "no_final_gap_repairs",
    applied_count: touched.length,
    touched_entities: touched,
    protected_entity_count: protectedEntityIds.size,
    skipped_protected_entities: Array.from(new Set(skippedProtected)).sort(),
    skipped_unexpected_gap_candidates: skippedUnexpectedGap,
    expected_gap_values: expectedGapValues
  };
}

function enforceChildLayerPolicy(outputDocument, config) {
  const technologyProfile = String(config?.technology_profile || "").trim().toUpperCase();
  if (technologyProfile !== "OPS_S4P4") return { applied: false, text_layer: null, geometry_layer: null, updated_count: 0 };
  let updatedCount = 0;
  for (const entity of Array.isArray(outputDocument?.entities) ? outputDocument.entities : []) {
    const layer = String(entity?.type || "").toUpperCase() === "TEXT" ? "0" : "1";
    setEntityRuntimeLayer(entity, layer);
    updatedCount += 1;
  }
  return { applied: true, text_layer: "0", geometry_layer: "1", updated_count: updatedCount };
}

function finalizeChildDocument(outputDocument, session, config, repairContext = null, options = {}) {
  const blockExplosion = explodeAllBlockInsertsOnDocument(outputDocument);
  const finalOrientation = options.skipFinalOrientation === true
    ? {
        applied_rules: cloneJson(options.preAppliedFinalOrientationRules || []),
        skipped: true,
        reason: "pre_applied_in_simulation_map"
      }
    : materializeFinalOrientationRulesOnDocument(outputDocument, session, config);
  const bboxNormalization = normalizeChildDocumentBBoxToOrigin(outputDocument);
  const finalGapRepair = applyFinalOpenContourGapRepair(outputDocument, repairContext);
  const childLabelExecution = materializeChildLabelsOnDocument(outputDocument, session);
  const layerPolicy = enforceChildLayerPolicy(outputDocument, config);
  const metadataCleanup = stripMotherAuthoringMetadataFromDocument(outputDocument);
  pruneUnusedBlocks(outputDocument);
  return {
    block_explosion: blockExplosion,
    final_orientation: finalOrientation,
    bbox_normalization: bboxNormalization,
    final_gap_repair: finalGapRepair,
    child_label: childLabelExecution,
    layer_policy: layerPolicy,
    metadata_cleanup: metadataCleanup
  };
}

function materializeChildLabelsOnDocument(outputDocument, session) {
  const activeRefs = new Set(activeRuleRefs(session));
  const entities = Array.isArray(outputDocument?.entities) ? outputDocument.entities : [];
  const grouped = new Map();
  for (const entity of entities) {
    const info = labelAnchorInfoFromEntity(entity);
    if (!info || !activeRefs.has(info.rule_id)) continue;
    if (!grouped.has(info.rule_id)) grouped.set(info.rule_id, { info, entities: [] });
    grouped.get(info.rule_id).entities.push(entity);
  }
  if (!grouped.size) return { applied_rules: [], removed_anchor_entities: [], emitted_text_entities: [] };

  const removedIds = new Set();
  const emitted = [];
  const applied = [];
  for (const [ruleId, group] of grouped.entries()) {
    const boxes = group.entities.map(lineRuntimeBBox).filter(Boolean);
    if (!boxes.length) continue;
    const bbox = boxes.reduce((acc, item) => bboxUnion(acc, item), null);
    const center = bboxCenter(bbox);
    const rule = ruleCatalogRule(session, ruleId) || {};
    const action = rule.action || {};
    const keys = group.info.keys || {};
    const rotation = Number(keys.rotation || action.rotation || 0);
    const textEntityId = nextRuntimeEntityId(outputDocument);
    const payload = String(action.payload_template || ";|{{WORKORDERCODE}}|{{MODEL_VRATA}}|{{SOURCE_REFERENCE}}|{{DIMENSION_SHORT}}|{{OPENING_SIDE_SHORT}}").replaceAll("{{MODEL}}", "{{MODEL_VRATA}}").replaceAll("{{TIP_LEGACY}}", "{{TIP_VRATA}}");
    const textEntity = makeRuntimeTextEntity({
      id: textEntityId,
      x: center.x,
      y: center.y,
      z: 0,
      layer: String(action.carrier_layer || "0"),
      height: Number(action.carrier_height || 1),
      rotation,
      color: Number(action.carrier_color || 1),
      hAlign: Number(action.carrier_h_align || 1),
      vAlign: Number(action.carrier_v_align || 2),
      text: payload
    });
    for (const entity of group.entities) removedIds.add(entity.id);
    emitted.push(textEntity);
    applied.push({
      rule_id: ruleId,
      anchor_count: group.entities.length,
      removed_anchor_entities: group.entities.map((entity) => entity.id),
      emitted_text_entity: textEntityId,
      x: roundNumber(center.x, 3),
      y: roundNumber(center.y, 3),
      payload_template: payload
    });
  }

  outputDocument.entities = entities.filter((entity) => !removedIds.has(entity.id));
  for (const entity of outputDocument.entities) {
    setEntityRuntimeLayer(entity, "1");
  }
  outputDocument.entities.push(...emitted);

  return {
    applied_rules: applied,
    removed_anchor_entities: Array.from(removedIds),
    emitted_text_entities: emitted.map((entity) => entity.id)
  };
}

function lineShapeFromRuntimeEntity(entity) {
  if (String(entity?.type || "").toUpperCase() !== "LINE") return null;
  const x1 = Number(childPairValue(entity, "10", "NaN"));
  const y1 = Number(childPairValue(entity, "20", "NaN"));
  const x2 = Number(childPairValue(entity, "11", "NaN"));
  const y2 = Number(childPairValue(entity, "21", "NaN"));
  if (![x1, y1, x2, y2].every(Number.isFinite)) return null;
  return { kind: "line", x1, y1, x2, y2 };
}

function setLineRuntimeEntityShape(entity, shape) {
  if (!entity || !shape || shape.kind !== "line") return false;
  const values = [shape.x1, shape.y1, shape.x2, shape.y2].map((value) => Number(value));
  if (!values.every(Number.isFinite)) return false;
  setRuntimePairValue(entity, "10", roundNumber(values[0], 3));
  setRuntimePairValue(entity, "20", roundNumber(values[1], 3));
  setRuntimePairValue(entity, "11", roundNumber(values[2], 3));
  setRuntimePairValue(entity, "21", roundNumber(values[3], 3));
  return true;
}

function setRuntimeEntityShape(entity, shape) {
  if (!entity || !shape) return false;
  const type = String(entity.type || "").toUpperCase();
  if (type === "LINE" && shape.kind === "line") {
    return setLineRuntimeEntityShape(entity, shape);
  }
  if ((type === "CIRCLE" || type === "ARC") && (shape.kind === "circle" || shape.kind === "arc")) {
    const centerX = Number(shape.centerX);
    const centerY = Number(shape.centerY);
    const radius = Number(shape.radius);
    if (![centerX, centerY, radius].every(Number.isFinite)) return false;
    setRuntimePairValue(entity, "10", roundNumber(centerX, 3));
    setRuntimePairValue(entity, "20", roundNumber(centerY, 3));
    setRuntimePairValue(entity, "40", roundNumber(Math.abs(radius), 3));
    if (type === "ARC" && shape.kind === "arc") {
      const startAngle = Number(shape.startAngle);
      const endAngle = Number(shape.endAngle);
      if (Number.isFinite(startAngle)) setRuntimePairValue(entity, "50", roundNumber(startAngle, 3));
      if (Number.isFinite(endAngle)) setRuntimePairValue(entity, "51", roundNumber(endAngle, 3));
    }
    return true;
  }
  return false;
}

function lineEndpointPoint(shape, endpointName) {
  if (!shape || shape.kind !== "line") return null;
  if (endpointName === "start") return { x: Number(shape.x1), y: Number(shape.y1) };
  return { x: Number(shape.x2), y: Number(shape.y2) };
}

function setLineEndpointPoint(shape, endpointName, point) {
  if (!shape || shape.kind !== "line" || !point) return shape;
  const px = Number(point.x);
  const py = Number(point.y);
  if (![px, py].every(Number.isFinite)) return shape;
  if (endpointName === "start") return { ...shape, x1: px, y1: py };
  return { ...shape, x2: px, y2: py };
}

function translatedLineEndpoint(shape, endpointName, dx, dy) {
  const point = lineEndpointPoint(shape, endpointName);
  if (!point) return null;
  return {
    x: Number(point.x) + Number(dx || 0),
    y: Number(point.y) + Number(dy || 0)
  };
}

function pointWithinVerticalSpan(pointY, a, b, tolerance = 1.5) {
  const y = Number(pointY);
  const ya = Number(a?.y);
  const yb = Number(b?.y);
  if (![y, ya, yb].every(Number.isFinite)) return false;
  const minY = Math.min(ya, yb) - tolerance;
  const maxY = Math.max(ya, yb) + tolerance;
  return y >= minY && y <= maxY;
}

function buildProjectedFollowerPoint(currentEndpoint, movedEndpoint, oppositeMovedEndpoint, tolerance = 1.5) {
  if (!currentEndpoint || !movedEndpoint || !oppositeMovedEndpoint) return null;
  const currentY = Number(currentEndpoint.y);
  const movedX = Number(movedEndpoint.x);
  if (![currentY, movedX].every(Number.isFinite)) return null;
  if (!pointWithinVerticalSpan(currentY, movedEndpoint, oppositeMovedEndpoint, tolerance)) return null;
  return {
    x: movedX,
    y: currentY
  };
}

function originalHorizontalEndpointTouchesMovedVertical(originalEndpoint, candidate, tolerance = 1.5) {
  if (!originalEndpoint || !candidate) return false;
  if (String(candidate.endpoint || '').toLowerCase() !== 'start') return false;
  if (pointsOverlapLocal(originalEndpoint, candidate.original, tolerance)) return true;
  const x = Number(originalEndpoint.x);
  const verticalX = Number(candidate.original?.x);
  if (![x, verticalX].every(Number.isFinite)) return false;
  if (Math.abs(x - verticalX) > tolerance) return false;
  return pointWithinVerticalSpan(originalEndpoint.y, candidate.original, candidate.opposite_original, tolerance);
}

function findMatchingMovedVerticals(originalEndpoint, movedEndpoints, tolerance = 1.5) {
  return (Array.isArray(movedEndpoints) ? movedEndpoints : []).filter((candidate) => (
    originalHorizontalEndpointTouchesMovedVertical(originalEndpoint, candidate, tolerance)
  ));
}

function applyTopoTrimRejoinEndpointFollowerRepair(session, outputDocument, sourceObjects, movedEntities, topoKeys) {
  if (String(topoKeys?.trim_policy || "").trim() !== "rejoin") {
    return { status: "none", applied_count: 0, touched_entities: [] };
  }
  if (String(topoKeys?.mode || "fixed_envelope_slide").trim() !== "fixed_envelope_slide") {
    return { status: "skipped_unsupported_mode", applied_count: 0, touched_entities: [] };
  }
  if (String(topoKeys?.axis || "").trim().toUpperCase() !== "X") {
    return { status: "skipped_unsupported_axis", applied_count: 0, touched_entities: [] };
  }

  const outputEntities = entityMapById(outputDocument);
  const topLevelObjects = Array.isArray(sourceObjects) ? sourceObjects : [];
  const blockInternalObjects = collectBlockInternalLineObjects(session, session?.document);
  const sourceByEntityId = new Map(topLevelObjects.map((object) => [object.entity_id, object]));
  const movedByEntityId = new Map((Array.isArray(movedEntities) ? movedEntities : []).map((entry) => [entry.entity_id, entry]));
  const movedEndpoints = [];

  const pushMovedLineEndpoints = (shape, moved, objectRef) => {
    if (!shape || strictOrthogonalLineOrientation(shape) !== "vertical") return;
    const dx = Number(moved.dx || 0);
    const dy = Number(moved.dy || 0);
    const runtimeShape = objectRef?.parent_insert_id
      ? null
      : lineShapeFromRuntimeEntity(outputEntities.get(moved.entity_id));
    const currentShape = runtimeShape && strictOrthogonalLineOrientation(runtimeShape) === "vertical"
      ? runtimeShape
      : null;
    for (const endpointName of ["start", "end"]) {
      const original = lineEndpointPoint(shape, endpointName);
      const current = currentShape
        ? lineEndpointPoint(currentShape, endpointName)
        : translatedLineEndpoint(shape, endpointName, dx, dy);
      if (!original || !current) continue;
      const oppositeEndpointName = endpointName === "start" ? "end" : "start";
      const oppositeOriginal = lineEndpointPoint(shape, oppositeEndpointName);
      const oppositeCurrent = currentShape
        ? lineEndpointPoint(currentShape, oppositeEndpointName)
        : translatedLineEndpoint(shape, oppositeEndpointName, dx, dy);
      movedEndpoints.push({
        entity_id: moved.entity_id,
        object_id: objectRef?.id || moved.object_id,
        endpoint: endpointName,
        original,
        current,
        opposite_original: oppositeOriginal,
        opposite_current: oppositeCurrent,
        source_kind: objectRef?.parent_insert_id ? "block_child" : "top_level"
      });
    }
  };

  for (const moved of movedByEntityId.values()) {
    const object = sourceByEntityId.get(moved.entity_id);
    const originalShape = Array.isArray(object?.shapes) ? object.shapes.find((shape) => shape?.kind === "line") : null;
    if (originalShape) pushMovedLineEndpoints(originalShape, moved, object);

    for (const childObject of blockInternalObjects) {
      if (String(childObject?.parent_insert_id || "") !== String(moved.entity_id || "")) continue;
      const childShape = Array.isArray(childObject?.shapes) ? childObject.shapes.find((shape) => shape?.kind === "line") : null;
      if (childShape) pushMovedLineEndpoints(childShape, moved, childObject);
    }
  }

  if (!movedEndpoints.length) {
    return { status: "no_vertical_mover_endpoints", applied_count: 0, touched_entities: [] };
  }

  const tolerance = 1.5;
  const touched = [];
  for (const object of Array.isArray(sourceObjects) ? sourceObjects : []) {
    if (movedByEntityId.has(object.entity_id)) continue;
    const outputEntity = outputEntities.get(object.entity_id);
    if (!outputEntity || String(outputEntity.type || "").toUpperCase() !== "LINE") continue;
    const originalShape = Array.isArray(object?.shapes) ? object.shapes.find((shape) => shape?.kind === "line") : null;
    if (!originalShape || strictOrthogonalLineOrientation(originalShape) !== "horizontal") continue;

    let nextShape = lineShapeFromRuntimeEntity(outputEntity) || cloneJson(originalShape);
    const changes = [];
    for (const endpointName of ["start", "end"]) {
      const originalEndpoint = lineEndpointPoint(originalShape, endpointName);
      if (!originalEndpoint) continue;
      const matches = findMatchingMovedVerticals(originalEndpoint, movedEndpoints, tolerance);
      if (matches.length !== 1) continue;
      const match = matches[0];
      const currentEndpoint = lineEndpointPoint(nextShape, endpointName);
      let followPoint = match.current;
      if (currentEndpoint && Math.abs(Number(currentEndpoint.y) - Number(match.current.y)) > tolerance) {
        const projectedPoint = buildProjectedFollowerPoint(
          currentEndpoint,
          match.current,
          match.opposite_current,
          tolerance
        );
        if (!projectedPoint) {
          continue;
        }
        followPoint = projectedPoint;
      }
      nextShape = setLineEndpointPoint(nextShape, endpointName, followPoint);
      changes.push({
        endpoint: endpointName,
        followed_mover_entity_id: match.entity_id,
        x: roundNumber(followPoint.x, 3),
        y: roundNumber(followPoint.y, 3)
      });
    }

    if (!changes.length) continue;
    const length = shapeLineLength(nextShape);
    if (!Number.isFinite(length) || length <= 0.5) continue;
    if (!setLineRuntimeEntityShape(outputEntity, nextShape)) continue;
    touched.push({
      entity_id: object.entity_id,
      object_id: object.id,
      changes
    });
  }

  return {
    status: touched.length ? "executed_endpoint_follower" : "no_matching_line_endpoints",
    applied_count: touched.length,
    touched_entities: touched
  };
}

function materializeChildDocumentTopoPoc(session, config, options = {}) {
  const view = projectViewModel(session);
  const parameters = config.parameters || {};
  const branchMode = effectiveBranchModeForConfig(config, options?.branchMode);
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
  const sourceObjects = filterObjectsByBranchMode(view.objects, branchMode);
  const outputDocument = cloneJson(session.document);
  const branchFilterExecution = filterDocumentByBranchMode(session, outputDocument, branchMode);
  const outputEntities = entityMapById(outputDocument);
  const documentRuleExecution = materializeDocumentRulesOnDocument(outputDocument, session, sourceObjects, parameters, branchMode);
  const decisionsByEntityId = new Map();
  const excludedEntities = [];
  const includedEntities = [];
  const movedEntities = [];
  const skippedTopoEntities = [];
  let matchingTopoMoverCount = 0;

  for (const object of Array.isArray(sourceObjects) ? sourceObjects : []) {
    const sourceEntity = findEntity(session.document, object.entity_id);
    const topoRole = entityTopoRoleMetadata(sourceEntity);
    const isMoverRole = topoRole && topoRole.keys?.role === "mover";
    const roleGroupMatches = isMoverRole && String(topoRole.keys?.group || "").trim() === String(topoKeys.group || "").trim();
    const decision = evaluateChildEntityInclusion(object, parameters);
    decisionsByEntityId.set(object.entity_id, decision);
    if (!decision.included) {
      excludedEntities.push({
        entity_id: object.entity_id,
        object_id: object.id,
        type: object.type,
        exclusion_reason: decision.exclusion_reason || "excluded"
      });
      if (roleGroupMatches) {
        skippedTopoEntities.push({
          entity_id: object.entity_id,
          object_id: object.id,
          reason: "TOPO_MOVER_EXCLUDED_BY_SEM",
          exclusion_reason: decision.exclusion_reason || "excluded"
        });
      }
      continue;
    }
    includedEntities.push({
      entity_id: object.entity_id,
      object_id: object.id,
      type: object.type
    });

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
    const excludedMoverCount = skippedTopoEntities.filter((item) => item.reason === "TOPO_MOVER_EXCLUDED_BY_SEM").length;
    if (excludedMoverCount) {
      const firstExcluded = skippedTopoEntities.find((item) => item.reason === "TOPO_MOVER_EXCLUDED_BY_SEM");
      throw new Error(`TOPO group ${String(topoKeys.group || "").trim() || "(missing group)"} has ${excludedMoverCount} mover annotation(s), but all are excluded by SEM/config before TOPO. First excluded entity: ${firstExcluded?.entity_id || "?"}; reason: ${firstExcluded?.exclusion_reason || "excluded"}.`);
    }
    throw new Error(`TOPO group ${String(topoKeys.group || "").trim() || "(missing group)"} has no entity-level mover annotations in the current session.`);
  }

  const topoRepairExecution = applyTopoTrimRejoinEndpointFollowerRepair(
    session,
    outputDocument,
    sourceObjects,
    movedEntities,
    topoKeys
  );

  const postTopoRuleExecution = materializePostTopoRulesOnDocument(
    outputDocument,
    session,
    sourceObjects,
    parameters
  );
  const repairContext = buildRepairDisciplineContext(documentRuleExecution, movedEntities, postTopoRuleExecution);

  outputDocument.entities = (Array.isArray(outputDocument.entities) ? outputDocument.entities : [])
    .filter((entity) => {
      const decision = decisionsByEntityId.get(entity.id);
      return !decision || decision.included;
    });
  pruneUnusedBlocks(outputDocument);
  const finalChildExecution = finalizeChildDocument(outputDocument, session, config, repairContext);

  return {
    document: outputDocument,
    generation_summary: {
      mode: "child_topo_poc_v0",
      topology_mode: "fixed_envelope_slide",
      product_code: config.product_code,
      technology_profile: config.technology_profile,
      branch_mode: branchMode,
      branch_filter: branchFilterExecution,
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
      document_rules_applied: documentRuleExecution.applied_rules || [],
      trim_policy: topoKeys.trim_policy || null,
      trim_policy_status: topoKeys.trim_policy ? topoRepairExecution.status : "none",
      trim_policy_repair: topoRepairExecution,
      entity_count: sourceObjects.length,
      included_count: includedEntities.length,
      excluded_count: excludedEntities.length,
      moved_count: movedEntities.length,
      included_entities: includedEntities,
      excluded_entities: excludedEntities,
      moved_entities: movedEntities,
      skipped_topo_entities: skippedTopoEntities,
      post_topo_rules_applied: postTopoRuleExecution.applied_rules || [],
      repair_discipline: {
        protected_entity_ids: repairContext.protected_entity_ids,
        expected_gap_values: repairContext.expected_gap_values
      },
      block_explosion: finalChildExecution.block_explosion,
      final_orientation_rules_applied: finalChildExecution.final_orientation.applied_rules || [],
      bbox_normalization: finalChildExecution.bbox_normalization,
      final_gap_repair: finalChildExecution.final_gap_repair,
      child_label_rules_applied: finalChildExecution.child_label.applied_rules || [],
      child_label_removed_anchor_entities: finalChildExecution.child_label.removed_anchor_entities || [],
      child_label_emitted_text_entities: finalChildExecution.child_label.emitted_text_entities || [],
      layer_policy: finalChildExecution.layer_policy,
      metadata_cleanup: finalChildExecution.metadata_cleanup
    }
  };
}

function generateChildDxfTopoPoc(session, parameterSet, options = {}) {
  const config = normalizeConfigParameterSet(parameterSet || DEFAULT_KSKR_EXECUTION_CHECK_PARAMETER_SET);
  const materialized = materializeChildDocumentTopoPoc(session, config, options);
  return {
    config_parameter_set: config,
    generation_summary: materialized.generation_summary,
    dxf_text: serializeDocument(materialized.document)
  };
}

function buildResolverMaterializedSimulation(session, config, materialized) {
  const outputObjects = listRelevantObjects(materialized.document);
  const summary = materialized.generation_summary || {};
  const sourceView = projectViewModel(session);
  const sourceByEntityId = new Map((Array.isArray(sourceView?.objects) ? sourceView.objects : []).map((object) => [String(object.entity_id || ""), object]));
  const renderObjects = outputObjects.map((object) => {
    const sourceObject = sourceByEntityId.get(String(object.entityId || "")) || null;
    return {
      id: object.id,
      entity_id: object.entityId,
      display_label: object.type === "INSERT" && object.blockName
        ? `${object.type} ${object.blockName}`
        : `${object.type} ${object.id}`,
      type: object.type,
      primary_layer: object.layer || sourceObject?.primary_layer || null,
      classification_state: sourceObject?.classification_state || "classified",
      semantic_color: String(object.type || "").toUpperCase() === "TEXT"
        ? "#dc2626"
        : (sourceObject?.semantic_color || "#334155"),
      semantic_metadata: sourceObject?.semantic_metadata ? cloneJson(sourceObject.semantic_metadata) : null,
      topo_role_metadata: sourceObject?.topo_role_metadata ? cloneJson(sourceObject.topo_role_metadata) : null,
      raw_ref: sourceObject?.raw_ref ? cloneJson(sourceObject.raw_ref) : null,
      source: object.source || sourceObject?.source || null,
      bbox: object.bbox ? cloneJson(object.bbox) : null,
      shapes: cloneShapes(object.shapes)
    };
  });

  const items = renderObjects.map((object) => ({
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
      visible: true,
      included: true,
      exclusion_reason: null,
      topology_mode: summary.topology_mode || "fixed_envelope_slide",
      geometry_simulation_mode: "resolver_materialized_child_dxf_v0",
      simulated_shapes: cloneShapes(object.shapes),
      simulated_bbox: object.bbox ? cloneJson(object.bbox) : null,
      applied_offset: null,
      render_visible: true,
      line_pairing: [],
      document_rule_actions: [],
      post_topo_rule_actions: [],
      resolver_materialized: true,
      ready_for_child_planning: object.classification_state === "classified" && Boolean(object.primary_layer),
      preview_actions: [
        object.primary_layer ? "LAYER=" + object.primary_layer : null,
        "RESOLVER_CHILD=TRUE"
      ].filter(Boolean)
    }
  }));
  const validation = validateCombinedPreviewGeometry(renderObjects, items, summary.topology_mode || "fixed_envelope_slide");

  return {
    session_id: session.session_id,
    technology_profile: config.technology_profile,
    product_code: config.product_code,
    topology_mode: summary.topology_mode || "fixed_envelope_slide",
    config_parameter_set: config,
    render_objects: renderObjects,
    items,
    validation,
    summary: {
      object_count: items.length,
      branch_mode: summary.branch_mode || null,
      source_object_count: sourceView.objects.length,
      included_count: items.filter((item) => item.preview?.included !== false).length,
      excluded_count: items.filter((item) => item.preview?.included === false).length,
      resolver_materialized: true,
      child_mode: summary.mode || "child_topo_poc_v0",
      post_topo_rules_applied: summary.post_topo_rules_applied || [],
      validation_counts: validation.counts
    }
  };
}
function cloneShapes(shapes) {
  return JSON.parse(JSON.stringify(Array.isArray(shapes) ? shapes : []));
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

function buildTopoGeometrySimulationMap(session, objects, parameters, topologyMode, baseSimulationMap = null) {
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
  const workingObjects = objectsList.map((object) => {
    const basePreview = baseSimulationMap instanceof Map ? baseSimulationMap.get(object.id) : null;
    const baseShapes = Array.isArray(basePreview?.simulated_shapes) ? cloneShapes(basePreview.simulated_shapes) : cloneShapes(object?.shapes);
    const baseBBox = basePreview?.simulated_bbox ? cloneJson(basePreview.simulated_bbox) : (object?.bbox ? cloneJson(object.bbox) : null);
    return {
      ...object,
      shapes: baseShapes,
      bbox: baseBBox
    };
  });
  const workingObjectMap = new Map(workingObjects.map((object) => [object.id, object]));
  const objectDecisions = new Map();
  const objectMap = new Map();
  const simulatedShapeMap = new Map();
  const repairEnvelope = buildTopoPreviewEnvelope(workingObjects);
  const repairOptions = {
    bounds: repairEnvelope,
    maxExtension: 30
  };

  for (const object of workingObjects) {
    objectDecisions.set(object.id, evaluateChildEntityInclusion(object, parameters));
  }

  const includedObjects = workingObjects.filter((object) => objectDecisions.get(object.id)?.included);
  const lineCandidates = collectLineCandidates(includedObjects);

  for (const object of workingObjects) {
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

  // Do not silently stretch untouched horizontals to the preview envelope.
  // In production-minded WYSIWYG preview this created false top/bottom lines
  // that could grow by hundreds of millimeters even when the source line was
  // only participating as an anchored segment. Keep the actual repaired shape
  // ownership instead of normalizing whole-width boundaries here.

  for (const object of workingObjects) {
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

function buildIdentitySimulationMap(objects, topologyMode) {
  const map = new Map();
  for (const object of Array.isArray(objects) ? objects : []) {
    map.set(object.id, buildIdentityGeometrySimulation(object, topologyMode));
  }
  return map;
}

function shapeEndpointPairs(shape) {
  if (!shape || typeof shape !== "object") return [];
  if (shape.kind === "line") {
    const x1 = Number(shape.x1);
    const y1 = Number(shape.y1);
    const x2 = Number(shape.x2);
    const y2 = Number(shape.y2);
    if (![x1, y1, x2, y2].every(Number.isFinite)) return [];
    return [
      { point: { x: x1, y: y1 }, vertex: "start" },
      { point: { x: x2, y: y2 }, vertex: "end" }
    ];
  }
  if (shape.kind === "arc") {
    const endpoints = arcEndpoints(shape);
    if (!endpoints?.start || !endpoints?.end) return [];
    return [
      { point: { x: Number(endpoints.start.x), y: Number(endpoints.start.y) }, vertex: "start" },
      { point: { x: Number(endpoints.end.x), y: Number(endpoints.end.y) }, vertex: "end" }
    ].filter((entry) => Number.isFinite(entry.point.x) && Number.isFinite(entry.point.y));
  }
  return [];
}

function shapeLineLength(shape) {
  if (!shape || shape.kind !== "line") return null;
  const x1 = Number(shape.x1);
  const y1 = Number(shape.y1);
  const x2 = Number(shape.x2);
  const y2 = Number(shape.y2);
  if (![x1, y1, x2, y2].every(Number.isFinite)) return null;
  return Math.hypot(x2 - x1, y2 - y1);
}

function pointDistanceLocal(a, b) {
  const ax = Number(a?.x);
  const ay = Number(a?.y);
  const bx = Number(b?.x);
  const by = Number(b?.y);
  if (![ax, ay, bx, by].every(Number.isFinite)) return Number.POSITIVE_INFINITY;
  return Math.hypot(ax - bx, ay - by);
}

function pointNearBoundary(point, bbox, tolerance = 1.5) {
  if (!point || !bbox) return null;
  const x = Number(point.x);
  const y = Number(point.y);
  const minX = Number(bbox.minX);
  const maxX = Number(bbox.maxX);
  const minY = Number(bbox.minY);
  const maxY = Number(bbox.maxY);
  if (![x, y, minX, maxX, minY, maxY].every(Number.isFinite)) return null;
  if (Math.abs(x - minX) <= tolerance) return "LEFT";
  if (Math.abs(x - maxX) <= tolerance) return "RIGHT";
  if (Math.abs(y - minY) <= tolerance) return "BOTTOM";
  if (Math.abs(y - maxY) <= tolerance) return "TOP";
  return null;
}

function validateCombinedPreviewGeometry(objects, items, topologyMode) {
  const objectList = Array.isArray(objects) ? objects : [];
  const itemList = Array.isArray(items) ? items : [];
  const objectMap = new Map(objectList.map((object) => [object.id, object]));
  const visibleItems = itemList.filter((item) => item?.preview?.visible !== false);
  const visibleShapes = [];

  for (const item of visibleItems) {
    const previewShapes = Array.isArray(item?.preview?.simulated_shapes) ? item.preview.simulated_shapes : [];
    for (let index = 0; index < previewShapes.length; index += 1) {
      visibleShapes.push({
        object_id: item.object_id,
        entity_id: item.entity_id,
        display_label: item.display_label,
        shape_index: index,
        shape: previewShapes[index]
      });
    }
  }

  const overallBBox = bboxFromShapes(visibleShapes.map((entry) => entry.shape).filter(Boolean));
  const errors = [];
  const warnings = [];

  for (const item of visibleItems) {
    const originalObject = objectMap.get(item.object_id);
    const originalShapes = Array.isArray(originalObject?.shapes) ? originalObject.shapes : [];
    const simulatedShapes = Array.isArray(item?.preview?.simulated_shapes) ? item.preview.simulated_shapes : [];
    const appliedOffset = item?.preview?.applied_offset || { dx: 0, dy: 0 };
    const offsetMagnitude = Math.abs(Number(appliedOffset.dx || 0)) + Math.abs(Number(appliedOffset.dy || 0));
    const linePairing = Array.isArray(item?.preview?.line_pairing) ? item.preview.line_pairing : [];

    for (let index = 0; index < Math.min(originalShapes.length, simulatedShapes.length); index += 1) {
      const originalShape = originalShapes[index];
      const simulatedShape = simulatedShapes[index];
      if (!originalShape || !simulatedShape) continue;
      if (originalShape.kind !== "line" || simulatedShape.kind !== "line") continue;
      const originalLength = shapeLineLength(originalShape);
      const simulatedLength = shapeLineLength(simulatedShape);
      if (!Number.isFinite(originalLength) || !Number.isFinite(simulatedLength)) continue;
      const deltaLength = Math.abs(simulatedLength - originalLength);
      const allowedChange = Math.max(40, offsetMagnitude + 12);
      if (deltaLength > allowedChange) {
        errors.push({
          code: "EXCESSIVE_LINE_RESIZE",
          severity: "error",
          message: `${item.display_label} changed line length by ${roundNumber(deltaLength, 3)} mm, above allowed ${roundNumber(allowedChange, 3)} mm.`,
          object_id: item.object_id,
          entity_id: item.entity_id,
          display_label: item.display_label,
          details: {
            shape_index: index,
            original_length: roundNumber(originalLength, 3),
            simulated_length: roundNumber(simulatedLength, 3),
            delta_length: roundNumber(deltaLength, 3),
            allowed_change: roundNumber(allowedChange, 3),
            applied_offset: cloneJson(appliedOffset)
          }
        });
      }
    }

    const unresolvedPairings = linePairing.filter((entry) => entry && entry.status && entry.status !== "paired");
    if (unresolvedPairings.length && (Math.abs(Number(appliedOffset.dx || 0)) > 0 || Math.abs(Number(appliedOffset.dy || 0)) > 0)) {
      warnings.push({
        code: "UNRESOLVED_REJOIN",
        severity: "warning",
        message: `${item.display_label} has ${unresolvedPairings.length} unresolved line rejoin candidate(s) after movement.`,
        object_id: item.object_id,
        entity_id: item.entity_id,
        display_label: item.display_label,
        details: {
          unresolved_pairings: unresolvedPairings.length,
          applied_offset: cloneJson(appliedOffset)
        }
      });
    }

    if (topologyMode !== "none" && String(item.type || "").trim().toUpperCase() === "INSERT"
      && (Math.abs(Number(appliedOffset.dx || 0)) > 0 || Math.abs(Number(appliedOffset.dy || 0)) > 0)) {
      warnings.push({
        code: "UNVERIFIED_BLOCK_TOPO_MOVER",
        severity: "warning",
        message: `${item.display_label} is a moved block insert; V1 validation cannot yet prove cutout relocation correctness inside block geometry.`,
        object_id: item.object_id,
        entity_id: item.entity_id,
        display_label: item.display_label,
        details: {
          applied_offset: cloneJson(appliedOffset)
        }
      });
    }
  }

  if (overallBBox) {
    const tolerance = 1.5;
    const endpointEntries = [];
    for (const entry of visibleShapes) {
      const endpoints = shapeEndpointPairs(entry.shape);
      for (const endpoint of endpoints) {
        endpointEntries.push({
          ...entry,
          vertex: endpoint.vertex,
          point: endpoint.point,
          boundary: pointNearBoundary(endpoint.point, overallBBox, tolerance)
        });
      }
    }
    for (const endpoint of endpointEntries) {
      if (!endpoint.boundary) continue;
      const hasMate = endpointEntries.some((candidate) => {
        if (candidate === endpoint) return false;
        return pointDistanceLocal(endpoint.point, candidate.point) <= tolerance;
      });
      if (!hasMate) {
        warnings.push({
          code: "OPEN_BOUNDARY_CONTOUR",
          severity: "warning",
          message: `${endpoint.display_label} leaves an unmatched endpoint on the ${endpoint.boundary} boundary.`,
          object_id: endpoint.object_id,
          entity_id: endpoint.entity_id,
          display_label: endpoint.display_label,
          details: {
            shape_index: endpoint.shape_index,
            vertex: endpoint.vertex,
            boundary: endpoint.boundary,
            point: {
              x: roundNumber(endpoint.point.x, 3),
              y: roundNumber(endpoint.point.y, 3)
            }
          }
        });
      }
    }
  }

  const dedupe = new Map();
  for (const issue of errors.concat(warnings)) {
    const key = [
      issue.code,
      issue.object_id || "",
      issue.entity_id || "",
      issue.details?.shape_index ?? "",
      issue.details?.vertex ?? "",
      issue.details?.boundary ?? ""
    ].join(":");
    if (!dedupe.has(key)) dedupe.set(key, issue);
  }
  const dedupedIssues = Array.from(dedupe.values());
  const dedupedErrors = dedupedIssues.filter((issue) => issue.severity === "error");
  const dedupedWarnings = dedupedIssues.filter((issue) => issue.severity !== "error");

  return {
    ok: dedupedErrors.length === 0,
    errors: dedupedErrors,
    warnings: dedupedWarnings,
    counts: {
      errors: dedupedErrors.length,
      warnings: dedupedWarnings.length
    }
  };
}

function simulateChildPreview(session) {
  const view = projectViewModel(session);
  const config = normalizeConfigParameterSet(session.config_parameter_set);
  const branchMode = effectiveBranchModeForSession(session, config);
  const sourceObjects = filterObjectsByBranchMode(view.objects, branchMode);
  const resolverRuleContext = {
    rule_catalog: normalizeRuleCatalogSnapshot(session.rule_catalog),
    configParameterSet: config,
    family: config.family,
    product: config.product,
    part: config.part
  };
  const topoRuntime = view.topo_metadata && view.topo_metadata.runtime_model
    ? view.topo_metadata.runtime_model
    : null;
  const topologyMode = topoRuntime?.mode || "none";
  const standardSimulationMap = buildIdentitySimulationMap(sourceObjects, topologyMode);
  let documentRuleExecution = { applied_rules: [] };
  let postTopoRuleExecution = { applied_rules: [] };
  let topoSimulationMap = null;
  let activeSimulationMap = standardSimulationMap;
  let coreShellFourBandShadow = null;
  let semEffectiveGeometryFilter = null;

  if (topologyMode === "none") {
    documentRuleExecution = applyDocumentRulesToSimulationMap(
      session,
      sourceObjects,
      config.parameters,
      activeSimulationMap,
      topologyMode,
      branchMode
    );
  } else {
    documentRuleExecution = applyDocumentRulesToSimulationMap(
      session,
      sourceObjects,
      config.parameters,
      standardSimulationMap,
      topologyMode,
      branchMode
    );
    topoSimulationMap = buildTopoGeometrySimulationMap(
      session,
      sourceObjects,
      config.parameters,
      topologyMode,
      standardSimulationMap
    );
    activeSimulationMap = topoSimulationMap || standardSimulationMap;
    if (topologyMode === "4_band_parameter_resize" && topoRuntime?.profile === "standard_parametric_resize") {
      try {
        semEffectiveGeometryFilter = buildSemEffectiveGeometryFilter(sourceObjects, config.parameters);
        const coreShellFourBandShadowResult = runFourBandParameterResizeShadowPreview({
          objects: semEffectiveGeometryFilter.included_objects,
          configParameterSet: config,
          topoRuntimeModel: topoRuntime,
          activeSimulationMap,
          ruleContext: resolverRuleContext
        });
        coreShellFourBandShadow = {
          ...coreShellFourBandShadowResult.summary,
          preview_visualization: true,
          effective_geometry_filter: semEffectiveGeometryFilter.summary
        };
        activeSimulationMap = coreShellFourBandShadowResult.shadow_map;
      } catch (err) {
        coreShellFourBandShadow = {
          mode: "core_shell_4_band_parameter_resize_shadow_v1",
          active: false,
          diagnostic_only: true,
          behavior_change: false,
          production_activation_status: "not_approved",
          cleanup_approval: "no",
          error: err?.message || String(err),
          validation: err?.validation || null
        };
      }
    }
  }
  postTopoRuleExecution = applyPostTopoRulesToSimulationMap(
    session,
    sourceObjects,
    config.parameters,
    activeSimulationMap
  );
  const finalOrientationPreview = applyFinalOrientationRulesToSimulationMap(session, config, activeSimulationMap);
  const finalSimulationMap = finalOrientationPreview.simulation_map;
  const limitator = normalizeBooleanLike(config.parameters.LIMITATOR);
  const brava = config.parameters.BRAVA == null ? null : String(config.parameters.BRAVA);
  const items = sourceObjects.map((object) => {
    const parsedSemRecords = Array.isArray(object.semantic_metadata?.parsed) ? object.semantic_metadata.parsed : [];
    const firstSem = parsedSemRecords.length ? parsedSemRecords[0] : null;
    const semKeys = firstSem?.keys || {};
    const partHint = semKeys.part || semKeys.target || config.product_code || null;
    const childInclusion = semEffectiveGeometryFilter?.inclusion_by_object_id.get(object.id)
      || evaluateChildEntityInclusion(object, config.parameters);
    const presenceEval = childInclusion.presence;
    const variantEval = childInclusion.variant;
    const geometryOps = childInclusion.geometry_ops;
    const aggregated = {
      included: childInclusion.included,
      exclusion_reason: childInclusion.exclusion_reason,
      geometry_ops: geometryOps
    };
    const opHint = presenceEval.operation_hint || semKeys.presence || null;
    const conditionalParamName = presenceEval.conditional_param;
    const conditionalExpected = presenceEval.conditional_expected;
    const conditionalOperator = presenceEval.conditional_operator;
    const conditionalActual = presenceEval.conditional_actual;
    const visible = aggregated.included;
    const visibilityReason = presenceEval.visibility_reason;
    const geometryPreview = (finalSimulationMap && finalSimulationMap.get(object.id)) || buildIdentityGeometrySimulation(object, topologyMode);
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
        post_topo_rule_actions: geometryPreview.post_topo_rule_actions || [],
        preview_actions,
        ready_for_child_planning: object.classification_state === "classified" && Boolean(object.primary_layer)
      }
    };
  });

  const validation = validateCombinedPreviewGeometry(sourceObjects, items, topologyMode);
  const topologyDeltaWarnings = Array.isArray(coreShellFourBandShadow?.topology_delta_warnings)
    ? coreShellFourBandShadow.topology_delta_warnings
    : [];
  for (const warning of topologyDeltaWarnings) {
    validation.warnings.push({
      code: warning.code || "TOPOLOGY_DELTA_WARNING",
      severity: "warning",
      message: warning.message || "Topology delta modifier warning.",
      object_id: null,
      entity_id: null,
      display_label: "Core Shell 4-band resolver",
      details: cloneJson(warning)
    });
  }
  const finalOrientationWarnings = missingFinalOrientationWarnings(
    session,
    config,
    finalOrientationPreview.applied_rules
  );
  for (const warning of finalOrientationWarnings) {
    validation.warnings.push({
      code: warning.code || "FINAL_ORIENTATION_WARNING",
      severity: "warning",
      message: warning.message || "Final orientation warning.",
      object_id: null,
      entity_id: null,
      display_label: "Final orientation resolver",
      details: cloneJson(warning)
    });
  }
  validation.counts.warnings = validation.warnings.length;
  validation.ok = validation.errors.length === 0;

  return {
    session_id: session.session_id,
    technology_profile: config.technology_profile,
    product_code: config.product_code,
    topology_mode: topologyMode,
    branch_mode: branchMode,
    config_parameter_set: config,
    items,
    validation,
    summary: {
      object_count: items.length,
      classified_count: items.filter((item) => item.classification_state === "classified").length,
      sem_bound_count: items.filter((item) => (item.semantic_metadata?.raw_comments || []).length > 0).length,
      document_rules_applied: documentRuleExecution.applied_rules || [],
      post_topo_rules_applied: postTopoRuleExecution.applied_rules || [],
      final_orientation_rules_applied: finalOrientationPreview.applied_rules || [],
      final_orientation_warnings: finalOrientationWarnings,
      final_orientation_bbox_normalization: finalOrientationPreview.bbox_normalization || null,
      core_shell_4_band_shadow: coreShellFourBandShadow,
      validation_counts: validation.counts
    }
  };
}

function materializeCoreShellFourBandShadowDocument(session, parameterSet) {
  const config = normalizeConfigParameterSet(parameterSet || session.config_parameter_set || DEFAULT_KSKR_EXECUTION_CHECK_PARAMETER_SET);
  const simulation = simulateChildPreview({
    ...session,
    config_parameter_set: config
  });
  if (simulation.topology_mode !== "4_band_parameter_resize") {
    throw new Error("Core Shell shadow DXF export requires 4-band topology metadata.");
  }
  const shadowSummary = simulation.summary?.core_shell_4_band_shadow || null;
  if (!shadowSummary || shadowSummary.active !== false) {
    throw new Error("Core Shell 4-band shadow summary is missing or not in diagnostic mode.");
  }

  const outputDocument = materializeDocumentForExport(session);
  const branchFilterExecution = filterDocumentByBranchMode(session, outputDocument, simulation.summary?.branch_mode || simulation.branch_mode || "ALL");
  const itemByEntityId = new Map((simulation.items || []).map((item) => [String(item.entity_id || ""), item]));
  const removedEntityIds = [];
  const updatedEntityIds = [];
  const skippedEntityIds = [];
  outputDocument.entities = (Array.isArray(outputDocument.entities) ? outputDocument.entities : []).filter((entity) => {
    const item = itemByEntityId.get(String(entity.id || ""));
    if (!item) return true;
    if (item.preview?.visible === false || item.preview?.included === false) {
      removedEntityIds.push(entity.id);
      return false;
    }
    return true;
  });

  const outputEntities = entityMapById(outputDocument);
  for (const item of simulation.items || []) {
    if (item.preview?.visible === false || item.preview?.included === false) continue;
    const entity = outputEntities.get(String(item.entity_id || ""));
    if (!entity) {
      skippedEntityIds.push(item.entity_id);
      continue;
    }
    const shapes = Array.isArray(item.preview?.simulated_shapes) ? item.preview.simulated_shapes : [];
    if (shapes.length !== 1) {
      skippedEntityIds.push(item.entity_id);
      continue;
    }
    if (setRuntimeEntityShape(entity, shapes[0])) {
      updatedEntityIds.push(item.entity_id);
    } else {
      skippedEntityIds.push(item.entity_id);
    }
  }

  const finalChildExecution = finalizeChildDocument(outputDocument, session, config, null, {
    skipFinalOrientation: true,
    preAppliedFinalOrientationRules: simulation.summary?.final_orientation_rules_applied || []
  });
  return {
    document: outputDocument,
    simulation,
    generation_summary: {
      mode: "core_shell_4_band_shadow_child_dxf_v0",
      diagnostic_only: true,
      production_activation_status: "not_approved",
      cleanup_approval: "no",
      topology_mode: simulation.topology_mode,
      branch_filter: branchFilterExecution,
      object_count: simulation.summary?.object_count ?? simulation.items.length,
      included_count: simulation.items.filter((item) => item.preview?.included !== false).length,
      excluded_count: simulation.items.filter((item) => item.preview?.included === false).length,
      removed_entity_count: removedEntityIds.length,
      updated_entity_count: updatedEntityIds.length,
      skipped_entity_count: Array.from(new Set(skippedEntityIds.filter(Boolean))).length,
      removed_entity_ids: removedEntityIds,
      updated_entity_ids: Array.from(new Set(updatedEntityIds.filter(Boolean))),
      skipped_entity_ids: Array.from(new Set(skippedEntityIds.filter(Boolean))),
      core_shell_4_band_shadow: shadowSummary,
      block_explosion: finalChildExecution.block_explosion,
      final_orientation_rules_applied: finalChildExecution.final_orientation.applied_rules || [],
      final_orientation_materialization: {
        skipped: finalChildExecution.final_orientation.skipped === true,
        reason: finalChildExecution.final_orientation.reason || null
      },
      bbox_normalization: finalChildExecution.bbox_normalization,
      final_gap_repair: finalChildExecution.final_gap_repair,
      child_label_rules_applied: finalChildExecution.child_label.applied_rules || [],
      child_label_removed_anchor_entities: finalChildExecution.child_label.removed_anchor_entities || [],
      child_label_emitted_text_entities: finalChildExecution.child_label.emitted_text_entities || [],
      layer_policy: finalChildExecution.layer_policy,
      metadata_cleanup: finalChildExecution.metadata_cleanup
    }
  };
}

function generateCoreShellFourBandShadowChildDxf(session, parameterSet) {
  const materialized = materializeCoreShellFourBandShadowDocument(session, parameterSet);
  return {
    config_parameter_set: materialized.simulation.config_parameter_set,
    generation_summary: materialized.generation_summary,
    dxf_text: serializeDocument(materialized.document)
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

async function saveSessionArtifactSnapshots(session, eventType, details, storeRoot) {
  const root = storeRoot || defaultRoot();
  await saveParamSet(session.session_id, session.config_parameter_set || {}, root);
  await saveRuleCatalogSnapshot(session.session_id, session.rule_catalog || {}, root);
  await appendEvent(session.session_id, {
    type: eventType,
    details: details && typeof details === "object" ? details : {}
  }, root);
}

async function createContextDraftSession({ context = {}, storeRoot }) {
  const nowIso = new Date().toISOString();
  const normalizedContext = normalizeSessionContextV1(context, { locked: false });
  const domainArtifacts = buildDomainArtifactsForContext(normalizedContext);
  const session = {
    session_id: crypto.randomUUID(),
    use_case: "mother_dxf_v1",
    created_at: nowIso,
    updated_at: nowIso,
    title: "Mother DXF context draft",
    status: "draft",
    artifact_state: "context_draft",
    source_name: "context_pending.dxf",
    bands: normalizeBands({}),
    config_parameter_set: domainArtifacts.config_parameter_set,
    parameter_catalog: domainArtifacts.parameter_catalog,
    rule_catalog: domainArtifacts.rule_catalog,
    topo_comments: [],
    assignments: {},
    xdata_assignments: {},
    document: sanitizeDocument(""),
    session_context_v1: normalizedContext,
    domain_validation_v1: null,
    geometry_validation_v1: null,
    geometry_strategy_v1: null,
    activity_log: []
  };
  ensureSessionContextShape(session);
  appendSessionActivity(session, {
    type: "context_draft_created",
    severity: "ok",
    summary: "Mother DXF session context draft created.",
    details: {}
  });
  projectViewModel(session);
  await saveSession({ rootDir: storeRoot || defaultRoot(), session });
  return session;
}

async function lockSessionContext({ sessionId, context, storeRoot }) {
  const session = await getSession({ sessionId, storeRoot });
  const nextContext = normalizeSessionContextV1({ ...(context || {}), status: "context_locked" }, { locked: true });
  if (!nextContext.validation.ok) {
    const err = new Error("Session context cannot be locked because required fields are missing or invalid.");
    err.code = "SESSION_CONTEXT_INVALID";
    err.validation = nextContext.validation;
    throw err;
  }
  const domainArtifacts = buildDomainArtifactsForContext(nextContext, session.raw_source_name || session.source_name);
  session.session_context_v1 = nextContext;
  session.config_parameter_set = domainArtifacts.config_parameter_set;
  session.parameter_catalog = domainArtifacts.parameter_catalog;
  session.rule_catalog = domainArtifacts.rule_catalog;
  session.domain_validation_v1 = null;
  session.geometry_validation_v1 = null;
  ensureSessionContextShape(session);
  session.artifact_state = session.document && Array.isArray(session.document.entities) && session.document.entities.length
    ? session.artifact_state
    : "context_locked";
  session.updated_at = new Date().toISOString();
  appendSessionActivity(session, {
    type: "session_context_locked",
    severity: "ok",
    summary: "Session context locked.",
    details: {
      production_program_id: nextContext.production_program_id,
      family_id: nextContext.family_id,
      product_id: nextContext.product_id,
      part_id: nextContext.part_id
    }
  });
  projectViewModel(session);
  await saveSession({ rootDir: storeRoot || defaultRoot(), session });
  return session;
}

async function resetSessionContext({ sessionId, storeRoot }) {
  const session = await getSession({ sessionId, storeRoot });
  session.session_context_v1 = normalizeSessionContextV1(session.session_context_v1 || {}, { locked: false });
  session.domain_validation_v1 = null;
  session.geometry_validation_v1 = null;
  ensureSessionContextShape(session);
  session.artifact_state = "context_draft";
  session.updated_at = new Date().toISOString();
  appendSessionActivity(session, {
    type: "session_context_reset",
    severity: "warn",
    summary: "Session context reset to draft.",
    details: {}
  });
  projectViewModel(session);
  await saveSession({ rootDir: storeRoot || defaultRoot(), session });
  return session;
}

function makeDomainContextRequiredError() {
  const err = new Error("Raw DXF upload is not allowed before session context is locked.");
  err.code = "DOMAIN_CONTEXT_REQUIRED";
  err.status = 400;
  return err;
}

async function createSession({ dxfText, sourceName, rawSourceName = "", title = null, bands, forceRefresh = false, storeRoot, sessionId, sessionContext }) {
  const normalizedSourceName = String(sourceName || "mother_dxf_input.dxf");
  const normalizedRawSourceName = String(rawSourceName || normalizedSourceName).trim() || normalizedSourceName;
  const requestedTitle = normalizeSessionTitle(title, defaultSessionTitleForSource(normalizedSourceName));
  const nowIso = new Date().toISOString();
  let contextSession = null;
  if (sessionId) {
    try {
      contextSession = await loadSession({ rootDir: storeRoot || defaultRoot(), sessionId: String(sessionId) });
      ensureSessionContextShape(contextSession);
    } catch (err) {
      contextSession = null;
    }
  }
  const lockedContext = sessionContextIsLocked(sessionContext)
    ? normalizeSessionContextV1(sessionContext, { locked: true })
    : contextSession && sessionContextIsLocked(contextSession)
      ? contextSession.session_context_v1
      : null;
  if (!lockedContext) {
    throw makeDomainContextRequiredError();
  }
  const document = sanitizeDocument(dxfText);
  const importedXdataAssignments = hoistMotherXdataFromDocument(document);
  const currentSession = contextSession || null;
  const preserveCustomTitle = currentSession
    && !["context_draft", "context_locked"].includes(String(currentSession.artifact_state || ""))
    && !titleLooksLikeDefault(currentSession.title, currentSession.source_name);
  const targetSessionId = currentSession?.session_id || crypto.randomUUID();
  const domainArtifacts = buildDomainArtifactsForContext(lockedContext, normalizedSourceName);
  if (currentSession && sessionHasAuthoringState(currentSession) && !forceRefresh) {
    currentSession.parameter_catalog = domainArtifacts.parameter_catalog;
    currentSession.rule_catalog = domainArtifacts.rule_catalog;
    currentSession.config_parameter_set = normalizeConfigParameterSet(currentSession.config_parameter_set || domainArtifacts.config_parameter_set);
    currentSession.session_context_v1 = lockedContext;
    ensureSessionContextShape(currentSession);
    appendSessionActivity(currentSession, {
      type: "raw_refresh_preserved",
      severity: "ok",
      summary: "Existing enriched session preserved; raw refresh not applied.",
      details: { source_name: normalizedSourceName }
    });
    projectViewModel(currentSession);
    await saveSession({ rootDir: storeRoot || defaultRoot(), session: currentSession });
    await saveSessionArtifactSnapshots(currentSession, "raw_refresh_preserved", { source_name: normalizedSourceName }, storeRoot);
    return {
      session: currentSession,
      action: "reused_existing_preserved"
    };
  }
  if (currentSession && sessionHasAuthoringState(currentSession)) {
    currentSession.document = document;
    currentSession.bands = normalizeBands(bands);
    currentSession.updated_at = nowIso;
    currentSession.title = preserveCustomTitle
      ? normalizeSessionTitle(currentSession.title, defaultSessionTitleForSource(normalizedSourceName))
      : requestedTitle;
    currentSession.source_name = normalizedSourceName;
    currentSession.raw_source_name = normalizedRawSourceName;
    currentSession.status = "draft";
    currentSession.artifact_state = "sanitized";
    currentSession.topo_comments = extractTopoCommentsFromDxfText(dxfText);
    currentSession.assignments = {};
    currentSession.parameter_catalog = domainArtifacts.parameter_catalog;
    currentSession.rule_catalog = domainArtifacts.rule_catalog;
    currentSession.config_parameter_set = domainArtifacts.config_parameter_set;
    currentSession.xdata_assignments = mergeImportedXdataAssignments(currentSession.document, importedXdataAssignments);
    currentSession.session_context_v1 = lockedContext;
    currentSession.domain_validation_v1 = null;
    currentSession.geometry_validation_v1 = null;
    currentSession.session_lifecycle_v1 = { version: 1, state: "raw_loaded", allowed_transitions: lifecycleTransitionsForState("raw_loaded") };
    ensureSessionContextShape(currentSession);
    appendSessionActivity(currentSession, {
      type: "raw_refresh_forced",
      severity: "warn",
      summary: "Existing authoring erased and session refreshed from raw DXF.",
      details: { source_name: normalizedSourceName }
    });
    projectViewModel(currentSession);
    await saveSession({ rootDir: storeRoot || defaultRoot(), session: currentSession });
    const rawInfo = await saveRawDxf(currentSession.session_id, dxfText, storeRoot || defaultRoot());
    await registerArtifact(currentSession.session_id, "raw_dxf", currentSession.session_id + "_raw", rawInfo.filePath, storeRoot || defaultRoot());
    await saveSessionArtifactSnapshots(currentSession, "raw_refresh_forced_artifacts_saved", { source_name: normalizedSourceName }, storeRoot);
    return {
      session: currentSession,
      action: "refreshed_existing"
    };
  }
  const session = {
    session_id: targetSessionId,
    use_case: "mother_dxf_v1",
    created_at: currentSession?.created_at || nowIso,
    updated_at: nowIso,
    title: preserveCustomTitle
      ? normalizeSessionTitle(currentSession.title, defaultSessionTitleForSource(normalizedSourceName))
      : requestedTitle,
    status: "draft",
    revision: currentSession?.__mother_dxf_session_revision || currentSession?.revision || 0,
    artifact_state: "sanitized",
    source_name: normalizedSourceName,
    raw_source_name: normalizedRawSourceName,
    storage_key: buildSessionStorageKey(requestedTitle, targetSessionId),
    bands: normalizeBands(bands),
    config_parameter_set: domainArtifacts.config_parameter_set,
    parameter_catalog: domainArtifacts.parameter_catalog,
    rule_catalog: domainArtifacts.rule_catalog,
    topo_comments: extractTopoCommentsFromDxfText(dxfText),
    assignments: {},
    xdata_assignments: normalizeXdataAssignments(document, importedXdataAssignments),
    document,
    session_context_v1: lockedContext,
    domain_validation_v1: null,
    geometry_validation_v1: null,
    geometry_strategy_v1: null,
    session_lifecycle_v1: { version: 1, state: "raw_loaded", allowed_transitions: lifecycleTransitionsForState("raw_loaded") },
    activity_log: []
  };
  ensureSessionContextShape(session);
  appendSessionActivity(session, {
    type: currentSession ? "session_refreshed" : "session_created",
    severity: "ok",
    summary: currentSession ? "Working session refreshed from raw DXF." : "Working session created.",
    details: { source_name: normalizedSourceName }
  });
  projectViewModel(session);
  await saveSession({ rootDir: storeRoot || defaultRoot(), session });
  const rawInfo = await saveRawDxf(session.session_id, dxfText, storeRoot || defaultRoot());
  await registerArtifact(session.session_id, "raw_dxf", session.session_id + "_raw", rawInfo.filePath, storeRoot || defaultRoot());
  await saveSessionArtifactSnapshots(session, currentSession ? "session_refreshed_artifacts_saved" : "session_created_artifacts_saved", { source_name: normalizedSourceName }, storeRoot);
  return {
    session,
    action: currentSession ? "refreshed_existing" : "created_new"
  };
}

async function getSession({ sessionId, storeRoot }) {
  const session = await loadSession({ rootDir: storeRoot || defaultRoot(), sessionId });
  ensureSessionContextShape(session);
  const importedXdataAssignments = hoistMotherXdataFromDocument(session.document);
  session.title = normalizeSessionTitle(session.title, defaultSessionTitleForSource(session.source_name));
  session.status = normalizeSessionStatus(session.status || "draft");
  session.activity_log = normalizeSessionActivityLog(session.activity_log);
  const normalizedTopoComments = normalizeTopoCommentsInput(session.topo_comments).filter((value) => isFileLevelTopoComment(value));
  const topoCommentsChanged = JSON.stringify(session.topo_comments || []) !== JSON.stringify(normalizedTopoComments);
  session.topo_comments = normalizedTopoComments;
  const domainArtifactsChanged = reconcileSessionDomainArtifacts(session);
  if (!domainArtifactsChanged) {
    session.parameter_catalog = resolveActiveParameterCatalog(session, session.config_parameter_set, session.parameter_catalog);
    session.rule_catalog = normalizeRuleCatalogSnapshot(session.rule_catalog);
  }
  session.xdata_assignments = mergeImportedXdataAssignments(session.document, session.xdata_assignments || importedXdataAssignments);
  projectViewModel(session);
  if (topoCommentsChanged || domainArtifactsChanged) {
    await saveSession({ rootDir: storeRoot || defaultRoot(), session });
    if (domainArtifactsChanged) {
      await saveSessionArtifactSnapshots(session, "domain_artifacts_reconciled", {
        parameter_catalog_id: session.parameter_catalog?.catalog_id || null,
        rule_catalog_id: session.rule_catalog?.catalog_id || null
      }, storeRoot);
    }
  }
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

function normalizeGeometryStrategyV1(value) {
  const mode = String(value?.mode || value || "").trim();
  const allowed = new Set(["four_band_parameter_resize", "fixed_envelope_slide", "static_geometry"]);
  if (!allowed.has(mode)) {
    const err = new Error("Select a supported geometry parametrization strategy before geometry projection.");
    err.code = "GEOMETRY_STRATEGY_REQUIRED";
    throw err;
  }
  return {
    version: 1,
    mode,
    status: "confirmed",
    source: "manual",
    confirmed_at: new Date().toISOString()
  };
}

async function computeGeometryContext({ sessionId, storeRoot, bands = null, geometryStrategy = null }) {
  const session = await loadSession({ rootDir: storeRoot || defaultRoot(), sessionId });
  ensureSessionContextShape(session);
  if (!sessionContextIsLocked(session)) {
    const err = new Error("Session context must be locked before geometry projection.");
    err.code = "SESSION_CONTEXT_REQUIRED";
    throw err;
  }
  if (!session.document || !Array.isArray(session.document.entities) || session.document.entities.length === 0) {
    const err = new Error("Raw DXF must be loaded before geometry projection.");
    err.code = "RAW_DXF_REQUIRED";
    throw err;
  }
  if (bands && typeof bands === "object") {
    session.bands = normalizeBands(bands);
  }
  const previousStrategy = String(session.geometry_strategy_v1?.mode || "").trim();
  const nextStrategy = normalizeGeometryStrategyV1(geometryStrategy || session.geometry_strategy_v1);
  const strategyChanged = Boolean(previousStrategy && previousStrategy !== nextStrategy.mode);
  session.geometry_strategy_v1 = nextStrategy;
  if (strategyChanged) {
    clearFileLevelTopoComment(session);
    session.resolver_preview_v1 = null;
    session.resolver_child_v1 = null;
    session.resolver_export_v1 = null;
    session.wysiwyg_gate_v1 = null;
  }
  const view = projectViewModel(session);
  const validation = buildGeometryValidationV1(session, view);
  session.geometry_validation_v1 = validation;
  session.domain_validation_v1 = null;
  const nextState = validation.ok ? "geometry_projected" : "raw_loaded";
  session.session_lifecycle_v1 = {
    version: 1,
    state: nextState,
    allowed_transitions: lifecycleTransitionsForState(nextState)
  };
  session.updated_at = new Date().toISOString();
  appendSessionActivity(session, {
    type: "geometry_context_computed",
    severity: validation.ok ? "ok" : "error",
    summary: validation.ok ? "Geometry context projected." : "Geometry context projection blocked execution.",
    details: {
      blocking_error_count: validation.blocking_error_count,
      warning_count: validation.warning_count,
      slot_count: validation.slot_count,
      lifecycle_state: nextState,
      geometry_strategy: nextStrategy.mode,
      strategy_changed: strategyChanged
    }
  });
  projectViewModel(session);
  await saveSession({ rootDir: storeRoot || defaultRoot(), session });
  return { session, validation };
}

async function validateDomainContext({ sessionId, storeRoot }) {
  const session = await loadSession({ rootDir: storeRoot || defaultRoot(), sessionId });
  ensureSessionContextShape(session);
  const view = projectViewModel(session);
  const validation = buildDomainValidationV1(session, view);
  session.domain_validation_v1 = validation;
  const hasGeometryBlockingError = Array.isArray(validation.errors) && validation.errors.some((item) => String(item?.code || "") === "GEOMETRY_CONTEXT_INVALID");
  const nextState = validation.ok ? "authoring_ready" : hasGeometryBlockingError ? "raw_loaded" : "geometry_projected";
  session.session_lifecycle_v1 = {
    version: 1,
    state: nextState,
    allowed_transitions: lifecycleTransitionsForState(nextState)
  };
  session.updated_at = new Date().toISOString();
  appendSessionActivity(session, {
    type: "domain_context_validated",
    severity: validation.ok ? "ok" : "error",
    summary: validation.ok ? "Domain context validated." : "Domain context validation blocked execution.",
    details: {
      blocking_error_count: validation.blocking_error_count,
      warning_count: validation.warning_count,
      lifecycle_state: nextState
    }
  });
  projectViewModel(session);
  await saveSession({ rootDir: storeRoot || defaultRoot(), session });
  return { session, validation };
}

async function updateLabelDefinition({ sessionId, payload, storeRoot }) {
  const session = await getSession({ sessionId, storeRoot });
  const ruleId = String(payload?.rule_id || "S4P4_LBRA_LABEL_APPLICATION").trim();
  if (!ruleId) throw new Error("Missing label rule id.");
  const x = Number(payload?.x);
  const y = Number(payload?.y);
  const width = Number(payload?.width || 50);
  const height = Number(payload?.height || 20);
  const rotation = Number(payload?.rotation || 0);
  if (![x, y, width, height, rotation].every(Number.isFinite) || width <= 0 || height <= 0) {
    throw new Error("Label definition requires numeric x, y, width, height, and rotation.");
  }
  const documentSem = collectDocumentSemMetadata(session.document);
  if (!documentSem) {
    throw new Error("Document SEM identity must be saved before label definition.");
  }

  const entities = Array.isArray(session.document.entities) ? session.document.entities : [];
  const removedIds = entities.filter((entity) => isLabelAnchorEntityForRule(entity, ruleId)).map((entity) => entity.id);
  session.document.entities = entities.filter((entity) => !isLabelAnchorEntityForRule(entity, ruleId));
  for (const entityId of removedIds) {
    delete session.assignments?.[entityId];
    delete session.xdata_assignments?.[entityId];
  }

  const rad = rotation * Math.PI / 180;
  const ux = { x: Math.cos(rad), y: Math.sin(rad) };
  const uy = { x: -Math.sin(rad), y: Math.cos(rad) };
  const hw = width / 2;
  const hh = height / 2;
  const corners = [
    { x: x - ux.x * hw - uy.x * hh, y: y - ux.y * hw - uy.y * hh },
    { x: x + ux.x * hw - uy.x * hh, y: y + ux.y * hw - uy.y * hh },
    { x: x + ux.x * hw + uy.x * hh, y: y + ux.y * hw + uy.y * hh },
    { x: x - ux.x * hw + uy.x * hh, y: y - ux.y * hw + uy.y * hh }
  ];
  const comment = labelAnchorComment({ ruleId, width, height, rotation, coordinateSpace: "raw_part" });
  const preComments = [{ code: "999", value: comment }];
  for (let i = 0; i < 4; i += 1) {
    const id = nextRuntimeEntityId(session.document);
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    session.document.entities.push(makeRuntimeLineEntity({
      id,
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      layer: "0",
      preComments
    }));
  }

  const existingRuleRefs = new Set(Array.isArray(documentSem.rule_refs) ? documentSem.rule_refs : []);
  if (!existingRuleRefs.has(ruleId)) {
    session.document.preComments = Array.isArray(session.document.preComments) ? session.document.preComments : [];
    session.document.preComments.push({ code: "999", value: `SEM:document=true;rule_ref=${ruleId}` });
  }

  appendSessionActivity(session, {
    type: "label_definition_saved",
    severity: "ok",
    summary: `Label definition saved for ${ruleId}.`,
    details: { rule_id: ruleId, x, y, width, height, rotation, removed_entity_ids: removedIds }
  });
  session.updated_at = new Date().toISOString();
  session.artifact_state = "mother_draft";
  await saveSession({ rootDir: storeRoot || defaultRoot(), session });
  return session;
}

async function clearLabelDefinition({ sessionId, ruleId, storeRoot }) {
  const session = await getSession({ sessionId, storeRoot });
  const normalizedRuleId = String(ruleId || "S4P4_LBRA_LABEL_APPLICATION").trim();
  const entities = Array.isArray(session.document.entities) ? session.document.entities : [];
  const removedIds = entities.filter((entity) => isLabelAnchorEntityForRule(entity, normalizedRuleId)).map((entity) => entity.id);
  session.document.entities = entities.filter((entity) => !isLabelAnchorEntityForRule(entity, normalizedRuleId));
  for (const entityId of removedIds) {
    delete session.assignments?.[entityId];
    delete session.xdata_assignments?.[entityId];
  }
  appendSessionActivity(session, {
    type: "label_definition_cleared",
    severity: "warn",
    summary: `Label definition cleared for ${normalizedRuleId}.`,
    details: { rule_id: normalizedRuleId, removed_entity_ids: removedIds }
  });
  session.updated_at = new Date().toISOString();
  session.artifact_state = "mother_draft";
  await saveSession({ rootDir: storeRoot || defaultRoot(), session });
  return session;
}

function validateExecutionIntentEvidence(session, executionIntentAuthoringV1) {
  const rows = Array.isArray(executionIntentAuthoringV1?.slots) ? executionIntentAuthoringV1.slots : [];
  const geometryContext = session?.geometry_validation_v1?.geometry_context_v1 || null;
  const slots = Array.isArray(geometryContext?.slots) ? geometryContext.slots : [];
  const slotByIndex = new Map(slots.map((slot) => [Number(slot.slot_index), slot]));
  const errors = [];
  for (const row of rows) {
    const evidenceSource = String(row?.evidence_source || "manual").trim().toLowerCase();
    if (!["xdata", "xdata_hint", "sem"].includes(evidenceSource)) continue;
    const slotIndex = Number(row?.slot_index);
    const slot = slotByIndex.get(slotIndex);
    if (evidenceSource === "xdata_hint") {
      const observedHints = Array.isArray(slot?.observed_xdata_hints) ? slot.observed_xdata_hints : [];
      const observedHintValues = observedHints.map((item) => String(item?.hint || "").trim()).filter(Boolean);
      const authoredHint = String(row?.observed_xdata_hint || "").trim();
      if (!slot || !observedHintValues.length || (authoredHint && !observedHintValues.includes(authoredHint))) {
        errors.push({
          slot_index: slotIndex,
          evidence_source: evidenceSource,
          observed_xdata_hint: authoredHint || null,
          discovered_xdata_hints: observedHintValues,
          message: `Slot ${slotIndex} declares XDATA hint evidence, but geometry discovery did not observe the referenced hint.`
        });
      }
      continue;
    }
    const observed = evidenceSource === "xdata"
      ? (Array.isArray(slot?.xdata_variant_keys) ? slot.xdata_variant_keys : [])
      : (Array.isArray(slot?.sem_variant_keys) ? slot.sem_variant_keys : []);
    const variantKey = String(row?.variant_key || "").trim();
    if (!slot || !observed.length || (variantKey && !observed.includes(variantKey))) {
      errors.push({
        slot_index: slotIndex,
        evidence_source: evidenceSource,
        variant_key: variantKey || null,
        observed_variant_keys: observed.slice(),
        message: `Slot ${slotIndex} declares ${evidenceSource} evidence for ${variantKey || "its variant"}, but geometry discovery did not observe that evidence.`
      });
    }
  }
  return errors;
}

async function updateConfigParameterSet({ sessionId, configParameterSet, executionIntentAuthoringV1 = undefined, storeRoot }) {
  const session = await getSession({ sessionId, storeRoot });
  let configInput = configParameterSet && typeof configParameterSet === "object" ? cloneJson(configParameterSet) : {};
  if (sessionContextIsLocked(session?.session_context_v1)) {
    const context = session.session_context_v1;
    const suppliedCatalogId = String(configInput.parameter_catalog_id || "").trim();
    if (!suppliedCatalogId || suppliedCatalogId !== context.parameter_catalog_id) {
      const error = new Error(`Config parameter_catalog_id must explicitly match locked session context: ${context.parameter_catalog_id}`);
      error.code = "CONFIG_PARAMETER_CATALOG_MISMATCH";
      error.validation = { ok: false, errors: [{
        code: error.code,
        field: "parameter_catalog_id",
        expected: context.parameter_catalog_id,
        actual: suppliedCatalogId || null,
        message: error.message
      }] };
      throw error;
    }
    configInput = {
      ...configInput,
      family: context.family_id,
      product: context.product_id,
      part: context.part_id,
      parameter_scope: { family: context.family_id, product: context.product_id, part: context.part_id }
    };
  }
  session.config_parameter_set = normalizeConfigParameterSet(configInput);
  const derivedVariantKey = readConfigVariantKey(session.config_parameter_set);
  if (derivedVariantKey) session.config_parameter_set.parameters.variant_key = derivedVariantKey;
  session.parameter_catalog = resolveActiveParameterCatalog(session, session.config_parameter_set, session.parameter_catalog);
  if (executionIntentAuthoringV1 !== undefined) {
    const source = executionIntentAuthoringV1 && typeof executionIntentAuthoringV1 === "object" ? executionIntentAuthoringV1 : {};
    const evidenceErrors = validateExecutionIntentEvidence(session, source);
    if (evidenceErrors.length) {
      const error = new Error(evidenceErrors.map((item) => item.message).join(" "));
      error.code = "EXECUTION_INTENT_EVIDENCE_INVALID";
      error.validation = { ok: false, errors: evidenceErrors };
      throw error;
    }
    session.execution_intent_authoring_v1 = {
      version: 1,
      slots: Array.isArray(source.slots) ? cloneJson(source.slots) : []
    };
  }
  appendSessionActivity(session, {
    type: "config_saved",
    severity: "ok",
    summary: "Config parameter set saved.",
    details: {
      parameter_count: Object.keys(session.config_parameter_set.parameters || {}).length,
      slot_intent_count: Array.isArray(session.execution_intent_authoring_v1?.slots) ? session.execution_intent_authoring_v1.slots.length : 0
    }
  });
  session.updated_at = new Date().toISOString();
  await saveSession({ rootDir: storeRoot || defaultRoot(), session });
  await saveParamSet(session.session_id, session.config_parameter_set || {}, storeRoot || defaultRoot());
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
  appendSessionActivity(session, {
    type: "document_sem_saved",
    severity: "ok",
    summary: "Document SEM identity and rules saved.",
    details: {
      nominal_dimensions: normalizeDocumentSemPayload(payload).nominal_dimensions,
      family: payload?.family || null,
      product: payload?.product || null,
      part: payload?.part || null,
      rule_refs: ruleRefs
    }
  });

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
  const strategy = String(session.geometry_strategy_v1?.mode || "").trim();
  if (!["four_band_parameter_resize", "fixed_envelope_slide"].includes(strategy)) {
    throw new Error("Confirmed geometry strategy does not allow TOPO metadata authoring.");
  }
  const proposedComment = normalizeTopoCommentsInput(topoText).find((value) => isFileLevelTopoComment(value)) || "";
  const parsedProposedTopo = parseTopoComment(proposedComment);
  const proposedMode = String(parsedProposedTopo?.mode || parsedProposedTopo?.keys?.mode || "").trim();
  const expectedTopoMode = strategy === "four_band_parameter_resize"
    ? "4_band_parameter_resize"
    : strategy;
  if (proposedMode !== expectedTopoMode) {
    throw new Error("TOPO mode must match the confirmed geometry strategy.");
  }
  const rawComment = upsertFileLevelTopoComment(session, topoText);
  session.topo_comments = [rawComment];
  appendSessionActivity(session, {
    type: "topo_saved",
    severity: "ok",
    summary: "File-level TOPO definition saved.",
    details: { raw_comment: rawComment }
  });
  session.updated_at = new Date().toISOString();
  session.artifact_state = "mother_draft";
  await saveSession({ rootDir: storeRoot || defaultRoot(), session });
  return session;
}

async function clearTopoMetadata({ sessionId, storeRoot }) {
  const session = await getSession({ sessionId, storeRoot });
  clearFileLevelTopoComment(session);
  appendSessionActivity(session, {
    type: "topo_cleared",
    severity: "warn",
    summary: "File-level TOPO definition cleared.",
    details: {}
  });
  session.updated_at = new Date().toISOString();
  session.artifact_state = "mother_draft";
  await saveSession({ rootDir: storeRoot || defaultRoot(), session });
  return session;
}

async function updateEntityTopoRoleMetadata({ sessionId, entityId, role, group, zone, storeRoot }) {
  const session = await getSession({ sessionId, storeRoot });
  const rawComment = buildEntityTopoRoleComment({ role, group, zone });
  upsertEntityTopoComment(session, entityId, rawComment);
  appendSessionActivity(session, {
    type: rawComment ? "topo_role_assigned" : "topo_role_cleared",
    severity: rawComment ? "ok" : "warn",
    summary: rawComment ? "Entity-level TOPO role assigned." : "Entity-level TOPO role cleared.",
    details: { entity_id: entityId, role: role || null, group: group || null, zone: zone || null, raw_comment: rawComment || null }
  });
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

async function authorSemanticMetadata({ sessionId, entityId, entityIds, operation, parameter, expectedValue, semanticComment, replaceSemanticComment, storeRoot }) {
  const session = await getSession({ sessionId, storeRoot });
  const rawComment = buildSemanticCommentFromRule({
    operation,
    parameter,
    expected_value: expectedValue,
    semantic_comment: semanticComment
  });
  const normalizedIds = Array.from(new Set([
    ...((Array.isArray(entityIds) ? entityIds : []).map((id) => String(id || "").trim()).filter(Boolean)),
    String(entityId || "").trim()
  ].filter(Boolean)));
  if (!normalizedIds.length) {
    throw new Error("Select one or more entities before applying semantic metadata.");
  }
  const replaceComment = String(replaceSemanticComment || "").trim();
  for (const targetEntityId of normalizedIds) {
    upsertSemanticComment(session.document, targetEntityId, rawComment, replaceComment);
  }
  appendSessionActivity(session, {
    type: "semantic_metadata_assigned",
    severity: "ok",
    summary: String(rawComment).includes("post_topo_group=MICRO_SHIFT_SET")
      ? String(normalizedIds.length) + " entitet(a) assigned to MICRO_SHIFT_SET."
      : "Semantic metadata assigned to " + String(normalizedIds.length) + " entitet(a).",
    details: {
      entity_count: normalizedIds.length,
      sample_entity_ids: sampleValues(normalizedIds),
      semantic_comment: rawComment,
      replaced_semantic_comment: replaceComment || null
    }
  });
  session.updated_at = new Date().toISOString();
  session.artifact_state = "mother_draft";
  await saveSession({ rootDir: storeRoot || defaultRoot(), session });
  return {
    session,
    semantic_comment: rawComment,
    affected_entity_ids: normalizedIds
  };
}

async function clearSemanticMetadata({ sessionId, entityId, storeRoot }) {
  const session = await getSession({ sessionId, storeRoot });
  removeSemanticComment(session.document, entityId);
  appendSessionActivity(session, {
    type: "semantic_metadata_cleared",
    severity: "warn",
    summary: "Semantic metadata cleared from entity.",
    details: { entity_id: entityId }
  });
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
  appendSessionActivity(session, {
    type: nextValue ? "xdata_assigned" : "xdata_cleared",
    severity: nextValue ? "ok" : "warn",
    summary: nextValue ? "Geometry branch XDATA assigned." : "Geometry branch XDATA cleared.",
    details: { entity_count: normalizedIds.length, sample_entity_ids: sampleValues(normalizedIds), value: nextValue || null, previous_value: previousGroupValue || null }
  });
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

function summarizeResolverPreviewItems(items) {
  const visibleItems = (Array.isArray(items) ? items : []).filter((item) => item?.preview?.visible !== false && item?.preview?.included !== false);
  const shapes = [];
  const layer_summary = {};
  for (const item of visibleItems) {
    const layer = item.primary_layer || "UNCLASSIFIED";
    layer_summary[layer] = Number(layer_summary[layer] || 0) + 1;
    for (const shape of item.preview?.simulated_shapes || []) shapes.push(shape);
  }
  const bbox = shapes.length ? bboxFromShapes(shapes) : null;
  return {
    input_object_count: Array.isArray(items) ? items.length : 0,
    output_object_count: visibleItems.length,
    bbox: bbox ? {
      minX: roundNumber(bbox.minX),
      minY: roundNumber(bbox.minY),
      maxX: roundNumber(bbox.maxX),
      maxY: roundNumber(bbox.maxY),
      width: roundNumber(bbox.width),
      height: roundNumber(bbox.height)
    } : null,
    layer_summary
  };
}

function buildUiProjectionSnapshotV1(session) {
  const config = normalizeConfigParameterSet(session.config_parameter_set);
  const branchMode = effectiveBranchModeForSession(session, config);
  const documentEntityCount = Array.isArray(session.document?.entities) ? session.document.entities.length : 0;
  const assignmentCount = session.assignments && typeof session.assignments === "object" ? Object.keys(session.assignments).length : 0;
  return {
    version: 1,
    session_id: session.session_id,
    branch_mode: branchMode,
    geometry_authority: "legacy_branch",
    selected_slot_index: null,
    selected_variant_key: null,
    session_context_v1: cloneJson(session.session_context_v1 || null),
    domain_validation_ok: session.domain_validation_v1?.ok === true,
    geometry_validation_ok: session.geometry_validation_v1?.ok === true,
    parameter_catalog_id: config.parameter_catalog_id || session.session_context_v1?.parameter_catalog_id || null,
    rule_set_id: session.session_context_v1?.rule_set_id || null,
    parameter_hash: hashJson(config.parameters || {}),
    document_entity_count: documentEntityCount,
    assignment_count: assignmentCount,
    geometry_slot_count: session.geometry_validation_v1?.slot_count ?? null
  };
}
function buildUiProjectionHashV1(session) {
  return hashJson(buildUiProjectionSnapshotV1(session));
}

function buildResolverInputV1Minimal(session) {
  const view = projectViewModel(session);
  const config = normalizeConfigParameterSet(session.config_parameter_set);
  const branchMode = effectiveBranchModeForSession(session, config);
  const selectedObjects = filterObjectsByBranchMode(view.objects, branchMode);
  const selectedIds = selectedObjects.map((object) => object.id);
  const selectedIdSet = new Set(selectedIds.map((id) => String(id)));
  const filteredIds = (view.objects || [])
    .map((object) => object.id)
    .filter((id) => !selectedIdSet.has(String(id)));
  return {
    version: 1,
    schema: "resolver_input_v1_minimal",
    session_id: session.session_id,
    ui_projection_hash: buildUiProjectionHashV1(session),
    execution_authority: "core_shell_resolver",
    geometry_authority: "legacy_branch",
    branch_mode: branchMode,
    selected_slot_index: null,
    selected_variant_key: null,
    session_context_v1: cloneJson(session.session_context_v1 || null),
    domain_context_v1: cloneJson(view.domain_context_v1 || null),
    geometry_context_v1_summary: {
      version: view.geometry_context_v1?.version || 1,
      slot_width: view.geometry_context_v1?.slot_width || GEOMETRY_SLOT_WIDTH_MM,
      slot_count: Array.isArray(view.geometry_context_v1?.slots) ? view.geometry_context_v1.slots.length : 0,
      base_slot_index: view.geometry_context_v1?.base_slot_index ?? 0,
      authoritative_slot_index: view.geometry_context_v1?.authoritative_slot_index ?? null,
      authoritative_variant_key: view.geometry_context_v1?.authoritative_variant_key ?? null
    },
    legacy_branch_context: {
      branch_mode: branchMode,
      selected_objects: selectedIds,
      filtered_objects: filteredIds
    },
    parameter_context: {
      valid: session.domain_validation_v1?.ok === true,
      parameter_catalog_id: config.parameter_catalog_id || session.session_context_v1?.parameter_catalog_id || null,
      parameter_count: Object.keys(config.parameters || {}).length
    },
    rule_context: {
      valid: session.domain_validation_v1?.ok === true,
      rule_set_id: session.session_context_v1?.rule_set_id || null,
      rule_catalog_id: view.rule_catalog?.catalog_id || null
    },
    objects: selectedObjects.map((object) => ({
      id: object.id,
      entity_id: object.entity_id,
      type: object.type,
      primary_layer: object.primary_layer,
      classification_state: object.classification_state,
      bbox: object.bbox,
      slot_index: object.slot_index,
      semantic_metadata: cloneJson(object.semantic_metadata || null),
      xdata_metadata: cloneJson(object.xdata_metadata || null),
      topo_role_metadata: cloneJson(object.topo_role_metadata || null)
    })),
    config_parameter_set: cloneJson(config)
  };
}

function buildResolverOutputV1({ session, resolverInput, simulation, previewInfo }) {
  const inputHash = hashJson(resolverInput);
  const itemSummary = summarizeResolverPreviewItems(simulation?.items || []);
  const validation = simulation?.validation || { ok: true, errors: [], warnings: [] };
  const outputBase = {
    version: 1,
    schema: "resolver_output_v1",
    session_id: session.session_id,
    resolver_run_id: previewInfo?.resolver_run_id || null,
    execution_authority: "core_shell_resolver",
    geometry_authority: "legacy_branch",
    branch_mode: resolverInput.branch_mode,
    selected_slot_index: null,
    selected_variant_key: null,
    resolver_input_hash: inputHash,
    ui_projection_hash: resolverInput.ui_projection_hash || null,
    resolver_geometry_summary: {
      input_object_count: itemSummary.input_object_count,
      output_object_count: itemSummary.output_object_count,
      bbox: itemSummary.bbox
    },
    resolver_layer_summary: itemSummary.layer_summary,
    execution_plan_summary: {
      topology_mode: simulation?.topology_mode || "none",
      technology_profile: simulation?.technology_profile || null,
      product_code: simulation?.product_code || null,
      document_rules_applied: Array.isArray(simulation?.summary?.document_rules_applied) ? simulation.summary.document_rules_applied.length : 0,
      post_topo_rules_applied: Array.isArray(simulation?.summary?.post_topo_rules_applied) ? simulation.summary.post_topo_rules_applied.length : 0,
      final_orientation_rules_applied: Array.isArray(simulation?.summary?.final_orientation_rules_applied) ? simulation.summary.final_orientation_rules_applied.length : 0
    },
    validation: {
      ok: validation.ok !== false && !(Array.isArray(validation.errors) && validation.errors.length),
      errors: cloneJson(validation.errors || []),
      warnings: cloneJson(validation.warnings || []),
      counts: cloneJson(validation.counts || {})
    },
    preview_artifact: previewInfo ? {
      preview_id: previewInfo.previewId || previewInfo.preview_id || null,
      json_path: previewInfo.jsonPath || previewInfo.json_path || null
    } : null
  };
  return {
    ...outputBase,
    resolver_output_hash: hashJson(outputBase)
  };
}

function validateResolverPreviewReadiness(session) {
  ensureSessionContextShape(session);
  const state = lifecycleStateForSession(session);
  const errors = [];
  if (!sessionContextIsLocked(session)) errors.push({ code: "SESSION_CONTEXT_INVALID", message: "Session context must be locked before resolver preview." });
  if (session.geometry_validation_v1?.ok !== true) errors.push({ code: "GEOMETRY_CONTEXT_INVALID", message: "Geometry context must be projected before resolver preview." });
  if (session.domain_validation_v1?.ok !== true) errors.push({ code: "DOMAIN_CONTEXT_INVALID", message: "Domain context must be validated before resolver preview." });
  if (!["authoring_ready", "domain_validated", "preview_ready"].includes(state)) {
    errors.push({ code: "RESOLVER_PREVIEW_STATE_INVALID", message: "Resolver preview requires authoring_ready lifecycle state.", lifecycle_state: state });
  }
  return {
    ok: errors.length === 0,
    errors,
    warnings: [],
    lifecycle_state: state,
    parameter_context: { valid: session.domain_validation_v1?.ok === true },
    rule_context: { valid: session.domain_validation_v1?.ok === true }
  };
}

async function generateResolverPreview({ sessionId, storeRoot }) {
  const rootDir = storeRoot || defaultRoot();
  const session = await getSession({ sessionId, storeRoot: rootDir });
  const readiness = validateResolverPreviewReadiness(session);
  if (!readiness.ok) {
    const err = new Error(readiness.errors.map((item) => item.message).join(" | "));
    err.code = "RESOLVER_PREVIEW_NOT_READY";
    err.validation = readiness;
    throw err;
  }
  const resolverInput = buildResolverInputV1Minimal(session);
  const simulation = simulateChildPreview(session);
  const previewId = crypto.randomUUID();
  const resolverRunId = crypto.randomUUID();
  const previewInfo = await savePreview(session.session_id, previewId, {
    session_id: session.session_id,
    preview_id: previewId,
    type: "resolver_preview_v1",
    resolver_input_v1_minimal: resolverInput,
    simulation
  }, null, rootDir);
  previewInfo.preview_id = previewId;
  previewInfo.resolver_run_id = resolverRunId;
  const resolverOutput = buildResolverOutputV1({ session, resolverInput, simulation, previewInfo });
  await savePreview(session.session_id, previewId, {
    session_id: session.session_id,
    preview_id: previewId,
    type: "resolver_preview_v1",
    resolver_input_v1_minimal: resolverInput,
    resolver_output_v1: resolverOutput,
    simulation
  }, null, rootDir);
  await registerArtifact(session.session_id, "preview_json", previewId, previewInfo.jsonPath, rootDir);
  await appendEvent(session.session_id, {
    type: "resolver_preview_saved",
    details: {
      preview_id: previewId,
      resolver_input_hash: resolverOutput.resolver_input_hash,
      resolver_output_hash: resolverOutput.resolver_output_hash,
      geometry_authority: resolverOutput.geometry_authority
    }
  }, rootDir);
  const nextState = resolverOutput.validation.ok ? "preview_ready" : "authoring_ready";
  session.resolver_input_v1_minimal = resolverInput;
  session.resolver_preview_v1 = resolverOutput;
  session.session_lifecycle_v1 = {
    version: 1,
    state: nextState,
    allowed_transitions: lifecycleTransitionsForState(nextState)
  };
  session.artifact_lineage_v1 = buildArtifactLineageV1(session);
  session.wysiwyg_gate_v1 = buildWysiwygGateV1(session, "child");
  session.updated_at = new Date().toISOString();
  appendSessionActivity(session, {
    type: "resolver_preview_generated",
    severity: resolverOutput.validation.ok ? "ok" : "error",
    summary: resolverOutput.validation.ok ? "Resolver preview generated." : "Resolver preview returned blocking errors.",
    details: {
      preview_id: previewId,
      lifecycle_state: nextState,
      resolver_input_hash: resolverOutput.resolver_input_hash,
      resolver_output_hash: resolverOutput.resolver_output_hash,
      geometry_authority: resolverOutput.geometry_authority
    }
  });
  await saveSession({ rootDir, session });
  return {
    session,
    resolver_input_v1_minimal: resolverInput,
    resolver_output_v1: resolverOutput,
    simulation
  };
}

function resolverOutputHashForValidation(output) {
  if (!output || typeof output !== "object") return null;
  const copy = cloneJson(output);
  delete copy.resolver_output_hash;
  return hashJson(copy);
}

function buildArtifactLineageV1(session) {
  const preview = session.resolver_preview_v1 || null;
  const child = session.resolver_child_v1 || null;
  const exported = session.resolver_export_v1 || null;
  return {
    version: 1,
    resolver_run_id: preview?.resolver_run_id || null,
    resolver_input_hash: preview?.resolver_input_hash || null,
    resolver_output_hash: preview?.resolver_output_hash || null,
    preview_id: preview?.preview_artifact?.preview_id || null,
    child_artifact_id: child?.child_artifact_id || null,
    export_artifact_id: exported?.export_artifact_id || null,
    dbr_handoff_manifest_id: exported?.dbr_handoff_manifest_id || null,
    parent_child_relationships: {
      preview_to_child: preview?.preview_artifact?.preview_id && child?.child_artifact_id ? { parent: preview.preview_artifact.preview_id, child: child.child_artifact_id } : null,
      child_to_export: child?.child_artifact_id && exported?.export_artifact_id ? { parent: child.child_artifact_id, child: exported.export_artifact_id } : null,
      export_to_dbr: exported?.export_artifact_id && exported?.dbr_handoff_manifest_id ? { parent: exported.export_artifact_id, child: exported.dbr_handoff_manifest_id } : null
    },
    complete_for_child: Boolean(preview?.resolver_input_hash && preview?.resolver_output_hash && preview?.preview_artifact?.preview_id),
    complete_for_export: Boolean(preview?.resolver_input_hash && preview?.resolver_output_hash && preview?.preview_artifact?.preview_id && child?.child_artifact_id),
    complete_for_dbr: Boolean(exported?.export_artifact_id && exported?.dbr_handoff_manifest_id)
  };
}

function buildWysiwygGateV1(session, action = "child") {
  const errors = [];
  const warnings = [];
  ensureSessionContextShape(session);
  const lifecycle = lifecycleStateForSession(session);
  const preview = session.resolver_preview_v1 || null;
  const currentUiProjectionHash = preview ? buildUiProjectionHashV1(session) : null;
  const storedOutputHashValid = preview?.resolver_output_hash ? resolverOutputHashForValidation(preview) === preview.resolver_output_hash : false;
  const lineage = buildArtifactLineageV1(session);

  if (!sessionContextIsLocked(session)) errors.push({ code: "SESSION_CONTEXT_INVALID", message: "Session context is not locked." });
  if (session.domain_validation_v1?.ok !== true) errors.push({ code: "DOMAIN_CONTEXT_INVALID", message: "Domain context is not valid." });
  if (session.geometry_validation_v1?.ok !== true) errors.push({ code: "GEOMETRY_CONTEXT_INVALID", message: "Geometry context is not valid." });
  if (!preview || preview.validation?.ok !== true) errors.push({ code: "resolver_invalid", message: "Resolver preview is missing or invalid." });
  if (!["preview_ready", "child_ready", "export_ready"].includes(lifecycle)) errors.push({ code: "preview_stale", message: "Lifecycle is not preview_ready or beyond.", lifecycle_state: lifecycle });
  if (preview && currentUiProjectionHash !== preview.ui_projection_hash) errors.push({ code: "WYSIWYG_CONTRACT_MISMATCH", message: "Current UI projection hash differs from preview UI projection hash." });
  if (preview && !preview.resolver_input_hash) errors.push({ code: "WYSIWYG_CONTRACT_MISMATCH", message: "Resolver input hash is missing." });
  if (preview && !storedOutputHashValid) errors.push({ code: "WYSIWYG_CONTRACT_MISMATCH", message: "Stored resolver output hash is not reproducible." });
  if (preview && preview.geometry_authority !== "legacy_branch") errors.push({ code: "WYSIWYG_CONTRACT_MISMATCH", message: "Unsupported geometry authority for v1 child/export gating." });
  if (action === "child" && !lineage.complete_for_child) errors.push({ code: "artifact_lineage_incomplete", message: "Preview lineage is incomplete; child generation is blocked." });
  if (action === "export" && !lineage.complete_for_export) errors.push({ code: "artifact_lineage_incomplete", message: "Child lineage is incomplete; export/DBR is blocked." });

  return {
    version: 1,
    action,
    ok: errors.length === 0,
    mismatch: errors.some((item) => item.code === "WYSIWYG_CONTRACT_MISMATCH"),
    lifecycle_state: lifecycle,
    ui_projection_hash: currentUiProjectionHash,
    resolver_input_hash: preview?.resolver_input_hash || null,
    current_resolver_input_hash: preview?.resolver_input_hash || null,
    resolver_output_hash: preview?.resolver_output_hash || null,
    resolver_output_hash_valid: storedOutputHashValid,
    blocking_error_count: errors.length,
    warning_count: warnings.length,
    errors,
    warnings,
    artifact_lineage_v1: lineage
  };
}
function assertWysiwygGate(session, action) {
  const gate = buildWysiwygGateV1(session, action);
  if (!gate.ok) {
    const err = new Error(gate.errors.map((item) => item.message).join(" | "));
    err.code = gate.mismatch ? "WYSIWYG_CONTRACT_MISMATCH" : "RESOLVER_EXECUTION_BLOCKED";
    err.validation = gate;
    throw err;
  }
  return gate;
}

function sessionHasTopoRuntime(session) {
  const topo = projectTopoMetadata(session);
  return Boolean(topo?.runtime_model && topo.runtime_model.mode && topo.runtime_model.mode !== "none");
}

async function generateResolverChild({ sessionId, storeRoot }) {
  const rootDir = storeRoot || defaultRoot();
  const session = await getSession({ sessionId, storeRoot: rootDir });
  const gate = assertWysiwygGate(session, "child");
  const config = normalizeConfigParameterSet(session.config_parameter_set);
  const result = generateChildDxfNoTopo(session, config);
  const enrichment999 = buildChildDxf999Enrichment(session, config, result.dxf_text);
  const childArtifactId = "resolver_child_v1";
  const childInfo = await saveChildExport({
    rootDir,
    sessionId,
    dxfText: enrichment999.enriched_dxf_text,
    suffix: childArtifactId
  });
  const childDxfInfo = await saveChildDxf(sessionId, childArtifactId, enrichment999.enriched_dxf_text, rootDir);
  await registerArtifact(sessionId, "child_dxf", childArtifactId, childDxfInfo.filePath, rootDir);
  const childMetadata = {
    version: 1,
    session_id: String(sessionId),
    child_artifact_id: childArtifactId,
    created_at: new Date().toISOString(),
    resolver_run_id: session.resolver_preview_v1?.resolver_run_id || null,
    resolver_input_hash: session.resolver_preview_v1?.resolver_input_hash || null,
    resolver_output_hash: session.resolver_preview_v1?.resolver_output_hash || null,
    preview_id: session.resolver_preview_v1?.preview_artifact?.preview_id || null,
    generation_summary: cloneJson(result.generation_summary || {}),
    child_dxf_999_enrichment_v1: cloneJson(enrichment999)
  };
  await writeChildMetadata(sessionId, childArtifactId, childMetadata, rootDir);
  await appendEvent(sessionId, {
    type: "resolver_child_artifacts_saved",
    details: { child_artifact_id: childArtifactId, resolver_input_hash: childMetadata.resolver_input_hash, resolver_output_hash: childMetadata.resolver_output_hash }
  }, rootDir);
  session.resolver_child_v1 = {
    version: 1,
    child_artifact_id: childArtifactId,
    child_file: childInfo.filePath,
    child_dxf_path: childDxfInfo.filePath,
    child_metadata: childMetadata,
    generation_summary: cloneJson(result.generation_summary || {}),
    child_dxf_999_enrichment_v1: cloneJson(enrichment999)
  };
  session.artifact_lineage_v1 = buildArtifactLineageV1(session);
  session.wysiwyg_gate_v1 = buildWysiwygGateV1(session, "child");
  session.session_lifecycle_v1 = { version: 1, state: "child_ready", allowed_transitions: lifecycleTransitionsForState("child_ready") };
  session.updated_at = new Date().toISOString();
  appendSessionActivity(session, {
    type: "resolver_child_generated",
    severity: "ok",
    summary: "Resolver child DXF generated with WYSIWYG gate.",
    details: { child_artifact_id: childArtifactId, child_file: childInfo.filePath }
  });
  await saveSession({ rootDir, session });
  return { session, dxf_text: enrichment999.enriched_dxf_text, child_artifact: session.resolver_child_v1, wysiwyg_gate_v1: gate, artifact_lineage_v1: session.artifact_lineage_v1 };
}

async function generateResolverExport({ sessionId, storeRoot }) {
  const rootDir = storeRoot || defaultRoot();
  const session = await getSession({ sessionId, storeRoot: rootDir });
  const gate = assertWysiwygGate(session, "export");
  const outputDocument = materializeDocumentForExport(session);
  const dxfText = serializeDocument(outputDocument);
  const exportInfo = await saveExport({ rootDir, sessionId, dxfText });
  await saveMotherJson(sessionId, session.document, rootDir);
  const exportArtifactId = "resolver_export_v1";
  const dbrManifestId = "dbr_handoff_manifest_v1";
  await registerArtifact(sessionId, "mother_dxf", exportArtifactId, exportInfo.artifactPath || exportInfo.filePath, rootDir);
  await registerArtifact(sessionId, "mother_export", exportArtifactId, exportInfo.filePath, rootDir);
  const dbrManifest = {
    version: 1,
    manifest_id: dbrManifestId,
    session_id: String(sessionId),
    created_at: new Date().toISOString(),
    execution_authority: "core_shell_resolver",
    geometry_authority: "legacy_branch",
    resolver_run_id: session.resolver_preview_v1?.resolver_run_id || null,
    resolver_input_hash: session.resolver_preview_v1?.resolver_input_hash || null,
    resolver_output_hash: session.resolver_preview_v1?.resolver_output_hash || null,
    child_artifact_id: session.resolver_child_v1?.child_artifact_id || null,
    export_artifact_id: exportArtifactId,
    reproducible: true
  };
  const manifestInfo = await savePreview(sessionId, dbrManifestId, { type: "dbr_handoff_manifest_v1", dbr_handoff_manifest_v1: dbrManifest }, null, rootDir);
  await registerArtifact(sessionId, "dbr_handoff_manifest", dbrManifestId, manifestInfo.jsonPath, rootDir);
  await appendEvent(sessionId, {
    type: "resolver_export_artifacts_saved",
    details: { export_artifact_id: exportArtifactId, dbr_handoff_manifest_id: dbrManifestId, export_file: exportInfo.filePath }
  }, rootDir);
  session.resolver_export_v1 = {
    version: 1,
    export_artifact_id: exportArtifactId,
    export_file: exportInfo.filePath,
    artifact_file: exportInfo.artifactPath || null,
    dbr_handoff_manifest_id: dbrManifestId,
    dbr_handoff_manifest_path: manifestInfo.jsonPath,
    dbr_handoff_manifest_v1: dbrManifest
  };
  session.artifact_lineage_v1 = buildArtifactLineageV1(session);
  session.wysiwyg_gate_v1 = buildWysiwygGateV1(session, "export");
  session.session_lifecycle_v1 = { version: 1, state: "export_ready", allowed_transitions: lifecycleTransitionsForState("export_ready") };
  session.updated_at = new Date().toISOString();
  appendSessionActivity(session, {
    type: "resolver_export_generated",
    severity: "ok",
    summary: "Resolver export and DBR handoff manifest generated with WYSIWYG gate.",
    details: { export_artifact_id: exportArtifactId, dbr_handoff_manifest_id: dbrManifestId, export_file: exportInfo.filePath }
  });
  await saveSession({ rootDir, session });
  return { session, dxf_text: dxfText, export_artifact: session.resolver_export_v1, wysiwyg_gate_v1: gate, artifact_lineage_v1: session.artifact_lineage_v1 };
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

async function validateMotherDraft({ sessionId, storeRoot }) {
  const session = await getSession({ sessionId, storeRoot });
  const validation = validateSession(session);
  session.updated_at = new Date().toISOString();
  session.validation = validation;
  if (validation.ok) {
    session.artifact_state = "mother_validated";
  }
  appendSessionActivity(session, {
    type: "mother_draft_validated",
    severity: validation.ok ? "ok" : "error",
    summary: validation.ok ? "Mother draft validation passed." : "Mother draft validation failed.",
    details: { error_count: validation.errors?.length || 0, warning_count: validation.warnings?.length || 0 }
  });
  await saveSession({ rootDir: storeRoot || defaultRoot(), session });
  return { session, validation };
}

module.exports = {
  use_case: "mother_dxf_v1",
  createSession,
  createContextDraftSession,
  lockSessionContext,
  resetSessionContext,
  computeGeometryContext,
  validateDomainContext,
  getSession,
  listSessionSummaries,
  assignPrimaryLayer,
  updateConfigParameterSet,
  updateLabelDefinition,
  clearLabelDefinition,
  buildDefaultConfigFromParameterCatalog,
  updateDocumentSemMetadata,
  updateTopoMetadata,
  clearTopoMetadata,
  updateEntityTopoRoleMetadata,
  updateSessionMeta,
  explodeBlockInsert,
  authorSemanticMetadata,
  clearSemanticMetadata,
  updateEntityXdataMetadata,
  generateResolverPreview,
  generateResolverChild,
  generateResolverExport,
  buildChildDxf999Enrichment,
  runKskrExecutionCheck,
  generateCoreShellFourBandShadowChildDxf,
  generateChildDxfNoTopo,
  generateChildDxfTopoPoc,
  validateMotherDraft,
  buildDomainValidationV1,
  projectViewModel,
  serializeCurrentMotherDraft,
  serializeDocument,
  parseDocumentSem,
  normalizeDocumentSemPayload,
  buildDocumentSemIdentityComment,
  collectDocumentSemMetadata,
  collectDocumentRuleMetadata,
  upsertFileLevelTopoComment,
  upsertEntityTopoComment,
  parseTopoComment,
  parseRuleComment,
  collectTopoMetadata,
  validateTopoBlock,
  normalizeTopoRuntimeModel,
  normalizeGeometryStrategyV1
};
