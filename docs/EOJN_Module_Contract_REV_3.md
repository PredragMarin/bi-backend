# EOJN Module Contract v1.0.0 REV_3

Projekt: `bi-backend`  
Use case: `eojn_v1`  
Datum: `26.03.2026`

### 1. Identitet contracta
1. `use_case = eojn_v1`
2. `contract_version = 1.0.0`
3. `rules_version = 1.0.0` ili visa verzija, uz obaveznu semanticku promjenu pri relevantnom L1/L2 rules updateu
4. `timezone = Europe/Zagreb`
5. Contract mora ostati vazeci i u filesystem-first i u PostgreSQL-backed izvedbi

### 2. Runtime config contract (module constants)
Obavezna polja:
1. `RUN_TIMES = ["06:00","15:00"]`
2. `RUN_ALL_DAYS = true`
3. `RETRY_MAX = 5`
4. `RETRY_INTERVAL_MIN = 5`
5. `TARGET_HIT_THRESHOLD = 0.40` ili drugi aktualni threshold, ali kao eksplicitna konfigurabilna konstanta
6. `WATCH_CANDIDATE_MIN = 0.01`
7. `WATCH_CANDIDATE_MAX = 0.10`
8. `UI_REFRESH_MIN = 10`
9. `RETENTION_MONTHS = 24`
10. `PROCUREMENT_SAFETY_OVERLAP_DAYS = 2`
11. `NOTICE_SAFETY_OVERLAP_DAYS = 2`
12. `DEFAULT_TIMEZONE = "Europe/Zagreb"`

Napomena:
- U REV_3 thresholdi ostaju vazni, ali vise ne definiraju sami po sebi cjelokupnu top-level L2 semantiku bez use-case profila.

### 3. Input envelope
Obavezno:
1. `use_case`
2. `period.date_from`
3. `period.date_to`
4. `run_mode` (`SCHEDULED|MANUAL_RECHECK|REPLAY|BOOTSTRAP|INCREMENTAL`)

Opcionalno:
1. `manual_tender_ids[]`
2. `debug`
3. `force_layer2`
4. `run_date_ymd`
5. `out_root`
6. `dry_run`

Napomena:
- `run_date_ymd` u REV_3 vise nije glavni operatorski input, nego debug/replay input.

### 4. runData output (obavezni shape)
1. `run_metadata`
2. `run_facts`
3. `notices`
4. `layer2_evidence`
5. `watch_candidates`
6. `target_hits`
7. `actions_queue`
8. `period_summary`
9. `recap_lines`

Dodatno obavezni canonical/output slojevi:
10. `tender_latest`
11. `tender_notice_history`
12. `review_decision_history`
13. `run_audit`
14. `ingest_ledger`
15. `ingest_state`

### 5. `run_metadata`
Minimalna polja:
1. `run_id`
2. `generated_at`
3. `run_status` (`DRAFT|FINAL|FAILED|EMPTY_SUCCESS|DRY_RUN_SUCCESS`)
4. `contract_version`
5. `rules_version`
6. `input_hash`
7. `started_at`
8. `finished_at`
9. `duration_ms`
10. `new_items`
11. `target_hits`
12. `publish_blocked`

Dodatno u REV_3:
13. `run_type`
14. `run_date_ymd`
15. `mode`
16. `out_dir`
17. `queue_source`
18. `watermarks_before`
19. `watermarks_after`
20. `integrity_overlap_applied`
21. `reviewed_count`
22. `failed_count`
23. `skipped_count`
24. `error_code`

### 6. `notices` (watchlist / timeline base)
Obavezne kolone:
1. `tender_id`
2. `publication_document_id`
3. `TenderStatus`
4. `workflow_status`
5. `ProcedureType`
6. `CPV`
7. `Narucitelj`
8. `naslov`
9. `ReferenceNumber`
10. `EstimatedValue`
11. `TypeContract`
12. `rok_predaje`
13. `hit_reason`
14. `zadnja_promjena`

Dodatno u REV_3:
15. `document_type_id`
16. `document_type_name`
17. `publish_date`
18. `notice_key`
19. `procedure_type_id`
20. `last_seen_at`
21. `source_run_date_ymd`

### 7. Layer classification fields
Za svaki tender:
1. `layer1_discard` (bool)
2. `layer1_score_top`
3. `layer2_incidence`
4. `layer2_status`
5. `layer2_evidence_available` (bool)

Dodatno u REV_3:
6. `layer1_candidate`
7. `layer1_shortlist`
8. `layer1_scope_class`
9. `layer1_intent_class`
10. `layer1_reasons`
11. `layer2_label`
12. `layer2_item_count`
13. `layer2_hit_items`
14. `layer2_intensity`
15. `layer2_model`
16. `layer2_profiles`
17. `layer2_primary_profile`

### 8. Target hit pravilo
1. `TARGET_HIT` samo ako postoji Layer 2 dokaz i `layer2_incidence >= TARGET_HIT_THRESHOLD`.
2. Ako Layer 2 dokaz nije dostupan (`download/parse fail`):
   - klasifikacija je `SUSPECT_MANUAL`,
   - obavezna akcija rucnog pregleda,
   - bez automatskog target-hita.

REV_3 dopuna:
3. Top-level EOJN target hit mora dolaziti iz aktivnog primarnog use-case profila.
4. Sekundarni profil ne smije sam proizvesti EOJN target hit bez business potvrde.
5. Genericki termini sami po sebi ne smiju lazno dizati strong target signal.

