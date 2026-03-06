# PLANS.md

## Migration Plan: Core Shell + Modules (DB-ready)

### Phase 0: Baseline Lock
- Freeze current behavior in `docs/BASELINE.md`.
- Tag snapshot before structural work.
- Accept temporary dual structure during migration.

Exit gate:
- Baseline document present.
- Snapshot tag exists.

### Phase 1: Governance + Skeleton
- Add `AGENTS.md` and `PLANS.md`.
- Create `src/core_shell` skeleton.
- Introduce storage interface with filesystem backend.
- Keep runtime behavior unchanged.

Exit gate:
- Existing critical flows still run.
- New code paths are additive/compatible.

### Phase 2: Storage Abstraction Adoption
- Route existing runtime/store writes through core_shell storage interface.
- Keep existing output locations compatible.
- Add run/event metadata normalization in one place.

Exit gate:
- Dry-run and non-dry run behavior remains compatible.
- No direct durable writes from modules.

### Phase 3: Module Boundary Extraction
- Move EPR business compute from `src/core/epr/*` to `src/modules/epr_attendance_v1/domain/*`.
- Keep thin compatibility adapter in core while migrating.
- Move production-grade code from `src/dev` to module adapters.

Exit gate:
- Same EPR outputs for locked baseline scenarios.
- Clear core/module ownership boundaries.

### Phase 4: EOJN Consolidation
- Merge EOJN smoke scripts into one orchestrated module workflow.
- Implement watchlist state through storage interface.
- Remove ad-hoc state handling.

Exit gate:
- EOJN runnable as one coherent module flow.
- Watchlist persistence path is stable and auditable.

### Phase 5: UI Shell Foundation
- Introduce menu-like UI shell container.
- Register module pages via descriptors.
- Keep existing EPR/SMS pages reachable during transition.

Exit gate:
- Shared navigation works.
- Existing operator flows still available.

### Phase 6: DB Backend Enablement
- Add BI DB storage backend behind same storage interface.
- Run filesystem and DB backend in controlled parallel test mode.
- Switch default backend by config only.

Exit gate:
- No module code changes required when switching backend.
- Data integrity checks pass.

## Behavior Change Policy
- Default: no behavior change.
- Any behavior change must be explicitly listed as approved scope in the active phase note.

## Rollback Policy
- Keep changes phase-scoped and small.
- Each phase must be revertible as an isolated commit series.
- Snapshot tags should exist before major phase transitions.
