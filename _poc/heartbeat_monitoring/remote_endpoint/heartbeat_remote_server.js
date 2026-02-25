'use strict';

/**
 * Heartbeat Remote Endpoint (POC)
 * Host target: 192.168.100.93
 *
 * Start:
 *   node heartbeat_remote_server.js
 *
 * Optional env vars:
 *   HB_HOST=0.0.0.0
 *   HB_PORT=8080
 *   HB_ALLOWED_SENDER=192.168.100.18
 *   HB_AUTH_TOKEN=your_token_here
 *   HB_HOST_ID=remote-93
 *   HB_ENDPOINT_VERSION=1.0.0
 */

const http = require('http');
const { randomUUID } = require('crypto');

const HOST = process.env.HB_HOST || '0.0.0.0';
const PORT = Number(process.env.HB_PORT || 8080);
const ALLOWED_SENDER = process.env.HB_ALLOWED_SENDER || '192.168.100.18';
const AUTH_TOKEN = process.env.HB_AUTH_TOKEN || '';
const HOST_ID = process.env.HB_HOST_ID || 'remote-93';
const ENDPOINT_VERSION = process.env.HB_ENDPOINT_VERSION || '1.0.0';

const startedAtMs = Date.now();

function nowIso() {
  return new Date().toISOString();
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const source = (raw || req.socket.remoteAddress || '').split(',')[0].trim();

  if (source.startsWith('::ffff:')) return source.slice(7);
  if (source === '::1') return '127.0.0.1';
  return source;
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1024 * 32) {
        reject(new Error('payload_too_large'));
      }
    });
    req.on('end', () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch (_err) {
        reject(new Error('invalid_json'));
      }
    });
    req.on('error', reject);
  });
}

function validateRequestShape(payload) {
  const required = ['request_id', 'seq_no', 'sender_ip', 'sent_ts', 'timeout_ms', 'interval_ms'];
  const missing = required.filter((key) => payload[key] === undefined || payload[key] === null || payload[key] === '');
  return {
    ok: missing.length === 0,
    missing
  };
}

const server = http.createServer(async (req, res) => {
  const reqStart = Date.now();
  const requestTag = randomUUID();

  if (req.url === '/healthz' && req.method === 'GET') {
    sendJson(res, 200, {
      status: 'OK',
      server_ts: nowIso(),
      endpoint_version: ENDPOINT_VERSION,
      host_id: HOST_ID
    });
    return;
  }

  if (req.url !== '/heartbeat' || !['GET', 'POST'].includes(req.method)) {
    sendJson(res, 404, {
      status: 'NOT_FOUND',
      server_ts: nowIso(),
      message: 'Use GET/POST /heartbeat'
    });
    return;
  }

  const clientIp = getClientIp(req);

  if (ALLOWED_SENDER && clientIp !== ALLOWED_SENDER && clientIp !== '127.0.0.1') {
    sendJson(res, 403, {
      status: 'FORBIDDEN',
      server_ts: nowIso(),
      message: `sender_not_allowed:${clientIp}`
    });
    return;
  }

  if (AUTH_TOKEN) {
    const token = req.headers['x-heartbeat-token'];
    if (token !== AUTH_TOKEN) {
      sendJson(res, 401, {
        status: 'UNAUTHORIZED',
        server_ts: nowIso(),
        message: 'invalid_token'
      });
      return;
    }
  }

  try {
    const payload = req.method === 'POST' ? await readJsonBody(req) : {};

    if (req.method === 'POST') {
      const reqShape = validateRequestShape(payload);
      if (!reqShape.ok) {
        sendJson(res, 400, {
          status: 'BAD_REQUEST',
          server_ts: nowIso(),
          message: `missing_fields:${reqShape.missing.join(',')}`
        });
        return;
      }
    }

    sendJson(res, 200, {
      status: 'OK',
      server_ts: nowIso(),
      receiver_ip: '192.168.100.93',
      uptime_sec: Math.floor((Date.now() - startedAtMs) / 1000),
      endpoint_version: ENDPOINT_VERSION,
      host_id: HOST_ID,
      echo: {
        request_id: payload.request_id || null,
        seq_no: payload.seq_no ?? null,
        sender_ip: payload.sender_ip || clientIp || null,
        sent_ts: payload.sent_ts || null,
        timeout_ms: payload.timeout_ms ?? null,
        interval_ms: payload.interval_ms ?? null
      }
    });

    const duration = Date.now() - reqStart;
    process.stdout.write(`${nowIso()} ${requestTag} OK method=${req.method} ip=${clientIp} duration_ms=${duration}\n`);
  } catch (err) {
    const duration = Date.now() - reqStart;
    sendJson(res, 400, {
      status: 'BAD_REQUEST',
      server_ts: nowIso(),
      message: err.message
    });
    process.stdout.write(`${nowIso()} ${requestTag} ERROR method=${req.method} ip=${clientIp} duration_ms=${duration} error=${err.message}\n`);
  }
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`${nowIso()} Heartbeat remote endpoint listening on http://${HOST}:${PORT}\n`);
  process.stdout.write(`${nowIso()} Allowed sender: ${ALLOWED_SENDER || '(disabled)'}\n`);
  process.stdout.write(`${nowIso()} Auth token required: ${AUTH_TOKEN ? 'yes' : 'no'}\n`);
});

function shutdown(signal) {
  process.stdout.write(`${nowIso()} Received ${signal}, shutting down...\n`);
  server.close(() => process.exit(0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
