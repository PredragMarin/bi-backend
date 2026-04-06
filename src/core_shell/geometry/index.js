"use strict";

const DEG_TO_RAD = Math.PI / 180;

function roundNumber(value, decimals = 3) {
  const num = Number(value);
  if (!Number.isFinite(num)) return value;
  const factor = 10 ** decimals;
  return Math.round(num * factor) / factor;
}

function rotatePoint(point, angleDeg) {
  const angle = Number(angleDeg || 0) * DEG_TO_RAD;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos
  };
}

function transformPoint(point, transform) {
  const scaleX = Number(transform?.scaleX || 1);
  const scaleY = Number(transform?.scaleY || 1);
  const rotationDeg = Number(transform?.rotationDeg || 0);
  const tx = Number(transform?.tx || 0);
  const ty = Number(transform?.ty || 0);

  const scaled = { x: point.x * scaleX, y: point.y * scaleY };
  const rotated = rotatePoint(scaled, rotationDeg);
  return {
    x: rotated.x + tx,
    y: rotated.y + ty
  };
}

function bboxFromPoints(points) {
  const valid = (Array.isArray(points) ? points : []).filter((point) =>
    point && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y))
  );
  if (!valid.length) return null;

  let minX = valid[0].x;
  let maxX = valid[0].x;
  let minY = valid[0].y;
  let maxY = valid[0].y;

  for (const point of valid) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }

  return { minX, minY, maxX, maxY };
}

function bboxUnion(a, b) {
  if (!a) return b || null;
  if (!b) return a || null;
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY)
  };
}

function bboxCenter(bbox) {
  if (!bbox) return null;
  return {
    x: (bbox.minX + bbox.maxX) / 2,
    y: (bbox.minY + bbox.maxY) / 2
  };
}

function bboxIntersects(a, b) {
  if (!a || !b) return false;
  return !(
    a.maxX < b.minX ||
    a.minX > b.maxX ||
    a.maxY < b.minY ||
    a.minY > b.maxY
  );
}

function arcEndpoints({ centerX, centerY, radius, startAngle, endAngle }) {
  const cx = Number(centerX);
  const cy = Number(centerY);
  const r = Number(radius);
  const start = Number(startAngle) * DEG_TO_RAD;
  const end = Number(endAngle) * DEG_TO_RAD;
  return {
    start: { x: cx + Math.cos(start) * r, y: cy + Math.sin(start) * r },
    end: { x: cx + Math.cos(end) * r, y: cy + Math.sin(end) * r }
  };
}

function angleWithinArc(targetDeg, startDeg, endDeg) {
  const normalize = (v) => {
    let out = v % 360;
    if (out < 0) out += 360;
    return out;
  };
  const target = normalize(targetDeg);
  const start = normalize(startDeg);
  const end = normalize(endDeg);
  if (start <= end) return target >= start && target <= end;
  return target >= start || target <= end;
}

function arcCriticalAngles(startDeg, endDeg) {
  return [0, 90, 180, 270].filter((angle) => angleWithinArc(angle, startDeg, endDeg));
}

function bboxFromArc({ centerX, centerY, radius, startAngle, endAngle }) {
  const endpoints = arcEndpoints({ centerX, centerY, radius, startAngle, endAngle });
  const cx = Number(centerX);
  const cy = Number(centerY);
  const r = Number(radius);
  const points = [endpoints.start, endpoints.end];
  for (const angle of arcCriticalAngles(Number(startAngle), Number(endAngle))) {
    const rad = angle * DEG_TO_RAD;
    points.push({ x: cx + Math.cos(rad) * r, y: cy + Math.sin(rad) * r });
  }
  return bboxFromPoints(points);
}

module.exports = {
  roundNumber,
  transformPoint,
  bboxFromPoints,
  bboxUnion,
  bboxCenter,
  bboxIntersects,
  arcEndpoints,
  bboxFromArc
};
