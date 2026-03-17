"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { scoreRows } = require("./legacy/layer1_score");
const { validateLayer1Request } = require("./validate_layer1_request");
const { fetchProcurementsPublic } = require("./adapters/fetch_procurements_public");
const { fetchNoticesPublic } = require("./adapters/fetch_notices_public");
const {
  defaultOutRoot,
  loadLayer1State,
  saveLayer1State,
  loadActiveCycle,
  saveActiveCycle,
  writeLayer1RunArtifacts,
  appendEventLog,
  loadLayer1RunView,
  loadLayer1RawArtifacts,
  writeLayer1DerivedArtifacts,
  writeCanonicalArtifacts,
  ensureWorklistViewConfig,
  mergeCanonicalStateArtifacts
} = require("../../core_shell/services/eojn_layer1_store");
const {
  loadReviewState,
  getLatestReviewDecisionsByTender
} = require("../../core_shell/services/eojn_review_store");
const { ymdInTZ, TZ } = require("./adapters/public_feed_common");
const procedureTypeCatalog = require("./contracts/procedure_type_catalog.json");
const documentTypeCatalog = require("./contracts/document_type_catalog.json");
const worklistViewConfigContract = require("./contracts/worklist_view_config_contract.json");

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

function listRunDateDirs(outRoot) {
  try {
    return fs.readdirSync(outRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory() && /^\d{4}_\d{2}_\d{2}$/.test(e.name))
      .map((e) => e.name)
      .sort();
  } catch (_) {
    return [];
  }
}

async function getUnresolvedDecisionSummary(outRoot) {
  const reviewState = await loadReviewState({ outRoot });
  const decisions = reviewState && reviewState.decisions ? reviewState.decisions : {};
  const unresolved = [];
  const runs = listRunDateDirs(outRoot);
  for (const runTag of runs) {
    const runDateYmd = runTag.replace(/_/g, "-");
    const queuePath = path.join(outRoot, runTag, "layer2_queue.json");
    if (!fs.existsSync(queuePath)) continue;
    try {
      const rows = JSON.parse(fs.readFileSync(queuePath, "utf8"));
      for (const row of Array.isArray(rows) ? rows : []) {
        const tenderId = Number(row && row.Id);
        if (!Number.isFinite(tenderId)) continue;
        const key = `${runDateYmd}|${tenderId}`;
        const review = decisions[key] || null;
        if (review && String(review.decision_code || "").trim()) continue;
        unresolved.push({
          run_date_ymd: runDateYmd,
          tender_id: tenderId,
          publish_date: String(row && row.NoticePublishDate || "").trim()
        });
      }
    } catch (_) {
      // ignore malformed debug artifact and continue summary build
    }
  }

  const publishDates = unresolved.map((x) => x.publish_date).filter(Boolean).sort();
  return {
    count: unresolved.length,
    oldest_publish_date: publishDates[0] || null,
    newest_publish_date: publishDates[publishDates.length - 1] || null
  };
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

function dedupeNotices(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const key = resolveNoticeKey(row);
    if (!key) continue;
    if (!map.has(key)) map.set(key, row);
  }
  return Array.from(map.values());
}

function procedureCatalogMap() {
  return new Map((procedureTypeCatalog.items || []).map((x) => [Number(x.ProcedureTypeId), x]));
}

function documentCatalogMap() {
  return new Map((documentTypeCatalog.items || []).map((x) => [Number(x.DocumentTypeId), x]));
}

function resolveNoticeRowKey(row) {
  return String(row && row._eojn_ingest && row._eojn_ingest.dedup_key ? row._eojn_ingest.dedup_key : resolveNoticeKey(row));
}

function listLayer2ResultFiles(runDir) {
  try {
    return fs.readdirSync(runDir)
      .filter((name) => /^layer2_monitor_result_.*\.json$/i.test(name))
      .map((name) => path.join(runDir, name))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  } catch (_) {
    return [];
  }
}

function buildLayer2ResultMap(runDir) {
  const out = new Map();
  for (const file of listLayer2ResultFiles(runDir)) {
    try {
      const payload = JSON.parse(fs.readFileSync(file, "utf8"));
      const results = Array.isArray(payload && payload.results) ? payload.results : [];
      for (const r of results) {
        const tenderId = Number(r && r.tender_id);
        if (!Number.isFinite(tenderId) || out.has(tenderId)) continue;
        out.set(tenderId, r);
      }
    } catch (_) {
      // ignore malformed result file and continue with older/newer ones
    }
  }
  return out;
}

