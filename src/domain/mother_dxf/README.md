# Mother DXF Domain Layer v2

This directory is a pure domain model for the Mother DXF v2 phase.

It intentionally contains no durable I/O, no DB implementation, no API routes,
and no DXF runtime mutations. Core Shell remains responsible for session
envelopes, artifact registry, parameter set persistence, rule catalog loading,
batch manifests, preview artifacts, and future DB dual-write.

## Boundary

- Domain layer: model objects, reference validation, dependency graph building,
  parameter/rule selection plans, product-in-parts structures, batch structures.
- Core Shell I/O: reads/writes catalogs, session envelopes, registries,
  previews, children, events, and future DB sinks.
- Mother DXF runtime: keeps existing DXF parsing/transformation behavior until a
  separate migration explicitly wires these domain plans into runtime execution.

## Validation Path

Use `validateDomainRegistry(registry)` from `core/validation.js` on an in-memory
registry assembled by callers. The validator checks identity shape, duplicate
IDs, versioned references, technology unit compatibility, product part links,
batch item links, and dependency graph cycles.

## Contracts

The JSON files in `contracts/` describe the DB-ready shapes for catalogs and
domain registries. They are documentation contracts for this phase, not runtime
schema validators.

