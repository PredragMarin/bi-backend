"use strict";

const {
  roundNumber,
  transformPoint,
  bboxFromPoints,
  bboxUnion,
  bboxFromArc
} = require("../geometry");

const SCOPED_ENTITY_TYPES = new Set(["LINE", "ARC", "CIRCLE", "INSERT"]);
const ROUNDED_CODES = new Set(["10", "20", "30", "11", "21", "31", "40", "41", "42", "43", "50", "51"]);
const ALLOWED_PRIMARY_LAYERS = new Set(["L", "R", "T", "B", "TL", "TR", "BL", "BR", "A"]);

function splitPairs(text) {
  const normalized = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  const pairs = [];
  for (let i = 0; i < lines.length; i += 2) {
    const code = lines[i];
    if (code === undefined || code === "") continue;
    const value = lines[i + 1] === undefined ? "" : lines[i + 1];
    pairs.push({
      code: String(code).trim(),
      value: String(value),
      lineStart: i + 1,
      lineEnd: i + 2
    });
  }
  return pairs;
}

function pairsToText(pairs) {
  return (Array.isArray(pairs) ? pairs : [])
    .map((pair) => `${pair.code}\n${pair.value}`)
    .join("\n")
    .concat("\n");
}

function clonePairs(pairs) {
  return (Array.isArray(pairs) ? pairs : []).map((pair) => ({
    code: String(pair.code),
    value: String(pair.value),
    lineStart: pair.lineStart,
    lineEnd: pair.lineEnd
  }));
}

function pairValue(entity, code, fallback = "") {
  const found = (entity.pairs || []).find((pair) => pair.code === String(code));
  return found ? found.value : fallback;
}

function setPairValue(entity, code, value) {
  const codeText = String(code);
  const nextValue = String(value);
  const pairs = entity.pairs || [];
  const idx = pairs.findIndex((pair) => pair.code === codeText);
  if (idx >= 0) {
    pairs[idx] = { code: codeText, value: nextValue };
    return;
  }
  pairs.splice(1, 0, { code: codeText, value: nextValue });
}

function roundEntityPairs(entity) {
  const next = clonePairs(entity.pairs);
  return next.map((pair) => {
    if (!ROUNDED_CODES.has(pair.code)) return pair;
    const num = Number(pair.value);
    if (!Number.isFinite(num)) return pair;
    return {
      code: pair.code,
      value: String(roundNumber(num, 3))
    };
  });
}

function parseEntity(pairs, context) {
  const type = String(pairs[0]?.value || "").trim().toUpperCase();
  const entity = {
    id: `${context.prefix}_${context.nextId()}`,
    type,
    pairs: clonePairs(pairs),
    preComments: clonePairs(context.preComments),
    section: context.section,
    blockName: context.blockName || null,
    source: {
      line_start: Number(pairs[0]?.lineStart || 0),
      line_end: Number(pairs[pairs.length - 1]?.lineEnd || 0)
    }
  };
  context.preComments.length = 0;
  return entity;
}

function parseDocument(text) {
  const pairs = splitPairs(text);
  const document = {
    sections: [],
    blocks: [],
    entities: []
  };

  let i = 0;
  let entityCounter = 0;
  const nextId = () => {
    entityCounter += 1;
    return entityCounter;
  };

  while (i < pairs.length) {
    const pair = pairs[i];
    if (pair.code === "0" && String(pair.value).trim().toUpperCase() === "SECTION") {
      const namePair = pairs[i + 1];
      const sectionName = String(namePair?.value || "").trim().toUpperCase();
      i += 2;

      if (sectionName === "BLOCKS") {
        const parsed = parseBlocksSection(pairs, i, nextId);
        document.sections.push({ name: "BLOCKS" });
        document.blocks = parsed.blocks;
        i = parsed.nextIndex;
        continue;
      }

      if (sectionName === "ENTITIES") {
        const parsed = parseEntitiesSection(pairs, i, nextId, "ENTITIES");
        document.sections.push({ name: "ENTITIES" });
        document.entities = parsed.entities;
        i = parsed.nextIndex;
        continue;
      }

      const rawPairs = [];
      while (i < pairs.length) {
        const current = pairs[i];
        if (current.code === "0" && String(current.value).trim().toUpperCase() === "ENDSEC") {
          i += 1;
          break;
        }
        rawPairs.push(current);
        i += 1;
      }
      document.sections.push({ name: sectionName, rawPairs: clonePairs(rawPairs) });
      continue;
    }

    if (pair.code === "0" && String(pair.value).trim().toUpperCase() === "EOF") {
      break;
    }
    i += 1;
  }

  return document;
}

