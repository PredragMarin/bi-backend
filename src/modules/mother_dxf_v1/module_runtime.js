"use strict";

const crypto = require("crypto");
const {
  ALLOWED_PRIMARY_LAYERS,
  sanitizeDocument,
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
  saveExport
} = require("../../core_shell/storage/mother_dxf_store");

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
      semantic_color: assignment.layer ? SEMANTIC_COLORS[assignment.layer] : SEMANTIC_COLORS.UNCLASSIFIED
    };
  });

  return {
    session_id: session.session_id,
    artifact_state: session.artifact_state,
    source_name: session.source_name,
    bands: session.bands,
    document_bbox: session.document_bbox,
    objects,
    allowed_layers: Array.from(ALLOWED_PRIMARY_LAYERS.values()),
    semantic_colors: SEMANTIC_COLORS
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

async function createSession({ dxfText, sourceName, bands, storeRoot }) {
  const document = sanitizeDocument(dxfText);
  const session = {
    session_id: crypto.randomUUID(),
    use_case: "mother_dxf_v1",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    artifact_state: "sanitized",
    source_name: String(sourceName || "mother_dxf_input.dxf"),
    bands: normalizeBands(bands),
    assignments: {},
    document
  };
  projectViewModel(session);
  await saveSession({ rootDir: storeRoot || defaultRoot(), session });
  return session;
}

async function getSession({ sessionId, storeRoot }) {
  const session = await loadSession({ rootDir: storeRoot || defaultRoot(), sessionId });
  projectViewModel(session);
  return session;
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
  assignPrimaryLayer,
  updateBands,
  validateMotherDraft,
  exportMotherDraft,
  projectViewModel
};
