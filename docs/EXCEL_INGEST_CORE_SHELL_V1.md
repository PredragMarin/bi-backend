# Excel Ingest Core Shell v1

## Purpose
Define a shared Excel ingest shell for multiple modules, with strict/lenient execution modes.

- `EOJN`: lenient, best-effort parse for early human signal.
- `EPR`: strict, deterministic parse for payroll-safe processing.

## Scope v1
Core shell handles only technical ingest concerns:
1. Discover input files.
2. Extract workbook/sheet rows.
3. Produce unified audit and error envelope.

Business/domain logic stays in module adapters.

## Central Source Config
Use one central config entry-point for all module ingest targets.

- File: `src/core/excel_shell/ingest_sources.js`
- Source resolution priority:
1. Request override (`source_dir` or module-specific override field)
2. Central template/dir from ingest source config
3. Error (for strict flows)

`epr_hzzo` and `eojn_budget` should be configured there, not in many per-module files.

## Architecture
```text
Input (file/folder)
  -> Core Discover
  -> Core Extract
  -> Adapter Normalize/Parse (module-specific)
  -> Adapter Aggregate/Pack (module-specific)
  -> Module Compute
```

## Modes
### LENIENT (EOJN)
- Parse can be partial.
- Unknown structures are tolerated.
- `can_continue=true` is allowed with warnings.
- Failure routes to manual review, not hard stop.

### STRICT (EPR)
- Required fields and mappings must validate.
- Ambiguous/missing critical data causes hard fail.
- `can_continue=false` on critical errors.
- No silent fallback that could alter payroll outcome.

## Contract: IngestEnvelope v1
```json
{
  "status": "OK|PARTIAL|FAIL",
  "mode": "LENIENT|STRICT",
  "can_continue": true,
  "manual_review_required": false,
  "input": {
    "source": "path-or-folder",
    "as_of": "YYYY-MM-DD",
    "period": { "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" }
  },
  "files": [
    {
      "path": "string",
      "name": "string",
      "mtime_ms": 0,
      "read_status": "OK|FAIL",
      "error": ""
    }
  ],
  "extract": {
    "workbooks": 0,
    "sheets": 0,
    "rows_loaded": 0
  },
  "normalized_rows": [],
  "audit": {
    "files_total": 0,
    "files_loaded": 0,
    "files_failed": 0,
    "warnings": [],
    "errors": []
  }
}
```

## Responsibility Split
### Core shell responsibilities
1. File discovery (`file` or `folder`, extension filter, sorting).
2. Workbook extraction (sheet loop, row capture, encoding/path robustness).
3. Technical dedup (same file/sheet/row hash, optional).
4. Unified telemetry and error reporting.

### Module adapter responsibilities
1. Domain normalization (column meaning, date semantics, reason codes).
2. Business dedup and interval logic.
3. Filtering by business period and `as_of`.
4. Domain mapping (e.g., OIB -> osebid).
5. Packing for module compute.

## Error Policy
### LENIENT
- Non-critical parse errors -> warning.
- Continue when possible.
- Mark manual review when confidence is low.

### STRICT
- Critical parse/mapping errors -> `FAIL`.
- Stop downstream compute.
- Return machine-readable error list.

## EOJN Adapter Rules (v1)
1. Multi-sheet and unknown structure supported.
2. Row grouping allowed (one logical item may span multiple Excel rows).
3. Output focuses on keyword incidence signal for human triage.
4. Parsing failure is not catastrophic; escalate to manual review.

## EPR Adapter Rules (v1)
1. Deterministic mapping and validation.
2. Multi-file aggregation with snapshot timeline behavior.
3. Payroll-safe fail-closed semantics on critical uncertainty.
4. Full audit of synthesized rows and unmatched identities.

## Suggested Directory Layout
```text
src/core/excel_shell/
  discover.js
  extract.js
  audit.js
  ingest_sources.js
  fixtures.js
  run.js

src/modules/epr_attendance_v1/
  ingest_adapter_hzzo.js

src/modules/eojn_v1/
  ingest_adapter_budget.js
```

## Fixture Strategy (Extensible)
Keep one fixture root for all modules:

```text
fixtures/excel_ingest/
  index.json
  epr_hzzo/<case_id>/
  eojn_budget/<case_id>/
  <future_module>/<case_id>/
```

This allows adding fixture cases for new modules without adding new fixture systems.

## Minimal Test Matrix
1. Single file, valid structure.
2. Multiple files in folder.
3. Corrupted file in batch (others still load in lenient mode).
4. Unicode/mapped path handling.
5. Multi-sheet workbook with sparse layout.
6. STRICT mode critical mapping failure -> hard fail.

## Implementation Plan (Incremental)
1. Extract reusable code from current HZZO ingest into `core/excel_shell` (`discover+extract+audit`).
2. Keep existing EPR business logic in adapter with no rule changes.
3. Introduce EOJN adapter on top of same shell in lenient mode.
4. Add contract-level tests for both modes.
5. Enable by feature flag per module, then switch to default.
