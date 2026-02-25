'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname);
const SETTINGS_PATH = path.join(ROOT, 'config', 'settings.json');
const OUT_DIR = path.join(ROOT, 'logs', 'timeline');

function nowIso() {
  return new Date().toISOString();
}

function safeReadJson(filePath, fallback) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(raw);
  } catch (_err) {
    return fallback;
  }
}

function parseNdjson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/).filter(Boolean);
  return lines.map((line) => JSON.parse(line));
}

function transitionReason(prevState, nextState, triggeringEvent) {
  if (!prevState) return 'initial_state';
  if (prevState === 'OK' && nextState === 'NOK') {
    if (triggeringEvent.status_code === 'LATENCY_HIGH') return 'latency_high';
    if (triggeringEvent.status_code === 'TIMEOUT') return 'signal_timeout';
    if (String(triggeringEvent.status_code || '').startsWith('HTTP_')) return 'http_error';
    return 'signal_lost';
  }
  if (prevState === 'NOK' && nextState === 'OK') return 'signal_restored';
  return 'state_continues';
}

function finalizePeriod(period, endEvent) {
  period.period_end_ts = endEvent.local_ts;
  const start = new Date(period.period_start_ts).getTime();
  const end = new Date(period.period_end_ts).getTime();
  period.duration_sec = Math.max(0, Math.round((end - start) / 1000));
  if (period.state === 'OK') {
    period.nok_primary_code = null;
  } else {
    period.worst_latency_ms = null;
  }
  return period;
}

function generateTimeline(events, nokThreshold, okThreshold) {
  if (!events.length) return [];

  let stableState = null;
  let pendingNok = 0;
  let pendingOk = 0;
  let currentPeriod = null;
  let previousEvent = null;
  const timeline = [];

  for (const event of events) {
    const baseState = event.status_class === 'OK' ? 'OK' : 'NOK';

    if (!stableState) {
      stableState = baseState;
      currentPeriod = {
        period_start_ts: event.local_ts,
        period_end_ts: event.local_ts,
        state: stableState,
        duration_sec: 0,
        transition_reason: 'initial_state',
        events_count: 1,
        worst_latency_ms: stableState === 'OK' ? (event.latency_ms ?? null) : null,
        nok_primary_code: stableState === 'NOK' ? event.status_code : null
      };
      pendingNok = stableState === 'NOK' ? 1 : 0;
      pendingOk = stableState === 'OK' ? 1 : 0;
      previousEvent = event;
      continue;
    }

    if (baseState === 'NOK') {
      pendingNok += 1;
      pendingOk = 0;
    } else {
      pendingOk += 1;
      pendingNok = 0;
    }

    let switchState = null;
    if (stableState === 'OK' && baseState === 'NOK' && pendingNok >= nokThreshold) {
      switchState = 'NOK';
    } else if (stableState === 'NOK' && baseState === 'OK' && pendingOk >= okThreshold) {
      switchState = 'OK';
    }

    if (switchState && switchState !== stableState) {
      finalizePeriod(currentPeriod, previousEvent || event);
      timeline.push(currentPeriod);

      const reason = transitionReason(stableState, switchState, event);
      stableState = switchState;
      currentPeriod = {
        period_start_ts: event.local_ts,
        period_end_ts: event.local_ts,
        state: stableState,
        duration_sec: 0,
        transition_reason: reason,
        events_count: 1,
        worst_latency_ms: stableState === 'OK' ? (event.latency_ms ?? null) : null,
        nok_primary_code: stableState === 'NOK' ? event.status_code : null
      };
      previousEvent = event;
      continue;
    }

    currentPeriod.events_count += 1;
    currentPeriod.period_end_ts = event.local_ts;
    if (currentPeriod.state === 'OK' && typeof event.latency_ms === 'number') {
      currentPeriod.worst_latency_ms = Math.max(currentPeriod.worst_latency_ms ?? event.latency_ms, event.latency_ms);
    }
    if (currentPeriod.state === 'NOK' && !currentPeriod.nok_primary_code) {
      currentPeriod.nok_primary_code = event.status_code;
    }
    previousEvent = event;
  }

  finalizePeriod(currentPeriod, events[events.length - 1]);
  timeline.push(currentPeriod);
  return timeline;
}

function writeNdjson(filePath, rows) {
  const content = rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '');
  fs.writeFileSync(filePath, content, 'utf8');
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const settings = safeReadJson(SETTINGS_PATH, null);
  if (!settings) {
    throw new Error(`Missing settings: ${SETTINGS_PATH}`);
  }

  const inputArg = process.argv[2];
  if (!inputArg) {
    throw new Error('Usage: node timeline_generator.js <raw_ndjson_file>');
  }

  const inputPath = path.resolve(ROOT, inputArg);
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`);
  }

  const events = parseNdjson(inputPath).sort((a, b) => String(a.local_ts).localeCompare(String(b.local_ts)));
  const timeline = generateTimeline(
    events,
    Number(settings.agent.nok_consecutive_threshold || 2),
    Number(settings.agent.ok_recovery_threshold || 2)
  );

  const base = path.basename(inputPath, '.ndjson');
  const outPath = path.join(OUT_DIR, `${base}_timeline.ndjson`);
  writeNdjson(outPath, timeline);

  process.stdout.write(`${nowIso()} Timeline generated: ${outPath} periods=${timeline.length}\n`);
}

main();
