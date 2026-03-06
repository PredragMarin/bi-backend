# AGENTS.md

## Purpose
This file defines architecture guardrails for development in `bi-backend` during Core Shell transformation.

## Locked Terminology
- `ERP (Gosoft SAP ASE)` is an external read-only source system.
- `EPR Attendance` is a BI module/use-case.
- `BI Core Shell` is shared platform infrastructure.
- `BI Core Store` is internal BI persistence (filesystem now, DB-ready by interface).

## Target Layering
- `src/core_shell/*` = shared platform services and orchestration.
- `src/modules/*` = domain/business logic only.
- `src/api/*` = transport layer only (HTTP/UI routing).

## Allowed Dependency Flow
- `api -> core_shell`
- `api -> modules` only through core_shell orchestration contract
- `modules -> core_shell/services`
- `core_shell` must not import from `modules`

## Forbidden Patterns
- No new production code in `src/dev`.
- No module direct persistence to filesystem/DB for durable state.
- No module direct calls to low-level ERP client; use core shell SQL fetch service.
- No copy-paste shared helpers across layers (CSV/date/period/decision parsing).

## Storage Rule
All durable writes must go through Core Shell storage interface:
- Current backend: filesystem
- Future backend: BI database
- Module code must stay backend-agnostic.

## API Rule
Public routes must be explicit, versioned, and stable.
Breaking response changes require explicit approval and migration note.

## Contracts Rule
Any new module or artifact must include:
- contract/schema file
- manifest update
- validation path

## Refactor Rule
Default mode is behavior parity unless a plan item explicitly states approved behavior change.

## Codex Execution Rule
Every architecture-affecting change must include:
1. files touched by layer
2. boundary impact
3. rollback note
