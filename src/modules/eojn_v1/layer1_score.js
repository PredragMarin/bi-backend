'use strict';

const fs = require('fs/promises');
const path = require('path');

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[čć]/g, 'c').replace(/đ/g, 'd').replace(/š/g, 's').replace(/ž/g, 'z')
    .replace(/\s+/g, ' ')
    .trim();
}

function includesAny(text, list) {
  const t = norm(text);
  for (const raw of list) {
    const k = norm(raw);
    if (k && t.includes(k)) return true;
  }
  return false;
}

async function readJsonArray(filePath) {
  const txt = await fs.readFile(filePath, 'utf8');
  const j = JSON.parse(txt);
  if (!Array.isArray(j)) throw new Error(`Expected array in ${filePath}`);
  return j;
}

function scoreFromHits(hitCount) {
  // jednostavna skala; kasnije možete kalibrirati
  if (hitCount >= 8) return 0.95;
  if (hitCount >= 4) return 0.80;
  if (hitCount >= 2) return 0.60;
  if (hitCount >= 1) return 0.40;
  return 0.05;
}

function countHits(text, list) {
  const t = norm(text);
  let hits = 0;
  for (const raw of list) {
    const k = norm(raw);
    if (k && t.includes(k)) hits++;
  }
  return hits;
}

function makeRowText(r) {
  return [
    r.Name, r.NameENG, r.CPVExtended, r.CPVExtendedENG,
    r.ContractingBody, r.BusinessEntityName,
    r.ReferenceNumber, r.ProcedureType, r.TypeContract
  ].filter(Boolean).join(' | ');
}

function isWorks(r) {
  return norm(r.TypeContract) === 'radovi' || r.CODECOREContractTypeId === 1;
}

function isRiskFacility(text) {
  // objekti gdje “skrivena kuhinja/vrata/komora” ima smisla
  return includesAny(text, [
    'vrtic', 'škola', 'skola', 'dom', 'bolnic', 'studentsk', 'zatvor',
    'sportska dvorana', 'dvorana', 'klinika', 'centar', 'kuhinja', 'blagovaonica'
  ]);
}

async function layer1Score({ outDir, moduleDir, rows }) {
  const p1 = await readJsonArray(path.join(moduleDir, 'keywords_p1.json'));
  const p2 = await readJsonArray(path.join(moduleDir, 'keywords_p2.json'));
  const p3 = await readJsonArray(path.join(moduleDir, 'keywords_p3.json'));
  const p4 = await readJsonArray(path.join(moduleDir, 'keywords_p4.json'));
  const negatives = await readJsonArray(path.join(moduleDir, 'stopwords_hard_negative.json'));

  const scored = rows.map(r => {
    const text = makeRowText(r);

    const hardNeg = includesAny(text, negatives);
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
          reasons: ['hard_negative']
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

    // risk heuristic za slučaj 2: radovi + objekt
    let layer2Candidate = false;
    if (isWorks(r) && isRiskFacility(text)) {
      layer2Candidate = true;
      // risk minimalni “push” da uđe u shortlist
      scores.P1 = Math.max(scores.P1, 0.35);
      scores.P3 = Math.max(scores.P3, 0.30);
      scores.P4 = Math.max(scores.P4, 0.25);
    }

    const entries = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const topProgram = entries[0][0];
    const topScore = entries[0][1];
    const candidate = topScore >= 0.35 || layer2Candidate;

    const reasons = [];
    if (hits[topProgram] > 0) reasons.push(`keyword_hits_${topProgram}:${hits[topProgram]}`);
    if (layer2Candidate) reasons.push('risk_works_facility');

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

  await fs.writeFile(path.join(outDir, 'scored.json'), JSON.stringify(scored, null, 2), 'utf8');

  const candidates = scored
    .filter(x => x._eojn && x._eojn.candidate && !x._eojn.discard)
    .sort((a, b) => b._eojn.topScore - a._eojn.topScore);

  // shortlist = top 15% ili min 20
  const shortlistN = Math.max(20, Math.ceil(scored.length * 0.15));
  const shortlist = candidates.slice(0, shortlistN);

  await fs.writeFile(path.join(outDir, 'shortlist.json'), JSON.stringify(shortlist, null, 2), 'utf8');

  const layer2Queue = scored
    .filter(x => x._eojn && x._eojn.layer2Candidate)
    .map(x => ({
      Id: x.Id,
      ReferenceNumber: x.ReferenceNumber,
      Name: x.Name,
      BusinessEntityName: x.BusinessEntityName,
      TenderUrl: `https://eojn.hr/tender-eo/${x.Id}`,
      topProgram: x._eojn.topProgram,
      topScore: x._eojn.topScore,
      reasons: x._eojn.reasons
    }));

  await fs.writeFile(path.join(outDir, 'layer2_queue.json'), JSON.stringify(layer2Queue, null, 2), 'utf8');

  return {
    scoredCount: scored.length,
    shortlistCount: shortlist.length
  };
}

module.exports = { layer1Score };
