# GRM_POC_CONTRACT_v1.md

## 1. Purpose

This document formalizes the `poc-v1` transport contract for `GRM` (`gosoft_request_module`).

It defines:
- request schema
- manifest schema
- output CSV expectations
- minimum processing and validation rules

This is a host-side POC contract.

## 2. Contract Status

- contract version: `poc-v1`
- transport mode: `file_drop`
- request format: `JSON`
- response format: `manifest.json + v_dn.csv + potreba.csv`

## 3. Integration Paths

Linux:
- root: `/mnt/nas/004_Konstrukcija/010_BI_File_Drop`
- request inbox: `/mnt/nas/004_Konstrukcija/010_BI_File_Drop/REQUEST`
- Aldo target root: `/mnt/nas/004_Konstrukcija/010_BI_File_Drop/ALDO_POC`
- Aldo responses: `/mnt/nas/004_Konstrukcija/010_BI_File_Drop/ALDO_POC/responses`
- Aldo errors: `/mnt/nas/004_Konstrukcija/010_BI_File_Drop/ALDO_POC/errors`

Windows view:
- `Z:\004_Konstrukcija\010_BI_File_Drop\REQUEST`
- `Z:\004_Konstrukcija\010_BI_File_Drop\ALDO_POC`
- `Z:\004_Konstrukcija\010_BI_File_Drop\ALDO_POC\responses`
- `Z:\004_Konstrukcija\010_BI_File_Drop\ALDO_POC\errors`

## 4. Request File Naming

Format:
- `<request_id>.request.json`

Example:
- `aldo-poc_2026_04_15_001.request.json`

## 5. Request Schema v1

### Required fields

- `request_id`
- `module_id`
- `target_drop`
- `contract_version`
- `requested_at`
- `fetch_mode`
- `params`

### Request shape

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

### Field rules

#### `request_id`
- string
- globally unique in integration space
- should be human-readable
- should identify requester/use-case and sequence

#### `module_id`
- string
- downstream module identifier
- for Aldo POC:
  - `shopfloor_parts_lifecycle_v1`

#### `target_drop`
- string
- must match one allowed target root
- initial allowed values:
  - `ALDO_POC`
  - `BOJAN_POC`
  - `ANTONIJA_POC`
  - `ZORAN_POC`

#### `contract_version`
- must equal `poc-v1`

#### `requested_at`
- ISO-8601 UTC timestamp string

#### `fetch_mode`
- initial allowed value:
  - `date_window`

Future allowed values may include:
- `dnid_list`
- `sifradn_list`

#### `params`
For `date_window`, required:
- `from`
- `to`
- `admctr`

## 6. Request Validation Rules

`GRM` must reject request if:
- JSON is invalid
- any required field is missing
- `contract_version` is unsupported
- `target_drop` is unsupported
- `fetch_mode` is unsupported
- required `params` for that mode are missing
- `request_id` has already been processed and overwrite is not explicitly allowed

## 7. Response Package Naming

Recommended package layout:
- `<target_root>/responses/<request_id>/`

Recommended filenames inside package:
- `<request_id>.manifest.json`
- `<request_id>.v_dn.csv`
- `<request_id>.potreba.csv`

## 8. Manifest Schema v1

### Required fields

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

### Manifest shape

```json
{
  "request_id": "aldo-poc_2026_04_15_001",
  "module_id": "shopfloor_parts_lifecycle_v1",
  "contract_version": "poc-v1",
  "status": "completed_with_warnings",
  "requested_at": "2026-04-15T09:30:00Z",
  "processed_at": "2026-04-15T09:31:42Z",
  "fetch_mode": "date_window",
  "params": {
    "from": "2026-03-15",
    "to": "2026-04-15",
    "admctr": "P INOX"
  },
  "files": {
    "v_dn": "aldo-poc_2026_04_15_001.v_dn.csv",
    "potreba": "aldo-poc_2026_04_15_001.potreba.csv"
  },
  "counts": {
    "v_dn_rows": 142,
    "potreba_rows": 1976,
    "unique_dnid": 142,
    "unique_potrid": 1976,
    "warning_count": 1
  },
  "warnings": [
    {
      "code": "PARTIAL_ENRICHMENT",
      "message": "One or more child rows did not resolve a full enrichment set."
    }
  ],
  "lineage": {
    "source_system": "gosoft",
    "parent_source": "V_DN",
    "child_source": "POTREBA",
    "child_enrichment_sources": ["ARTIKEL", "ARTKLAS"]
  }
}
```

## 9. Manifest Status Model

Allowed status values:
- `completed`
- `completed_with_warnings`
- `failed`

### Meaning

#### `completed`
- request processed successfully
- no warnings that affect interpretation

#### `completed_with_warnings`
- request processed successfully
- package may still be ingestible
- warnings must be explicitly listed

#### `failed`
- package is not ingestible
- response should be treated as failed

## 10. Full Snapshot Rule