function parseBlocksSection(pairs, startIndex, nextId) {
  const blocks = [];
  let i = startIndex;
  while (i < pairs.length) {
    const pair = pairs[i];
    const value = String(pair.value).trim().toUpperCase();
    if (pair.code === "0" && value === "ENDSEC") {
      return { blocks, nextIndex: i + 1 };
    }
    if (pair.code === "0" && value === "BLOCK") {
      const block = {
        headerPairs: [{ code: "0", value: "BLOCK" }],
        entities: [],
        endblkPairs: [{ code: "0", value: "ENDBLK" }],
        source: {
          line_start: Number(pair.lineStart || 0),
          line_end: Number(pair.lineEnd || 0)
        }
      };
      i += 1;
      while (i < pairs.length) {
        const current = pairs[i];
        if (current.code === "0") {
          const currentValue = String(current.value).trim().toUpperCase();
          if (currentValue === "ENDBLK") {
            block.name = pairValue({ pairs: block.headerPairs }, "2", "");
            block.source.line_end = Number(current.lineEnd || current.lineStart || block.source.line_end || 0);
            i += 1;
            break;
          }
          const parsed = parseEntity(readEntityPairs(pairs, i), {
            prefix: "blk",
            nextId,
            preComments: [],
            section: "BLOCKS",
            blockName: pairValue({ pairs: block.headerPairs }, "2", "")
          });
          parsed.pairs = roundEntityPairs(parsed);
          block.entities.push(parsed);
          i += parsed.pairs.length;
          continue;
        }
        block.headerPairs.push({ code: current.code, value: current.value });
        i += 1;
      }
      blocks.push(block);
      continue;
    }
    i += 1;
  }
  return { blocks, nextIndex: i };
}

function parseEntitiesSection(pairs, startIndex, nextId, sectionName) {
  const entities = [];
  const preComments = [];
  let i = startIndex;

  while (i < pairs.length) {
    const pair = pairs[i];
    const value = String(pair.value).trim().toUpperCase();
    if (pair.code === "0" && value === "ENDSEC") {
      return { entities, nextIndex: i + 1 };
    }
    if (pair.code === "999") {
      preComments.push({ code: pair.code, value: pair.value });
      i += 1;
      continue;
    }
    if (pair.code === "0") {
      const rawPairs = readEntityPairs(pairs, i);
      const entity = parseEntity(rawPairs, {
        prefix: "ent",
        nextId,
        preComments,
        section: sectionName
      });
      entity.pairs = roundEntityPairs(entity);
      entities.push(entity);
      i += rawPairs.length;
      continue;
    }
    i += 1;
  }

  return { entities, nextIndex: i };
}

function readEntityPairs(pairs, startIndex) {
  const out = [];
  let i = startIndex;
  while (i < pairs.length) {
    const current = pairs[i];
    if (i > startIndex && current.code === "0") break;
    if (i > startIndex && current.code === "999") break;
    out.push({
      code: current.code,
      value: current.value,
      lineStart: current.lineStart,
      lineEnd: current.lineEnd
    });
    i += 1;
  }
  return out;
}

function sanitizeEntity(entity) {
  if (!entity || !SCOPED_ENTITY_TYPES.has(String(entity.type || "").toUpperCase())) {
    return null;
  }
  const next = {
    ...entity,
    preComments: [],
    pairs: roundEntityPairs({
      pairs: clonePairs(entity.pairs)
        .filter((pair) => String(pair.code) !== "999")
        .map((pair) => ({
          code: String(pair.code),
          value: String(pair.value)
        }))
    })
  };
  setPairValue(next, "8", "0");
  return next;
}