function buildNoticeHistoryRows({ noticesRows, runDateYmd }) {
  const docMap = documentCatalogMap();
  const unknownPolicy = documentTypeCatalog.unknown_type_policy || {};
  return (Array.isArray(noticesRows) ? noticesRows : []).map((row) => {
    const tenderId = Number(row && (row.TenderId || row.TenderID || row.ProcurementId));
    const docId = Number(row && row.DocumentTypeId);
    const ref = docMap.get(docId) || null;
    return {
      TenderId: Number.isFinite(tenderId) ? tenderId : null,
      NoticeKey: resolveNoticeRowKey(row),
      DocumentTypeId: Number.isFinite(docId) ? docId : null,
      DocumentTypeName: String(row && row.DocumentTypeName || "").trim(),
      PublishDate: String(row && (row.PublishDate || row.NoticePublishDate || "")).trim(),
      NoticeNumber: String(row && row.NoticeNumber || "").trim(),
      EventClass: ref ? String(ref.event_class || "") : String(unknownPolicy.default_event_class || "unknown_notice"),
      AffectsLatestState: ref ? Boolean(ref.affects_latest_state) : true,
      ModificationDescription: String(row && row.ModificationDescription || "").trim(),
      SourceRunDate: runDateYmd,
      RecordedAt: new Date().toISOString()
    };
  }).filter((row) => Number.isFinite(row.TenderId));
}

function buildReviewHistoryRows({ latestReviewByTender, tenderIds }) {
  const allowed = new Set((tenderIds || []).map((x) => String(Number(x))));
  return Object.values(latestReviewByTender || {})
    .filter((row) => allowed.has(String(Number(row && row.tender_id))))
    .map((row) => ({
      TenderId: Number(row.tender_id),
      RunDateYmd: String(row.run_date_ymd || "").trim(),
      Decision: String(row.decision_code || "").trim(),
      ReasonCode: String(row.reason_code || "").trim(),
      ReasonNote: String(row.reason_note || "").trim(),
      SavedAt: String(row.updated_at || "").trim(),
      Source: String(row.source || "").trim() || "operator_ui"
    }));
}

function buildCanonicalBaseRows({ scoredRows }) {
  return (Array.isArray(scoredRows) ? scoredRows : [])
    .filter((row) => {
      const eojn = row && row._eojn ? row._eojn : {};
      return Boolean(eojn.shortlist || eojn.candidate);
    })
    .sort((a, b) => Number((b && b._eojn && b._eojn.topScore) || 0) - Number((a && a._eojn && a._eojn.topScore) || 0));
}

