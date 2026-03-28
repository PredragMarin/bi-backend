# CORE_BOUNDARY_RULES.md

## 1. Purpose

This document defines the current Core vs Core Shell boundaries in `bi-backend` after the recent controlled consolidation steps.

Its purpose is practical:
- prevent reintroducing `core` / `core_shell` duality
- give future work a small set of enforceable entry points
- keep ongoing module integration consistent with the current repo state

This document does not describe a future rewrite. It describes how the repository should be worked on now.

## 2. Current Target Layer

Treat `src/core_shell/*` as the target platform layer for new shared/platform capabilities.

Use `src/core_shell/*` for:
- shared service access paths
- shared config access
- shared storage entry points
- module registration
- DB/platform infrastructure

Current target-layer examples:
- `src/core_shell/services/erp_fetch_service.js`
- `src/core_shell/config/erp_config.js`
- `src/core_shell/config/sms_config.js`
- `src/core_shell/storage/index.js`
- `src/core_shell/kernel/module_registry.js`
- `src/core_shell/config/db_config.js`

## 3. Current Compatibility Layer

Treat `src/core/*` as a legacy compatibility layer under migration.

`src/core/*` still contains active code and must not be treated as dead code. However, it is not the preferred target for new shared/platform development.

Current compatibility-layer examples:
- `src/core/runtime.js`
- `src/core/store.js`
- `src/core/erp_gateway/*`
- `src/core/excel_shell/*`
- `src/core/sms_*`
- `src/core/epr/*`

Allowed work in `src/core/*` is limited to:
- narrowly scoped compatibility bridges
- low-risk fixes that preserve current behavior
- approved maintenance of specialized legacy capabilities

Do not add new shared/platform code to `src/core/*`.

## 4. Official Entry Points

### ERP fetch

Use:
- `src/core_shell/services/erp_fetch_service.js`

Responsibility:
- official access path for allowed ERP batch fetches

Rule:
- new module/shared code must not import `src/core/erp_gateway/client.js` directly

### ERP config

Use:
- `src/core_shell/config/erp_config.js`

Responsibility:
- ERP DSN resolution
- ERP credential/config access path

Rule:
- new ERP config reads should go through this file, not through direct `process.env` reads

### SMS config

Use:
- `src/core_shell/config/sms_config.js`

Responsibility:
- SMS gateway outbox dir
- SMS ledger root
- SMS contract defaults

Rule:
- new SMS config reads should go through this file, not through direct `process.env` reads

### Storage JSON writes

Use:
- `src/core_shell/storage/index.js`

Responsibility:
- official public storage entry point
- public access to `writeJsonAtomic`

Rule:
- new shared durable JSON writes should use `src/core_shell/storage/index.js`
- do not import `src/core_shell/storage/fs_store.js` directly outside storage internals

### Module registry

Use:
- `src/core_shell/kernel/module_registry.js`

Responsibility:
- registering and resolving module runtimes

Rule:
- future shared/module runtime registration should use this registry

### DB config

Use:
- `src/core_shell/config/db_config.js`

Responsibility:
- PostgreSQL and DB platform config loading

Rule:
- new shared DB config access should use this file

### Workbook ingest

Workbook ingest currently has two distinct capability lines. They are not the same thing and must not be merged casually.

1. Node/XLSX workbook reader
Use:
- `src/core_shell/services/workbook_ingest_service.js`

Responsibility:
- workbook file support checks
- workbook matrix extraction for EOJN-style analysis

2. Legacy Excel ingest shell
Use:
- `src/core/excel_shell/run.js`
- `src/core/excel_shell/extract.js`
- `src/core/excel_shell/discover.js`

Responsibility:
- workbook discovery
- validation hooks
- row-oriented extraction
- PowerShell / Excel COM fallback behavior

Rule:
- do not force these two capability lines into one API without a separate approved plan

## 5. Rules for New Code

- New shared/platform code must go into `src/core_shell/*`.
- Do not add new shared/platform code into `src/core/*`.
- Do not add new direct imports from `src/core/erp_gateway/client.js`.
- Do not add new direct shared `process.env` reads where a `src/core_shell/config/*` entry point already exists.
- For ERP config, use `src/core_shell/config/erp_config.js`.
- For SMS config, use `src/core_shell/config/sms_config.js`.
- For DB config, use `src/core_shell/config/db_config.js`.
- For shared durable JSON writes, use `src/core_shell/storage/index.js`.
- Do not add new direct imports from `src/core_shell/storage/fs_store.js`.
- Do not introduce new shared storage helpers outside `src/core_shell/storage/*`.
- Do not create new route-level orchestration paths that bypass existing Core Shell entry points.
- `src/api/server.js` must not grow new parallel orchestration patterns.
- Do not add new shared PowerShell / Excel COM workbook helpers in module code.
- Do not treat `src/core/*` as the default place for new reusable utilities.

## 6. Rules for New Modules

When integrating a new module:

- Keep domain/business logic inside `src/modules/<module>/*`.
- Consume shared platform capabilities from `src/core_shell/*`.
- Use `src/core_shell/services/erp_fetch_service.js` for ERP access.
- Use `src/core_shell/config/*` for shared config access.
- Use `src/core_shell/storage/index.js` or module-specific Core Shell store services for shared durable JSON writes.
- Do not implement a module-local ERP client.
- Do not implement a module-local generic config loader if a Core Shell config access path already exists.
- Do not implement a module-local generic JSON durable write helper.
- Do not import legacy `src/core/*` shared capabilities directly unless there is an approved compatibility exception.
- Do not expand `src/api/server.js` with one-off orchestration logic for the module if an existing module/runtime entry path can be used.
- For workbook ingest, first determine which capability line is actually needed:
  - `src/core_shell/services/workbook_ingest_service.js` for Node/XLSX matrix reading
  - `src/core/excel_shell/*` only for specialized legacy COM/PowerShell ingest scenarios

## 7. Known Open Gaps

- Runtime contract is still hybrid: `src/core/runtime.js` remains a compatibility entry point while module registry is in `src/core_shell/kernel/module_registry.js`.
- Route-level orchestration is still too heavy, especially in `src/api/server.js`.
- Artifact lifecycle is not yet normalized across all modules.
- Logging and audit are not yet formalized as one Core Shell contract.
- SMS subsystem is only partially consolidated: config access is centralized, but runtime/storage/publish internals remain legacy.
- Workbook ingest boundary is understood, but intentionally left split between two capability lines.
- Some module-specific durable writes still bypass a more explicit Core Shell contract.

## 8. Near-term Next Step

Near-term next step:
- formalize a small Core Contract v1 based on the current entry points and boundaries

This should stay documentation-first and should not trigger a broad refactor.

The immediate goal is to make future work consistent:
- use the current official entry points
- stop creating new direct imports into legacy `core`
- stop growing route-level orchestration in `src/api/server.js`