function sanitizeBlock(block) {
  if (!block) return null;
  const entities = (Array.isArray(block.entities) ? block.entities : [])
    .map(sanitizeEntity)
    .filter(Boolean);
  return {
    ...block,
    headerPairs: clonePairs(block.headerPairs)
      .filter((pair) => String(pair.code) !== "999")
      .map((pair) => ({
        code: String(pair.code),
        value: String(pair.value)
      })),
    entities,
    endblkPairs: clonePairs(block.endblkPairs || [{ code: "0", value: "ENDBLK" }])
      .filter((pair) => String(pair.code) !== "999")
      .map((pair) => ({
        code: String(pair.code),
        value: String(pair.value)
      }))
  };
}

function sanitizeDocument(rawText) {
  const parsed = parseDocument(rawText);
  return {
    sections: [
      { name: "BLOCKS" },
      { name: "ENTITIES" }
    ],
    blocks: (Array.isArray(parsed.blocks) ? parsed.blocks : [])
      .map(sanitizeBlock)
      .filter(Boolean),
    entities: (Array.isArray(parsed.entities) ? parsed.entities : [])
      .map(sanitizeEntity)
      .filter(Boolean)
  };
}

function assignPairLineNumbers(pairs, lineCursor) {
  const nextPairs = (Array.isArray(pairs) ? pairs : []).map((pair) => {
    const nextPair = {
      code: String(pair.code),
      value: String(pair.value),
      lineStart: lineCursor,
      lineEnd: lineCursor + 1
    };
    lineCursor += 2;
    return nextPair;
  });
  return { pairs: nextPairs, lineCursor };
}

function reindexDocumentSources(document) {
  if (!document || typeof document !== "object") return document;
  let lineCursor = 1;

  lineCursor += 4;

  for (const block of document.blocks || []) {
    const headerResult = assignPairLineNumbers(block.headerPairs || [], lineCursor);
    block.headerPairs = headerResult.pairs;
    const blockLineStart = block.headerPairs[0]?.lineStart || lineCursor;
    lineCursor = headerResult.lineCursor;

    for (const entity of block.entities || []) {
      const commentResult = assignPairLineNumbers(entity.preComments || [], lineCursor);
      entity.preComments = commentResult.pairs;
      lineCursor = commentResult.lineCursor;

      const pairResult = assignPairLineNumbers(entity.pairs || [], lineCursor);
      entity.pairs = pairResult.pairs;
      entity.source = {
        line_start: entity.preComments[0]?.lineStart || entity.pairs[0]?.lineStart || 0,
        line_end: entity.pairs[entity.pairs.length - 1]?.lineEnd || entity.preComments[entity.preComments.length - 1]?.lineEnd || 0
      };
      lineCursor = pairResult.lineCursor;
    }

    const endblkResult = assignPairLineNumbers(block.endblkPairs || [{ code: "0", value: "ENDBLK" }], lineCursor);
    block.endblkPairs = endblkResult.pairs;
    block.source = {
      line_start: blockLineStart,
      line_end: block.endblkPairs[block.endblkPairs.length - 1]?.lineEnd || blockLineStart
    };
    lineCursor = endblkResult.lineCursor;
  }

  lineCursor += 4;

  for (const entity of document.entities || []) {
    const commentResult = assignPairLineNumbers(entity.preComments || [], lineCursor);
    entity.preComments = commentResult.pairs;
    lineCursor = commentResult.lineCursor;

    const pairResult = assignPairLineNumbers(entity.pairs || [], lineCursor);
    entity.pairs = pairResult.pairs;
    entity.source = {
      line_start: entity.preComments[0]?.lineStart || entity.pairs[0]?.lineStart || 0,
      line_end: entity.pairs[entity.pairs.length - 1]?.lineEnd || entity.preComments[entity.preComments.length - 1]?.lineEnd || 0
    };
    lineCursor = pairResult.lineCursor;
  }

  lineCursor += 2;
  return document;
}