function buildTenderLatestRows({
  baseRows,
  noticeHistoryRows,
  latestReviewByTender,
  latestLayer2ByTender,
  runDateYmd
}) {
  const procMap = procedureCatalogMap();
  const byTenderNotices = new Map();
  for (const row of noticeHistoryRows) {
    const key = Number(row.TenderId);
    if (!byTenderNotices.has(key)) byTenderNotices.set(key, []);
    byTenderNotices.get(key).push(row);
  }
  for (const rows of byTenderNotices.values()) {
    rows.sort((a, b) => String(a.PublishDate || "").localeCompare(String(b.PublishDate || "")));
  }

  return (Array.isArray(baseRows) ? baseRows : []).map((row) => {
    const tenderId = Number(row && row.Id);
    const notices = byTenderNotices.get(tenderId) || [];
    const latestNotice = notices.slice(-1)[0] || null;
    const firstNotice = notices[0] || null;
    const review = latestReviewByTender[String(tenderId)] || null;
    const l2 = latestLayer2ByTender.get(tenderId) || null;
    const procTypeId = Number(row && row.ProcedureTypeId);
    const procRef = procMap.get(procTypeId) || null;
    const eojn = row && row._eojn ? row._eojn : {};
    const scopeClass = String(eojn.scope_class || "").trim();
    const scopeParts = scopeClass ? scopeClass.split(":") : [];
    return {
      TenderId: tenderId,
      Reference: String(row && row.ReferenceNumber || "").trim(),
      Name: String(row && row.Name || "").trim(),
      ProcedureTypeId: Number.isFinite(procTypeId) ? procTypeId : null,
      ProcedureType: String(row && row.ProcedureType || "").trim(),
      ProcedureClass: procRef ? String(procRef.procedure_class || "") : "unknown",
      TypeContract: String(row && row.TypeContract || "").trim(),
      CPVExtended: String(row && row.CPVExtended || "").trim(),
      ContractingBody: String(row && row.ContractingBody || row.BusinessEntityName || "").trim(),
      PublishDate: String(row && row.NoticePublishDate || "").trim(),
      DueDate: String(row && (row.SubmissionDeadlineDate || row.SubmissionDeadline || "")).trim(),
      EstimatedValue: row && row.EstimatedValue !== undefined ? Number(row.EstimatedValue || 0) : null,
      CurrencyCode: String(row && row.CurrencyCode || "").trim(),
      NutsCode: String(row && row.NutsCode || "").trim(),
      L1Status: eojn.shortlist ? "SHORTLISTED" : "SCORED",
      L1Score: Number(eojn.topScore || 0),
      L1TopProgram: String(eojn.topProgram || "").trim(),
      L1ScopeClass: scopeClass,
      L1IntentClass: scopeParts.length > 1 ? String(scopeParts[1] || "").trim() : "",
      L2Status: l2 ? String(l2.status || "").trim() : "PENDING",
      L2Label: l2 ? String(l2.label || "").trim() : "",
      L2Incidence: l2 ? Number(l2.incidence || 0) : null,
      L2ItemCount: l2 ? Number(l2.total_items || 0) : null,
      L2HitItems: l2 ? Number(l2.hit_items || 0) : null,
      L2Intensity: l2 && l2.hit_items ? Number(((Number(l2.total_keyword_hits || 0)) / Number(l2.hit_items || 1)).toFixed(4)) : null,
      L2MaxSheet: l2 ? String(l2.max_sheet || "").trim() : "",
      Decision: review ? String(review.decision_code || "").trim() : "",
      ReasonCode: review ? String(review.reason_code || "").trim() : "",
      DecisionUpdatedAt: review ? String(review.updated_at || "").trim() : "",
      LifecycleGate: l2 ? String(l2.watchlist_gate || "").trim() : "",
      WatchFlag: review ? String(review.decision_code || "").trim() === "WATCH" : false,
      AlertFlag: false,
      FirstSeenAt: firstNotice ? String(firstNotice.PublishDate || "").trim() : String(row && row.NoticePublishDate || "").trim(),
      LastSeenAt: latestNotice ? String(latestNotice.PublishDate || "").trim() : String(row && row.NoticePublishDate || "").trim(),
      LastNoticeTypeId: latestNotice ? Number(latestNotice.DocumentTypeId || 0) : null,
      LastNoticeTypeName: latestNotice ? String(latestNotice.DocumentTypeName || "").trim() : "",
      LastNoticePublishedAt: latestNotice ? String(latestNotice.PublishDate || "").trim() : "",
      UpdatedAt: new Date().toISOString(),
      SourceRunDate: runDateYmd
    };
  });
}

async function buildCanonicalArtifacts({
  outRoot,
  outDir,
  runDateYmd,
  scoredRows,
  noticesRows
}) {
  const latestReviewByTender = await getLatestReviewDecisionsByTender({ outRoot });
  const latestLayer2ByTender = buildLayer2ResultMap(outDir);
  const baseRows = buildCanonicalBaseRows({ scoredRows });
  const tenderIds = baseRows.map((row) => Number(row && row.Id)).filter(Number.isFinite);
  const tenderNoticeHistoryRows = buildNoticeHistoryRows({ noticesRows, runDateYmd })
    .filter((row) => tenderIds.includes(Number(row.TenderId)));
  const reviewDecisionHistoryRows = buildReviewHistoryRows({ latestReviewByTender, tenderIds });
  const tenderLatestRows = buildTenderLatestRows({
    baseRows,
    noticeHistoryRows: tenderNoticeHistoryRows,
    latestReviewByTender,
    latestLayer2ByTender,
    runDateYmd
  });
  return {
    tenderLatestRows,
    tenderNoticeHistoryRows,
    reviewDecisionHistoryRows
  };
}

