'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname);
const AGG_DIR = path.join(ROOT, 'logs', 'aggregate');

function nowIso() {
  return new Date().toISOString();
}

function parseNdjson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/).filter(Boolean);
  return lines.map((line) => JSON.parse(line));
}

function percentile(sortedValues, p) {
  if (!sortedValues.length) return null;
  if (sortedValues.length === 1) return sortedValues[0];
  const rank = (p / 100) * (sortedValues.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sortedValues[lo];
  const w = rank - lo;
  return sortedValues[lo] * (1 - w) + sortedValues[hi] * w;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function safePct(num, den) {
  if (!den) return 0;
  return (num / den) * 100;
}

function main() {
  fs.mkdirSync(AGG_DIR, { recursive: true });

  const inputArg = process.argv[2];
  if (!inputArg) {
    throw new Error('Usage: node aggregate_kpi.js <raw_ndjson_file>');
  }

  const inputPath = path.resolve(ROOT, inputArg);
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`);
  }

  const events = parseNdjson(inputPath).sort((a, b) => String(a.local_ts).localeCompare(String(b.local_ts)));
  const total = events.length;
  const okEvents = events.filter((e) => e.status_class === 'OK').length;
  const nokEvents = total - okEvents;

  const latencies = events
    .map((e) => e.latency_ms)
    .filter((v) => typeof v === 'number')
    .sort((a, b) => a - b);

  const jitters = events
    .map((e) => e.jitter_ms)
    .filter((v) => typeof v === 'number')
    .sort((a, b) => a - b);

  const byStatusCode = {};
  for (const e of events) {
    const k = e.status_code || 'UNKNOWN';
    byStatusCode[k] = (byStatusCode[k] || 0) + 1;
  }

  const summary = {
    generated_at: nowIso(),
    source_file: inputPath,
    total_events: total,
    ok_events: okEvents,
    nok_events: nokEvents,
    availability_pct: round2(safePct(okEvents, total)),
    loss_pct: round2(safePct(nokEvents, total)),
    latency_p50_ms: latencies.length ? round2(percentile(latencies, 50)) : null,
    latency_p95_ms: latencies.length ? round2(percentile(latencies, 95)) : null,
    latency_p99_ms: latencies.length ? round2(percentile(latencies, 99)) : null,
    latency_max_ms: latencies.length ? latencies[latencies.length - 1] : null,
    jitter_p95_ms: jitters.length ? round2(percentile(jitters, 95)) : null,
    status_code_breakdown: byStatusCode
  };

  const base = path.basename(inputPath, '.ndjson');
  const outPath = path.join(AGG_DIR, `${base}_kpi.json`);
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2), 'utf8');

  process.stdout.write(`${nowIso()} KPI generated: ${outPath}\n`);
}

main();
