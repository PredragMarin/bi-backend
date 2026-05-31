# MOTHER_DXF_CONTRACT_v1

Status: canonical contract v1.

This document supersedes the previous split between the Mother DXF semantic contract and the DB-ready I/O architecture. It is a domain and I/O contract, not runtime code, not a DB schema, and not an API implementation plan.

## Deprecation Notice

The following documents are now deprecated and must be removed from the repository after `MOTHER_DXF_CONTRACT_v1.md` is merged:

- `docs/MOTHER_DXF_DB_READY_IO_ARCHITECTURE_v1.md`
- `docs/MOTHER_DXF_Contract_v0_1.md`

All future updates MUST be made exclusively in `MOTHER_DXF_CONTRACT_v1.md`.

## 1. Purpose and Scope

`MOTHER DXF` is an internal, controlled DXF semantic authoring and materialization contract for this flow:

1. raw DXF
2. Stage 0 sanitize
3. sanitized DXF
4. Stage 1 semantic preparation
5. Mother DXF
6. preview / validation / planning
7. Stage 2 child generation
8. child DXF

The v1 contract covers:

- authoring session identity and lifecycle
- DB-ready metadata contracts
- filesystem payload contracts
- Stage 0 sanitize behavior
- Stage 1 semantic authoring behavior
- SEM, TOPO, XDATA, and enrichment models
- preview, child, batch, catalog, parameter, and event metadata contracts
- resolver pipeline discipline and Stage 2 compatibility requirements

Non-goals:

- no runtime code
- no DB schema
- no API route contract
- no dependency or technology mandate
- no approval to change existing runtime behavior by itself

## 2. Identity Model

Identifiers are stable contract keys across DB metadata and filesystem payloads. Mutable labels, titles, statuses, and filenames MUST NOT be primary identities.

- `session_id`: identifies one Mother DXF authoring session and its revision history.
- `artifact_id`: identifies one durable file or structured snapshot registered as an artifact.
- `variant_id`: identifies one child-output variant context, including profile, part, branch/mode, and parameter snapshot identity.
- `preview_id`: identifies one preview/dry-run result tied to a session revision and parameter set.
- `param_set_id`: identifies one parameter snapshot used for authoring, preview, child generation, or batch execution.
- `batch_id`: identifies one grouped orchestration run or package.
- `job_id`: identifies one executable unit inside a batch, usually one part/variant/materialization job.

## 3. Session Envelope Contract

The session envelope is the stable authoring boundary. It separates metadata, payload summary, and file-backed references.

Required sections:

- `metadata`: identity, lifecycle state, timestamps, user attribution, and concurrency fields
- `payload`: current authoring summary, catalog references, parameter set reference, validation summary, and document identity summary
- `path_references`: links to file-backed session, Mother JSON, raw DXF, Mother DXF, preview, and child artifacts

Required fields:

- `session_id`: stable authoring-session identity
- `session_revision`: monotonically increasing revision for optimistic concurrency and preview/child reproducibility
- `created_by`, `updated_by`: actor attribution
- `locked_by`: optional actor reference for future explicit editing locks
- lifecycle state: one of the session lifecycle states in Section 6

Large parsed DXF state MAY remain file-backed and be referenced from the envelope. The session envelope is not a requirement to store every heavy authoring payload directly in DB.

## 4. Artifact Registry Contract

The artifact registry contract defines how durable files and structured snapshots are identified and related to the workflow.

Required fields:

- `artifact_id`: stable artifact identity
- `artifact_type`: semantic artifact type
- parent references: zero or more of `session_id`, `mother_artifact_id`, `preview_id`, `child_artifact_id`, `batch_id`, `job_id`, `param_set_id`, or catalog id/version
- lifecycle status
- checksum when available
- size when available
- path reference

The artifact registry stores artifact metadata and relationships. It does not own domain semantics for sessions, previews, child generation, catalogs, or batch orchestration.

## 5. Artifact Types

Canonical artifact types:

