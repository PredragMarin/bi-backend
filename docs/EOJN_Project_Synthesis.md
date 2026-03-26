# EOJN Project Synthesis

## 1. Scope and goal
EOJN v1 is a continuous BI module for daily tender intelligence:
- Layer 1: fetch + score EOJN metadata (`Postupci` + `Objave`) and determine `L1 pass`.
- Layer 2: targeted budget/troskovnik download and evidence scan for relevant tenders.
- Canonical worklist: one latest-state view by `TenderId`.
- Notice timeline: linked history of `Objava` rows for tracked tenders.
- Review workflow: manual business decision (`WATCH`, `REJECT`, `HOLD`) with append-only history.
- Alerts: future strong-signal notification layer.
- Audit and health: run audit, ingest ledger, continuity/integrity monitoring.

Primary objective:
- maximize recall so relevant tenders are not missed,
- keep the operator-facing model simple,
- preserve DB migration readiness without changing EOJN business logic later.

## 2. Current verified status
- EOJN now operates with one canonical latest-state worklist over `TenderId`.
- Main UI worklist reads canonical `_state` indices by default.
- `Run date` is no longer the primary operator axis; it is a debug/advanced concept.
- Layer 2 can start from canonical state without mandatory `run_date`.
- Review save and Layer 2 result save both sync back into canonical latest/history state immediately.
- Layer 2 XLS/XLSX parsing was refactored:
  - bulk extraction instead of cell-by-cell COM traversal,
  - `uom_anchor_items_v2` item detection,
  - profile-based scoring instead of one mixed incidence score.
- Legacy EOJN keyword/smoke files were moved under `src/modules/eojn_v1/legacy/`.
- EOJN now writes operational append-only artifacts:
  - `run_audit.ndjson`
  - `ingest_ledger.ndjson`

## 3. Confirmed EOJN auth/session behavior
- Public tender pages can be opened anonymously.
- Protected actions such as document download trigger auth flow.
- Normal flow:
  - `tender-eo -> /login -> /konzola -> back to tender`
- One active session can be reused for multiple tender IDs in one browser context.
- Runtime tokens in document links remain sensitive and must not be exposed in clear text in logs.

## 4. Layer architecture

### 4.1 Layer 1
Input:
- EOJN public feeds for `Postupci`
- EOJN public feeds for `Objave`
- watermark + overlap driven incremental fetch

Behavior:
1. fetch procurements and notices
2. normalize fields
3. apply hard negatives
4. classify scope and intent
5. compute L1 score
6. determine `candidate`, `shortlist`, `layer2Candidate`
7. update canonical latest-state for all `L1 pass` tenders

Notes:
- L1 is intentionally recall-oriented.
- L1 must not be the final business gate.
- L1 now supports laboratory discrete-device cases such as:
  - `laminar flow`
  - `laminarna komora`
  - `digestor`

### 4.2 Layer 2
Input:
- canonical latest-state `L1 pass` tenders for normal operation
- optional manual/debug rerun by explicit `run_date`

Behavior:
1. login once
2. inspect tender page and detect budget/troskovnik documents
3. download and parse evidence
4. detect item anchors via `JM`-based logic
5. score by active use-case profiles
6. sync L2 result back to canonical latest-state

Current parser/scoring shape:
- bulk extraction
- `uom_anchor_items_v2`
- primary profile-based top-level signal
- secondary profiles allowed in details but must not distort the main EOJN signal

### 4.3 Review workflow
- one latest review state per `TenderId`
- append-only decision history
- latest decision is projected back into canonical latest-state
- `WATCH` is a filter over canonical latest-state, not a separate primary operator list

### 4.4 Alerts
- alerting remains planned but not final-frozen
- no automatic production alerting should be assumed until thresholds, dedup policy and recipients are frozen

## 5. Canonical data model
EOJN now converges on one main latest-state layer plus linked histories.

### 5.1 Canonical latest-state
- `tender_latest_index.json`
- one row per `TenderId`
- only tenders that passed L1 enter the canonical operator worklist

### 5.2 Notice history
- `tender_notice_history_index.json`
- multiple rows per `TenderId`
- linked notice/event timeline for tracked tenders

### 5.3 Review history
- `review_decision_history_index.json`
- append-only operator decision history

### 5.4 Supporting state
- `layer1_state.json`
- `layer2_run_status.json`
- `active_cycle.json`
- `worklist_view_config.json`
- `run_audit.ndjson`
- `ingest_ledger.ndjson`

## 6. Contracts and reference model
EOJN runtime is supported by explicit contracts and reference artifacts under `src/modules/eojn_v1/contracts/`.

