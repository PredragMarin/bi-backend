"use strict";

const {
  listRelevantObjects,
  pairValue
} = require("../dxf");
const {
  bboxUnion,
  arcEndpoints,
  roundNumber,
  transformPoint
} = require("../geometry");

const MOTHER_XDATA_APP_NAME = "MOTHERDXF";

function normalizeXdataValue(value) {
  return String(value || "").trim();
}

function parseMotherXdataAttributes(value) {
  const text = normalizeXdataValue(value);
  if (!text) return {};
  return text
    .split(/[;\n]+/)
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
    .reduce((acc, entry) => {
      const eqIndex = entry.indexOf("=");
      if (eqIndex <= 0) return acc;
      const key = entry.slice(0, eqIndex).trim().toUpperCase();
      const val = entry.slice(eqIndex + 1).trim();
      if (!key || !val) return acc;
      acc[key] = val;
      return acc;
    }, {});
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

function collectEntityXdataMetadata(entity) {
  const value = extractMotherXdataValue(entity);
  if (!value) return null;
  const attributes = parseMotherXdataAttributes(value);
  const keys = Object.keys(attributes);
  const rawGeometryVariant = String(attributes.GEOMETRY_VARIANT || "").trim() || null;
  let branchIssue = null;
  if (!rawGeometryVariant) {
    branchIssue = "missing_geometry_variant";
  } else if (keys.length !== 1) {
    branchIssue = "unexpected_branch_attributes";
  }
  return {
    app: MOTHER_XDATA_APP_NAME,
    value,
    attributes,
    geometry_variant: branchIssue ? null : rawGeometryVariant,
    raw_geometry_variant: rawGeometryVariant,
    branch_valid: !branchIssue,
    branch_issue: branchIssue
  };
}

function findTopEntity(document, entityId) {
  return (Array.isArray(document?.entities) ? document.entities : []).find((entity) => entity && entity.id === entityId) || null;
}

function computeDocumentBBox(relevantObjects) {
  return (Array.isArray(relevantObjects) ? relevantObjects : []).reduce((acc, item) => bboxUnion(acc, item.bbox), null);
}

function buildRelevantObjectsWithXdata(document) {
  const relevantObjects = listRelevantObjects(document);
  return relevantObjects.map((item) => {
    const entity = findTopEntity(document, item.entityId);
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
      xdata_metadata: collectEntityXdataMetadata(entity)
    };
  });
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

function collectBlockInternalLineObjects(document) {
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
    const parentXdataMetadata = collectEntityXdataMetadata(entity);
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
        primary_layer: String(pairValue(child, "8", "") || "").trim() || null,
        shapes: [{ kind: "line", x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y }],
        hygiene_context: "block_child",
        xdata_metadata: parentXdataMetadata
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

function connectionPointsForObject(object, summaryOverride = null) {
  const lineSummary = summaryOverride || lineGeometrySummary(object);
  if (lineSummary) {
    return lineEndpoints(lineSummary);
  }
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
          block_name: object.block_name || null,
          source_line: object?.source?.line_start || null,
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
              block_name: object.block_name || null,
              source_line: object?.source?.line_start || null,
              geometry_variant: String(object?.xdata_metadata?.geometry_variant || "").trim() || null
            },
            {
              object_id: candidate.object?.id || null,
              entity_id: candidate.object?.entity_id || null,
              block_name: candidate.object?.block_name || null,
              source_line: candidate.object?.source?.line_start || null,
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
      block_name: object.block_name || null,
      source_line: object?.source?.line_start || null,
      issue_type: "invalid_branch_xdata",
      raw_value: metadata.value,
      branch_issue: metadata.branch_issue,
      bbox: object.bbox || null,
      suggestion: "Fix upstream XDATA to the strict syntax GEOMETRY_VARIANT=<VALUE>. Invalid branch XDATA is ignored by branch filtering."
    });
  }
  return issues;
}

function analyzeGeometryHygiene(document, objects) {
  const sourceObjects = [
    ...(Array.isArray(objects) ? objects : []),
    ...collectBlockInternalLineObjects(document)
  ];
  const issues = [];
  const invalidBranchXdata = collectInvalidBranchXdataIssues(objects);
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
        ? Math.max(Math.min(previous.summary.y1, previous.summary.y2), Math.min(entry.summary.y1, entry.summary.y2))
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

function collectXdataContext(objects) {
  const sourceObjects = Array.isArray(objects) ? objects : [];
  const geometryVariants = new Set();
  let taggedObjectCount = 0;
  let baseObjectCount = 0;
  let invalidBranchXdataCount = 0;
  for (const object of sourceObjects) {
    const metadata = object?.xdata_metadata;
    const geometryVariant = String(metadata?.geometry_variant || "").trim();
    if (geometryVariant) {
      geometryVariants.add(geometryVariant);
      taggedObjectCount += 1;
      continue;
    }
    if (metadata?.branch_valid === false) {
      invalidBranchXdataCount += 1;
      continue;
    }
    baseObjectCount += 1;
  }
  return {
    geometry_variants: Array.from(geometryVariants.values()).sort(),
    tagged_object_count: taggedObjectCount,
    base_object_count: baseObjectCount,
    invalid_branch_xdata_count: invalidBranchXdataCount
  };
}

function buildSanitizeReview(document) {
  const objects = buildRelevantObjectsWithXdata(document);
  const documentBBox = computeDocumentBBox(objects);
  const geometryHygiene = analyzeGeometryHygiene(document, objects);
  const xdataContext = collectXdataContext(objects);
  return {
    document_bbox: documentBBox,
    objects,
    geometry_hygiene: geometryHygiene,
    xdata_context: xdataContext
  };
}

module.exports = {
  MOTHER_XDATA_APP_NAME,
  parseMotherXdataAttributes,
  extractMotherXdataValue,
  collectEntityXdataMetadata,
  analyzeGeometryHygiene,
  collectXdataContext,
  buildSanitizeReview
};
