"use strict";

const fs = require("fs/promises");
const path = require("path");

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9+\- ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function includesAny(text, list) {
  const t = norm(text);
  for (const raw of list || []) {
    const k = norm(raw);
    if (k && t.includes(k)) return true;
  }
  return false;
}

async function readJsonArray(filePath) {
  const txt = await fs.readFile(filePath, "utf8");
  const j = JSON.parse(txt);
  if (!Array.isArray(j)) throw new Error(`Expected array in ${filePath}`);
  return j;
}

async function readJsonObject(filePath) {
  const txt = await fs.readFile(filePath, "utf8");
  const j = JSON.parse(txt);
  if (!j || typeof j !== "object" || Array.isArray(j)) throw new Error(`Expected object in ${filePath}`);
  return j;
}

function scoreFromHits(hitCount) {
  if (hitCount >= 8) return 0.95;
  if (hitCount >= 4) return 0.8;
  if (hitCount >= 2) return 0.6;
  if (hitCount >= 1) return 0.4;
  return 0.05;
}

function countHits(text, list) {
  const t = norm(text);
  let hits = 0;
  for (const raw of list || []) {
    const k = norm(raw);
    if (k && t.includes(k)) hits += 1;
  }
  return hits;
}

function countPrefixHits(text, list) {
  const t = norm(text);
  let hits = 0;
  for (const raw of list || []) {
    const k = norm(raw);
    if (k && t.includes(k)) hits += 1;
  }
  return hits;
}

function makeRowText(r) {
  return [
    r.Name,
    r.NameENG,
    r.CPVExtended,
    r.CPVExtendedENG,
    r.ContractingBody,
    r.BusinessEntityName,
    r.ReferenceNumber,
    r.ProcedureType,
    r.TypeContract
  ]
    .filter(Boolean)
    .join(" | ");
}

function isWorks(r) {
  return norm(r.TypeContract) === "radovi" || Number(r.CODECOREContractTypeId) === 1;
}

function isRiskFacility(text) {
  return includesAny(text, [
    "vrtic",
    "skola",
    "dom",
    "bolnic",
    "studentsk",
    "zatvor",
    "sportska dvorana",
    "dvorana",
    "klinika",
    "centar",
    "kuhinja",
    "blagovaonica"
  ]);
}

function matchConceptGroups(text, groups) {
  const matched = [];
  for (const [groupName, terms] of Object.entries(groups || {})) {
    if (includesAny(text, terms || [])) matched.push(groupName);
  }
  return matched;
}

function computeConceptScore({ conceptMatches, strongName, strongCpv, weakFalsePositive }) {
  let score = 0;
  if (strongName) score = Math.max(score, 0.8);
  if (strongCpv) score = Math.max(score, 0.75);
  if (conceptMatches.length >= 2) score = Math.max(score, 0.7);
  if (conceptMatches.includes("kitchen_context") && conceptMatches.length >= 2) score = Math.max(score, 0.8);
  if (conceptMatches.includes("inox_furniture") && conceptMatches.includes("kitchen_context")) score = Math.max(score, 0.75);
  if (weakFalsePositive && score > 0) score = Math.max(0.35, score - 0.1);
  return score;
}

async function scoreRows({ moduleDir, rows }) {
  const p1 = await readJsonArray(path.join(moduleDir, "keywords_p1.json"));
  const p2 = await readJsonArray(path.join(moduleDir, "keywords_p2.json"));
  const p3 = await readJsonArray(path.join(moduleDir, "keywords_p3.json"));
  const p4 = await readJsonArray(path.join(moduleDir, "keywords_p4.json"));
  const negatives = await readJsonArray(path.join(moduleDir, "stopwords_hard_negative.json"));
  const vocab = await readJsonObject(path.join(moduleDir, "layer1_vocabulary.json"));

  const scored = (rows || []).map((r) => {
    const text = makeRowText(r);
    const hardNeg = includesAny(text, negatives) || includesAny(text, vocab?.negative_groups?.hard_negatives || []);
    if (hardNeg) {
      return {
        ...r,
        _eojn: {
          discard: true,
          scores: { P1: 0, P2: 0, P3: 0, P4: 0 },
          topProgram: null,
          topScore: 0,
          candidate: false,
          layer2Candidate: false,
          reasons: ["hard_negative"]
        }
      };
    }

    const hits = {
      P1: countHits(text, p1),
      P2: countHits(text, p2),
      P3: countHits(text, p3),
      P4: countHits(text, p4)
    };

    const scores = {
      P1: scoreFromHits(hits.P1),
      P2: scoreFromHits(hits.P2),
      P3: scoreFromHits(hits.P3),
      P4: scoreFromHits(hits.P4)
    };

    const nameText = [r.Name, r.NameENG].filter(Boolean).join(" | ");
    const cpvText = [r.CPVExtended, r.CPVExtendedENG].filter(Boolean).join(" | ");
    const strongName = includesAny(nameText, vocab?.strong_signals?.name || []);
    const strongCpv = countPrefixHits(cpvText, vocab?.strong_signals?.cpv_prefix || []) > 0;
    const conceptMatches = matchConceptGroups(text, vocab?.concept_groups || {});
    const weakFalsePositive = includesAny(text, vocab?.negative_groups?.weak_false_positives || []);

    let layer2Candidate = false;
    if (isWorks(r) && isRiskFacility(text)) {
      layer2Candidate = true;
      scores.P1 = Math.max(scores.P1, 0.35);
      scores.P3 = Math.max(scores.P3, 0.3);
      scores.P4 = Math.max(scores.P4, 0.25);
    }

    scores.P1 = Math.max(scores.P1, computeConceptScore({
      conceptMatches,
      strongName,
      strongCpv,
      weakFalsePositive
    }));

    const entries = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const topProgram = entries[0][0];
    const topScore = entries[0][1];
    const candidate = topScore >= 0.35 || layer2Candidate;
    const reasons = [];
    if (hits[topProgram] > 0) reasons.push(`keyword_hits_${topProgram}:${hits[topProgram]}`);
    if (strongName) reasons.push("strong_signal_name");
    if (strongCpv) reasons.push("strong_signal_cpv");
    if (conceptMatches.length) reasons.push(`concept_groups:${conceptMatches.join(",")}`);
    if (weakFalsePositive) reasons.push("weak_false_positive_context");
    if (layer2Candidate) reasons.push("risk_works_facility");

    return {
      ...r,
      _eojn: {
        discard: false,
        hits,
        scores,
        topProgram,
        topScore,
        candidate,
        layer2Candidate,
        reasons
      }
    };
  });

  const candidates = scored
    .filter((x) => x._eojn && x._eojn.candidate && !x._eojn.discard)
    .sort((a, b) => b._eojn.topScore - a._eojn.topScore);

  const shortlistN = Math.max(20, Math.ceil(scored.length * 0.15));
  const shortlist = candidates.slice(0, shortlistN);

  const layer2Queue = scored
    .filter((x) => x._eojn && x._eojn.candidate && !x._eojn.discard)
    .map((x) => ({
      Id: x.Id,
      ReferenceNumber: x.ReferenceNumber,
      Name: x.Name,
      BusinessEntityName: x.BusinessEntityName,
      TenderUrl: `https://eojn.hr/tender-eo/${x.Id}`,
      topProgram: x._eojn.topProgram,
      topScore: x._eojn.topScore,
      reasons: x._eojn.reasons
    }));

  return {
    scored,
    shortlist,
    layer2Queue,
    scoredCount: scored.length,
    shortlistCount: shortlist.length
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
