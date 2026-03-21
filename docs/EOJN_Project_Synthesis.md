# EOJN v1 - Project Synthesis (bi-backend)

## 1. Scope and goal
EOJN v1 is a continuous BI module for daily tender intelligence:
- Layer 1: fetch + score EOJN metadata (searchgrid) and create shortlist.
- Layer 2: targeted budget (troskovnik) download/scan for shortlisted/risk tenders.
- Watchlist: persistent case tracking per tender ID across days/months.
- Alerts: notify sales when relevant new events appear (including updates on old tender IDs).

Primary objective: maximize recall (do not miss relevant tenders), while keeping sales workload low through heavy filtering.

## 2. Current verified status (as of 2026-03-21)
- EOJN now operates with one canonical latest-state worklist over `TenderId`, not with multiple operator-facing daily lists.
- Main UI worklist reads canonical `_state` indices by default.
- Layer 2 can start from canonical state without mandatory `run_date`.
- Review save and Layer 2 result save both sync back into canonical latest/history state immediately.
- Layer 2 XLS/XLS parsers were refactored:
  - bulk extraction instead of cell-by-cell COM traversal,
  - `uom_anchor_items_v2` item detection,
  - use-case split scoring (`target_fitout`, `doors_joinery`).
- Legacy EOJN keyword/smoke files were moved under `src/modules/eojn_v1/legacy/`.

## 3. Confirmed EOJN auth/session behavior
- Public tender pages can be opened anonymously.
- Protected actions (document download) trigger auth flow.
- Normal flow: `tender-eo -> 302 /login -> 302 /konzola -> back to tender`.
- Active session can be reused for multiple tender IDs in one browser context.
- `userToken` appears in document links; it is treated as sensitive runtime token and should be masked in logs.

## 4. Layer architecture

### Layer 1 (metadata only)
- Input: EOJN procurements/notices public feeds with watermark + overlap.
- Steps:
  1) Fetch bootstrap page and parse `uiUserToken`.
  2) Fetch searchgrid JSON.
  3) Normalize fields.
  4) Hard-negative filter.
  5) Program scoring (P1-P4).
  6) Risk heuristic (hidden equipment signal).
  7) Mark `L1 pass` tenders and update canonical latest state.
- Output:
  - daily run artifacts remain available for audit/debug,
  - canonical `_state` indices are the primary operator source.

### Layer 2 (targeted docs)
- Input:
  - canonical latest-state `L1 pass` tenders for normal run,
  - optional manual/run-date fallback for debug.
- Steps:
  1) Single Playwright session (login once).
  2) Open tender pages, detect budget links, download docs.
  3) Parse/scan XLS/XLSX evidence.
  4) Score by use-case profile and update canonical latest state.
- Output:
  - `layer2_analysis_*.json`,
  - `layer2_monitor_result_*.json`,
  - canonical `L2Status/L2Label/L2Incidence` update per `TenderId`.

### Canonical state and review
- One canonical `TenderId` list for all `L1 pass` tenders.
- One linked notice history by `TenderId`.
- Review decisions are append-only history with latest decision projected back to canonical latest state.
- `WATCH` is a filter over canonical latest state, not a separate operator list.

### Watch and re-check
- Persistent watchlist semantics are implemented as latest review/watch state per `TenderId`.
- Every run may refresh watched IDs and their notice history.
- Expired tenders can remain tracked for post-award/business-relevant decisions.

## 5. Current data model contract
Current filesystem model uses one primary latest-state table plus linked histories.

### Primary artifacts
- `tender_latest_index.json`
  - one latest-state row per `TenderId`
- `tender_notice_history_index.json`
  - append-style notice history for tracked tenders
- `review_decision_history_index.json`
  - append-only operator decisions

### Supporting contracts
- `event_model_v1.json`
- `procedure_type_catalog.json`
- `document_type_catalog.json`
- `layer2_use_case_profiles.json`
- `eojn_kpi_summary_contract.json`
- `eojn_kpi_model_v1.json`

### Status model
- `event_status`: `new -> l1_scored -> l2_scored -> proposed_discard|proposed_watch -> confirmed_discard|confirmed_watch`
- `case_status`: `active | expired | disengaged | archived`
- `subject_status`: `active | converted_to_case | disengaged`

## 6. Logging/storage policy
Current target pattern:
- canonical `_state` indices as primary operator source,
- daily partition folders as audit/debug artifacts,
- run-specific outputs retained for rebuild or forensic inspection,
- no full raw warehouse for rejected/not-applicable items,
- future DB migration should preserve:
  - `tender_latest`,
  - `notice_history`,
  - `review_decision_history`,
  - `run_audit`,
  - `ingest_state`,
  - `ingest_ledger`,
  - `ref_catalog`,
  - optional later `kpi_daily`.

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
- Background runs target: `06:00` and `15:00` local.
- EOJN raw publish pattern is assumed to be weekday-heavy around local midnight.
- Empty morning run on weekends is not by itself a process-health failure.
- Layer 2 limits:
  - bounded docs/day,
  - single worker,
  - canonical latest-state is the default queue source.

## 9. Manual workflows required
- Manual add of missed tender ID:
  - fetch key EOJN metadata and attach to watchlist.
- Manual soft watch add (without tender ID):
  - track institution/topic until converted to real tender case.
- Manual confirmations:
  - confirm discard,
  - watch mode selection (`DIRECT` or `GC`),
  - disengage with reason.

## 10. Recommended production file structure (current direction)
```text
src/modules/eojn_v1/
  module_manifest.json
  run_daily.js
  layer2_budget_scan.js
  contracts/
    tender_latest_contract.json
    tender_notice_history_contract.json
    review_decision_history_contract.json
    worklist_view_config_contract.json
    procedure_type_catalog.json
    document_type_catalog.json
    event_model_v1.json
    layer2_use_case_profiles.json
    eojn_kpi_summary_contract.json
    eojn_kpi_model_v1.json
  legacy/
    ...

out/eojn_v1/
  YYYY_MM_DD/
    procurements_raw.json
    notices_raw.json
    scored.json
    shortlist.json
    layer2_queue.json
    layer2_analysis_*.json
    layer2_monitor_result_*.json
    manifest.json
    events.log
  _state/
    tender_latest_index.json
    tender_notice_history_index.json
    review_decision_history_index.json
    layer1_state.json
    layer2_run_status.json
    active_cycle.json
    worklist_view_config.json
```

## 11. Repo simplification decision
- Operator-facing EOJN must converge on one canonical worklist and one linked notice history.
- Daily shortlist/queue artifacts may remain as technical pipeline outputs, but not as primary operator lists.
- Legacy smoke/dev/keyword files are moved out of active runtime path.
- Paths/config remain centralized and DB migration must preserve storage contracts instead of embedding file logic into business code.

## 12. Open decisions for final contract freeze
- exact alert thresholds and strong-signal SLA,
- final review operator identity model,
- final scheduler/heartbeat semantics for unattended production mode,
- exact DB cutover sequence and retention of audit artifacts.