- `raw_dxf`: raw input DXF payload
- `sanitized_dxf`: sanitized Stage 0 DXF payload
- `mother_json`: structured Mother DXF semantic snapshot
- `mother_dxf`: viewer/postprocessor-readable Mother DXF payload
- `child_metadata`: metadata for one child generation result
- `child_dxf`: generated child DXF payload
- `preview_metadata`: metadata for one preview/dry-run result
- `preview_json`: verbose preview payload when retained
- `preview_dxf`: preview DXF payload when retained
- `rule_catalog`: versioned rule catalog JSON
- `parameter_catalog`: versioned parameter catalog JSON
- `param_set`: parameter snapshot used for authoring/preview/execution
- `event_stream`: append-only audit/event payload
- `batch_manifest`: batch-level orchestration manifest
- `job_manifest`: job-level orchestration manifest

DXF artifacts are payload artifacts. Metadata records for those artifacts are DB-friendly; DXF content itself remains file/object-storage friendly.

## 6. Lifecycle Models

### Session Lifecycle

States:

- `created`
- `sanitized`
- `authoring`
- `mother_draft`
- `validated`
- `in_review`
- `approved`
- `archived`

Rules:

- session metadata is mutable until approval
- each significant authoring save increments `session_revision`
- approval freezes the approved Mother artifact reference
- filesystem snapshots remain available for rollback and parity

### Artifact Lifecycle

States:

- `registered`
- `created`
- `validated`
- `superseded`
- `approved`
- `archived`
- `failed`

Rules:

- every durable file has an artifact registry record
- every artifact records type, status, path reference, checksum/size when available, and parent references
- superseding creates a new artifact; approved artifacts must not be silently overwritten

### Preview Lifecycle

States:

- `requested`
- `generated`
- `viewed`
- `promoted`
- `superseded`
- `expired`
- `failed`

Rules:

- preview is tied to session revision, param set, branch mode, and resolver mode
- preview should be read-only by default
- promoted preview output must become an explicit artifact transition, not an implicit side effect

### Child Lifecycle

States:

- `requested`
- `generated`
- `validated`
- `approved`
- `superseded`
- `archived`
- `failed`

Rules:

- child metadata is queryable
- child DXF is a file-backed payload
- child generation must identify source Mother artifact, parameter set, branch/mode, and generation summary

### Batch Lifecycle

States:

- `created`
- `planned`
- `queued`
- `running`
- `partial_success`
- `completed`
- `failed`
- `cancelled`

Rules:

- batch owns immutable input summary
- each job references approved Mother artifact and frozen param set
- child outputs are separate artifacts

### Param Set Lifecycle

States:

- `draft`
- `validated`
- `frozen`
- `used`
- `superseded`
- `archived`

Rules:

- child and batch execution use frozen param sets
- authoring previews may use draft param sets only when workflow policy allows
- validation result is part of the param set record

### Rule Catalog Lifecycle

States:

- `draft`
- `validated`
- `active`
- `deprecated`
- `archived`

Rules:

- active catalog versions are immutable
- rules may be deprecated but not deleted from historical catalogs
- canonical JSON remains available for review, reproducibility, and migration parity

## 7. Param Set Contract

A param set captures exact parameter values used for preview, child generation, or batch execution.

Required fields:

- `param_set_id`: stable identity for one parameter snapshot
- `parameter_catalog_id` and version: catalog source
- `scope`: technology profile, family, product, part, and product code context
- `values`: parameter key/value map
- `validation`: validation status, errors, and warnings
- frozen status
- lifecycle state

Parameter Catalog is not the same as a param set:

- Parameter Catalog defines possible parameter vocabulary.
- Param Set defines one concrete snapshot in that vocabulary.

## 8. Rule Catalog Contract

A rule catalog defines named domain rules that may be referenced from Mother DXF metadata or document-level rule references.

Required fields:

