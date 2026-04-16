# GRM_IMPLEMENTATION_OUTLINE_v1.md

## 1. Purpose

This document defines the file-by-file implementation outline for:

- `src/modules/gosoft_request_module_v1/`

It is intended to turn the POC contract into a concrete coding plan without starting a broad refactor.

## 2. Recommended Package Location

```text
src/modules/gosoft_request_module_v1/
```

Rationale:
- host-side integration module
- use-case specific
- not yet a generic permanent Core Shell capability
- still consumes Core Shell services and follows Core Shell boundaries

## 3. Proposed File Structure

```text
src/modules/gosoft_request_module_v1/
  module_manifest.json
  index.js
  runtime.js
  contract/
    request_contract_v1.json
    manifest_contract_v1.json
  config/
    grm_config.js
  services/
    request_inbox_service.js
    target_folder_service.js
    response_package_service.js
    manifest_builder_service.js
    csv_export_service.js
  adapters/
    erp_parent_fetch.js
    erp_child_fetch.js
    erp_child_enrichment.js
  domain/
    request_validator.js
    request_router.js
    processing_policy.js
    warning_codes.js
  stores/
    request_archive_store.js
  README.md
```

## 4. File Responsibilities

### `module_manifest.json`

Purpose:
- identify GRM as a host-side integration module
- declare `poc-v1` transport contract
- declare request/response contract references

Should include:
- `module_id`
- `module_version`
- `owner`
- `use_case`
- `entrypoints`
- contract/schema references

### `index.js`

Purpose:
- small public entry module
- export main runtime entry
- avoid leaking internal structure

### `runtime.js`

Purpose:
- module runtime entry for orchestration
- single place that coordinates:
  - request discovery
  - request validation
  - fetch
  - enrichment
  - response write
  - archive/error flow

This should be the primary orchestration file for POC.

### `contract/request_contract_v1.json`

Purpose:
- machine-readable request schema for `poc-v1`

Should validate:
- required request fields
- `fetch_mode`
- `target_drop`
- param shape for `date_window`

### `contract/manifest_contract_v1.json`

Purpose:
- machine-readable response manifest schema for `poc-v1`

Should validate:
- required manifest fields
- allowed statuses
- counts/files/warnings structure

### `config/grm_config.js`

Purpose:
- central config facade for GRM paths and defaults

Should provide:
- integration root
- request inbox path
- known target drops
- default target subfolders
- archive behavior flags

Rule:
- keep path/config reads here, not scattered across module files

### `services/request_inbox_service.js`

Purpose:
- scan request inbox
- load request file contents
- filter candidate files

Should not perform business validation itself.

### `services/target_folder_service.js`

Purpose:
- resolve target root from `target_drop`
- ensure folders exist
- bootstrap:
  - `responses`
  - `errors`
  - `archive_processed`
  - `archive_failed`

This is where host-owned folder lifecycle should live.

### `services/response_package_service.js`

Purpose:
- write response package layout
- ensure file naming is consistent
- keep `request_id` alignment across output files

Should write:
- manifest
- `v_dn.csv`
- `potreba.csv`

### `services/manifest_builder_service.js`

Purpose:
- build manifest object from processing result

Should set:
- `request_id`
- `module_id`
- `contract_version`
- `status`
- `counts`
- `warnings`
- `lineage`

### `services/csv_export_service.js`

Purpose:
- turn row arrays into CSV strings/files
- preserve expected column order
- handle escaping consistently

### `adapters/erp_parent_fetch.js`

Purpose:
- fetch parent scope from `V_DN`

Expected responsibility:
- build/fill parent query for `date_window`
- return raw parent rows

### `adapters/erp_child_fetch.js`

Purpose:
- fetch child scope from `POTREBA`

Expected responsibility:
- use parent result keys to fetch children
- return raw child rows

### `adapters/erp_child_enrichment.js`

Purpose:
- host-owned enrichment pipeline for child rows

Current `poc-v1` responsibility:
- apply:
  - `POTREBA.ident + 1 -> ARTIKEL.artid`
  - `ARTKLAS.artid -> ARTIKEL.artid`
- add enriched fields to child rows
- aggregate `ARTKLAS.kljuc` into `artklas_kljucevi`

Important:
- ERP quirks/workarounds must stay here, not in downstream modules

### `domain/request_validator.js`

Purpose:
- validate request object against POC rules

Should validate:
- required fields
- supported `fetch_mode`
- supported `target_drop`
- params shape
- request identity consistency

### `domain/request_router.js`

Purpose:
- translate request into processing route
- choose target root and processing strategy

Useful now because later:
- `date_window`
- `dnid_list`
- `sifradn_list`
may need different fetch flows

### `domain/processing_policy.js`

Purpose:
- centralize policy choices that are not raw config

Examples:
- full snapshot rule
- idempotency rule
- fail vs warning behavior
- archive behavior

### `domain/warning_codes.js`

Purpose:
- stable warning/error code definitions

Examples:
- `SIFRADN_MULTI_DNID`
- `PARTIAL_ENRICHMENT`
- `EMPTY_RESPONSE`
- `MISSING_PARENT_FOR_CHILD`

### `stores/request_archive_store.js`

Purpose:
- move/copy processed requests into archive folders
- keep archive behavior encapsulated

Even if this is still filesystem-based, it should remain a small host-side storage helper inside the GRM package.

### `README.md`

Purpose:
- quick developer/operator usage note
- explain what GRM does
- explain where request/response folders live

## 5. Recommended Runtime Flow

`runtime.js` should orchestrate:

1. load GRM config
2. discover request files
3. parse request
4. validate request
5. resolve target folder
6. ensure folders exist
7. fetch parent rows
8. fetch child rows
9. enrich child rows
10. build warnings/counts
11. write `v_dn.csv`
12. write `potreba.csv`
13. write manifest
14. archive request to processed
15. on failure, write failed manifest/error and archive request to failed

## 6. Scope Control Rules

For initial coding:
- do not add API routes yet
- do not add auth model
- do not add DB-backed request ledger
- do not generalize beyond current POC fetch modes
- do not move ERP quirks into downstream module contracts

## 7. Minimum First Implementation Slice

The smallest useful first slice is:

1. folder bootstrap
2. request parse + validate
3. `date_window` parent fetch
4. child fetch
5. child enrichment
6. manifest generation
7. CSV output
8. archive/error flow

This slice is enough to power Aldo POC end-to-end.

## 8. Suggested Next Coding Order

1. `config/grm_config.js`
2. `domain/request_validator.js`
3. `services/target_folder_service.js`
4. `adapters/erp_parent_fetch.js`
5. `adapters/erp_child_fetch.js`
6. `adapters/erp_child_enrichment.js`
7. `services/csv_export_service.js`
8. `services/manifest_builder_service.js`
9. `services/response_package_service.js`
10. `runtime.js`
11. `module_manifest.json`
12. contract JSON files
