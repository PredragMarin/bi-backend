# Mother DXF DB-ready I/O Architecture v1

Status: architecture proposal, no implementation.

Scope: `mother_dxf_v1` authoring, session storage, DXF/JSON artifacts, rule catalogs, parameter sets, preview outputs, child outputs, and future DB handoff.

Non-goals:

- no dependency changes
- no DB code
- no runtime resolver changes
- no behavior changes to existing routes
- no production code changes

## 1. Existing Module Analysis

Analyzed sources:

- `src/modules/mother_dxf_v1/module_runtime.js`
- `src/core_shell/storage/mother_dxf_store.js`
- `src/api/routes/mother_dxf_v1.js`
- `src/core_shell/dxf/index.js`
- `src/modules/mother_dxf_v1/contracts/parameter_catalog_legacy_door_v0.json`
- `src/modules/mother_dxf_v1/contracts/rule_catalog_mxd_door_v0.json`
- `tests/fixtures/mother_dxf/*.json`
- `out/mother_dxf_v1/{sessions,exports,children}`
- `docs/MOTHER_DXF_Contract_v0_1.md`
- `docs/MOTHER_DXF_TO_DXF_MODIFIER_ROADMAP_v1.md`
- `docs/DXF_XDATA_CONTRACT_DRAFT_v0_1.md`

### Implicit I/O Model

Current input:

- raw DXF text through `POST /api/mother-dxf/v1/sessions`
- `source_name`
- `bands`
- config parameter set updates
- entity-level SEM/TOPO/XDATA edits
- document-level SEM edits
- child generation parameter payloads

Current output:

- session JSON under `out/mother_dxf_v1/sessions/<session_id>.json`
- mother DXF under `out/mother_dxf_v1/exports/<session_id>_mother.dxf`
- child DXF under `out/mother_dxf_v1/children/<session_id>_<suffix>.dxf`
- preview JSON returned by HTTP but not persisted
- response headers carrying child generation status

Stable:

- session as authoritative working aggregate
- UUID session ids
- `use_case: mother_dxf_v1`
- `status`, `artifact_state`, `created_at`, `updated_at`
- DXF files as filesystem artifacts
- catalogs as JSON contract artifacts

Unstable:

- one large `module_runtime.js` owns parsing, authoring, evaluation, preview, export, and persistence orchestration
- preview has no durable artifact identity
- child outputs overwrite by `session_id + suffix`
- batch is not a first-class Mother DXF concept
- activity log is embedded and capped

Implicit:

- session JSON is both working state and metadata record
- raw DXF is not stored separately after sanitize; parsed `document` becomes source of truth
- preview lifecycle exists only as endpoint behavior
- child metadata exists mostly in activity log and response headers

Explicit:

- route names
- catalog file paths
- storage root
- session id
- artifact state
- parameter and rule catalog ids

DB-friendly:

- session metadata
- catalog ids and versions
- config parameter set snapshot
- validation result
- rule references
- child generation summary
- path references

Filesystem-friendly:

- raw DXF text
- mother DXF
- child DXF
- large parsed document snapshots during early migration
- verbose previews and logs

Needs normalization:

- artifact identity for raw, sanitized, mother, preview, and child outputs
- path reference envelope
- child metadata separate from session activity
- preview metadata separate from transient HTTP response
- consistent status vocabulary

Needs standardization:

- artifact naming
- artifact lifecycle states
- log/event schema
- user attribution fields
- versioned JSON shapes

### Implicit Session Model

Current session shape is an aggregate:

- identity: `session_id`, `use_case`
- audit: `created_at`, `updated_at`
- authoring metadata: `title`, `status`, `artifact_state`, `source_name`
- process config: `bands`, `config_parameter_set`
- embedded catalogs: `parameter_catalog`, `rule_catalog`
- DXF state: parsed `document`
- semantic state: `assignments`, `topo_comments`, `xdata_assignments`
- validation: `validation`
- log: `activity_log`

Stable:

- session is the authoring unit
- `draft -> in_review` style human lifecycle is present
- `sanitized -> mother_draft -> mother_validated` artifact lifecycle is present

Unstable:

- duplicate sessions are resolved by `source_name`
- DB concurrency/versioning is absent
- user attribution is absent
- no separate revision number

Implicit:

- session JSON is mutable latest state
- `updated_at` is optimistic freshness signal but not a lock

Explicit:

- JSON file per session
- session list sorted by `updated_at`

DB-friendly:

- one row for session metadata
- JSONB payload for working state in early hybrid phase
- separate event table later

Filesystem-friendly:

- full session JSON snapshots

Needs normalization:

- `session_revision`
- `created_by`, `updated_by`, `locked_by`
- `source_artifact_id`
- `active_artifact_id`
- durable references instead of embedded DXF-heavy state where practical

