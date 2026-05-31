# Mother DXF I/O Layer (New Pipeline)

This directory contains the ONLY allowed entrypoints for all new Mother DXF durable I/O.

## Rules

1. All new I/O MUST go through these adapters.
2. Legacy I/O in module_runtime.js and mother_dxf_store.js is DISABLED.
3. Direct filesystem writes in legacy modules are FORBIDDEN and enforced by CI.
4. Adapters may initially throw NOT_IMPLEMENTED errors until migrated slice-by-slice.
5. Migration order:
   - event_stream
   - child_metadata
   - preview_io
   - param_set
   - session_store
   - artifact_registry

## Purpose

This layer enforces a single source of truth for Mother DXF I/O and prevents
parallel legacy/new I/O paths.
