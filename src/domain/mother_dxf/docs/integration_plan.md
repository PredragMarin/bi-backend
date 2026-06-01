# Integration Plan with Core Shell I/O

No integration code is added in this phase. This plan describes the future
boundary.

## Phase 1: Domain Registry Assembly

Input sources:

- Core Shell rule catalog loader
- Core Shell parameter catalog loader
- future product/family catalog loader
- future batch catalog loader

Action:

- Assemble an in-memory Mother DXF domain registry.
- Run `validateDomainRegistry(registry)`.
- Build a dependency graph for diagnostics and configurator previews.

Output:

- no durable write from domain layer
- optional validation report returned to caller

## Phase 2: Session Envelope Usage

The domain layer must not change the canonical session envelope or legacy
payload shape.

Allowed future usage:

- Read session context from Core Shell loaded payload.
- Derive a domain resolution context, for example family, product, part,
  technology unit, and batch item selectors.
- Return selected domain plans to the caller.

Forbidden:

- writing session envelopes directly
- adding domain fields into payload without an approved migration
- changing envelope revision behavior

## Phase 3: Artifact Registry Usage

The domain layer does not register artifacts.

Allowed future usage:

- Return artifact intent metadata such as expected preview model ID or
  transformation reference.
- Core Shell or runtime registers real artifacts through artifact registry I/O.

Forbidden:

- direct registry writes
- new artifact paths from domain code
- path changes for existing artifacts

## Phase 4: Parameter Set I/O

The domain layer resolves parameter plans in memory.

Future caller flow:

1. Core Shell loads parameter catalogs.
2. Domain resolver selects and resolves parameter set v2 for context.
3. Existing Core Shell `saveParamSet(sessionId, resolvedPlan, rootDir)` persists
   the session parameter set if the current runtime needs it.

The domain layer never calls `saveParamSet`.

## Phase 5: Rules Catalog

The domain layer defines and selects rule sets, but does not load files.

Future caller flow:

1. Core Shell loads rule catalog.
2. Domain selects rule sets by technology unit, family, and dependencies.
3. Runtime applies existing rule logic or a later approved rule engine.

## Phase 6: Batch Models

The domain layer creates batch execution units in memory.

Future caller flow:

1. Core Shell loads or creates a batch manifest.
2. Domain validates batch item references and groups technology units.
3. Core Shell persists batch/job records through batch I/O when implemented.

## Rollback

Because this phase adds an isolated domain directory and docs only, rollback is
removing `src/domain/mother_dxf` and any tests/docs that reference it. Existing
API, DXF runtime, Core Shell I/O paths, session payloads, and artifact paths are
unchanged.