For `poc-v1`, response package is a full snapshot for the request scope.

That means:
- `v_dn.csv` contains all parent rows for the request
- `potreba.csv` contains all child rows for those parent rows, subject to current host-side business filters

## 11. `v_dn.csv` Output Contract

`v_dn.csv` must contain raw `V_DN` columns in full current POC scope.

Known exact columns:
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

### Minimum validation expectation for downstream module

Must include at least:
- `DNID`
- `SIFRADN`

## 12. `potreba.csv` Output Contract

`potreba.csv` must contain:
- full raw `POTREBA` scope
- plus host-side enrichment columns

### Raw columns

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

### Enriched columns

- `artikel_artid`
- `artikel_artikel`
- `artikel_naziv1`
- `artikel_naziv2`
- `artikel_admid`
- `artikel_barkoda`
- `artikel_em`
- `artklas_kljucevi`

### Minimum validation expectation for downstream module

Must include at least:
- `potrid`
- `dnid`
- `ident`
- `kolicina`
- `status`
- `kolvhod`
- `opombe`
- `artikel_artid`
- `artikel_artikel`
- `artikel_naziv1`
- `artikel_naziv2`
- `artikel_admid`
- `artikel_barkoda`
- `artikel_em`
- `artklas_kljucevi`

## 13. Host-side Enrichment Rule

Current POC rule:
- `POTREBA.ident + 1 -> ARTIKEL.artid`
- `ARTKLAS.artid -> ARTIKEL.artid`

This rule is host-owned and must not be implemented in downstream modules.

If this ERP semantic quirk changes later, only host-side logic should change.

## 14. Warning Model

Known warning codes may include:
- `SIFRADN_MULTI_DNID`
- `PARTIAL_ENRICHMENT`
- `EMPTY_RESPONSE`
- `NON_INGEST_BLOCKING_WARNING`

Warnings do not necessarily block ingest.
Blocking behavior is left to downstream module policy unless `status=failed`.

## 15. Failure Model

Typical failure conditions:
- request parse/validation failure
- ERP fetch failure
- parent/child inconsistency
- output file generation failure
- required response file missing

For `failed` packages:
- no ingest should occur
- manifest must still identify `request_id`

## 16. Downstream Ingest Assumptions

Downstream modules may assume:
- package belongs to one `request_id`
- package is a full snapshot for that request scope
- parent-child join is by `DNID`
- parent business key is `N{DNID}`
- child business/scan key is `R{POTRID}`
- host-side enrichment has already been applied

Downstream modules must not assume:
- direct ERP table access
- direct ERP join/workaround logic
- stable ERP semantics outside the host contract

## 17. Polling And Response Readiness

### GRM watchdog polling

For `poc-v1`, `GRM` should run as a background watchdog process.

Recommended request inbox scan interval:
- every `5` seconds

Practical expectation:
- `GRM` checks `REQUEST/` every `5` seconds for new `*.request.json` files

### Downstream polling

After writing a request file, a downstream module may poll for response readiness.

Recommended downstream poll interval:
- every `5` seconds

The downstream module should not try to read CSV files immediately after request creation.

### Readiness rule

For `poc-v1`, response package is considered ready only when:
- the response package directory exists for the correct `request_id`
- and `manifest.json` exists for that same `request_id`

Recommended readiness target file:
- `<responses>/<request_id>/<request_id>.manifest.json`

Example:
- `Z:\004_Konstrukcija\010_BI_File_Drop\ALDO_POC\responses\aldo-poc_2026_04_15_001\aldo-poc_2026_04_15_001.manifest.json`
- `/mnt/nas/004_Konstrukcija/010_BI_File_Drop/ALDO_POC/responses/aldo-poc_2026_04_15_001/aldo-poc_2026_04_15_001.manifest.json`

### Write order rule

To avoid downstream modules reading half-written payloads, `GRM` should write response files in this order:

1. `v_dn.csv`
2. `potreba.csv`
3. `manifest.json`

Important rule:
- `manifest.json` must be written last

This makes `manifest.json` the completion signal for `poc-v1`.

### Downstream read order

Recommended downstream read order:

1. wait until `manifest.json` exists
2. read `manifest.json`
3. validate:
   - `request_id`
   - `contract_version`
   - `status`
   - `files`
4. if status is `completed` or `completed_with_warnings`, read CSV files
5. if status is `failed`, do not ingest

### Expected response time

For human/operator communication in `poc-v1`, recommended wording is:

- `GRM` checks requests every `5` seconds
- typical response for a normal `date_window` request is expected within `15` to `60` seconds

This is an operational expectation, not a strict SLA.

### Path duality rule

All integrations should be documented with both path views:

Linux / server:
- `/mnt/nas/004_Konstrukcija/010_BI_File_Drop/...`

Windows / user view:
- `Z:\004_Konstrukcija\010_BI_File_Drop\...`

Both paths point to the same shared file-drop location.
