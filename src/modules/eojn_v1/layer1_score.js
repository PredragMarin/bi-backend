"use strict";

const fs = require("fs/promises");
const path = require("path");

function norm(input) {
  return String(input || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9+\- ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function readJsonObject(filePath) {
  const txt = await fs.readFile(filePath, "utf8");
  const json = JSON.parse(txt);
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    throw new Error(`Expected JSON object in ${filePath}`);
  }
  return json;
}

function collectMatches(text, list) {
  const hay = norm(text);
  const out = [];
  for (const raw of list || []) {
    const needle = norm(raw);
    if (needle && hay.includes(needle)) out.push(raw);
  }
  return out;
}

function includesAny(text, list) {
  return collectMatches(text, list).length > 0;
}

function parseCpvCode(cpvExtended) {
  const m = String(cpvExtended || "").match(/(\d{8})/);
  return m ? m[1] : "";
}

function parseCpvDivision(cpvExtended) {
  const code = parseCpvCode(cpvExtended);
  return code ? code.slice(0, 2) : "";
}

function makeNameText(row) {
  return [row.Name, row.NameENG].filter(Boolean).join(" | ");
}

function makeBodyText(row) {
  return [row.ContractingBody, row.BusinessEntityName].filter(Boolean).join(" | ");
}

function makeCpvText(row) {
  return [row.CPVExtended, row.CPVExtendedENG].filter(Boolean).join(" | ");
}

function scoreBody(row, rules) {
  const text = makeBodyText(row);
  const scores = rules && rules.scores ? rules.scores : {};
  let band = "default";
  if (includesAny(text, rules && rules.high_priority_terms)) band = "high";
  else if (includesAny(text, rules && rules.medium_priority_terms)) band = "medium";
  else if (includesAny(text, rules && rules.low_priority_terms)) band = "low";
  return {
    band,
    score: Number(scores[band] === undefined ? scores.default || 0.35 : scores[band])
  };
}

function scoreCpv(row, rules) {
  const division = parseCpvDivision(row.CPVExtended);
  const code = parseCpvCode(row.CPVExtended);
  const divisionScores = rules && rules.division_scores ? rules.division_scores : {};
  const prefixAdjustments = rules && rules.prefix_adjustments ? rules.prefix_adjustments : {};
  let score = Number(Object.prototype.hasOwnProperty.call(divisionScores, division) ? divisionScores[division] : rules.default_score || 0.05);
  let matchedPrefix = "";
  let matchedAdjustment = 0;
  const prefixes = Object.keys(prefixAdjustments).sort((a, b) => b.length - a.length);
  for (const prefix of prefixes) {
    if (code.startsWith(prefix)) {
      matchedPrefix = prefix;
      matchedAdjustment = Number(prefixAdjustments[prefix] || 0);
      score += matchedAdjustment;
      break;
    }
  }
  return {
    division,
    code,
    matched_prefix: matchedPrefix,
    matched_adjustment: matchedAdjustment,
    score: Math.max(0, Math.min(1, Number(score.toFixed(3))))
  };
}

function scoreNegativeSemantics(row, rules) {
  const text = [makeNameText(row), makeCpvText(row), row.ProcedureType, row.TypeContract].filter(Boolean).join(" | ");
  const hardMatches = collectMatches(text, rules && rules.hard);
  const softMatches = collectMatches(text, rules && rules.soft);
  const hard = hardMatches.length > 0;
  const penalty = hard ? 1 : softMatches.length ? 0.18 : 0;
  return {
    hard,
    penalty,
    hard_matches: hardMatches,
    soft_matches: softMatches
  };
}

function pickBestSemanticClass({ text, cpvCode, classes, defaultScore, defaultId }) {
  let best = {
    id: defaultId,
    score: Number(defaultScore || 0),
    term_matches: [],
    cpv_matches: []
  };
  for (const item of classes || []) {
    const termMatches = collectMatches(text, item.terms || []);
    const cpvMatches = (item.cpv_prefixes || []).filter((prefix) => cpvCode.startsWith(String(prefix)));
    if (!termMatches.length && !cpvMatches.length) continue;
    const candidateScore = Number(item.score || 0);
    if (candidateScore > best.score) {
      best = {
        id: String(item.id || defaultId),
        score: candidateScore,
        term_matches: termMatches,
        cpv_matches: cpvMatches
      };
    }
  }
  return best;
}

function scoreContractType(row, contractTypeRules, intentId) {
  const rawType = norm(row.TypeContract);
  const typeScores = contractTypeRules && contractTypeRules.type_scores ? contractTypeRules.type_scores : {};
  const base = Number(Object.prototype.hasOwnProperty.call(typeScores, rawType) ? typeScores[rawType] : contractTypeRules.default_score || 0.3);
  const byScope = contractTypeRules && contractTypeRules.type_adjustments_by_scope ? contractTypeRules.type_adjustments_by_scope : {};
  const adjustMap = byScope[intentId] || {};
  const adjustment = Number(Object.prototype.hasOwnProperty.call(adjustMap, rawType) ? adjustMap[rawType] : 0);
  return {
    normalized_type: rawType || "unknown",
    base,
    adjustment,
    score: Math.max(0, Math.min(1, Number((base + adjustment).toFixed(3))))
  };
}

function buildReasons(parts) {
  const reasons = [];
  if (parts.cpv.division) reasons.push(`cpv_division:${parts.cpv.division}`);
  if (parts.cpv.matched_prefix) reasons.push(`cpv_prefix:${parts.cpv.matched_prefix}`);
  if (parts.body.band !== "default") reasons.push(`body_band:${parts.body.band}`);
  if (parts.domain.id !== "other") reasons.push(`domain:${parts.domain.id}`);
  if (parts.intent.id !== "generic") reasons.push(`intent:${parts.intent.id}`);
  if (parts.domain.term_matches.length) reasons.push(`domain_terms:${parts.domain.term_matches.slice(0, 4).join("|")}`);
  if (parts.intent.term_matches.length) reasons.push(`intent_terms:${parts.intent.term_matches.slice(0, 4).join("|")}`);
  if (parts.negatives.soft_matches.length) reasons.push(`soft_negative:${parts.negatives.soft_matches.slice(0, 3).join("|")}`);
  if (parts.negatives.hard) reasons.push(`hard_negative:${parts.negatives.hard_matches.slice(0, 3).join("|")}`);
  return reasons;
}

async function scoreRows({ moduleDir, rows }) {
  const cpvRules = await readJsonObject(path.join(moduleDir, "l1_cpv_rules_v1.json"));
  const contractTypeRules = await readJsonObject(path.join(moduleDir, "l1_contract_type_rules_v1.json"));
  const bodyRules = await readJsonObject(path.join(moduleDir, "l1_contracting_body_rules_v1.json"));
  const negativeRules = await readJsonObject(path.join(moduleDir, "l1_negative_semantics_v1.json"));
  const taxonomy = await readJsonObject(path.join(moduleDir, "l1_scope_taxonomy_v1.json"));
  const semanticMatrix = await readJsonObject(path.join(moduleDir, "l1_semantic_matrix_v1.json"));

  const weights = taxonomy && taxonomy.weights ? taxonomy.weights : { cpv: 0.45, body: 0.25, name: 0.3 };
  const thresholds = taxonomy && taxonomy.thresholds ? taxonomy.thresholds : { layer2: 0.68, shortlist: 0.5 };

  const scored = (rows || []).map((row) => {
    const cpvPart = scoreCpv(row, cpvRules);
    const bodyPart = scoreBody(row, bodyRules);
    const negativePart = scoreNegativeSemantics(row, negativeRules);
    const semanticText = [makeNameText(row), makeCpvText(row), row.ProcedureType].filter(Boolean).join(" | ");
    const cpvCode = cpvPart.code;

    const domainPart = pickBestSemanticClass({
      text: semanticText,
      cpvCode,
      classes: semanticMatrix.domains,
      defaultScore: semanticMatrix.default_domain_score || 0.2,
      defaultId: "other"
    });

    const intentPart = pickBestSemanticClass({
      text: semanticText,
      cpvCode,
      classes: semanticMatrix.intents,
      defaultScore: semanticMatrix.default_intent_score || 0.25,
      defaultId: "generic"
    });

    const pairKey = `${domainPart.id}:${intentPart.id}`;
    const businessFit = Number(
      Object.prototype.hasOwnProperty.call(semanticMatrix.business_fit || {}, pairKey)
        ? semanticMatrix.business_fit[pairKey]
        : semanticMatrix.default_business_fit || 0.2
    );
    const allowedL2 = Array.isArray(semanticMatrix.allowed_l2_pairs) && semanticMatrix.allowed_l2_pairs.includes(pairKey);
    const contractTypePart = scoreContractType(row, contractTypeRules, intentPart.id);

    let nameScore = Math.max(domainPart.score, intentPart.score * 0.9);
    if (businessFit >= 0.8) nameScore = Math.max(nameScore, 0.8);

    let finalScore =
      (Number(weights.cpv || 0.45) * cpvPart.score) +
      (Number(weights.body || 0.25) * bodyPart.score) +
      (Number(weights.name || 0.3) * nameScore);

    finalScore += (contractTypePart.score - 0.3) * 0.15;
    finalScore = finalScore * businessFit;
    finalScore -= negativePart.penalty;
    finalScore = Math.max(0, Math.min(1, Number(finalScore.toFixed(3))));

    const hardRejected = negativePart.hard;
    const candidate = !hardRejected && finalScore >= Number(thresholds.layer2 || 0.5);
    const shortlist = !hardRejected && (finalScore >= Number(thresholds.shortlist || 0.5) || (businessFit >= 0.75 && cpvPart.score >= 0.6));
    const reasons = buildReasons({
      cpv: cpvPart,
      body: bodyPart,
      domain: domainPart,
      intent: intentPart,
      negatives: negativePart
    });

    return {
      ...row,
      _eojn: {
        discard: hardRejected,
        topProgram: ["kitchen", "inox_fitout"].includes(domainPart.id) ? "P1" : "P2",
        topScore: finalScore,
        candidate,
        shortlist,
        layer2Candidate: candidate,
        reasons,
        scope_class: `${domainPart.id}:${intentPart.id}`,
        cpv_division: cpvPart.division,
        negative_flags: {
          hard: negativePart.hard_matches,
          soft: negativePart.soft_matches
        },
        score_breakdown: {
          cpv: cpvPart.score,
          body: bodyPart.score,
          name: Number(nameScore.toFixed(3)),
          contract_type: contractTypePart.score,
          business_fit: businessFit,
          negative_penalty: negativePart.penalty,
          final: finalScore
        },
        semantic: {
          domain: domainPart,
          intent: intentPart,
          allowed_l2: allowedL2
        }
      }
    };
  });

  const shortlisted = scored
    .filter((x) => x._eojn && x._eojn.shortlist && !x._eojn.discard)
    .sort((a, b) => b._eojn.topScore - a._eojn.topScore);

  const layer2Queue = scored
    .filter((x) => x._eojn && x._eojn.candidate && !x._eojn.discard)
    .sort((a, b) => b._eojn.topScore - a._eojn.topScore)
    .map((x) => ({
      Id: x.Id,
      ReferenceNumber: x.ReferenceNumber,
      Name: x.Name,
      NoticePublishDate: x.NoticePublishDate || "",
      BusinessEntityName: x.BusinessEntityName,
      TenderUrl: `https://eojn.hr/tender-eo/${x.Id}`,
      topProgram: x._eojn.topProgram,
      topScore: x._eojn.topScore,
      reasons: x._eojn.reasons,
      scope_class: x._eojn.scope_class,
      score_breakdown: x._eojn.score_breakdown,
      cpv_division: x._eojn.cpv_division
    }));

  return {
    scored,
    shortlist: shortlisted,
    layer2Queue,
    scoredCount: scored.length,
    shortlistCount: shortlisted.length
  };
}

async function layer1Score({ outDir, moduleDir, rows }) {
  const result = await scoreRows({ moduleDir, rows });
  await fs.writeFile(path.join(outDir, "scored.json"), JSON.stringify(result.scored, null, 2), "utf8");
  await fs.writeFile(path.join(outDir, "shortlist.json"), JSON.stringify(result.shortlist, null, 2), "utf8");
  await fs.writeFile(path.join(outDir, "layer2_queue.json"), JSON.stringify(result.layer2Queue, null, 2), "utf8");
  return {
    scoredCount: result.scoredCount,
    shortlistCount: result.shortlistCount
  };
}

module.exports = {
  scoreRows,
  layer1Score
};
