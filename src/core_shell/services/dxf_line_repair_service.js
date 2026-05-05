"use strict";

const {
  lineLineIntersection,
  trimLineToPoint
} = require("../geometry");

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

function pointDistance(a, b) {
  const ax = Number(a?.x);
  const ay = Number(a?.y);
  const bx = Number(b?.x);
  const by = Number(b?.y);
  if (![ax, ay, bx, by].every(Number.isFinite)) return Number.POSITIVE_INFINITY;
  return Math.hypot(ax - bx, ay - by);
}

function pointWithinBounds(point, bounds, tolerance = 0.5) {
  if (!bounds) return true;
  const x = Number(point?.x);
  const y = Number(point?.y);
  const minX = Number(bounds?.minX);
  const minY = Number(bounds?.minY);
  const maxX = Number(bounds?.maxX);
  const maxY = Number(bounds?.maxY);
  if (![x, y, minX, minY, maxX, maxY].every(Number.isFinite)) return false;
  return x >= minX - tolerance
    && x <= maxX + tolerance
    && y >= minY - tolerance
    && y <= maxY + tolerance;
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

function buildReciprocalTrim(pairing, simulatedShapeMap, intersection, options = {}) {
  const candidateRef = pairing.candidate
    ? `${pairing.candidate.object_id}:${pairing.candidate.shape_index}`
    : null;
  const candidateShape = candidateRef ? simulatedShapeMap.get(candidateRef) : null;
  const candidateLine = lineShapeToPoints(candidateShape);
  if (!candidateLine) return null;
  const reciprocalPoint = pairing.candidate_vertex === "start" ? candidateLine.startPoint : candidateLine.endPoint;
  const maxExtension = Number(options?.maxExtension);
  if (Number.isFinite(maxExtension) && pointDistance(reciprocalPoint, intersection) > maxExtension) {
    return null;
  }
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

function applyTrimRejoinToTranslatedLine(originalLineShape, translatedLineShape, lineCandidates, selfRef, simulatedShapeMap, options = {}) {
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
    if (!pointWithinBounds(intersection, options.bounds)) {
      resolvedPairings.push({
        ...pairing,
        status: "unresolved"
      });
      continue;
    }
    const pairingPoint = pairing.paired_vertex === "start" ? currentLine.startPoint : currentLine.endPoint;
    const maxExtension = Number(options?.maxExtension);
    if (Number.isFinite(maxExtension) && pointDistance(pairingPoint, intersection) > maxExtension) {
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
    const reciprocal = buildReciprocalTrim(pairing, simulatedShapeMap, intersection, options);
    if (reciprocal) reciprocals.push(reciprocal);
  }

  return {
    shape: linePointsToShape(currentLine) || translatedLineShape,
    pairings: resolvedPairings,
    reciprocals
  };
}

module.exports = {
  collectLineCandidates,
  applyTrimRejoinToTranslatedLine
};
