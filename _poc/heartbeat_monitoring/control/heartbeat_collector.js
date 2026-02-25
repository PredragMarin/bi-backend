'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { randomUUID } = require('crypto');

const ROOT = path.resolve(__dirname);
const SETTINGS_PATH = path.join(ROOT, 'config', 'settings.json');
const STATE_PATH = path.join(ROOT, 'state', 'run_state.json');
const RAW_DIR = path.join(ROOT, 'logs', 'raw');

function nowIso() {
  return new Date().toISOString();
}

function dayStamp(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}_${m}_${d}`;
}

function safeReadJson(filePath, fallback) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(raw);
  } catch (_err) {
    return fallback;
  }
}

function writeJsonAtomic(filePath, value) {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function classifyResult(result, thresholdMs) {
  if (result.ok && typeof result.latency_ms === 'number') {
    if (result.latency_ms <= thresholdMs) {
      return { status_class: 'OK', status_code: 'OK' };
    }
    return { status_class: 'NOK', status_code: 'LATENCY_HIGH' };
  }

  return {
    status_class: 'NOK',
    status_code: result.status_code || 'NETWORK_ERROR'
  };
}

function requestHeartbeat(urlObj, body, timeoutMs, authToken) {
  return new Promise((resolve) => {
    const isHttps = urlObj.protocol === 'https:';
    const transport = isHttps ? https : http;
    const payload = JSON.stringify(body);
    const startedAt = Date.now();

    const req = transport.request(
      {
        protocol: urlObj.protocol,
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: urlObj.pathname + (urlObj.search || ''),
        method: 'POST',
        timeout: timeoutMs,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': Buffer.byteLength(payload),
          ...(authToken ? { 'x-heartbeat-token': authToken } : {})
        }
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          const latency = Date.now() - startedAt;
          let parsed = null;
          try {
            parsed = data ? JSON.parse(data) : null;
          } catch (_err) {
            parsed = null;
          }

          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({
              ok: true,
              status_code: 'OK',
              latency_ms: latency,
              http_status: res.statusCode,
              remote_ts: parsed && parsed.server_ts ? parsed.server_ts : null,
              error_message: null
            });
            return;
          }

          const statusCode = res.statusCode >= 500 ? 'HTTP_5XX' : 'HTTP_4XX';
          resolve({
            ok: false,
            status_code: statusCode,
            latency_ms: latency,
            http_status: res.statusCode,
            remote_ts: parsed && parsed.server_ts ? parsed.server_ts : null,
            error_message: data ? data.slice(0, 500) : `HTTP ${res.statusCode}`
          });
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error('timeout'));
    });

    req.on('error', (err) => {
      let statusCode = 'NETWORK_ERROR';
      if (err && err.message === 'timeout') {
        statusCode = 'TIMEOUT';
      } else if (err && (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET')) {
        statusCode = 'CONNECTION_REFUSED';
      }

      resolve({
        ok: false,
        status_code: statusCode,
        latency_ms: null,
        http_status: null,
        remote_ts: null,
        error_message: err && err.message ? err.message : String(err)
      });
    });

    req.write(payload);
    req.end();
  });
}

function appendNdjson(filePath, row) {
  fs.appendFileSync(filePath, `${JSON.stringify(row)}\n`, 'utf8');
}

async function main() {
  ensureDir(RAW_DIR);

  const settings = safeReadJson(SETTINGS_PATH, null);
  if (!settings) {
    throw new Error(`Missing settings: ${SETTINGS_PATH}`);
  }

  const state = safeReadJson(STATE_PATH, {
    seq_no: 0,
    test_run_id: null,
    last_event_ts: null,
    last_status_class: null,
    last_latency_ms: null,
    updated_at: null
  });

  if (!state.test_run_id) {
    state.test_run_id = `run_${nowIso().replace(/[-:.TZ]/g, '').slice(0, 14)}_${randomUUID().slice(0, 8).toUpperCase()}`;
  }

  const urlObj = new URL(settings.remote.url);
  const intervalMs = Number(settings.agent.heartbeat_interval_sec) * 1000;
  const timeoutMs = Number(settings.agent.request_timeout_ms);
  const thresholdMs = Number(settings.agent.latency_threshold_ms);

  process.stdout.write(`${nowIso()} Collector start test_run_id=${state.test_run_id} target=${settings.remote.url}\n`);

  let stopped = false;
  const stop = (signal) => {
    stopped = true;
    process.stdout.write(`${nowIso()} Received ${signal}, stopping collector...\n`);
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));

  while (!stopped) {
    const seqNo = Number(state.seq_no || 0) + 1;
    const requestId = randomUUID();
    const sentTs = nowIso();

    const reqPayload = {
      request_id: requestId,
      seq_no: seqNo,
      sender_ip: settings.remote.sender_ip,
      sent_ts: sentTs,
      timeout_ms: timeoutMs,
      interval_ms: intervalMs,
      agent_version: settings.agent.agent_version,
      test_run_id: state.test_run_id
    };

    const result = await requestHeartbeat(urlObj, reqPayload, timeoutMs, settings.remote.auth_token || '');
    const baseClass = classifyResult(result, thresholdMs);

    let jitter = null;
    if (typeof result.latency_ms === 'number' && typeof state.last_latency_ms === 'number') {
      jitter = Math.abs(result.latency_ms - state.last_latency_ms);
    }

    const event = {
      local_ts: nowIso(),
      request_id: requestId,
      seq_no: seqNo,
      sender_ip: settings.remote.sender_ip,
      receiver_ip: settings.remote.receiver_ip,
      status_class: baseClass.status_class,
      status_code: baseClass.status_code,
      latency_ms: result.latency_ms,
      http_status: result.http_status,
      remote_ts: result.remote_ts,
      timeout_ms: timeoutMs,
      interval_ms: intervalMs,
      error_message: result.error_message,
      jitter_ms: jitter,
      test_run_id: state.test_run_id,
      agent_version: settings.agent.agent_version
    };

    const rawFile = path.join(RAW_DIR, `heartbeat_${dayStamp()}.ndjson`);
    appendNdjson(rawFile, event);

    state.seq_no = seqNo;
    state.last_event_ts = event.local_ts;
    state.last_status_class = event.status_class;
    if (typeof event.latency_ms === 'number') {
      state.last_latency_ms = event.latency_ms;
    }
    state.updated_at = nowIso();
    writeJsonAtomic(STATE_PATH, state);

    process.stdout.write(`${event.local_ts} seq=${seqNo} status=${event.status_class}/${event.status_code} latency_ms=${event.latency_ms ?? 'null'}\n`);

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  state.updated_at = nowIso();
  writeJsonAtomic(STATE_PATH, state);
  process.stdout.write(`${nowIso()} Collector stopped.\n`);
}

main().catch((err) => {
  process.stderr.write(`${nowIso()} FATAL ${err && err.stack ? err.stack : err}\n`);
  process.exit(1);
});