#### Session Envelope Contract

The DB-ready session contract is the stable boundary for authoring state. It separates:

- `metadata`: identity, lifecycle state, timestamps, user attribution, and concurrency fields
- `payload`: current authoring summary, catalog references, parameter set reference, validation summary, and document identity summary
- `path_references`: links to file-backed session, Mother JSON, raw DXF, Mother DXF, preview, and child artifacts

Required contract fields:

- `session_id`: stable authoring-session identity
- `session_revision`: monotonically increasing revision for optimistic concurrency and preview/child reproducibility
- `created_by`, `updated_by`: actor attribution for audit and multi-user operation
- `locked_by`: optional actor reference for future explicit editing locks
- lifecycle state: one of the approved session lifecycle states defined below

The session envelope is a contract boundary, not a requirement to store all heavy session payload directly in DB. Large parsed DXF state may remain file-backed and be referenced from the envelope.

### Implicit Artifact Model

Current artifact types:

- session JSON
- exported mother DXF
- child DXF no-topo
- child DXF topo-poc
- parsed document embedded in session
- rule catalog JSON
- parameter catalog JSON
- preview JSON transient response

Stable:

- DXF outputs are files
- session JSON is structured
- catalogs are structured

Unstable:

- artifact ids are inferred from paths
- child outputs can overwrite earlier outputs of same suffix
- no raw/sanitized/mother JSON split

Implicit:

- `document` inside session is the Mother JSON equivalent
- `generation_summary` is child metadata when returned

Explicit:

- `exports`, `children`, `sessions` folders

DB-friendly:

- artifact registry table with ids, type, status, MIME, checksum, path
- child metadata rows
- preview metadata rows

Filesystem-friendly:

- DXF payloads and large snapshots

Needs normalization:

- one artifact registry record per produced file or structured snapshot
- checksum and size
- content type
- parent/child relationship

#### Artifact Registry Contract

The artifact registry contract defines how any durable file or structured snapshot is identified and related to the rest of the workflow.

Required contract fields:

- `artifact_id`: stable artifact identity
- `artifact_type`: semantic type such as raw DXF, Mother JSON, Mother DXF, preview JSON, preview DXF, child metadata, child DXF, catalog, event stream, or batch manifest
- parent references: zero or more of `session_id`, `mother_artifact_id`, `preview_id`, `child_artifact_id`, `batch_id`, `job_id`, `param_set_id`, or catalog id/version
- lifecycle status: registry state such as registered, created, validated, superseded, approved, archived, or failed
- checksum: content integrity fingerprint when available
- size: byte size when available
- path reference: store location described by the path reference contract

The registry stores artifact metadata and relationships. It does not own domain semantics for sessions, previews, child generation, catalogs, or batch orchestration.

### Implicit Rule Model

Current rule catalog:

- JSON contract with `catalog_id`, `schema_version`, `profile_id`, `source`, `rules`
- rules include condition, target scope, action, status, descriptions
- document SEM comments reference rules through `rule_ref`

Stable:

- rule ids are first-class
- rule groups are implied by `profile_scope` and `action.stage`
- rule definitions are JSON-ready

Unstable:

- status vocabulary is loose
- groups are derived rather than explicit
- compatibility/deprecation metadata is partial

Implicit:

- evaluator order is inferred from action stage and priority
- profile applicability is embedded in each rule

Explicit:

- rule id
- condition
- target scope
- action
- status

DB-friendly:

- catalog row
- rule rows
- JSONB condition/action
- catalog versioning

Filesystem-friendly:

- canonical JSON catalog for review and Git history

Needs normalization:

- `rule_groups`
- `rule_version`
- `effective_from`, `deprecated_at`
- `owner`
- `validation_status`

#### Rule Catalog Contract

The rule catalog contract makes rule vocabulary versioned and replayable.

Required contract fields:

- `catalog_id`: stable catalog identity
- `version`: immutable catalog version once active
- `rule_groups`: explicit grouping by stage, profile, or domain purpose
- `rule definitions`: rule id, version, label, status, condition, target scope, action, and metadata
- lifecycle state: draft, validated, active, deprecated, or archived

Rule definitions may be queryable as DB metadata/JSONB, while the canonical catalog JSON remains file-backed for review, reproducibility, and migration parity.

### Implicit Param Model

Current parameter catalog:

- JSON contract with `catalog_id`, `schema_version`, `source`, `parameters`
- parameter definitions include key, code, label, type, unit, min/max/step, scope, default
- session has `config_parameter_set` snapshot with technology profile, product code, scope, and values

Stable:

- parameter keys are canonical long-form keys
- defaults can be generated from catalog
- session stores frozen-ish config snapshot

