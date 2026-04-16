# GRM_POC_OUTLINE_v1.md

## 1. Purpose

This document defines the implementation outline for `GRM` (`gosoft_request_module`) as a host-side integration module in `bi-backend`.

Its role is practical:
- support the first Aldo POC
- remain reusable for other Gosoft fetch consumers
- stay compatible with current Core Shell boundaries
- avoid pushing ERP SQL semantics into downstream modules

This is a POC-first, production-minded outline.
It is not a final enterprise redesign.

## 2. Position In Architecture

`GRM` should be treated as:
- a host-side integration module
- owned by the BI host side
- powered by Core Shell capabilities
- transport-limited to file-drop in `poc-v1`

`GRM` is not:
- a downstream business module
- a direct ERP client exposed to users
- a final long-term production transport contract

Near-term role:
- shared fetch broker for Gosoft-backed request/response workflows

## 3. Boundary Model

### Host / GRM owns

- request inbox scanning
- request validation
- target folder bootstrap
- ERP fetch orchestration
- SQL select semantics
- join logic between ERP sources
- enrichment logic and ERP quirks/workarounds
- response package generation
- manifest generation
- warning/error reporting
- archive flow

### Downstream module owns

- request creation
- local session/batch tracking
- response ingest
- local domain lifecycle
- local SQLite operational state

### Important rule

Downstream modules must not own:
- direct ERP fetch
- ERP credentials
- ERP join logic
- ERP workaround rules such as `POTREBA.ident + 1 -> ARTIKEL.artid`

## 4. Core Shell Alignment

`GRM` must align with existing Core Shell boundaries:

- use `src/core_shell/services/erp_fetch_service.js` as the official ERP access path where possible
- any compatibility bridge into legacy ERP access must remain narrow and host-owned
- no new direct module-side ERP client
- no new route-level orchestration patterns in `src/api/server.js`

Because `POTREBA`, `ARTIKEL`, and `ARTKLAS` fetch/enrichment are not yet formalized as a generic Core Shell capability, `GRM` should be implemented as a host-side integration module under `src/modules/*`, while consuming current Core Shell entry points and keeping any temporary ERP compatibility logic encapsulated.

## 5. Folder Contract

### Integration root

Linux:
- `/mnt/nas/004_Konstrukcija/010_BI_File_Drop`

Windows view:
- `Z:\004_Konstrukcija\010_BI_File_Drop`

### Shared request inbox

- `/mnt/nas/004_Konstrukcija/010_BI_File_Drop/REQUEST`

### Target result roots

- `/mnt/nas/004_Konstrukcija/010_BI_File_Drop/ALDO_POC`
- `/mnt/nas/004_Konstrukcija/010_BI_File_Drop/BOJAN_POC`
- `/mnt/nas/004_Konstrukcija/010_BI_File_Drop/ANTONIJA_POC`
- `/mnt/nas/004_Konstrukcija/010_BI_File_Drop/ZORAN_POC`

### Recommended target subfolders

For each target root:
- `responses/`
- `errors/`
- `archive_processed/`
- `archive_failed/`

## 6. Folder Lifecycle Rule

For `poc-v1`, host side owns folder lifecycle.

That means:
- `GRM` must ensure the integration root exists
- `GRM` must ensure `REQUEST/` exists
- `GRM` must ensure known target folders exist
- `GRM` must ensure target subfolders exist before writing results

Downstream modules should not be responsible for creating host-side infrastructure folders.

## 7. Request Contract v1

Request transport:
- JSON file drop

Request location:
- `REQUEST/`

Request naming:
- `<request_id>.request.json`

Example:
- `aldo-poc_2026_04_15_001.request.json`

Minimal request shape:

```json
{
  "request_id": "aldo-poc_2026_04_15_001",
  "module_id": "shopfloor_parts_lifecycle_v1",
  "target_drop": "ALDO_POC",
  "contract_version": "poc-v1",
  "requested_at": "2026-04-15T09:30:00Z",
  "fetch_mode": "date_window",
  "params": {
    "from": "2026-03-15",
    "to": "2026-04-15",
    "admctr": "P INOX"
  }
}
```

### Request rules

- `request_id` must be globally unique within the integration space
- `module_id` identifies the downstream module
- `target_drop` identifies the host-side result root
- `contract_version` for this phase is `poc-v1`
- `fetch_mode` for initial POC is `date_window`

Future fetch modes may include:
- `dnid_list`
- `sifradn_list`

## 8. Response Contract v1

Response transport:
- file-drop package

Minimal package:
- `manifest.json`
- `v_dn.csv`
- `potreba.csv`

Recommended location:
- `<TARGET_ROOT>/responses/<request_id>/`

Alternative flat layout is allowed only if `request_id` remains unambiguous in all filenames.

### Recommended filenames

- `<request_id>.manifest.json`
- `<request_id>.v_dn.csv`
- `<request_id>.potreba.csv`

## 9. Manifest Contract v1

Manifest is the control/orchestration layer.

It must minimally include:
- `request_id`
- `module_id`
- `contract_version`
- `status`
- `requested_at`
- `processed_at`
- `fetch_mode`
- `params`
- `files`
- `counts`
- `warnings`
- `lineage`

Allowed status values:
- `completed`
- `completed_with_warnings`
- `failed`

For `poc-v1`, the response package should be treated as a full snapshot for the given request scope.

## 10. Data Sources And Enrichment

### Parent source

`V_DN`

