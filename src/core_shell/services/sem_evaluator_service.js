"use strict";

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
      expected: "[" + expectedValues.join(",") + "]",
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
    ? raw.split(new RegExp("\\s+" + logicalOperator + "\\s+", "i"))
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
        message: "Invalid SEM pair: " + pair
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
        message: "SEM value for key " + key + " is empty."
      });
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(keys, key)) {
      errors.push({
        code: "DUPLICATE_SEM_KEY",
        message: "Duplicate SEM key: " + key
      });
      continue;
    }
    keys[key] = value;
  }

  const when_expression = keys.when ? parseWhenExpression(keys.when) : null;
  if (keys.when && !when_expression) {
    errors.push({
      code: "INVALID_SEM_WHEN",
      message: "Invalid SEM when expression: " + keys.when
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
          ? "condition_matched:" + conditionalParamName
          : "condition_not_matched:" + conditionalParamName,
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
      ? (evaluations.length > 1 ? "presence_records_matched:" + evaluations.length : String(firstDetailed?.visibility_reason || "presence_matched"))
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

function evaluateChildEntityInclusion(object, semContext) {
  const parameters = semContext && semContext.parameters && typeof semContext.parameters === "object"
    ? semContext.parameters
    : semContext;
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

module.exports = {
  parseWhenExpression,
  parseSemanticComment,
  evaluatePresenceInstruction,
  evaluateVariantInstruction,
  evaluateChildEntityInclusion
};