Unstable:

- value validation is not a separate artifact
- ERP/order provenance is absent
- aliases/code mappings need stronger governance

Implicit:

- current config is the active preview/export input
- generated child output may mutate session config if request provides values

Explicit:

- catalog id
- parameter key/type/default/scope

DB-friendly:

- parameter definitions table
- parameter set table
- parameter value table or JSONB snapshot

Filesystem-friendly:

- JSON snapshots for reproducibility

Needs normalization:

- `param_set_id`
- immutable frozen param snapshots for child/batch execution
- source attribution for values
- validation result per parameter set

#### Param Set Contract

The param set contract captures the exact parameter values used for preview, child generation, or batch execution.

Required contract fields:

- `param_set_id`: stable identity for one parameter snapshot
- `scope`: technology profile, family, product, part, and product code context
- `values`: parameter key/value map
- `validation`: validation status, errors, and warnings for the set
- frozen status: whether the set is still editable or immutable for execution/replay
- lifecycle state: draft, validated, frozen, used, superseded, or archived

Child and batch execution must reference frozen param sets. Authoring previews may reference draft param sets when explicitly allowed by workflow policy.

### Implicit Preview Model

Current preview:

- `simulateSession` returns simulation JSON
- `generateChildDxfTopoPocPreviewForSession` returns `generation_summary`, `dxf_text`, `resolver_preview`
- preview can persist parameter changes through `persistSessionConfigParameterSet`

Stable:

- preview output is structured enough for UI and diagnostics
- generation summary exists

Unstable:

- preview is not stored
- no preview id
- no checksum/path for preview DXF text
- preview request can update session parameters

Implicit:

- preview is a resolver dry run
- preview belongs to session + param snapshot + branch mode

Explicit:

- endpoint and response shape

DB-friendly:

- preview metadata and summary
- JSONB resolver preview
- link to generated temporary DXF if persisted

Filesystem-friendly:

- optional preview DXF and full verbose JSON

Needs normalization:

- `preview_id`
- read-only vs write-through preview mode
- persisted preview status: `created`, `superseded`, `expired`, `promoted`

#### Preview Contract

The preview contract captures a reproducible dry-run result without making the preview itself the production artifact.

Required contract fields:

- `preview_id`: stable identity for the preview result
- `session_id` and `session_revision`: source authoring state used for preview
- `param_set_id`: parameter snapshot used for evaluation
- branch mode: selected geometry branch or authoring/debug mode
- resolver summary: generation summary, warnings, validation findings, and relevant resolver metadata
- lifecycle state: requested, generated, viewed, promoted, superseded, expired, or failed

Preview metadata is DB-friendly. Large resolver payloads and preview DXF outputs may remain filesystem-backed and referenced by path.

### Implicit Batch Model

Current Mother DXF module:

- no native batch model
- DBR docs and routes expect future reuse of Mother DXF artifacts
- child generation endpoints operate one session at a time

Stable:

- session + parameter set + child mode are enough to form one part job
- DBR owns order/batch orchestration directionally

Unstable:

- no Mother-side batch manifest
- no variant id
- no job id
- no idempotency key

Implicit:

- repeated child calls are ad hoc batch-like runs
- output suffix acts like mode identity

Explicit:

- DBR contract mentions batch, part jobs, frozen parameter snapshots, Mother artifact registry

DB-friendly:

- batch run row
- part job row
- child artifact rows

Filesystem-friendly:

- batch folder with manifests, logs, child DXFs

Needs normalization:

- `batch_id`
- `job_id`
- `variant_id`
- idempotent output paths
- per-job status and failure reason

#### Batch Contract

The batch contract describes orchestration metadata for grouped child generation, while keeping Mother DXF focused on authoring and artifact preparation.

Required contract fields:

- `batch_id`: stable batch identity
- `job_id`: stable per-part/per-variant job identity
- manifests: immutable batch and job input/output summaries
- frozen param sets: parameter snapshots used by each job
- approved Mother artifacts: explicit reference to approved Mother DXF/JSON artifacts
- lifecycle state: created, planned, queued, running, partial_success, completed, failed, or cancelled

Batch metadata is queryable. Child DXF payloads remain file-backed artifacts referenced by job records.

### Implicit Logging Model

Current logging:

- embedded `activity_log` array in session
- normalized to `{ ts, severity, type, summary, details }`
- capped at last 200 events

Stable:

- event envelope is already good
- severity/type/details are structured

Unstable:

- capped embedded history loses old events
- no correlation ids
- no actor
- no request id

Implicit:

- session activity doubles as audit log

Explicit:

- timestamps, severity, type, details

DB-friendly:

- append-only event table
- correlation id, actor, artifact id

