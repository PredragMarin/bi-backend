# EOJN v1 - Project Synthesis (bi-backend)

## 1. Scope and goal
EOJN v1 is a continuous BI module for daily tender intelligence:
- Layer 1: fetch + score EOJN metadata (searchgrid) and create shortlist.
- Layer 2: targeted budget (troskovnik) download/scan for shortlisted/risk tenders.
- Watchlist: persistent case tracking per tender ID across days/months.
- Alerts: notify sales when relevant new events appear (including updates on old tender IDs).

Primary objective: maximize recall (do not miss relevant tenders), while keeping sales workload low through heavy filtering.

## 2. Current verified status (as of 2026-02-21)
- Playwright login flow is validated in fully automated mode (no manual click needed).
- Login smoke test: PASS (`out/eojn_v1/_dev_budget_pw/2026_02_21/login_smoke_74182.json`).
- Batch download test with one session across multiple tender IDs: PASS.
- Batch report created at:
  - `out/eojn_v1/_dev_budget_pw/2026_02_21/batch_report.json`
- Downloaded budget files are stored per tender folder under:
  - `out/eojn_v1/_dev_budget_pw/2026_02_21/tender_<ID>/...`

## 3. Confirmed EOJN auth/session behavior
- Public tender pages can be opened anonymously.
- Protected actions (document download) trigger auth flow.
- Normal flow: `tender-eo -> 302 /login -> 302 /konzola -> back to tender`.
- Active session can be reused for multiple tender IDs in one browser context.
- `userToken` appears in document links; it is treated as sensitive runtime token and should be masked in logs.

## 4. Layer architecture

### Layer 1 (metadata only)
- Input: EOJN searchgrid for date D (default: today/active window, no past-only ingestion for auto flow).
- Steps:
  1) Fetch bootstrap page and parse `uiUserToken`.
  2) Fetch searchgrid JSON.
  3) Normalize fields.
  4) Hard-negative filter.
  5) Program scoring (P1-P4).
  6) Risk heuristic (hidden equipment signal).
  7) Produce shortlist + layer2 queue.
- Output (daily partition):
  - `raw.json`, `scored.json`, `shortlist.json`, `layer2_queue.json`, `manifest.json`, `events.log`.

### Layer 2 (targeted docs)
- Input: `layer2_queue` + optional manual tender IDs.
- Steps:
  1) Single Playwright session (login once).
  2) Open tender pages, detect budget links, download docs.
  3) Parse/scan XLS/XLSX evidence.
  4) Update L2 score and propose watch/discard.
- Output:
  - `layer2_evidence.json` and scoring updates.

### Watch and re-check
- Persistent watchlist per `tender_id`.
- Every run checks updates for watched IDs and emits alerts.
- Expired tenders can remain watched for post-award/business-relevant decisions.

## 5. Data model contract (draft)
Use two levels: event stream + current state.

### Entities
- `tender_event`: one EOJN publication/event (immutable, append-only).
- `tender_case`: current watch status for a specific `tender_id`.
- `watch_subject`: soft watch item without tender ID (institution/topic-based).
- `alert`: actionable notification item.

### Status model
- `event_status`: `new -> l1_scored -> l2_scored -> proposed_discard|proposed_watch -> confirmed_discard|confirmed_watch`
- `case_status`: `active | expired | disengaged | archived`
- `subject_status`: `active | converted_to_case | disengaged`

## 6. Logging/storage policy
Recommended pattern:
- Persistent current state:
  - `watchlist_current` (source of truth for active status).
- Append-only event log (partitioned):
  - monthly/yearly NDJSON partitions for audit/history.
- Daily run artifacts:
  - partitioned by `YYYY_MM_DD`.

Why:
- watchlist remains durable and easy to query,
- event history is scalable and audit-safe,
- month/year boundaries do not break long-lived tender tracking.

## 7. Retention and cleanup policy
- For `discard_confirmed` cases:
  - delete local downloaded documents,
  - keep evidence summary + audit event.
- For active watch cases:
  - keep only minimal operational artifacts.
- For engaged cases (DIRECT/GC):
  - documentation moves to controlled internal DMS/project storage.
- Always mask tokens/cookies in logs.

## 8. Operational assumptions
- Background runs: 2x daily (minimum).
- Optional lighter delta re-check for watchlist updates during day.
- Layer 2 limits:
  - bounded docs/day,
  - single worker (no aggressive parallelism).

## 9. Manual workflows required
- Manual add of missed tender ID:
  - fetch key EOJN metadata and attach to watchlist.
- Manual soft watch add (without tender ID):
  - track institution/topic until converted to real tender case.
- Manual confirmations:
  - confirm discard,
  - watch mode selection (`DIRECT` or `GC`),
  - disengage with reason.

## 10. Recommended production file structure (target)
```text
src/modules/eojn_v1/
  module_manifest.json
  run_daily.js
  layer1_fetch.js
  layer1_score.js
  layer2_budget_scan.js
  watchlist_store.js
  publish.js
  rules/
    keywords_p1.json
    keywords_p2.json
    keywords_p3.json
    keywords_p4.json
    stopwords_hard_negative.json
    risk_object_terms.json
  contracts/
    tender_event.schema.json
    tender_case.schema.json
    watch_subject.schema.json
    alert.schema.json
  _dev/
    dev_pw_login_smoke.js
    dev_pw_download_budget.js

out/eojn_v1/
  YYYY_MM_DD/
    raw.json
    scored.json
    shortlist.json
    layer2_queue.json
    layer2_evidence.json
    manifest.json
    events.log
  _state/
    watchlist_current.json
    watch_subjects_current.json
    intake_log.ndjson
    cleanup_log.ndjson
    events/YYYY/MM/events_YYYY_MM.ndjson
```

## 11. Repo simplification decision
Before production hardening:
- Keep only production module files in root of `src/modules/eojn_v1`.
- Move/remove smoke/dev scripts (`_dev` only, or remove after stabilization).
- Centralize all paths/config in one external config (and secrets outside repo).

## 12. Open decisions for final contract freeze
- exact shortlist and alert thresholds,
- final retention days per status,
- final UI action set and role permissions,
- final event schema fields and reason code enums.
