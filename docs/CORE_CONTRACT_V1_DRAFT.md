# CORE_CONTRACT_V1_DRAFT.md

## 1. Purpose

This document defines a practical Core Contract v1 draft for the current state of `bi-backend`.

It is intended to help:
- integrate new modules without increasing `core` / `core_shell` duality
- give developers a concrete contract for shared service access
- define what modules may assume today, even while the repository is still hybrid

This is a current-state draft, not a target-state redesign.

## 2. Scope

This contract applies to:
- new modules under `src/modules/*`
- new shared/platform code under `src/core_shell/*`
- route/runtime integration that depends on shared platform capabilities

This contract does not claim that all platform concerns are complete.
It only covers the currently usable boundaries and entry points.

## 3. Contract Status

### Already available

- ERP fetch access path:
  - `src/core_shell/services/erp_fetch_service.js`
- ERP config access path:
  - `src/core_shell/config/erp_config.js`
- SMS config access path:
  - `src/core_shell/config/sms_config.js`
- Public JSON storage write entry point:
  - `src/core_shell/storage/index.js`
- Module registry:
  - `src/core_shell/kernel/module_registry.js`
- DB config access path:
  - `src/core_shell/config/db_config.js`
- Workbook matrix reader for EOJN-style analysis:
  - `src/core_shell/services/workbook_ingest_service.js`

### Partial

- Runtime/orchestration contract is still hybrid:
  - compatibility runtime entry remains in `src/core/runtime.js`
  - module registry is in `src/core_shell/kernel/module_registry.js`
- Storage/artifact handling is only partially normalized:
  - some JSON durable writes already have a Core Shell access path
  - many module-specific artifact writes still remain direct and specialized
- SMS subsystem is only partially under Core Shell contract:
  - config access is centralized
  - runtime/publish/ledger internals remain legacy

### Placeholder / not yet implemented

- formal auth/roles contract
- formal logging contract
- formal audit contract for all modules
- formal job runner / batch runner contract
- normalized artifact lifecycle contract across all modules
- single unified workbook ingest contract

## 4. Module Identity Contract

Every new module should define a minimal identity contract.

Required fields:
- `module_id`
- `module_version`
- `owner`
- `use_case`
- `entrypoints`

Current repo shape suggests:
- `use_case` is the runtime lookup key used by `src/core_shell/kernel/module_registry.js`
- `module_version` and contract metadata belong in module manifest files such as:
  - `src/modules/epr_attendance_v1/module_manifest.json`
  - `src/modules/eojn_v1/module_manifest.json`

Practical expectations:
- `module_id`: stable internal identifier for the module package
- `module_version`: current module version string
- `owner`: owning team or responsible person/group
- `use_case`: runtime use-case key used for orchestration
- `entrypoints`: explicit runtime/API-facing entrypoints exposed by the module

Current runtime registration pattern:
- module runtimes are registered in:
  - `src/bootstrap/register_modules.js`
- module lookup happens via:
  - `src/core_shell/kernel/module_registry.js`

## 5. Shared Service Access Contract

### ERP fetch

Available now.

Use:
- `src/core_shell/services/erp_fetch_service.js`

Rule:
- modules must not directly import `src/core/erp_gateway/client.js`

### ERP config

Available now.

Use:
- `src/core_shell/config/erp_config.js`

Rule:
- shared ERP config reads should go through this file

### SMS config

Available now.

Use:
- `src/core_shell/config/sms_config.js`

Rule:
- shared SMS config reads should go through this file

### Storage JSON writes

Available now.

Use:
- `src/core_shell/storage/index.js`

Rule:
- public JSON durable write access should use `writeJsonAtomic` from this entry point
- do not import `src/core_shell/storage/fs_store.js` directly outside storage internals

### DB config

Available now.

Use:
- `src/core_shell/config/db_config.js`

### Workbook ingest

Partial. Two distinct capability lines exist.

1. Node/XLSX workbook reader
- `src/core_shell/services/workbook_ingest_service.js`
- use for matrix-style workbook extraction and workbook support checks

2. Legacy Excel ingest shell
- `src/core/excel_shell/run.js`
- `src/core/excel_shell/extract.js`
- `src/core/excel_shell/discover.js`

Use this legacy line only for specialized scenarios that depend on:
- discovery logic
- validation hooks
- row-based extraction
- PowerShell / Excel COM fallback behavior