Relevant contract families:
- `tender_latest`
- `tender_notice_history`
- `review_decision_history`
- `worklist_view_config`
- `layer1_run`
- `run_audit`
- `ingest_ledger`
- `procedure_type_catalog`
- `document_type_catalog`
- `event_model_v1`
- `layer2_use_case_profiles`
- `eojn_kpi_summary_contract`
- `eojn_kpi_model_v1`

Unknown type handling rule:
- unknown EOJN notice/procedure types must not break ingest
- they remain ingested and flagged for later classification

## 7. Logging and audit policy
Current logging pattern:
- canonical `_state` indices as primary operator source
- daily partition folders for audit/debug
- append-only `run_audit.ndjson`
- append-only `ingest_ledger.ndjson`
- scheduler-side summary log under `_scheduler_logs`

Design intent:
- operator UI reads canonical state
- forensic reconstruction remains possible from daily partitions + audit logs
- runtime failures must be visible without relying only on UI changes

## 8. Continuity and integrity model
EOJN production logic must prioritize data integrity over perfect scheduler continuity.

### 8.1 Continuity
Continuity answers:
- did the expected `06:00` and `15:00` cycles run?

### 8.2 Integrity
Integrity answers:
- can we prove that no relevant raw EOJN data was lost despite a temporary outage?

### 8.3 Recovery rules
- watermark moves only after successful L1 completion
- next incremental run starts from `last_successful_watermark - overlap`
- overlap is currently `2 days` for procurements and notices
- ingest is idempotent through stable ID/dedup rules

This means:
- a missed scheduler cycle is a continuity problem
- it becomes an integrity problem only if a later successful run cannot provably close the gap

## 9. Ingest ledger strategy
EOJN does not aim to store a full raw warehouse for all rejected/not-applicable rows.

Instead, it keeps a lightweight ledger for all seen raw entities:
- entity type
- entity id
- seen timestamp
- run id
- L1 status

Purpose:
- coverage proof
- continuity/integrity forensics
- later DB-ready `ingest_ledger` table mapping

This allows:
- `passed + rejected + not_applicable`
- reconciliation against EOJN reference totals for a period

## 10. UI model
Current intended operator UI:
- one main worklist grid over canonical latest-state
- one detail panel for selected tender
- one notices timeline per selected tender
- one review panel with decision persistence

Important UI principles:
- no primary operator dependence on daily folders
- no need to guess `run_date`
- watchlist is just a view/filter over canonical latest-state
- detail panel provides depth instead of many columns in the main grid

## 11. Operational assumptions
- target schedule remains `06:00` and `15:00`, Europe/Zagreb
- EOJN raw publish pattern is weekday-heavy around local midnight
- empty weekend runs are acceptable if the raw source has no meaningful changes
- scheduler continuity must be audited
- integrity recovery must be provable

## 12. Retention and cleanup policy
- retain run artifacts and minimal audit trail for at least `24 months`
- cleanup may reduce bulky daily artifacts later
- cleanup must not remove minimal proof of:
  - what ran
  - what was seen
  - what was decided
- sensitive auth/session tokens must not remain in clear logs

## 13. DB migration target
Filesystem is still the current primary backend, but EOJN is now shaped to migrate cleanly.

Minimal DB target:
1. `eojn_tender_latest`
2. `eojn_notice_history`
3. `eojn_review_decision_history`
4. `eojn_run_audit`
5. `eojn_ingest_state`
6. `eojn_ingest_ledger`
7. `eojn_ref_catalog`

Optional later:
8. `eojn_kpi_daily`

Key migration rule:
- do not replace file calls with SQL calls throughout the module
- replace the storage backend behind stable Core Shell contracts

## 14. Current open decisions
- final alert thresholds and dedup semantics
- final strong-signal SLA
- final operator identity model
- production scheduler hardening on the real server
- exact DB cutover sequence
- retention depth for bulky daily evidence files

## 15. Document set alignment
EOJN documentation should now be understood as:
- [EOJN_Project_Synthesis.md](/c:/Users/Marin/bi-backend/docs/EOJN_Project_Synthesis.md): high-level actual-state synthesis
- `EOJN_Runtime_Framework_REV_3.md`: runtime and operational framework
- `EOJN_Module_Contract_REV_3.md`: formal module contract and data/runtime obligations

## 16. Summary
EOJN is no longer only a smoke/prototype flow.
It is now a filesystem-first, canonical-state BI module with:
- one latest-state worklist by `TenderId`
- linked notice history
- append-only review, run audit and ingest ledger traces
- L1/L2 layered intelligence
- integrity-first recovery model
- clear path to PostgreSQL migration without rewriting business logic