Filesystem-friendly:

- NDJSON logs per session/batch

Needs normalization:

- event id
- subject type/id
- actor
- request id
- lifecycle phase

#### Event Contract

The event contract defines the append-only audit shape for sessions, artifacts, previews, child generation, catalogs, and batches.

Required contract fields:

- `event_id`: stable event identity
- `timestamp`: event time
- `severity`: informational, warning, error, or domain-specific severity
- `type`: event class such as session_created, preview_generated, child_failed, artifact_superseded, or catalog_activated
- `subject`: typed reference to the affected session, artifact, preview, child, catalog, batch, or job
- `actor`: user/system identity responsible for the action
- `correlation_id`: request or workflow correlation identity

Session JSON may keep a small recent-event window for UI convenience, but the contractual audit source is the append-only event stream.

## 2. DB-ready I/O Structure

```text
I/O Model v1
------------
Mother DXF I/O is split into a metadata plane and a payload plane.

Metadata plane:
- sessions
- artifact registry
- rule catalogs
- parameter catalogs
- parameter sets
- previews
- child metadata
- batch/job records
- event logs

Payload plane:
- raw DXF
- sanitized DXF
- exported mother DXF
- generated child DXF
- large preview payloads
- archival session snapshots

In Phase 1, both planes live on filesystem.
In Phase 2, DB stores metadata and selected JSON snapshots while filesystem keeps DXF payloads.
In Phase 3+, DB becomes the authoritative metadata store and filesystem remains object/payload storage unless binary storage is explicitly approved.
```

### Folder Layout

```text
out/mother_dxf_v1/
  sessions/
    <session_id>/
      session.json
      mother.json
      events.ndjson
      snapshots/
        <revision_id>.json
      previews/
        <preview_id>/
          preview.json
          preview.dxf
      exports/
        <artifact_id>_mother.dxf
      children/
        <variant_id>/
          child.json
          child.dxf
  artifacts/
    raw/
      <artifact_id>.dxf
    sanitized/
      <artifact_id>.dxf
    mother/
      <artifact_id>.dxf
  catalogs/
    rules/
      <catalog_id>/<version>/rule_catalog.json
    parameters/
      <catalog_id>/<version>/parameter_catalog.json
  batches/
    <batch_id>/
      batch.json
      jobs/
        <job_id>/
          job.json
          child.dxf
      events.ndjson
```

### Naming Conventions

- `session_id`: `mxd_sess_<yyyyMMdd>_<uuid>`
- `artifact_id`: `mxd_art_<uuid>`
- `preview_id`: `mxd_prev_<uuid>`
- `variant_id`: `mxd_var_<profile>_<part>_<short_hash>`
- `batch_id`: `mxd_batch_<yyyyMMdd>_<uuid>`
- `job_id`: `mxd_job_<batch_short>_<part>_<ordinal>`
- file names use lowercase type suffixes: `_raw.dxf`, `_sanitized.dxf`, `_mother.dxf`, `_child.dxf`, `_preview.json`

### Contract Identity Model

The identity model defines stable references across DB metadata and filesystem payloads. These identifiers are conceptual contract keys; their exact generation mechanism belongs to implementation planning.

- `session_id`: identifies one Mother DXF authoring session and its revision history.
- `artifact_id`: identifies one durable file or structured snapshot registered as an artifact.
- `variant_id`: identifies one child-output variant context, including profile, part, branch/mode, and parameter snapshot identity.
- `preview_id`: identifies one preview/dry-run result tied to a session revision and parameter set.
- `param_set_id`: identifies one parameter snapshot used for authoring, preview, child generation, or batch execution.
- `batch_id`: identifies one grouped orchestration run or package.
- `job_id`: identifies one executable unit inside a batch, usually one part/variant/materialization job.

Identifiers must be immutable once assigned. Mutable labels, titles, statuses, and filenames must not be used as primary identities.

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
- approval freezes a `mother_artifact_id`
- filesystem snapshot is retained for rollback and parity

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

- every file has an artifact registry record
- every artifact has content type, checksum, size, path reference, and parent references
- DXF payloads remain file artifacts
- structured JSON can be mirrored into DB

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

- preview is tied to session revision, param set id, branch mode, and resolver mode
- preview must be read-only by default
- write-through previews require explicit `updates_session: true`

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

- batch owns immutable input snapshot
- each job references one approved Mother artifact and one frozen param set
- child outputs are separate artifacts

### Logging Lifecycle

States:

- append-only
- queryable current window
- archived

Rules:

- session JSON may keep last events for UI
- authoritative audit is append-only event stream
- batch and job logs include correlation ids

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
- DB stores searchable metadata and JSONB definitions
- filesystem keeps canonical versioned JSON

