# BASELINE.md
Status: Locked baseline before Core Shell restructuring  
Date: 2026-03-06  
Branch: `restructure/core-shell-v1`

## 1. Purpose
This document freezes current observable behavior so architecture refactoring can proceed with controlled risk.

Refactoring target:
- Introduce `BI Core Shell + Modules` boundaries
- Keep critical runtime behavior stable unless explicitly approved

## 2. Terminology (Locked)
- `ERP (Gosoft SAP ASE)` = external read-only source system (SQL SELECT only)
- `EPR Attendance` = BI module/use-case (`epr_attendance_v1`)
- `EOJN` = BI module/use-case (`eojn_v1`, now consolidated around canonical latest-state + history filesystem model)
- `BI Core Store` = internal BI persistence (currently filesystem)

## 3. Current Entrypoints and Flows

### 3.1 API/Server flows currently in use
- EPR run with provided payload
- EPR run-db (fetch from ERP, run deterministic pipeline)
- Export-and-publish flow
- SMS approvals and outbox publish routes
- UI routes for EPR and SMS pages
- Health route

Note:
- There are multiple entrypoints (`src/index.js` and `src/api/server.js`).
- Current baseline accepts this; consolidation will happen later.

### 3.2 EOJN flow currently in use
- EOJN uses a canonical filesystem state under `out/eojn_v1/_state`.
- Main operator worklist is based on latest-state by `TenderId`.
- Daily run artifacts remain available for audit/debug.
- EOJN is not yet final production-hardening complete, but is no longer only smoke/proto flow.

## 4. Baseline Behavior to Preserve During Refactor

### 4.1 EPR module behavior
Must remain functionally equivalent:
- Input validation behavior
- Core compute outcomes for:
  - interval results
  - daily summary
  - period summary
  - actions queue
  - recap lines
- Run metadata generation semantics
- Existing dry-run behavior
- Existing HZZO overlay behavior (when enabled)

### 4.2 ERP fetch behavior
Must remain functionally equivalent:
- Allowed SQL query execution pattern
- Query parameter conventions
- Returned mapped datasets (`epr_data`, `calendar`, `osebe_raw`)
- Existing error semantics (sanitized failure style)

### 4.3 SMS behavior
Must remain functionally equivalent:
- Preview + approvals join behavior
- Approval decision normalization semantics
- Outbox contract validation semantics
- Idempotency checks via ledger
- Atomic outbox drop behavior

### 4.4 EOJN baseline
During remaining EOJN stabilization:
- Existing Layer 1 and Layer 2 flows must still execute
- Canonical `_state` worklist/history artifacts must remain producible
- Daily run-folder artifacts must remain obtainable for audit/debug

## 5. Current Artifacts (Filesystem baseline)
Current filesystem artifacting is accepted as baseline.
Exact structure may evolve later, but during architecture refactor:
- Existing EPR publish outputs must remain producible
- Existing SMS approvals/outbox files must remain producible
- Existing EOJN run outputs must remain producible

## 6. Known Baseline Weaknesses (Accepted for now)
- Blurred Core vs Module boundaries
- Production flow depending on `src/dev` code
- Duplicate helper logic across layers
- Rudimentary frontend/UI structure
- Filesystem-centric storage without formal storage abstraction
- EOJN KPI/reporting layer not yet finalized

These are intentional refactor targets and not immediate blockers.

## 7. Refactor Acceptance Criteria (Phase Gate)
A refactor increment is acceptable only if:
1. No critical baseline flow is broken
2. Inputs/outputs remain behaviorally compatible for locked flows
3. Architecture boundaries improve (measurable reduction in cross-layer coupling)
4. Rollback remains possible via git branch/tag snapshot

## 8. Change Policy During Restructure
Allowed without extra approval:
- Folder/module movement
- Interface extraction
- Dependency inversion
- Shared service consolidation

Requires explicit approval:
- Behavior changes in EPR compute rules
- Breaking API contract changes
- Artifact contract breaking changes
- Storage backend switch from FS to DB as default

## 9. Out of Scope for This Baseline Lock
- Final UI redesign
- EOJN final unattended production hardening
- Payroll module implementation
- MES control module implementation

## 10. Next Documents
After baseline lock:
- `AGENTS.md` (architecture guardrails for development/Codex)
- `PLANS.md` (phase-by-phase migration execution plan)