- `catalog_id`: stable catalog identity
- `version`: immutable version once active
- `rule_groups`: explicit grouping by stage, profile, or domain purpose
- `rule definitions`: rule id, rule version, label, status, condition, target scope, action, and metadata
- lifecycle state

Rule catalogs are domain/profile-specific. A rule catalog for one profile MUST NOT be treated as universal inventory for unrelated profiles.

## 9. Preview Contract

A preview captures a reproducible dry-run result. It is not itself the production artifact.

Required fields:

- `preview_id`
- `session_id`
- `session_revision`
- `param_set_id`
- branch mode
- resolver/generation summary
- warnings and validation findings when available
- lifecycle state
- path references for verbose preview JSON or preview DXF when retained

Preview metadata is DB-friendly. Large resolver payloads and preview DXF outputs may remain filesystem-backed.

## 10. Child Contract

A child contract captures metadata for one generated child output.

Required fields:

- `child_artifact_id`
- `session_id`
- `mother_artifact_id`
- `variant_id`
- optional `job_id`
- param set reference
- `param_overrides`
- branch/mode metadata
- generation summary
- output path reference
- lifecycle state

Child DXF content remains file-backed. Child metadata is queryable and may be mirrored as JSON.

## 11. Batch Contract

The batch contract describes grouped child generation orchestration while keeping Mother DXF focused on authoring and artifact preparation.

Required fields:

- `batch_id`
- `job_id` for each executable unit
- immutable batch and job manifests
- frozen param set references
- approved Mother artifact references
- per-job status, failure reason, and output artifact references
- lifecycle state

DBR or another orchestration layer may own production batch execution. Mother DXF must not become the production batch orchestrator by accident.

## 12. Event Contract

Events form the append-only audit source for sessions, artifacts, previews, child generation, catalogs, and batches.

Required fields:

- `event_id`
- `timestamp`
- `severity`
- `type`
- `subject`
- `actor`
- `correlation_id`
- message/details payload

Session JSON may keep a small recent-event window for UI convenience. The contractual audit source is the append-only event stream.

## 13. Path Reference Model

A DB record references filesystem/object-storage payload through artifact identity plus a path reference.

Required path reference fields:

- `store`: storage backend class
- `root_key`: named storage root resolved by platform configuration
- `relative_path`: immutable path below the resolved root
- `content_type`: MIME or domain content type
- `checksum`: content fingerprint when available
- `size`: byte size when available

DB records MUST NOT store machine-local absolute paths. Path references describe storage location; they are not a replacement for artifact identity.

## 14. DB vs Filesystem Split

Mother DXF I/O is split into a metadata plane and a payload plane.

Metadata plane, DB-friendly:

- session metadata
- artifact registry records
- catalog metadata and searchable definitions
- param set metadata and values
- preview metadata
- child metadata
- batch/job metadata
- event records
- validation and generation summaries
- path references

Payload plane, filesystem/object-storage friendly:

- raw DXF
- sanitized DXF
- Mother DXF
- child DXF
- preview DXF
- large parsed Mother JSON snapshots
- verbose preview JSON
- NDJSON event archives
- canonical catalog JSON mirrors

DB may mirror selected structured JSON as JSONB when needed for query, validation, or orchestration. Filesystem snapshots remain the reproducibility and rollback payload layer.

## 15. Semantic Contract

### Stage 0 Sanitize Contract

Input: raw DXF.

Output: sanitized DXF.

Responsibilities:

- simplify DXF section payload
- keep relevant geometry
- normalize supported numeric payload to 3 decimals
- preserve viewer-readable DXF
- keep valid HEADER, TABLES, BLOCKS, ENTITIES, and EOF structure

Stage 0 does not imply full repair approval lifecycle. Detect/propose/approve/apply repair workflows remain separate contract topics.

Supported active geometry:

- `LINE`
- `ARC`
- `INSERT`
- `BLOCK`

Supported passthrough geometry:

- `CIRCLE`

Out of active repair/advanced semantics unless explicitly added by future contract:

- `LWPOLYLINE`
- `POLYLINE`
- `SPLINE`
- `ELLIPSE`
- `HATCH`
- `TEXT`
- `MTEXT`
- `DIMENSION`
- other DXF entities not explicitly listed

### Stage 1 Semantic Contract

Stage 1 input: sanitized DXF.

Stage 1 output: Mother draft DXF.

Responsibilities:

- build relevant semantic object model
- apply primary dimensional semantics through 9-layer scheme
- support manual correction workflow
- preserve viewer-readable Mother DXF
- keep metadata as exception/enrichment layer

Relevant semantic objects:

- top-level scoped geometry entities in ENTITIES
- INSERT block instances

Block definition internals are technical geometry, not separate user-facing semantic objects in this contract slice.

Allowed primary layers:

- `L`
- `R`
- `T`
- `B`
- `TL`
- `TR`
- `BL`
- `BR`
- `A`

Meaning:

- `L/R/T/B`: edge dimensional zones
- `TL/TR/BL/BR`: corner dimensional zones
- `A`: anchored, neutral, or valid primary class

Critical rules:

- `A` is valid.
- `A` is not the same as `unclassified`.
- Every relevant semantic object must have exactly one primary dimensional class.
- Whole-block semantics are owned by the INSERT instance.

### SEM Grammar

Metadata exists as an exception/enrichment layer. Every object must first be resolved by primary dimensional classification as far as possible.

Canonical compact carrier:

```text
999
SEM:key=value;key=value;key=value
```

The `999` comment binds to the next entity.

Canonical authored forms include:

```text
SEM:feature={PARAMETER_KEY};presence=conditional;when={PARAMETER_KEY}=={VALUE}
SEM:feature={PARAMETER_KEY};presence=conditional;when={PARAMETER_KEY}!={VALUE}
SEM:role={variant|prototype|anchor|reference};feature={PARAMETER_KEY};variant={VARIANT_ID}
SEM:role=variant;feature={PARAMETER_KEY};variant={VARIANT_ID};rule_ref={RULE_ID}
SEM:operation_ref={OPERATION_OR_RULE_ID};feature={PARAMETER_KEY}
SEM:post_topo_group={GROUP_ID}
```

Validation direction:

- unknown key should be a validation problem
- duplicate key should be a validation error
- empty value should be a validation error
- catalog-backed choices should be filtered by active profile/family/product/part context

Approved SEM execution forms:

1. `selection`: conditional inclusion/exclusion of a feature or geometry group
2. `variant_gate`: entity/block is active only when parameter value matches expected variant id
3. `placement-by-presence`: multiple pre-drawn alternatives exist and conditional expressions decide which alternative survives
4. stage tags: e.g. post-TOPO group markers and related stage-binding metadata

### TOPO Contract

`TOPO` is a file-level `999` metadata family for part-level topology behavior.

Rules:

- `SEM` remains local entity metadata.
- `TOPO` describes part-level topology mode.
- `TOPO` and `SEM` must not be mixed as one grammar family.
- Approved Mother DXF must carry required TOPO metadata physically in DXF `999` rows when topology behavior is required.
- Session sidecar TOPO state is authoring/runtime convenience, not canonical approved artifact state.

Recognized topology families:

- `4-band parameter resize`
- `fixed envelope slide`
- `none / skip topology`

A Stage 1 authoring surface must not present one topology family through another family vocabulary. `4-band` authoring must not be forced through `LEC/REC`; `fixed envelope slide` must not be forced through `L/R/T/B/TL/TR/BL/BR` language.

### Enrichment Model

Mother DXF enrichment follows a generic three-level model:

1. 9-layer dimensional semantics
2. `999` metadata for presence / variant intent
3. rule-driven / operation-driven transform intent

Interpretation order:

1. dimensional semantics first
2. presence / variant metadata second
3. rule / operation intent third

Rule or operation references must not substitute for missing dimensional classification or missing metadata structure.

## 16. Resolver Pipeline Contract

Canonical resolver pipeline:

1. active geometry branch isolation
2. document-level SEM context load
3. entity-level SEM selection / inclusion resolution
4. entity-level variant gating and placement-by-presence resolution
5. build initial resolved active geometry for the current parameter set
6. execute one movement stage
7. recompute local join graph and active geometry state
8. apply only stage-allowed repair / rejoin operators
9. run stage validation
10. continue to the next declared movement stage
11. execute post-TOPO and later child rules
12. serialize child DXF

Normative resolver rules:

- resolver must not search for arbitrary join candidates across the whole DXF
- resolver must not join across geometry branches
- movement stages execute one at a time over previously stabilized geometry
- collision and repair logic operate on resolved active geometry for the same parameter set, not on the full raw DXF universe
- `SEM recompute` is reserved future behavior, not default behavior

Stage taxonomy:

- `4_BAND_PARAMETER_RESIZE`: canonical base movement model for freely resizable parts
- `B_LAYER_OFFSET_9P5`: specialized fixed-envelope preparation stage
- `LEC_SLIDE`: manual left cutout mover stage
- `REC_SLIDE`: mirror-equivalent right cutout mover stage
- post-TOPO rigid offset stages, when explicitly declared
- final orientation stages, when explicitly declared
- child label application stages, when explicitly declared

## 17. Geometry Branch Contract

Mother DXF may contain multiple alternative geometry branches inside one mother file when those branches share the same product/part contract, parameter set, label pipeline, and rule pipeline.

Rules:

- branch selection is not a layer contract
- untagged top-level geometry is implicit `BASE`
- tagged alternative geometry uses `MOTHERDXF` XDATA with `GEOMETRY_VARIANT=<VALUE>`
- `ALL` is only an authoring, inspection, and XDATA repair view
- child preview/export must resolve exactly one source branch before SEM, TOPO, document rules, final orientation, labels, and serialization
- resolved child output must not contain eliminated branch geometry or Mother DXF branch XDATA
- selected branch geometry is normalized during child materialization

Validation direction:

- untagged geometry in shifted branch slots should warn
- tagged branch geometry in implicit base slot should warn unless accepted as legacy/debug overlap
- child preview/export with `ALL` as materialization source should warn or refuse

## 18. Metadata Authoring Contract

Guided metadata authoring is controlled enrichment, not a free-text authoring model.

Supported authoring modes:

- presence condition
- geometry role
- operation reference
- post-TOPO group selection
- document/profile rule reference where needed

Authoring principles:

- prefer explicit SEM metadata when intent is local, readable, and unambiguous
- use `rule_ref` only when local SEM is no longer clear or maintainable
- canonical SEM string is generated output of the authoring surface, not the primary everyday input
- raw SEM edit may exist only as admin/debug fallback
- catalog-backed choices should be filtered by active profile scope

Manual correction contract:

- viewer can select, hover, rectangle-select, deselect, zoom, and pan
- author can force assign any of the 9 primary classes
- semantic color reflects current primary semantic class
- selection and hover are visual overlays, not semantic classes
- for INSERT, semantic source-of-truth is the block instance, not individual block internals

Auto-suggestion contract:

- initial suggestion is bbox-based
- inputs are left/right/top/bottom bands
- output is one of the 9 primary classes
- suggestion is a starting proposal, not immutable truth

## 19. Stage 2 Compatibility Requirements

Stage 1 exists as a contract carrier for Stage 2.

Required direction:

- full 9-layer movement first
- repair second
- target-driven reconstruction when parameters are known
- metadata remains exception/enrichment layer, not dominant mechanism
- movement execution must be deterministic and stage-ordered
- production child generation must use resolved active geometry for the same parameter set

Current practical Stage 2 scope includes:

- entity inclusion/exclusion through SEM metadata
- document-level rule execution
- TOPO fixed-envelope simulation
- post-TOPO rigid offset rules
- child DXF save/export entrypoints
- preview and validation warnings

Planned/compatible child-level behaviors include:

- final orientation mirror rules for left/right door orientation when configured
- bbox normalization after final orientation
- child label application with explicit anchor, envelope, rotation, collision policy, payload carrier, and payload template
- payload resolution from DBR batch row, document metadata, and config/param set context according to a defined precedence policy

Mother DXF must remain enriched raw DXF. It must stay valid and viewer-readable without prior transformation. Geometry deletion, coordinate changes, and production materialization belong to child generation, not approved Mother DXF authoring state.

## 20. Appendix A: Legacy Contract v0.1

This appendix preserves the relevant historical meaning of `docs/MOTHER_DXF_Contract_v0_1.md` while marking implementation-era details as legacy.

### Legacy Scope

The v0.1 contract originally described the first useful slice:

- import raw DXF
- sanitize Stage 0 payload
- build Stage 1 relevant-object model
- auto-suggest primary dimensional classes
- allow manual correction in UI
- validate
- export Mother draft DXF

It later accumulated practical Stage 1.5 and early Stage 2 bridge details:

- guided SEM metadata authoring
- parameter catalog and rule catalog visibility
- child preview and child save entrypoints
- TOPO fixed-envelope authoring
- branch-aware authoring notes
- resolver harness and diagnostic extraction notes
- planned final orientation and label rules

### Legacy Items Now Normative in v1

The following v0.1 concepts are incorporated into the v1 normative body:

- Stage 0 sanitize contract
- Stage 1 primary semantic contract
- supported geometry scope
- 9-layer dimensional model
- whole-block policy
- SEM metadata carrier and binding rule
- three-level enrichment model
- TOPO boundary
- metadata authoring boundary
- resolver pipeline discipline
- geometry branch contract
- Stage 2 compatibility direction
- parameter and rule catalog distinction

### Legacy Items Retained as Historical Context

The following are retained as historical context and should not be copied into new contract sections without review:

- first useful slice status descriptions
- current implementation snapshot statements
- POC delivery strategy details
- diagnostic resolver harness command lists
- shadow/parity command inventory
- implementation file inventories
- cleanup-scope and activation-candidate reports
- non-normative POC TODO list

### Legacy Limitations

The v0.1 contract explicitly acknowledged that Mother DXF was not yet a fully consolidated production resolver. Remaining concerns carried forward into v1 planning:

- one shared canonical resolver contract between Mother DXF and DBR
- full movement-stage coverage for all domain cases
- approval-grade validation completeness for all relocation and branch-sensitive cases
- reduction of legacy heuristic repair paths after explicit parity and activation approval

## 21. Appendix B: Migration Notes from v0.1 to v1

### Document Migration

`MOTHER_DXF_CONTRACT_v1.md` becomes the only canonical Mother DXF contract. The previous split documents are deprecated after merge:

- `docs/MOTHER_DXF_DB_READY_IO_ARCHITECTURE_v1.md`
- `docs/MOTHER_DXF_Contract_v0_1.md`

Migration instruction:

1. Merge this canonical document.
2. Update references that point to either deprecated document.
3. Remove the deprecated documents in a follow-up repository cleanup.
4. Make all future Mother DXF contract changes only in this document.

### Contract Migration

v1 keeps v0.1 semantics but reorganizes them around stable contracts:

- v0.1 session JSON aggregate maps to v1 Session Envelope Contract.
- v0.1 filesystem outputs map to v1 Artifact Registry Contract and Path Reference Model.
- v0.1 config parameter set maps to v1 Param Set Contract.
- v0.1 rule catalog maps to v1 Rule Catalog Contract.
- v0.1 preview responses map to v1 Preview Contract.
- v0.1 child outputs map to v1 Child Contract.
- v0.1 activity log maps to v1 Event Contract.
- v0.1 DBR compatibility notes map to v1 Batch Contract and Stage 2 Compatibility Requirements.

### Behavioral Migration

This document does not approve behavior changes by itself. Runtime behavior changes still require explicit implementation plans, validation, parity checks where relevant, and migration notes.