### Param Set Lifecycle

States:

- `draft`
- `validated`
- `frozen`
- `used`
- `superseded`
- `archived`

Rules:

- child and batch execution always use frozen param sets
- parameter source is recorded per set
- validation result is part of the param set record

### Child Contract

The child contract captures metadata for one generated child output.

Required contract fields:

- `child_artifact_id`: artifact identity for the child DXF payload or child metadata snapshot
- `variant_id`: stable child variant identity
- `param_overrides`: request-specific values applied over or alongside the referenced param set
- generation summary: included/excluded/moved counts, warnings, and resolver status
- lifecycle state: requested, generated, validated, approved, superseded, archived, or failed

Child metadata is queryable. Child DXF content remains a filesystem payload referenced through artifact registry and path reference records.

## 3. DB-ready JSON Formats

### A. Session JSON

```json
{
  "schema_version": "mother_dxf.session.v1",
  "metadata": {
    "session_id": "mxd_sess_20260531_00000000-0000-4000-8000-000000000000",
    "use_case": "mother_dxf_v1",
    "title": "KSKR authoring",
    "source_name": "kskr.dxf",
    "status": "mother_draft",
    "artifact_state": "mother_draft",
    "session_revision": 12,
    "created_at": "2026-05-31T00:00:00.000Z",
    "updated_at": "2026-05-31T00:10:00.000Z",
    "created_by": "user:unknown",
    "updated_by": "user:unknown",
    "locked_by": null
  },
  "payload": {
    "bands": { "left": 80, "right": 80, "top": 80, "bottom": 80 },
    "config_parameter_set_id": "mxd_param_set_00000000-0000-4000-8000-000000000000",
    "parameter_catalog_id": "legacy_door_configurator_catalog_v0",
    "rule_catalog_id": "rule_catalog_mxd_door_v0",
    "document_sem": {
      "family": "VRATA",
      "product": "PPV",
      "part": "KSKR",
      "nominal_width": 900,
      "nominal_height": 2100,
      "rule_refs": ["KSKR_EXTERNAL_DOOR_RIGHT_SHORTEN"]
    },
    "active_geometry_variant": "BASE",
    "assignment_summary": {
      "object_count": 0,
      "classified_count": 0,
      "unclassified_count": 0
    },
    "validation": {
      "ok": true,
      "errors": [],
      "warnings": []
    }
  },
  "path_references": {
    "session_json": {
      "artifact_id": "mxd_art_00000000-0000-4000-8000-000000000001",
      "store": "fs",
      "relative_path": "sessions/mxd_sess_20260531_00000000-0000-4000-8000-000000000000/session.json",
      "content_type": "application/json"
    },
    "source_raw_dxf": {
      "artifact_id": "mxd_art_00000000-0000-4000-8000-000000000002",
      "store": "fs",
      "relative_path": "artifacts/raw/mxd_art_00000000-0000-4000-8000-000000000002_raw.dxf",
      "content_type": "application/dxf"
    },
    "mother_json": {
      "artifact_id": "mxd_art_00000000-0000-4000-8000-000000000003",
      "store": "fs",
      "relative_path": "sessions/mxd_sess_20260531_00000000-0000-4000-8000-000000000000/mother.json",
      "content_type": "application/json"
    }
  }
}
```

### B. Mother DXF JSON

