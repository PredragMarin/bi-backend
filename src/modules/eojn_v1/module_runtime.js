"use strict";

const crypto = require("crypto");
const { scoreRows } = require("./layer1_score");
const { validateLayer1Request } = require("./validate_layer1_request");
const { fetchProcurementsPublic } = require("./adapters/fetch_procurements_public");
const { fetchNoticesPublic } = require("./adapters/fetch_notices_public");
const {
  defaultOutRoot,
  loadLayer1State,
  saveLayer1State,
  writeLayer1RunArtifacts,
  appendEventLog
} = require("../../core_shell/services/eojn_layer1_store");
const { ymdInTZ, TZ } = require("./adapters/public_feed_common");

function parseDateToYmd(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  return null;
}

function maxYmd(values) {
  return values.filter(Boolean).sort().slice(-1)[0] || null;
}

function stableHash(obj) {
  return crypto.createHash("sha256").update(JSON.stringify(obj || {})).digest("hex");
}

function dedupeById(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const id = Number(row && row.Id);
    if (!Number.isFinite(id)) continue;
    if (!map.has(id)) map.set(id, row);
  }
  return Array.from(map.values());
}

function buildTenderFingerprint(row) {
  return stableHash({
    Id: row.Id,
    ReferenceNumber: row.ReferenceNumber,
    Name: row.Name,
    SubmissionDeadline: row.SubmissionDeadline,
    TenderStatusId: row.TenderStatusId,
    NoticePublishDate: row.NoticePublishDate,
    EstimatedValue: row.EstimatedValue
  });
}

function resolveNoticeKey(row) {
  const explicit = row.NoticeId || row.Id || row.DocumentId || row.Guid || row.ReferenceNumber;
  if (explicit !== undefined && explicit !== null && String(explicit).trim() !== "") {
    return `N:${String(explicit).trim()}`;
  }
  return `H:${stableHash({
    TenderId: row.TenderId || row.TenderID || row.ProcurementId || null,
    NoticePublishDate: row.NoticePublishDate || row.PublishDate || null,
    Title: row.Name || row.Title || null,
    Type: row.NoticeType || row.Type || null
  })}`;
}

function markProcurementsWithState(rows, state) {
  const processed = state && state.processed_tenders ? state.processed_tenders : {};
  const out = [];
  const changedOrNew = [];

  for (const row of rows) {
    const id = Number(row.Id);
    const key = String(id);
    const fingerprint = buildTenderFingerprint(row);
    const prev = processed[key];
    const same = !!(prev && prev.last_fingerprint === fingerprint);
    const ingestStatus = same ? "SKIPPED_DUPLICATE" : "NEW_OR_CHANGED";
    const withMeta = {
      ...row,
      _eojn_ingest: {
        dedup_key: key,
        fingerprint,
        ingest_status: ingestStatus
      }
    };
    out.push(withMeta);
    if (!same) changedOrNew.push(withMeta);
  }

  return { procurementsWithStatus: out, changedOrNew };
}

function markNoticesWithState(rows, state) {
  const processed = state && state.processed_notice_keys ? state.processed_notice_keys : {};
  const seenInRun = new Set();
  const out = [];
  const newCount = { value: 0 };

  for (const row of rows || []) {
    const key = resolveNoticeKey(row);
    if (seenInRun.has(key)) continue;
    seenInRun.add(key);
    const known = !!processed[key];
    if (!known) newCount.value += 1;
    out.push({
      ...row,
      _eojn_ingest: {
        dedup_key: key,
        ingest_status: known ? "SKIPPED_DUPLICATE" : "NEW"
      }
    });
  }

  return { noticesWithStatus: out, newNoticesCount: newCount.value };
}

function updateStateFromRun({ state, procurementsRows, noticesRows, runMeta }) {
  const next = {
    ...(state || {}),
    watermarks: { ...(state && state.watermarks ? state.watermarks : {}) },
    processed_tenders: { ...(state && state.processed_tenders ? state.processed_tenders : {}) },
    processed_notice_keys: { ...(state && state.processed_notice_keys ? state.processed_notice_keys : {}) },
    last_successful_run: runMeta
  };

  const procWm = maxYmd(procurementsRows.map((r) => parseDateToYmd(r.NoticePublishDate)));
  const noticesWm = maxYmd(
    noticesRows.map((r) => parseDateToYmd(r.NoticePublishDate || r.PublishDate || r.DatePublished))
  );
  if (procWm) next.watermarks.procurements_notice_publish_date = procWm;
  if (noticesWm) next.watermarks.notices_publish_date = noticesWm;

  for (const row of procurementsRows) {
    const id = Number(row.Id);
    if (!Number.isFinite(id)) continue;
    const key = String(id);
    const prev = next.processed_tenders[key];
    next.processed_tenders[key] = {
      first_processed_at: prev ? prev.first_processed_at : runMeta.completed_at,
      last_processed_at: runMeta.completed_at,
      last_fingerprint: row._eojn_ingest && row._eojn_ingest.fingerprint
    };
  }

  for (const row of noticesRows) {
    const k = row._eojn_ingest && row._eojn_ingest.dedup_key;
    if (!k) continue;
    const prev = next.processed_notice_keys[k];
    next.processed_notice_keys[k] = {
      first_ingested_at: prev ? prev.first_ingested_at : runMeta.completed_at,
      last_ingested_at: runMeta.completed_at,
      tender_id: row.TenderId || row.TenderID || row.ProcurementId || null
    };
  }

  return next;
}