Rule:
- do not assume workbook ingest is one unified service today
- do not merge the two capability lines without a separate approved plan

## 6. Persistence / Artifact Contract

What should go through Core Shell storage now:
- shared durable JSON writes
- shared platform-level state writes
- module-store style JSON persistence that is part of shared host behavior

Current entry point:
- `src/core_shell/storage/index.js`

What may remain module-specific for now:
- EPR export CSV outputs
- EPR export manifests tied to current export flow
- EOJN specialized artifact/state/history/canonical files already managed by current EOJN store services
- specialized SMS ledger append behavior

What new modules should not write directly:
- new shared platform state JSON files
- new generic persistent JSON state outside Core Shell entry points
- new module-local copies of generic atomic JSON write helpers

Practical rule:
- if a durable write is shared/platform-like, it should not be invented directly inside a new module

## 7. Config Contract

Direct `process.env` is forbidden when:
- the config is shared/platform-level
- a `src/core_shell/config/*` access path already exists for that capability

Use `src/core_shell/config/*` now for:
- ERP config:
  - `src/core_shell/config/erp_config.js`
- SMS config:
  - `src/core_shell/config/sms_config.js`
- DB config:
  - `src/core_shell/config/db_config.js`

Direct `process.env` may still exist in legacy code, but new shared code should not add to that pattern.

Practical rule for new modules:
- do not add new shared config reads directly from environment if the value belongs to a platform capability

## 8. Runtime / Orchestration Contract

Current reality is hybrid.

Today, modules should assume:
- module runtimes are registered through:
  - `src/bootstrap/register_modules.js`
- runtime lookup happens through:
  - `src/core_shell/kernel/module_registry.js`
- some orchestration still enters through:
  - `src/core/runtime.js`

Modules should not bypass:
- module registry for registered module runtime access
- Core Shell service entry points for shared capabilities
- established API/runtime paths with ad hoc parallel orchestration

Important repo rule:
- `src/api/server.js` should not grow new parallel orchestration patterns

## 9. Rules for Future Module Integration

This applies especially to a future heavy external module such as DXF/OPS.

A new module may consume:
- ERP fetch via `src/core_shell/services/erp_fetch_service.js`
- shared config via `src/core_shell/config/*`
- JSON durable writes via `src/core_shell/storage/index.js`
- module registration via `src/core_shell/kernel/module_registry.js`

A new module must not implement directly:
- its own ERP client
- its own shared config facade for existing platform capabilities
- its own generic persistent JSON storage helper
- new route-level orchestration that bypasses current runtime/module registration patterns

What should remain inside module domain logic:
- module-specific business rules
- module-specific transformation logic
- module-specific artifact interpretation
- module-specific parsing that is not clearly reusable platform behavior

## 10. DXF Resolver Contract Addendum

This addendum captures completed shared resolver functionality as it is rounded off, so Mother DXF and future DBR batch processing do not drift into separate resolver semantics.

### Mother DXF / DBR Resolver Boundary

- Mother DXF is the operator-facing authoring, inspection, and preview UI.
- DBR is the future headless batch consumer and must not depend on Mother DXF UI/runtime internals.
- Core Shell resolver services are the shared engine boundary between them.
- Completed resolver capabilities must be written here before DBR production use is approved.

### 4-band Parameter Resize Slice

Status: Core Shell 4-band preview resolver confirmed for shadow visualization; DBR production activation remains not approved.

Current completed contract surface:

- file-level metadata mode: `TOPO:mode=4_band_parameter_resize`
- resolver profile: `profile=standard_parametric_resize`
- required base band mapping keys: `l_parameter`, `r_parameter`, `t_parameter`, `b_parameter`
- required nominal keys: `l_nominal`, `r_nominal`, `t_nominal`, `b_nominal`
- required axis keys: `l_axis=X`, `r_axis=X`, `t_axis=Y`, `b_axis=Y`
- required factor keys: `l_delta_factor`, `r_delta_factor`, `t_delta_factor`, `b_delta_factor`
- corner behavior: `TL/TR/BL/BR` are derived from adjacent base band deltas

Confirmed Core Shell preview resolver slice:

- Core Shell now normalizes the saved `4_band_parameter_resize` runtime model into `standard_parametric_resize` band offsets when the runtime model is passed explicitly.
- `L/R/T/B` offsets are computed from `(parameter actual - nominal) * delta_factor` on the declared axis.
- `TL/TR/BL/BR` offsets are derived by adding adjacent base-band offsets.
- Optional `RULE:stage=topology_delta_modifier` catalog rules may adjust final base-band offsets after base 4-band delta calculation and before movement execution. They target a base band (`L`, `R`, `T`, or `B`) and axis, and corner bands inherit through the normal adjacent-band composition.
- KSKR-specific draft catalog rules are accepted in shadow/diagnostic mode: `KSKR_HIDDEN_CLOSER_LEFT_SHORTEN` applies `L.X += +5` when `HIDRAULICKI_ZATVARAC==Skriveni`; Core Shell emits `SUPERPOSED_TOPOLOGY_DELTA` warnings for catalog rules marked with `warning_on_superposition=true` when that modifier adds to an existing band offset in the same direction; `KSKR_EXTERNAL_DOOR_RIGHT_SHORTEN` applies `R.X += -30` when `VANJSKA_VRATA==Da`.
- 4-band inference policy is `explicit_layer_only`: circle/arc/insert follower behavior must come from explicit primary layer assignment such as `BL/BR/TL/TR`, not from geometric proximity heuristics.
- Mother DXF `/simulate` resolves entity-level `SEM` presence/variant filters into an effective geometry set before invoking the Core Shell 4-band shadow resolver.
- The Core Shell 4-band shadow map is rendered as preview-only `simulated_shapes` for operator inspection.
- Mother DXF may export a diagnostic `core_shell_4_band_shadow_child_dxf_v0` DXF for external viewer validation; it must carry `diagnostic_only=true` and `production_activation_status=not_approved` and must not be treated as DBR production child generation.
- Final child materialization order is SEM effective geometry, TOPO movement, post-TOPO offsets, final orientation mirror, bbox normalization to minX=0/minY=0, then child label TEXT emission. This keeps label text from being mirrored.
- Final orientation mirror is now explicit by axis. `DOOR_SX_DX_MIRROR_X_UNSTACKED` mirrors unstacked parts (`KSKR`, `OBRA`, `OSPY`, `OBRIT`, `OMET`) around X. `DOOR_SX_DX_MIRROR_Y_STACKED` mirrors stacked parts (`LBRA`, `LBRIT`, `LHOR`, `LMET`, `SBRA`, `SBRIT`, `SHOR`, `KDDV`, `KDLV`, `KDHOR`, `PS`) around Y. Deprecated `DOOR_SX_DX_MIRROR` remains only as a compatibility alias for older sessions. Mother DXF preview must emit `MISSING_FINAL_ORIENTATION_RULE` when parameters and part scope match a final-orientation candidate but no explicit document `rule_ref` is active.
- This preview visualization remains diagnostic-only and must not be treated as DBR child DXF generation or production activation.
- The shadow summary must report `active=false`, `diagnostic_only=true`, `behavior_change=false`, `production_activation_status=not_approved`, and `cleanup_approval=no`.

Boundary rule:

- Mother DXF may author and save this metadata.
- Core Shell owns the shared resolver profile semantics.
- DBR must consume this through Core Shell resolver entry points, not by importing Mother DXF runtime.

Not yet approved:

- strict Core Shell native session projection for this slice
- DBR child DXF generation from this slice
- removal of legacy Mother DXF fallback behavior

## 11. Known Gaps and Non-goals

Known gaps:
- runtime contract is still hybrid
- route-level orchestration is still heavier than desired
- artifact lifecycle is not normalized across all modules
- auth/roles are not formalized
- logging/audit are not formalized as one platform contract
- workbook ingest is intentionally split into two capability lines

Non-goals of this draft:
- replacing legacy `src/core/*` immediately
- declaring the repository fully platformized
- pretending that auth, roles, logging, or job orchestration are already solved
- forcing all filesystem writes into one abstraction immediately

## 12. Near-term Implementation Implications

For ongoing work, this draft implies:
- new shared/platform capability work should prefer `src/core_shell/*`
- new modules should use the official current entry points instead of direct legacy imports
- new shared config access should go through `src/core_shell/config/*`
- new shared durable JSON writes should go through `src/core_shell/storage/index.js`
- workbook ingest choices must stay explicit:
  - `core_shell` matrix reader for EOJN-style workbook analysis
  - legacy Excel shell only for specialized COM/PowerShell ingest cases

Near-term next step after this draft:
- use this document together with `docs/CORE_BOUNDARY_RULES.md` as the baseline for future module integration reviews