Exact known columns:
- `DNID`
- `SIFRADN`
- `NALOGID`
- `Nalog`
- `Nalog_Naziv`
- `SifraID`
- `KOLICINA`
- `ADMCTR`
- `AdmCtr_Naziv`
- `STATUS`
- `Status_Sifra`
- `Status_Naziv`
- `TERMIN_ZAC`
- `TERMIN_KON`
- `DAT_LANS`
- `DAT_KONC`
- `OPOMBE`

### Child source

`POTREBA`

Exact known columns:
- `potrid`
- `dnid`
- `ident`
- `status`
- `kolicina`
- `koltrn`
- `pozicija`
- `tehn`
- `termin`
- `opombe`
- `dnoprid`
- `izmetkolnakos`
- `kolvhod`
- `timecr`
- `timemod`
- `usercr`
- `usermod`
- `zamikvgr`
- `osebid`
- `potrdil`
- `kontr_pod`

### Enrichment sources

- `ARTIKEL`
- `ARTKLAS`

### Confirmed current smoke rule for child/material enrichment

For the currently validated POC case:
- `POTREBA.ident + 1 -> ARTIKEL.artid`
- `ARTKLAS.artid -> ARTIKEL.artid`

This is currently treated as a known ERP semantic quirk/workaround.
It is host-side logic and must remain encapsulated inside `GRM`.

### Enriched columns expected in `potreba.csv`

In addition to raw `POTREBA` columns, `potreba.csv` should include:
- `artikel_artid`
- `artikel_artikel`
- `artikel_naziv1`
- `artikel_naziv2`
- `artikel_admid`
- `artikel_barkoda`
- `artikel_em`
- `artklas_kljucevi`

`artklas_kljucevi` should aggregate all matched `ARTKLAS.kljuc` values with delimiter `;`.

## 11. Canonical Keys

- canonical parent ERP key: `DNID`
- parent business key: `N{DNID}`
- canonical child ERP key: `POTRID`
- child/scan key: `R{POTRID}`
- display/business identifier: `SIFRADN`

Parent-child join rule:
- `V_DN.DNID = POTREBA.dnid`

## 12. Multi-user Model

`GRM` should be designed as a shared host fetch broker, not as an Aldo-only helper.

That means:
- multiple downstream users/modules may drop requests into one shared `REQUEST/`
- routing must happen via `target_drop`
- response package identity must be based on `request_id`
- manifest must explicitly state:
  - who requested
  - what was fetched
  - what was returned
  - whether warnings/errors occurred

## 13. Processing Lifecycle

For each request:

1. scan `REQUEST/`
2. pick valid `*.request.json`
3. parse and validate request
4. resolve `target_drop`
5. ensure target folders exist
6. run ERP fetch for parent and child scope
7. run host-side enrichment
8. generate `manifest.json`
9. write `v_dn.csv`
10. write `potreba.csv`
11. archive request into `archive_processed/`
12. on error, write error/failed manifest and archive request into `archive_failed/`

## 14. Idempotency And Safety

`GRM` should enforce:
- no duplicate processing of the same `request_id`
- no ambiguous response package ownership
- no partial success without explicit `completed_with_warnings` or `failed` status

Important minimum rules:
- same `request_id` must map to one logical processing result
- same `request_id` must not create two conflicting response packages silently
- response package must carry the same `request_id` as the request

## 15. Warning And Error Model

Typical warnings:
- `SIFRADN_MULTI_DNID`
- `EMPTY_RESPONSE`
- `PARTIAL_ENRICHMENT`

Typical errors:
- invalid request JSON
- unknown `target_drop`
- unsupported `fetch_mode`
- ERP fetch failure
- parent/child join inconsistency
- required output file generation failure

## 16. Implementation Shape

Recommended package location:
- `src/modules/gosoft_request_module_v1/`

Recommended internal responsibilities:
- `module_manifest.json`
- request parser/validator
- folder bootstrap helper
- request inbox scanner
- ERP fetch orchestrator
- enrichment pipeline
- CSV writer
- manifest writer
- archive/error handling

Recommended host-facing posture:
- host-owned integration module
- POC transport now
- direct host integration later

## 17. Non-goals For POC

Do not implement yet:
- final production API transport
- auth/role model
- fully generalized ERP query language for users
- broad Core Shell refactor around GRM
- full DB-backed request ledger
- fully normalized audit subsystem

## 18. Next Step After This Outline

Next step is not broad coding.
Next step is to formalize:

1. `request.json` schema
2. `manifest.json` schema
3. `v_dn.csv` output contract
4. `potreba.csv` output contract including enrichment columns
5. module bootstrap/folder bootstrap behavior
6. implementation outline mapped to concrete files

## 19. Watchdog And Polling Model

For `poc-v1`, `GRM` should run as a background watchdog process.

Recommended request inbox scan interval:
- every `5` seconds

Recommended downstream poll interval:
- every `5` seconds

Operational expectation for users:
- `GRM` checks for new requests every `5` seconds
- normal `date_window` requests should typically return within `15` to `60` seconds

### Completion signal

For `poc-v1`, response package should be treated as ready only when:
- the response directory for the correct `request_id` exists
- and `manifest.json` exists

### Response write order

Recommended host write order:

1. `v_dn.csv`
2. `potreba.csv`
3. `manifest.json`

Important rule:
- `manifest.json` should be written last

This allows downstream modules to use `manifest.json` as the package completion signal.

### Dual path documentation rule

All folder references should be documented in both views:

Linux / server:
- `/mnt/nas/004_Konstrukcija/010_BI_File_Drop/...`

Windows / user view:
- `Z:\004_Konstrukcija\010_BI_File_Drop\...`