async function runLayer1(payload) {
  const req = validateLayer1Request(payload);
  const runDateYmd = req.run_date_ymd || ymdInTZ(new Date(), TZ);
  const outRoot = req.out_root || defaultOutRoot();
  const startedAt = new Date().toISOString();

  const state = await loadLayer1State({ outRoot });
  const procurementsWatermark = state?.watermarks?.procurements_notice_publish_date || null;
  const noticesWatermark = state?.watermarks?.notices_publish_date || null;
  const noticesFromYmd =
    noticesWatermark || (req.mode === "bootstrap" ? "2000-01-01" : runDateYmd);

  const procurementsFeed = await fetchProcurementsPublic({
    mode: req.mode,
    watermarkYmd: procurementsWatermark,
    runDateYmd
  });
  const noticesFeed = await fetchNoticesPublic({
    watermarkYmd: noticesFromYmd,
    runDateYmd
  });

  const uniqueProcurements = dedupeById(procurementsFeed.rows);
  const procurementsMarked = markProcurementsWithState(uniqueProcurements, state);
  const noticesMarked = markNoticesWithState(noticesFeed.rows, state);

  const scoreResult = await scoreRows({
    moduleDir: __dirname,
    rows: procurementsMarked.changedOrNew
  });

  const completedAt = new Date().toISOString();
  const runMeta = {
    mode: req.mode,
    run_date_ymd: runDateYmd,
    started_at: startedAt,
    completed_at: completedAt,
    timezone: TZ,
    counts: {
      procurements_total: procurementsMarked.procurementsWithStatus.length,
      procurements_changed_or_new: procurementsMarked.changedOrNew.length,
      notices_total: noticesMarked.noticesWithStatus.length,
      notices_new: noticesMarked.newNoticesCount,
      scored: scoreResult.scoredCount,
      shortlist: scoreResult.shortlistCount,
      layer2_queue: scoreResult.layer2Queue.length
    }
  };

  const manifest = {
    module: "eojn_v1",
    phase: "EOJN-1",
    created_at: completedAt,
    run: runMeta,
    filters: {
      procurements: procurementsFeed.filter_expr,
      notices: noticesFeed.filter_expr
    },
    sources: {
      procurements: procurementsFeed.source,
      notices: noticesFeed.source
    }
  };

  if (!req.dry_run) {
    const writeInfo = await writeLayer1RunArtifacts({
      outRoot,
      runDateYmd,
      procurementsRows: procurementsMarked.procurementsWithStatus,
      noticesRows: noticesMarked.noticesWithStatus,
      scoredRows: scoreResult.scored,
      shortlistRows: scoreResult.shortlist,
      layer2QueueRows: scoreResult.layer2Queue,
      manifest
    });
    await appendEventLog({
      outDir: writeInfo.outDir,
      event: { ts: completedAt, type: "LAYER1_RUN_OK", run: runMeta }
    });
    const nextState = updateStateFromRun({
      state,
      procurementsRows: procurementsMarked.procurementsWithStatus,
      noticesRows: noticesMarked.noticesWithStatus,
      runMeta
    });
    await saveLayer1State({ outRoot, state: nextState });
    return {
      ok: true,
      run: runMeta,
      out_dir: writeInfo.outDir,
      state_watermarks: nextState.watermarks
    };
  }

  return {
    ok: true,
    dry_run: true,
    run: runMeta,
    state_watermarks: state && state.watermarks ? state.watermarks : {}
  };
}

async function getLayer1Status(input) {
  const outRoot = input && input.out_root ? String(input.out_root) : defaultOutRoot();
  const state = await loadLayer1State({ outRoot });
  return {
    use_case: "eojn_v1",
    timezone: TZ,
    out_root: outRoot,
    watermarks: state.watermarks || {},
    last_successful_run: state.last_successful_run || null,
    totals: {
      processed_tenders: Object.keys(state.processed_tenders || {}).length,
      processed_notices: Object.keys(state.processed_notice_keys || {}).length
    }
  };
}

function runCompute() {
  throw new Error("eojn_v1 runCompute is not used. Use runLayer1 orchestration.");
}

module.exports = {
  use_case: "eojn_v1",
  current_pointer_use_case: "eojn_v1",
  runCompute,
  runLayer1,
  getLayer1Status
};
