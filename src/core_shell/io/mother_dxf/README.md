# Mother DXF Core Shell I/O Skeleton

Ovo nije runtime logika.

This directory is a source-side placeholder for the future Mother DXF DB-ready I/O layer. It mirrors the architecture skeleton in `docs/mother_dxf_io_v1_skeleton/` and aligns with the canonical contract in `docs/MOTHER_DXF_CONTRACT_v1.md`.

## Purpose

The future I/O layer will provide Core Shell boundaries for:

- session envelopes
- artifact registry metadata
- preview metadata
- child metadata
- batch/job metadata
- rule and parameter catalog loading
- frozen parameter sets
- event streams

## Current Status

These files are placeholders only.

- No runtime behavior is implemented.
- No DB code is implemented.
- No dependency is introduced.
- No Mother DXF module code imports this directory.
- No API route imports this directory.
- No artifact registry, path reference, or envelope builder is implemented here.

## Layout

```text
session/
  session_store.js
  artifact_registry.js
preview/
  preview_io.js
child/
  child_metadata.js
batch/
  batch_io.js
catalogs/
  rule_catalog_loader.js
  param_catalog_loader.js
  param_set.js
events/
  event_stream.js
cli/
  mother_cli.js
```

## Future Integration

Future implementation should connect this layer through Core Shell orchestration, not directly from UI routes or module internals. Mother DXF domain runtime should continue to own authoring semantics and resolver behavior, while this I/O layer owns persistence-facing metadata boundaries once implementation is explicitly approved.

References:

- `docs/MOTHER_DXF_CONTRACT_v1.md`
- `docs/mother_dxf_io_v1_skeleton/`