async function ensureDefaultWorklistConfig(outRoot) {
  const recommended = worklistViewConfigContract.recommended_defaults || {};
  return ensureWorklistViewConfig({
    outRoot,
    config: {
      ...recommended,
      notes: "Editable default worklist/watchlist column visibility and ordering for EOJN canonical worklist."
    }
  });
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
  const uniqueNotices = dedupeNotices(noticesFeed.rows);
  const procurementsMarked = markProcurementsWithState(uniqueProcurements, state);
  const noticesMarked = markNoticesWithState(uniqueNotices, state);

  const scoreResult = await scoreRows({
    moduleDir: __dirname,
    rows: procurementsMarked.procurementsWithStatus
  });

  const completedAt = new Date().toISOString();
  const runMeta = {
    mode: req.mode,
    run_date_ymd: runDateYmd,
    started_at: startedAt,
    completed_at: completedAt,
    timezone: TZ,
    counts: {
      procurements_fetched: Array.isArray(procurementsFeed.rows) ? procurementsFeed.rows.length : 0,
      procurements_unique: uniqueProcurements.length,
      procurements_total: procurementsMarked.procurementsWithStatus.length,
      procurements_changed_or_new: procurementsMarked.changedOrNew.length,
      notices_fetched: Array.isArray(noticesFeed.rows) ? noticesFeed.rows.length : 0,
      notices_unique: uniqueNotices.length,
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
    const canonical = await buildCanonicalArtifacts({
      outRoot,
      outDir: writeInfo.outDir,
      runDateYmd,
      scoredRows: scoreResult.scored,
      noticesRows: noticesMarked.noticesWithStatus
    });
    await writeCanonicalArtifacts({
      outRoot,
      runDateYmd,
      tenderLatestRows: canonical.tenderLatestRows,
      tenderNoticeHistoryRows: canonical.tenderNoticeHistoryRows,
      reviewDecisionHistoryRows: canonical.reviewDecisionHistoryRows
    });
    await mergeCanonicalStateArtifacts({
      outRoot,
      tenderLatestRows: canonical.tenderLatestRows,
      tenderNoticeHistoryRows: canonical.tenderNoticeHistoryRows,
      reviewDecisionHistoryRows: canonical.reviewDecisionHistoryRows
    });
    await ensureDefaultWorklistConfig(outRoot);
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
    await saveActiveCycle({
      outRoot,
      activeCycle: {
        cycle_id: runMeta.completed_at,
        run_date_ymd: runDateYmd,
        out_dir: writeInfo.outDir,
        layer1_run: runMeta
      }
    });
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
  const activeCycle = await loadActiveCycle({ outRoot });
  const unresolved = await getUnresolvedDecisionSummary(outRoot);
  return {
    use_case: "eojn_v1",
    timezone: TZ,
    out_root: outRoot,
    watermarks: state.watermarks || {},
    last_successful_run: state.last_successful_run || null,
    summary: {
      last_successful_ingest: state.last_successful_run || null,
      current_watermarks: state.watermarks || {},
      unresolved_decision_count: unresolved.count,
      unresolved_oldest_publish_date: unresolved.oldest_publish_date,
      unresolved_newest_publish_date: unresolved.newest_publish_date
    },
    active_cycle: activeCycle || null,
    totals: {
      processed_tenders: Object.keys(state.processed_tenders || {}).length,
      processed_notices: Object.keys(state.processed_notice_keys || {}).length
    }
  };
}

async function getLayer1ViewData(input) {
  const outRoot = input && input.out_root ? String(input.out_root) : defaultOutRoot();
  const view = await loadLayer1RunView({
    outRoot,
    runDateYmd: input && input.run_date_ymd ? String(input.run_date_ymd) : ""
  });
  const shortlistRows = Array.isArray(view.shortlist_rows) ? view.shortlist_rows : [];
  const queueRows = Array.isArray(view.layer2_queue_rows) ? view.layer2_queue_rows : [];
  const normalizeShortlistRow = (row) => ({
    Id: row.Id,
    ReferenceNumber: row.ReferenceNumber || "",
    Name: row.Name || "",
    NoticePublishDate: row.NoticePublishDate || "",
    topProgram: row._eojn && row._eojn.topProgram ? row._eojn.topProgram : "",
    topScore: row._eojn && Number.isFinite(Number(row._eojn.topScore)) ? Number(row._eojn.topScore) : 0,
    reasons: row._eojn && Array.isArray(row._eojn.reasons) ? row._eojn.reasons : []
  });
  const normalizeQueueRow = (row) => ({
    Id: row.Id,
    ReferenceNumber: row.ReferenceNumber || "",
    Name: row.Name || "",
    NoticePublishDate: row.NoticePublishDate || "",
    topProgram: row.topProgram || "",
    topScore: Number.isFinite(Number(row.topScore)) ? Number(row.topScore) : 0,
    reasons: Array.isArray(row.reasons) ? row.reasons : []
  });
  return {
    use_case: "eojn_v1",
    ...view,
    shortlist_rows: shortlistRows.map(normalizeShortlistRow),
    layer2_queue_rows: queueRows.map(normalizeQueueRow)
  };
}

async function recomputeLayer1FromStoredRaw(input) {
  const outRoot = input && input.out_root ? String(input.out_root) : defaultOutRoot();
  const runDateYmd = String(input && input.run_date_ymd ? input.run_date_ymd : "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(runDateYmd)) {
    throw new Error("Invalid run_date_ymd; expected YYYY-MM-DD");
  }

  const loaded = await loadLayer1RawArtifacts({ outRoot, runDateYmd });
  const scoreResult = await scoreRows({
    moduleDir: __dirname,
    rows: loaded.procurementsRows
  });
  const completedAt = new Date().toISOString();
  const prevRun = loaded.manifest && loaded.manifest.run ? loaded.manifest.run : null;
  const nextManifest = {
    ...(loaded.manifest || {}),
    module: "eojn_v1",
    phase: "EOJN-1-RECOMPUTE",
    recomputed_at: completedAt,
    recompute: {
      source: "stored_raw",
      run_date_ymd: runDateYmd
    },
    run: {
      ...(prevRun || {}),
      run_date_ymd: runDateYmd,
      completed_at: completedAt,
      counts: {
        ...(prevRun && prevRun.counts ? prevRun.counts : {}),
        scored: scoreResult.scoredCount,
        shortlist: scoreResult.shortlistCount,
        layer2_queue: scoreResult.layer2Queue.length
      }
    }
  };

  const writeInfo = await writeLayer1DerivedArtifacts({
    outRoot,
    runDateYmd,
    scoredRows: scoreResult.scored,
    shortlistRows: scoreResult.shortlist,
    layer2QueueRows: scoreResult.layer2Queue,
    manifest: nextManifest
  });
  const canonical = await buildCanonicalArtifacts({
    outRoot,
    outDir: writeInfo.outDir,
    runDateYmd,
    scoredRows: scoreResult.scored,
    noticesRows: loaded.noticesRows
  });
  await writeCanonicalArtifacts({
    outRoot,
    runDateYmd,
    tenderLatestRows: canonical.tenderLatestRows,
    tenderNoticeHistoryRows: canonical.tenderNoticeHistoryRows,
    reviewDecisionHistoryRows: canonical.reviewDecisionHistoryRows
  });
  await mergeCanonicalStateArtifacts({
    outRoot,
    tenderLatestRows: canonical.tenderLatestRows,
    tenderNoticeHistoryRows: canonical.tenderNoticeHistoryRows,
    reviewDecisionHistoryRows: canonical.reviewDecisionHistoryRows
  });
  await ensureDefaultWorklistConfig(outRoot);
  await appendEventLog({
    outDir: writeInfo.outDir,
    event: {
      ts: completedAt,
      type: "LAYER1_RECOMPUTE_OK",
      run_date_ymd: runDateYmd,
      counts: nextManifest.run.counts
    }
  });

  return {
    ok: true,
    recomputed: true,
    run_date_ymd: runDateYmd,
    out_dir: writeInfo.outDir,
    counts: nextManifest.run.counts
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
  getLayer1Status,
  getLayer1ViewData,
  recomputeLayer1FromStoredRaw
};