### 9. Actions queue contract
Minimalna polja:
1. `action_id`
2. `action_type`
3. `severity` (`INFO|WARN|ACTION|BLOCKER`)
4. `tender_id`
5. `publication_document_id`
6. `summary`
7. `suggested_fix`
8. `status` (`OPEN|RESOLVED|DISMISSED`)
9. `priority_rank`
10. `created_at`

Obavezni action tipovi (v1):
1. `L1_STRONG_NEGATIVE_REJECT`
2. `L2_WATCH_CANDIDATE_REVIEW`
3. `L2_TARGET_HIT_ALERTED`
4. `L2_EVIDENCE_FETCH_FAILED_MANUAL_REVIEW`
5. `RUN_OVERLAP_PREVIOUS_FAILED`

Dodatno u REV_3:
6. `INTEGRITY_GAP_PENDING_RECOVERY`
7. `SCHEDULER_CONTINUITY_FAIL`
8. `NOTICE_TYPE_UNKNOWN_REVIEW`
9. `L2_PROFILE_CONFLICT_REVIEW`

### 10. Heartbeat NDJSON contract
Putanja u starom modelu:
1. `out/eojn_v1/heartbeat/YYYY_MM/events.ndjson`

REV_3 operativni contract:
1. runtime run audit je u:
   - `out/eojn_v1/_state/run_audit.ndjson`
2. scheduler-side summary log ostaje dodatni operativni sloj

Event shape:
1. `event_type = RUN_SUMMARY`
2. `run_id`
3. `started_at`
4. `finished_at`
5. `status`
6. `duration_ms`
7. `new_items`
8. `target_hits`

Dodatno u REV_3:
9. `run_type`
10. `run_date_ymd`
11. `queue_source`
12. `reviewed_count`
13. `failed_count`
14. `empty_success`

### 11. SMS alert contract
1. Kanal: `SMS`
2. Dedup kljuc: `publication_document_id`
3. Primatelji: fiksna lista
4. Kratki template, npr:
`[EOJN HIT] {program} | {narucitelj} | {naslov_short} | rok {date} | ID {tender_id}`

REV_3 dopuna:
5. Alerting ostaje planiran sloj i nije finalno frozen.
6. Alert se ne salje na svaki `WATCH`.
7. Alert mora biti vezan uz strong confirmed target hit.

### 12. UI/Audit contract
1. Role model:
   - `SALES_LEAD` write/audit
   - `VIEWER` read-only
2. Auto-refresh: `10 min`
3. UI audit ledger (append-only NDJSON):
   - status promjene,
   - rucne odluke,
   - korisnik, timestamp, promjena.

REV_3 dopuna:
4. Main UI je canonical worklist nad latest-state tender listom.
5. Notice timeline je detail-layer, ne odvojeni primarni source.
6. `Run date` je advanced/debug only.

### 13. Retencija
1. Run artefakti + heartbeat + audit ledger: `24 mjeseca`.
2. Retencijski cleanup mora ostaviti audit minimalni trag.
3. Cleanup ne smije ukloniti:
   - `run_audit`
   - `ingest_ledger`
   - latest review history
   - canonical minimum state dokaz

### 14. Gate kriteriji
1. `FAILED` run:
   - tehnicki fatal,
   - ili overlap policy fail prethodnog runa.
2. `FINAL` run:
   - heartbeat upisan,
   - output artefakti zapisani,
   - action queue konzistentan.
3. Warningi ne blokiraju automatski, osim ako su mapirani u `BLOCKER`.

REV_3 dopuna:
4. `EMPTY_SUCCESS` je valjan zavrsetak ako je runtime uspjesan bez actionable novih stavki.
5. `Continuity FAIL` ne znaci automatski `Integrity FAIL`.
6. `Integrity FAIL` postoji tek ako recovery model ne moze dokazati coverage.

### 15. Canonical latest/history contract
1. `tender_latest`
2. `tender_notice_history`
3. `review_decision_history`
4. `worklist_view_config`
5. `run_audit`
6. `ingest_ledger`
7. `ingest_state`

Napomena:
- Ovaj sloj je u REV_3 dio stvarnog runtime contracta, ne samo plan.

### 16. Reference catalog contract
Potrebni reference/config slojevi:
1. `ProcedureType`
2. `DocumentType`
3. event model
4. use-case profiles
5. KPI rules
6. view config

### 17. KPI contract smjer
REV_3 odjeljuje:
1. `ContinuityStatus`
2. `IntegrityStatus`

Minimalni management KPI smjer:
1. `ExpectedCycles`
2. `SuccessfulL1Cycles`
3. `SuccessfulL2Cycles`
4. `CoverageStatus`
5. `NewL1PassTenders`
6. `L2AnalyzedTenders`
7. `OpenReviewBacklog`
8. `WatchCount`
9. `MedianReviewLatencyHours`
10. `StrongSignalSlaStatus`

### 18. DB migration compatibility
Minimalni DB target:
1. `eojn_tender_latest`
2. `eojn_notice_history`
3. `eojn_review_decision_history`
4. `eojn_run_audit`
5. `eojn_ingest_state`
6. `eojn_ingest_ledger`
7. `eojn_ref_catalog`

Opcionalno kasnije:
8. `eojn_kpi_daily`

### 19. Zakljucak REV_3
Ovim contractom EOJN ostaje operativni modul s:
1. fiksnim scheduler ritmom,
2. jasnim L1/L2 klasifikacijama,
3. canonical latest/history modelom,
4. audit i ingest ledger tragom,
5. integrity-first recovery logikom,
6. human-in-the-loop review slojem,
7. DB-ready storage contract smjerom.