```json
{
  "schema_version": "mother_dxf.document.v1",
  "metadata": {
    "artifact_id": "mxd_art_00000000-0000-4000-8000-000000000003",
    "session_id": "mxd_sess_20260531_00000000-0000-4000-8000-000000000000",
    "source_artifact_id": "mxd_art_00000000-0000-4000-8000-000000000002",
    "created_at": "2026-05-31T00:10:00.000Z",
    "created_by": "user:unknown",
    "status": "mother_draft"
  },
  "semantic_layers": {
    "allowed_primary_layers": ["L", "R", "T", "B", "TL", "TR", "BL", "BR", "A"],
    "assignments": {
      "ent_001": {
        "state": "classified",
        "primary_layer": "L",
        "origin": "manual",
        "suggested_layer": "L"
      }
    },
    "semantic_metadata": {
      "ent_001": [
        {
          "raw": "SEM:feature=closer;presence=conditional;when=HIDRAULICKI_ZATVARAC==Skriveni",
          "parsed": {
            "feature": "closer",
            "presence": "conditional",
            "when": "HIDRAULICKI_ZATVARAC==Skriveni"
          }
        }
      ]
    },
    "xdata": {
      "ent_001": {
        "app": "MOTHERDXF",
        "geometry_variant": "BASE"
      }
    }
  },
  "topo_layers": {
    "file_level": [
      {
        "raw_comment": "TOPO:...",
        "parsed": {}
      }
    ],
    "entity_roles": {
      "ent_001": {
        "role": "LEC",
        "group": "FRAME",
        "zone": "L"
      }
    }
  },
  "enriched_metadata": {
    "document_sem": {
      "family": "VRATA",
      "product": "PPV",
      "part": "KSKR",
      "rule_refs": ["KSKR_EXTERNAL_DOOR_RIGHT_SHORTEN"]
    },
    "parameter_catalog_id": "legacy_door_configurator_catalog_v0",
    "rule_catalog_id": "rule_catalog_mxd_door_v0",
    "technology_profile": "OPS_S4P4"
  },
  "geometry_metadata": {
    "document_bbox": { "min_x": 0, "min_y": 0, "max_x": 0, "max_y": 0 },
    "object_count": 0,
    "entity_count": 0,
    "block_count": 0,
    "geometry_hygiene": {
      "branch_filtering_ready": false,
      "geometry_variants": [],
      "invalid_branch_xdata_count": 0
    }
  },
  "rule_evaluation_results": [
    {
      "rule_id": "KSKR_EXTERNAL_DOOR_RIGHT_SHORTEN",
      "matched": false,
      "stage": "topology_delta_modifier",
      "reason": "condition_not_matched"
    }
  ],
  "param_evaluation_results": {
    "param_set_id": "mxd_param_set_00000000-0000-4000-8000-000000000000",
    "ok": true,
    "errors": [],
    "warnings": []
  },
  "path_references": {
    "mother_dxf": {
      "artifact_id": "mxd_art_00000000-0000-4000-8000-000000000004",
      "store": "fs",
      "relative_path": "sessions/mxd_sess_20260531_00000000-0000-4000-8000-000000000000/exports/mxd_art_00000000-0000-4000-8000-000000000004_mother.dxf"
    }
  }
}
```

### C. Child DXF Metadata

```json
{
  "schema_version": "mother_dxf.child_metadata.v1",
  "metadata": {
    "child_artifact_id": "mxd_art_00000000-0000-4000-8000-000000000005",
    "session_id": "mxd_sess_20260531_00000000-0000-4000-8000-000000000000",
    "mother_artifact_id": "mxd_art_00000000-0000-4000-8000-000000000004",
    "variant_id": "mxd_var_ops_s4p4_kskr_abcdef12",
    "job_id": null,
    "created_at": "2026-05-31T00:20:00.000Z",
    "created_by": "user:unknown",
    "status": "created"
  },
  "variant_metadata": {
    "technology_profile": "OPS_S4P4",
    "product_code": "KSKR",
    "part": "KSKR",
    "branch_mode": "BASE",
    "child_mode": "child_topo_poc_v0"
  },
  "param_overrides": {
    "param_set_id": "mxd_param_set_00000000-0000-4000-8000-000000000000",
    "overrides": {
      "SIRINA_VRATA": 900,
      "VISINA_VRATA": 2100
    }
  },
  "generation_summary": {
    "included_count": 0,
    "excluded_count": 0,
    "moved_count": 0,
    "warnings": []
  },
  "output_path": {
    "store": "fs",
    "relative_path": "sessions/mxd_sess_20260531_00000000-0000-4000-8000-000000000000/children/mxd_var_ops_s4p4_kskr_abcdef12/child.dxf",
    "content_type": "application/dxf",
    "checksum_sha256": null,
    "size_bytes": null
  }
}
```

### D. Rule Catalog JSON

```json
{
  "schema_version": "mother_dxf.rule_catalog.v1",
  "catalog_id": "rule_catalog_mxd_door_v0",
  "version": "0.1.0",
  "status": "active",
  "metadata": {
    "profile_id": "MXD_DOOR_V0",
    "source": "initial_mxd_kskr_authoring",
    "created_at": "2026-05-31T00:00:00.000Z",
    "created_by": "system",
    "description": "Mother DXF rule catalog."
  },
  "rule_groups": [
    {
      "group_id": "topology_delta_modifier",
      "label": "Topology delta modifiers",
      "stage": "topology_delta_modifier",
      "priority": 100
    }
  ],
  "rules": [
    {
      "rule_id": "KSKR_EXTERNAL_DOOR_RIGHT_SHORTEN",
      "rule_version": "1.0.0",
      "group_id": "topology_delta_modifier",
      "label": "KSKR external door right band -30 mm",
      "status": "draft",
      "metadata": {
        "profile_scope": "OPS_S4P4",
        "owner": "mother_dxf_v1",
        "deprecated_by": null
      },
      "condition": {
        "parameter": "VANJSKA_VRATA",
        "operator": "==",
        "value": "Da"
      },
      "target_scope": {
        "family": "VRATA",
        "products": ["PPV"],
        "parts": ["KSKR"]
      },
      "action": {
        "stage": "topology_delta_modifier",
        "target_band": "R",
        "axis": "X",
        "delta": -30,
        "unit": "mm"
      }
    }
  ]
}
```