function serializeDocument(document) {
  const pairs = [];

  pairs.push({ code: "0", value: "SECTION" });
  pairs.push({ code: "2", value: "BLOCKS" });
  for (const block of document.blocks || []) {
    pairs.push(...clonePairs(block.headerPairs));
    for (const entity of block.entities || []) {
      pairs.push(...clonePairs(entity.preComments));
      pairs.push(...clonePairs(entity.pairs));
    }
    pairs.push(...clonePairs(block.endblkPairs || [{ code: "0", value: "ENDBLK" }]));
  }
  pairs.push({ code: "0", value: "ENDSEC" });

  pairs.push({ code: "0", value: "SECTION" });
  pairs.push({ code: "2", value: "ENTITIES" });
  for (const entity of document.entities || []) {
    pairs.push(...clonePairs(entity.preComments));
    pairs.push(...clonePairs(entity.pairs));
  }
  pairs.push({ code: "0", value: "ENDSEC" });

  pairs.push({ code: "0", value: "EOF" });
  return pairsToText(pairs);
}

function entityToPrimitive(entity, blockMap, nesting) {
  const type = String(entity?.type || "").toUpperCase();
  if (type === "LINE") {
    const x1 = Number(pairValue(entity, "10", "NaN"));
    const y1 = Number(pairValue(entity, "20", "NaN"));
    const x2 = Number(pairValue(entity, "11", "NaN"));
    const y2 = Number(pairValue(entity, "21", "NaN"));
    if (![x1, y1, x2, y2].every(Number.isFinite)) return null;
    return {
      bbox: bboxFromPoints([{ x: x1, y: y1 }, { x: x2, y: y2 }]),
      shapes: [{ kind: "line", x1, y1, x2, y2 }]
    };
  }

  if (type === "ARC") {
    const centerX = Number(pairValue(entity, "10", "NaN"));
    const centerY = Number(pairValue(entity, "20", "NaN"));
    const radius = Number(pairValue(entity, "40", "NaN"));
    const startAngle = Number(pairValue(entity, "50", "NaN"));
    const endAngle = Number(pairValue(entity, "51", "NaN"));
    if (![centerX, centerY, radius, startAngle, endAngle].every(Number.isFinite)) return null;
    return {
      bbox: bboxFromArc({ centerX, centerY, radius, startAngle, endAngle }),
      shapes: [{ kind: "arc", centerX, centerY, radius, startAngle, endAngle }]
    };
  }

  if (type === "CIRCLE") {
    const centerX = Number(pairValue(entity, "10", "NaN"));
    const centerY = Number(pairValue(entity, "20", "NaN"));
    const radius = Number(pairValue(entity, "40", "NaN"));
    if (![centerX, centerY, radius].every(Number.isFinite)) return null;
    return {
      bbox: {
        minX: centerX - radius,
        minY: centerY - radius,
        maxX: centerX + radius,
        maxY: centerY + radius
      },
      shapes: [{ kind: "circle", centerX, centerY, radius }]
    };
  }

  if (type === "INSERT") {
    if ((nesting || 0) > 3) return null;
    const blockName = pairValue(entity, "2", "");
    const block = blockMap.get(blockName);
    if (!block) return null;
    const tx = Number(pairValue(entity, "10", "0"));
    const ty = Number(pairValue(entity, "20", "0"));
    const scaleX = Number(pairValue(entity, "41", "1"));
    const scaleY = Number(pairValue(entity, "42", "1"));
    const rotationDeg = Number(pairValue(entity, "50", "0"));

    let bbox = null;
    const shapes = [];
    for (const child of block.entities || []) {
      const childPrimitive = entityToPrimitive(child, blockMap, (nesting || 0) + 1);
      if (!childPrimitive) continue;
      for (const shape of childPrimitive.shapes || []) {
        const transformed = transformShape(shape, { tx, ty, scaleX, scaleY, rotationDeg });
        shapes.push(transformed);
        bbox = bboxUnion(bbox, shapeBBox(transformed));
      }
    }
    return { bbox, shapes };
  }

  return null;
}

