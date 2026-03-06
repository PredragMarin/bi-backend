# Migration Status
Date: 2026-03-06
Branch: `restructure/core-shell-v1`

## Completed (Phase 1 Foundation)
- Added governance file: `AGENTS.md`
- Added migration roadmap: `PLANS.md`
- Added baseline lock doc: `docs/BASELINE.md`
- Created Core Shell storage skeleton:
  - `src/core_shell/storage/index.js`
  - `src/core_shell/storage/fs_store.js`
- Wired compatibility bridge:
  - `src/core/store.js` now delegates to Core Shell storage interface.

## Completed (Phase 2/3 In Progress)
- Extracted EPR domain ownership into module path:
  - `src/modules/epr_attendance_v1/domain/compute.js`
  - `src/modules/epr_attendance_v1/domain/recap.js`
- Added compatibility adapters in legacy core path:
  - `src/core/epr/compute.js` -> re-export module domain compute
  - `src/core/epr/recap.js` -> re-export module domain recap
- Moved production-grade EPR data adapters into module path:
  - `src/modules/epr_attendance_v1/adapters/db_fetch_epr.js`
  - `src/modules/epr_attendance_v1/adapters/hzzo_ingest.js`
- Updated API import to module adapter:
  - `src/api/server.js` now imports fetch adapter from module path.
- Kept compatibility wrappers for existing dev imports:
  - `src/dev/db_fetch_epr.js`
  - `src/dev/hzzo_ingest.js`

## Completed (Phase 4 Kickoff)
- Introduced module runtime entry for EPR:
  - `src/modules/epr_attendance_v1/module_runtime.js`
- Introduced core shell module registry:
  - `src/core_shell/kernel/module_registry.js`
- Replaced hardcoded runtime branching with registry dispatch:
  - `src/core/runtime.js` now resolves module runtime via registry.
- Preserved existing pointer behavior through module runtime metadata:
  - `current_pointer_use_case: "use_case_EPR"` for EPR module.

## Behavior Intent
- No intentional business behavior changes.
- Refactor is boundary/ownership oriented.

## Validation Performed
- `node --check` passed for changed JS files.
- Module/runtime load check passed without execution of long-running server.

## Next Phase
1. Start consolidating duplicated shared helpers (CSV/period/decision parsing) into core shell libs.
2. Define EOJN consolidation target workflow and watchlist persistence contract through storage interface.
3. Add EOJN module runtime entry and registry integration.
4. After parity confidence, remove legacy bridge files (`src/core/epr/*` thin adapters and `src/dev/*` wrappers).

## Rollback
- Safe rollback via git tag: `pre-core-shell-restructure-2026-03-06`
- Or revert branch commits in `restructure/core-shell-v1`.