### E. Param Set JSON

```json
{
  "schema_version": "mother_dxf.param_set.v1",
  "metadata": {
    "param_set_id": "mxd_param_set_00000000-0000-4000-8000-000000000000",
    "parameter_catalog_id": "legacy_door_configurator_catalog_v0",
    "status": "frozen",
    "created_at": "2026-05-31T00:00:00.000Z",
    "created_by": "user:unknown",
    "source": "manual_authoring"
  },
  "scope": {
    "technology_profile": "OPS_S4P4",
    "family": "VRATA",
    "product": "PPV",
    "part": "KSKR",
    "product_code": "KSKR"
  },
  "param_definitions": {
    "SIRINA_VRATA": {
      "type": "number",
      "unit": "mm",
      "min": 670,
      "max": 1100,
      "step": 10,
      "default": 900
    }
  },
  "values": {
    "SIRINA_VRATA": 900,
    "VISINA_VRATA": 2100
  },
  "param_metadata": {
    "value_source": "manual",
    "frozen_at": "2026-05-31T00:05:00.000Z",
    "validation": {
      "ok": true,
      "errors": [],
      "warnings": []
    }
  }
}
```

### F. Logging JSON

```json
{
  "schema_version": "mother_dxf.events.v1",
  "events": [
    {
      "event_id": "mxd_evt_00000000-0000-4000-8000-000000000000",
      "timestamp": "2026-05-31T00:00:00.000Z",
      "severity": "info",
      "type": "session_created",
      "subject": {
        "type": "session",
        "id": "mxd_sess_20260531_00000000-0000-4000-8000-000000000000"
      },
      "actor": {
        "type": "user",
        "id": "unknown"
      },
      "correlation_id": "mxd_req_00000000-0000-4000-8000-000000000000",
      "message": "Working session created.",
      "details": {
        "source_name": "kskr.dxf"
      }
    }
  ]
}
```

## 4. Filesystem vs DB Split

### DB vs Filesystem Split (Contractual)

The contractual split is:

- metadata goes to DB: identities, lifecycle state, timestamps, relationships, validation summaries, generation summaries, catalog references, param set references, and path references
- payload goes to filesystem/object storage: DXF content, large parsed documents, verbose preview payloads, archival JSON snapshots, and NDJSON archives

DB records may mirror selected structured JSON as JSONB when it is needed for query, validation, or orchestration. Filesystem snapshots remain the reproducibility and rollback payload layer.

```text
Artifact | DB | Filesystem | Reason
Raw DXF | no | yes | large text/binary-like CAD payload; file/object storage is natural
Sanitized DXF | optional metadata only | yes | useful for replay; not needed for relational queries
Session metadata | yes | yes | DB queryable; JSON snapshot gives rollback and parity
Session working payload | yes as JSONB in hybrid | yes | structured, but may be large during transition
Mother JSON | yes | yes | structured and needed for DB queries; file mirror supports reproducibility
Mother DXF | no | yes | DXF payload should stay in file/object storage
Child DXF | no | yes | generated payload, potentially many files
Child metadata | yes | yes | structured status, paths, params, generation summary
Preview JSON | optional | yes | can be large/ephemeral; store selected metadata in DB
Preview DXF | no | yes | ephemeral CAD payload
Rules | yes | yes | structured, queryable, versioned contract
Params catalog | yes | yes | structured, queryable, versioned contract
Param sets | yes | yes | execution needs frozen snapshots
Logs | optional/append table | yes/NDJSON | DB for audit and search; filesystem for verbose run logs
Batch manifest | yes | yes | queryable orchestration state plus reproducible file snapshot
```

## 5. DB-ready Path Reference Model

### DB Record to Filesystem File

A DB record references a filesystem payload through artifact identity plus a path reference. The artifact record owns lifecycle and relationship metadata; the path reference only describes storage location.

### Path Reference Contract

A path reference contract describes where a file-backed payload lives without embedding machine-local absolute paths.

Required contract fields:

- `store`: storage backend class, such as filesystem/object storage
- `root_key`: named storage root resolved by platform configuration
- `relative_path`: immutable path below the resolved root
- `content_type`: MIME or domain content type
- `checksum`: content fingerprint when available
- `size`: byte size when available

Path references belong to artifact records and domain metadata. They are not a replacement for artifact identity.

Every file-backed payload is referenced through an artifact registry shape:

```json
{
  "artifact_id": "mxd_art_00000000-0000-4000-8000-000000000000",
  "artifact_type": "child_dxf",
  "store": "fs",
  "root_key": "mother_dxf_v1",
  "relative_path": "sessions/<session_id>/children/<variant_id>/child.dxf",
  "content_type": "application/dxf",
  "checksum_sha256": "optional",
  "size_bytes": 0,
  "created_at": "2026-05-31T00:00:00.000Z",
  "status": "created"
}
```

DB must store relative paths, never machine-local absolute paths. Runtime resolves:

```text
absolute_path = configured_store_root(root_key) + "/" + relative_path
```

### Path Generation

Inputs:

- `session_id`
- `artifact_type`
- `artifact_id`
- optional `variant_id`
- optional `batch_id` / `job_id`

Rules:

- generated once, then stored
- path is immutable after artifact creation
- superseding creates a new artifact id and new path
- paths must not encode mutable title/status

### ID Generation

Recommended:

- `session_id = mxd_sess_<yyyyMMdd>_<uuid>`
- `artifact_id = mxd_art_<uuid>`
- `variant_id = mxd_var_<technology_profile>_<part>_<hash(param_set_id + branch_mode + child_mode)>`
- `preview_id = mxd_prev_<uuid>`
- `batch_id = mxd_batch_<yyyyMMdd>_<uuid>`
- `job_id = mxd_job_<short_batch_id>_<part>_<zero_padded_ordinal>`

## 6. Migration Path to PostgreSQL

### Phase 1 - File-oriented

Do:

- keep current runtime behavior
- add architecture-only skeleton and docs
- introduce artifact registry JSON shape in future non-invasive files
- keep catalogs in repo JSON

Do not:

- add DB writes
- change route responses
- move existing session files

Changes:

- documentation standardizes target models
- future new artifacts can follow path-reference envelope

Same:

- session JSON remains authority
- DXF files remain under filesystem output

### Phase 2 - Hybrid Metadata + File Artifacts

Do:

- add DB tables for sessions, artifacts, param sets, previews, child metadata, events
- write DB metadata after successful filesystem write
- keep filesystem as payload authority
- mirror current session JSON for rollback

Do not:

- store DXF payloads in DB
- require DB for local development until migration is accepted

Changes:

- DB can list sessions/artifacts
- artifact ids become explicit
- preview and child metadata become queryable

Same:

- resolver reads existing session payload shape
- DXF generation remains unchanged

### Phase 3 - Full DB Integration

Do:

- make DB metadata authoritative
- store normalized catalogs, param sets, and events
- use filesystem only through Core Shell storage abstraction
- add migration tooling for old session JSON files

Do not:

- let modules write durable files directly
- let DBR call Mother internals except via orchestration contract

Changes:

- session load/save goes through Core Shell store interface
- latest session state is DB-backed

Same:

- DXF payloads remain file/object artifacts
- contract JSON mirrors remain possible

### Phase 4 - Multi-user Concurrency

Do:

- add optimistic concurrency through `session_revision`
- add optional locks
- add actor attribution
- add append-only audit events

Do not:

- rely on `updated_at` alone for conflict detection
- silently overwrite approved artifacts

Changes:

- saves require expected revision
- UI can show conflicts

Same:

- session lifecycle vocabulary
- artifact lifecycle vocabulary

### Phase 5 - Batch Orchestration

Do:

- introduce batch and job records
- freeze parameter sets per job
- reference approved mother artifacts
- store per-child metadata and output paths
- let DBR own production batch orchestration

Do not:

- make `mother_dxf_v1` a production batch orchestrator
- duplicate DBR order/job state inside Mother module

Changes:

- child generation becomes job-addressable
- failures are per-job and resumable

Same:

- Mother DXF remains authoring and canonical artifact preparation surface
- child DXFs remain filesystem artifacts

## 7. I/O Skeleton

Skeleton files are placed in:

```text
docs/mother_dxf_io_v1_skeleton/
```

They are intentionally non-production placeholders. They do not import from existing runtime, do not access DB, do not write files, and do not implement DXF logic.

## 8. Architecture Boundary Report

Files touched by layer:

- `docs/MOTHER_DXF_DB_READY_IO_ARCHITECTURE_v1.md` - documentation only
- `docs/mother_dxf_io_v1_skeleton/**` - documentation skeleton only

Boundary impact:

- no `src/api` change
- no `src/modules` change
- no `src/core_shell` change
- no durable storage behavior change
- proposed future direction reinforces Core Shell storage boundary

Rollback note:

- delete `docs/MOTHER_DXF_DB_READY_IO_ARCHITECTURE_v1.md`
- delete `docs/mother_dxf_io_v1_skeleton/`
- no runtime rollback needed