function shapeBBox(shape) {
  if (!shape) return null;
  if (shape.kind === "line") {
    return bboxFromPoints([{ x: shape.x1, y: shape.y1 }, { x: shape.x2, y: shape.y2 }]);
  }
  if (shape.kind === "arc") {
    return bboxFromArc(shape);
  }
  if (shape.kind === "circle") {
    return {
      minX: shape.centerX - shape.radius,
      minY: shape.centerY - shape.radius,
      maxX: shape.centerX + shape.radius,
      maxY: shape.centerY + shape.radius
    };
  }
  return null;
}

function transformShape(shape, transform) {
  if (shape.kind === "line") {
    const p1 = transformPoint({ x: shape.x1, y: shape.y1 }, transform);
    const p2 = transformPoint({ x: shape.x2, y: shape.y2 }, transform);
    return { kind: "line", x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
  }
  if (shape.kind === "circle") {
    const center = transformPoint({ x: shape.centerX, y: shape.centerY }, transform);
    const radius = Math.abs(shape.radius * Number(transform?.scaleX || 1));
    return { kind: "circle", centerX: center.x, centerY: center.y, radius };
  }
  if (shape.kind === "arc") {
    const center = transformPoint({ x: shape.centerX, y: shape.centerY }, transform);
    const radius = Math.abs(shape.radius * Number(transform?.scaleX || 1));
    return {
      kind: "arc",
      centerX: center.x,
      centerY: center.y,
      radius,
      startAngle: shape.startAngle + Number(transform?.rotationDeg || 0),
      endAngle: shape.endAngle + Number(transform?.rotationDeg || 0)
    };
  }
  return shape;
}

function buildViewPrimitives(document) {
  const blockMap = new Map((document.blocks || []).map((block) => [String(block.name || ""), block]));
  return (document.entities || []).map((entity) => {
    const primitive = entityToPrimitive(entity, blockMap, 0);
    return {
      id: entity.id,
      type: entity.type,
      layer: pairValue(entity, "8", ""),
      primitive
    };
  });
}

function listRelevantObjects(document) {
  const primitives = buildViewPrimitives(document);
  const blockMap = new Map((document.blocks || []).map((block) => [String(block.name || ""), block]));
  return primitives
    .filter((item) => SCOPED_ENTITY_TYPES.has(String(item.type || "").toUpperCase()))
    .map((item) => {
      const entity = findEntityById(document.entities, item.id);
      const blockName = item.type === "INSERT" ? pairValue(entity, "2", "") : null;
      const block = blockName ? blockMap.get(blockName) : null;
      const source = item.type === "INSERT" && block && block.source && block.source.line_start
        ? block.source
        : (entity?.source || null);

      return {
        id: item.id,
        entityId: item.id,
        type: item.type,
        bbox: item.primitive ? item.primitive.bbox : null,
        layer: item.layer || "",
        shapes: item.primitive ? item.primitive.shapes : [],
        blockName,
        source
      };
    });
}

function findEntityById(entities, entityId) {
  return (entities || []).find((entity) => entity.id === entityId) || null;
}

function applyPrimaryLayer(document, entityId, layer) {
  if (!ALLOWED_PRIMARY_LAYERS.has(String(layer || "").trim().toUpperCase())) {
    throw new Error(`Unsupported primary layer: ${layer}`);
  }
  const entity = findEntityById(document.entities, entityId);
  if (!entity) {
    throw new Error(`Unknown entity id: ${entityId}`);
  }
  setPairValue(entity, "8", String(layer).trim().toUpperCase());
}

module.exports = {
  SCOPED_ENTITY_TYPES,
  ALLOWED_PRIMARY_LAYERS,
  sanitizeDocument,
  reindexDocumentSources,
  serializeDocument,
  listRelevantObjects,
  applyPrimaryLayer,
  pairValue
};
