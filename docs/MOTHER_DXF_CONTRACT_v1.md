# MOTHER_DXF_CONTRACT_v1

Status: canonical contract v1, rewritten as Mother DXF v2 boundary-ready contract.

This document defines the Mother DXF domain, session, artifact, and resolver boundary contract. It is a contract document, not runtime code, not a DB schema, and not an API implementation plan.

## 1. Purpose and Scope

Mother DXF is an internal, controlled DXF authoring environment for preparing, validating, previewing, and materializing production-ready DXF artifacts.

Mother DXF v2 is based on a domain-first workflow:

1. create and validate `session_context_v1`
2. lock production program / family / product / part context
3. load raw DXF
4. sanitize raw DXF
5. project geometry context
6. validate SEM and XDATA as evidence
7. prepare resolver input
8. execute preview / child / export through Core Shell Resolver
9. register artifacts and lineage through Core Shell I/O

The contract covers:

- Mother DXF / Core Shell Resolver ownership boundary
- `session_context_v1`
- `domain_context_v1`
- `geometry_context_v1`
- session lifecycle v2
- authoritative context chain
- WYSIWYG consistency enforcement
- passive projection rules
- slot model activation rules
- resolver input and output contracts
- child DXF and DBR/export rules
- artifact registry and DB-ready I/O contracts
- semantic authoring model
- legacy fallback and migration rules
- error taxonomy

Non-goals:

- no direct DB implementation
- no API route implementation
- no runtime behavior approval by documentation alone
- no UI design specification
- no permission to bypass Core Shell storage contracts

## 2. Core Principle

Mother DXF is the authoring, session, projection, diagnostics, and artifact orchestration module.

Core Shell Resolver is the execution authority for all transformative geometry behavior.

Mother DXF may describe, validate, select candidates, and project context. Mother DXF must not become the execution authority for geometry transformations.

If an operation changes geometry, removes geometry, moves geometry, selects authoritative geometry for execution, or produces executable output, that operation belongs to Core Shell Resolver.

## 3. Ownership Boundary

### 3.1 Mother DXF Owns

Mother DXF owns non-transformative workflow responsibilities:

- session lifecycle
- raw DXF intake
- sanitized document custody
- session envelope integration
- artifact registry integration
- parameter catalog references
- rule catalog references
- metadata authoring
- SEM evidence extraction
- XDATA evidence extraction
- `session_context_v1`
- `domain_context_v1`
- `geometry_context_v1`
- passive slot model projections
- diagnostics and read models
- UI-facing `projectViewModel()`
- resolver input preparation
- persistence through Core Shell I/O

Mother DXF may compute projections, summaries, warnings, readiness states, and candidate selections.

Mother DXF must not independently execute new v2 transformative geometry behavior.

### 3.2 Core Shell Resolver Owns

Core Shell Resolver owns transformative behavior:

- authoritative geometry selection
- branch-based execution
- slot-based execution
- variant selection for execution
- rule execution
- parameter-resolved transformations
- geometry movement
- offsets
- topology transforms
- trim/rejoin logic
- child DXF materialization
- preview geometry materialization
- export-ready geometry materialization
- execution diagnostics
- execution plan validation

Core Shell Resolver must declare the execution authority it used for each run.

Allowed values:

```js
execution_authority: "core_shell_resolver"
geometry_authority: "legacy_branch" | "slot_model"
```

Legacy Mother DXF execution paths must be explicitly marked:

```js
execution_authority: "mother_dxf_legacy"
migration_status: "deprecated_for_v2"
```

## 4. Transformative Function Rule

Mother DXF must not implement new transformative geometry functions directly.

When a new transformative requirement appears, the implementation path is:

1. define or extend resolver input contract
2. implement the operation in Core Shell Resolver
3. expose resolver output as preview, diagnostics, or artifact data
4. have Mother DXF call resolver
5. have Mother DXF store and register resulting artifacts through Core Shell I/O
6. reflect resolver output in `projectViewModel()`

Forbidden pattern:

```txt
Mother DXF UI state
  -> Mother DXF custom geometry transform
  -> child/export output
```

Required pattern:

```txt
Mother DXF session context
  -> resolver_input_v1_minimal or resolver_input_v2_extended
  -> Core Shell Resolver
  -> resolver_output_v1
  -> Mother DXF view/artifacts
```

## 5. Authoritative Geometry Decision Rule

Mother DXF may calculate candidate authoritative geometry.

Examples of candidate calculations:

- candidate branch mode
- candidate variant key
- candidate slot index
- candidate slot-to-variant mapping
- candidate object set
- candidate validation readiness

Core Shell Resolver makes the only authoritative geometry decision for execution.

Mother DXF must not independently activate slot-based execution.

Slot-based execution becomes valid only when:

1. Mother DXF prepares the required context and evidence
2. resolver input includes the slot model and variant mapping
3. Core Shell Resolver validates the input
4. Core Shell Resolver declares the selected authoritative slot
5. resolver output is used for preview, child, export, and DBR handoff

### 5.1 Resolver Acceptance Rule

Core Shell Resolver must explicitly accept authoritative geometry before any execution result is valid.

Resolver output must contain:

```js
geometry_authority
selected_slot_index
selected_variant_key
```

If any of these elements is missing for an execution mode that requires geometry authority, execution is invalid.

For `geometry_authority = "legacy_branch"`, `selected_slot_index` and `selected_variant_key` may be `null`, but they must still be present so downstream consumers can distinguish explicit legacy execution from missing resolver acceptance.

For `geometry_authority = "slot_model"`, `selected_slot_index` must be a valid slot index and `selected_variant_key` must match validated variant mapping policy.

## 6. Authoritative Context Chain

The context authority order is:

```txt
session_context_v1
  -> domain_context_v1 validation
  -> geometry_context_v1 validation
  -> resolver_input
  -> resolver_output
  -> artifact registration / DBR handoff
```

Forbidden authority order:

```txt
raw DXF filename
  -> default config
  -> inferred SEM/XDATA
  -> child/export output
```

`session_context_v1` is the authoritative domain context.

SEM and XDATA are evidence. They may confirm or contradict `session_context_v1`, but they must never silently override it.

## 7. session_context_v1

`session_context_v1` is the mandatory pre-DXF domain context.

A Mother DXF v2 session must not load raw DXF for production workflow until `session_context_v1` is complete and valid.

Canonical shape:

```js
session_context_v1: {
  version: 1,
  status: "context_draft" | "context_locked",
  production_program_id: "MXD" | "INOX" | "MDF" | "ALU" | string,
  family_id: string,
  product_id: string,
  part_id: string,
  nominal_value_set_id: string,
  rule_set_id: string,
  parameter_catalog_id: string,
  branch_mode: "ALL" | "BASE" | "ECO" | string,
  expected_variant_policy: {
    mode: "none" | "optional" | "required",
    expected_variant_keys: string[]
  },
  selected_by: string | null,
  locked_at: string | null,
  validation: {
    ok: boolean,
    warnings: [],
    errors: []
  }
}
```

Required invariants before context lock:

- `production_program_id` is selected
- `family_id` belongs to the selected production program
- `product_id` belongs to the selected family
- `part_id` belongs to the selected product
- `nominal_value_set_id` belongs to the selected product/part scope
- `rule_set_id` is compatible with selected product/part/technology unit
- `parameter_catalog_id` is compatible with selected rule set and product/part scope
- `branch_mode` is explicitly selected
- `expected_variant_policy` is explicit

## 8. Domain Context Merge Algorithm

`domain_context_v1` is a validated projection, not the domain authority.

Merge algorithm:

```txt
session_context_v1 (authority)
+ SEM (evidence)
+ XDATA (evidence)
= domain_context_v1 (validated projection)
```

Rules:

- `session_context_v1` provides authoritative production program, family, product, part, nominal set, rule set, parameter catalog, and branch mode.
- SEM may confirm or contradict family/product/part/nominal/rule evidence.
- XDATA may confirm or contradict variant evidence.
- SEM never overrides `session_context_v1`.
- XDATA never overrides `session_context_v1`.
- Contradictions become validation findings.
- Blocking contradictions prevent preview, child, export, and DBR handoff.

### 8.1 SEM/XDATA Contradiction Rule

If SEM evidence and XDATA evidence contradict each other, the result is a blocking domain error unless `session_context_v1.expected_variant_policy.mode = "optional"`.

Examples of contradiction include:

- SEM identifies one product/part context while XDATA variant keys belong to another context.
- SEM rule references require one variant family while XDATA exposes incompatible variant keys.
- SEM indicates no variant behavior while XDATA requires a variant and policy is not optional.

When `expected_variant_policy.mode = "optional"`, the contradiction may be downgraded to warning only if resolver input remains deterministic and does not require variant-based authoritative selection.

Canonical shape:

```js
domain_context_v1: {
  version: 1,
  authority: "session_context_v1",
  production_program_id,
  family,
  product,
  part,
  technology_unit_id,
  nominal_value_set_id,
  rule_set_id,
  parameter_catalog_id,
  branch_mode,
  variant_key,
  sem_evidence: {
    present,
    family,
    product,
    part,
    nominal_width,
    nominal_height,
    rule_refs,
    validation
  },
  xdata_evidence: {
    geometry_variants,
    block_internal_geometry_variants,
    invalid_branch_xdata_count,
    validation
  },
  validation: {
    ok,
    warnings,
    errors
  }
}
```

## 9. geometry_context_v1

`geometry_context_v1` is the validated projection of observed geometry.

It describes what is present in the DXF. It does not decide product, part, rule set, or parameter set.

Canonical shape:

```js
geometry_context_v1: {
  version: 1,
  slot_width: 3000,
  base_slot_index: 0,
  slots: [
    {
      slot_index,
      role: "base" | "variant",
      variant_key,
      bbox,
      object_ids,
      hygiene,
      band_assignments,
      slot_completeness: {
        missing_objects: number,
        unexpected_objects: number,
        cross_slot_objects: number
      },
      validation
    }
  ],
  authoritative_slot_index: null | number,
  authoritative_variant_key: null | string,
  validation: {
    ok,
    warnings,
    errors
  }
}
```

`geometry_context_v1` may become execution-relevant only when passed into resolver input and accepted by Core Shell Resolver.

### 9.1 Slot Completeness Metrics

Each slot must expose completeness metrics so resolver and WYSIWYG validation can distinguish clean slot geometry from mixed or leaking geometry.

Canonical field:

```js
slot_completeness: {
  missing_objects: number,
  unexpected_objects: number,
  cross_slot_objects: number
}
```

Meanings:

- `missing_objects`: expected objects that are absent from the slot according to selected product/part/variant policy
- `unexpected_objects`: objects present in the slot but not expected by selected product/part/variant policy
- `cross_slot_objects`: objects whose bbox crosses the physical slot boundary

Slot completeness metrics are passive in Phase 1 and become blocking for slot-authoritative execution in Phase 2.

## 10. Session Lifecycle v2

### 10.1 Lifecycle States

Canonical v2 states:

- `context_draft`
- `context_locked`
- `raw_loaded`
- `geometry_projected`
- `domain_validated`
- `authoring_ready`
- `preview_ready`
- `child_ready`
- `export_ready`

Legacy user-facing states such as `draft`, `in_review`, and `finished` may remain as UI/status labels, but v2 execution readiness is governed by the lifecycle states above.

### 10.2 context_draft

Purpose: user selects production/domain context before DXF upload.

Allowed transitions:

- to `context_locked` when `session_context_v1.validation.ok === true`

Forbidden transitions:

- to `raw_loaded`
- to `preview_ready`
- to `child_ready`
- to `export_ready`

Required invariants:

- session exists
- context may be incomplete
- no production raw DXF execution is allowed

Validation rules:

- missing production program is an error
- missing family/product/part is an error
- missing rule set is an error
- missing parameter catalog is an error
- missing branch mode is an error

### 10.3 context_locked

Purpose: domain context is explicit and stable enough for raw DXF intake.

Allowed transitions:

- to `raw_loaded` after raw DXF is attached and sanitized
- back to `context_draft` only through explicit context unlock/reset

Forbidden transitions:

- direct transition to `preview_ready`
- direct transition to `child_ready`
- direct transition to `export_ready`

Required invariants:

- `session_context_v1.status === "context_locked"`
- context lock timestamp exists
- all selected catalog references are compatible

Validation rules:

- context compatibility errors block raw DXF production intake

### 10.4 raw_loaded

Purpose: raw DXF has been loaded and sanitized.

Allowed transitions:

- to `geometry_projected` after object model, bbox, slot model, hygiene, and band projections are computed
- to `context_locked` when raw DXF is removed or replaced

Forbidden transitions:

- direct transition to `child_ready`
- direct transition to `export_ready`

Required invariants:

- raw DXF artifact is registered
- sanitized document exists
- session context remains locked

Validation rules:

- invalid DXF structure is blocking
- missing relevant geometry is blocking for production workflow

### 10.5 geometry_projected

Purpose: geometry projections exist.

Allowed transitions:

- to `domain_validated` after SEM, XDATA, parameter, rule, and slot validation complete
- to `raw_loaded` after geometry-affecting raw replacement

Forbidden transitions:

- direct transition to `child_ready`
- direct transition to `export_ready`

Required invariants:

- `geometry_context_v1` exists
- `geometry_slot_model` exists
- global and per-slot diagnostics are available

Validation rules:

- slot boundary crossing is at least a warning
- invalid slot model blocks slot authority
- global bbox spanning multiple slots must be detected when global classification is used

### 10.6 domain_validated

Purpose: domain context and observed evidence have been compared and validated.

Allowed transitions:

- to `authoring_ready` when blocking errors are absent
- to `context_locked` when domain context is changed
- to `raw_loaded` when raw DXF is replaced

Forbidden transitions:

- direct transition to `export_ready`

Required invariants:

- `domain_context_v1.validation` exists
- SEM has been evaluated as evidence
- XDATA has been evaluated as evidence
- rule and parameter compatibility has been checked

Validation rules:

- SEM mismatch may be warning or blocking according to policy
- wrong parameter catalog is blocking
- wrong rule set is blocking
- uninitialized branch mode is blocking

### 10.7 authoring_ready

Purpose: manual metadata/layer/topology authoring is allowed.

Allowed transitions:

- to `preview_ready` after resolver-backed or legacy-validated preview is generated
- back to `domain_validated` when authoring changes invalidate preview readiness

Forbidden transitions:

- direct transition to `export_ready` without preview/child readiness when policy requires them

Required invariants:

- domain context is valid
- geometry context is valid enough for authoring
- authoring changes are revisioned

Validation rules:

- assignments must be internally consistent
- SEM authoring must remain compatible with session context

### 10.8 preview_ready

Purpose: preview exists and matches current resolver input snapshot.

Allowed transitions:

- to `child_ready` when child generation conditions pass
- back to `authoring_ready` when context, parameters, rules, or geometry change

Forbidden transitions:

- to `child_ready` if WYSIWYG validation fails

Required invariants:

- preview references current input hash
- preview uses current context and parameter snapshot
- resolver output or legacy fallback output is registered

Validation rules:

- WYSIWYG mismatch blocks promotion
- stale preview blocks child readiness

### 10.9 child_ready

Purpose: child DXF generation is valid and reproducible.

Allowed transitions:

- to `export_ready` after export/DBR handoff validation passes
- back to `preview_ready` when child artifacts are superseded

Forbidden transitions:

- child generation without valid domain context
- child generation without WYSIWYG consistency

Required invariants:

- child output references source session revision
- child output references parameter snapshot
- child output references resolver input/output or marked legacy fallback

Validation rules:

- domain invalid blocks child generation
- geometry invalid blocks child generation
- parameter/rule invalid blocks child generation

### 10.10 export_ready

Purpose: export and DBR handoff are allowed.

Allowed transitions:

- to archived/review lifecycle states according to operational policy
- back to earlier states only by explicit superseding revision

Forbidden transitions:

- DBR handoff without artifact lineage
- DBR handoff without reconstructable execution context

Required invariants:

- artifact registry lineage is complete
- current resolver input/output or legacy fallback summary is registered
- no blocking validation errors exist

Validation rules:

- DBR export context invalid is blocking
- stale artifact references are blocking

### 10.11 Lifecycle Rollback Rules

Lifecycle rollback must be deterministic whenever context, geometry, or authoring state changes.

Rules:

- changing `family_id`, `product_id`, or `part_id` returns lifecycle to `context_locked`
- changing rule catalog or parameter catalog returns lifecycle to `domain_validated` after compatibility is rechecked
- replacing or materially changing the DXF returns lifecycle to `raw_loaded`
- changing hygiene inputs, TOPO metadata, layer assignments, or authoring assignments returns lifecycle to `geometry_projected`

Rollback invalidates all downstream readiness states after the target state.

For example, rollback to `geometry_projected` invalidates `domain_validated`, `authoring_ready`, `preview_ready`, `child_ready`, and `export_ready` until they are recomputed from the new state.

## 11. Session Reset Rules

Changing `production_program_id` resets:

- family
- product
- part
- nominal value set
- rule set
- parameter catalog
- parameter set
- validation readiness
- preview readiness
- child readiness
- export readiness

Changing `family_id` resets:

- product
- part
- nominal value set
- rule set
- parameter catalog
- parameter set
- preview readiness
- child readiness
- export readiness

Changing `product_id` resets:

- part
- nominal value set
- rule set
- parameter catalog
- parameter set
- preview readiness
- child readiness
- export readiness

Changing `part_id` resets:

- nominal value set
- rule set
- parameter catalog
- parameter set
- assignments when assignment scope is part-dependent
- preview artifacts
- child artifacts
- export readiness

Changing `rule_set_id` resets:

- rule validation
- resolver input hash
- preview readiness
- child readiness
- export readiness

Changing `parameter_catalog_id` resets:

- parameter set
- parameter resolution
- resolver input hash
- preview readiness
- child readiness
- export readiness

Changing `branch_mode` resets:

- branch comparison
- resolver input hash
- preview readiness
- child readiness
- export readiness

Replacing raw DXF resets:

- sanitized document
- object model
- document bbox
- geometry slot model
- geometry context
- hygiene projections
- band projections
- preview artifacts
- child artifacts
- export readiness

Replacing raw DXF may preserve locked `session_context_v1` if the user explicitly chooses to keep the same product/part context.

## 12. Resolver Input Contract

Resolver input is the only allowed bridge from Mother DXF authoring state into resolver execution.

### 12.1 resolver_input_v1_minimal

`resolver_input_v1_minimal` supports v2 migration while legacy branch authority may still exist.

It is required for preview, child, and export readiness during migration.

Canonical shape:

```js
resolver_input_v1_minimal: {
  version: 1,
  input_kind: "resolver_input_v1_minimal",
  session: {
    session_id,
    session_revision,
    source_name,
    artifact_state,
    lifecycle_state
  },
  session_context_v1,
  domain_context_v1,
  geometry_context_v1,
  parameter_context: {
    parameter_set_id,
    parameter_catalog_id,
    resolved_parameters,
    validation
  },
  rule_context: {
    rule_set_id,
    rule_catalog_id,
    rule_refs,
    validation
  },
  execution_context: {
    mode: "preview" | "child_dxf" | "export",
    geometry_authority: "legacy_branch",
    branch_mode,
    prefer_slot_mode: false,
    strict_domain_context: true,
    strict_geometry_context: false
  },
  legacy_branch_context: {
    branch_mode,
    selected_objects,
    filtered_objects
  },
  source_document_ref: {
    artifact_id,
    artifact_type: "raw_dxf" | "mother_dxf",
    content_hash
  },
  source_objects: [
    {
      object_id,
      entity_id,
      bbox,
      slot_index,
      primary_layer,
      xdata_metadata,
      semantic_metadata,
      topo_role_metadata
    }
  ]
}
```

Rules:

- must include `session_context_v1`
- must include `domain_context_v1`
- must include `geometry_context_v1`
- may execute with `geometry_authority = "legacy_branch"`
- must include `legacy_branch_context` when using legacy branch authority
- must not claim slot model authority
- must be hashable for WYSIWYG enforcement

#### 12.1.1 Legacy Branch Execution Context

`resolver_input_v1_minimal` must explicitly describe legacy branch execution context so resolver output and UI projections can be compared deterministically.

Canonical field:

```js
legacy_branch_context: {
  branch_mode,
  selected_objects,
  filtered_objects
}
```

Rules:

- `selected_objects` is the object set eligible for legacy branch execution
- `filtered_objects` is the object set removed or excluded by branch filtering
- both lists must be derived before resolver execution and included in the resolver input hash

### 12.2 resolver_input_v2_extended

`resolver_input_v2_extended` is required for slot-based authoritative execution.

Canonical shape:

```js
resolver_input_v2_extended: {
  version: 2,
  input_kind: "resolver_input_v2_extended",
  session: {
    session_id,
    session_revision,
    source_name,
    artifact_state,
    lifecycle_state
  },
  session_context_v1,
  domain_context_v1,
  geometry_context_v1,
  parameter_context: {
    parameter_set_id,
    parameter_catalog_id,
    resolved_parameters,
    override_hierarchy,
    validation
  },
  rule_context: {
    rule_set_id,
    rule_catalog_id,
    rule_refs,
    rule_versions,
    validation
  },
  slot_context: {
    slot_width,
    base_slot_index,
    candidate_authoritative_slot_index,
    candidate_variant_key,
    variant_to_slot_map,
    slot_validation,
    completeness_validation
  },
  execution_context: {
    mode: "preview" | "child_dxf" | "export",
    geometry_authority: "slot_model",
    branch_mode,
    prefer_slot_mode: true,
    strict_domain_context: true,
    strict_geometry_context: true,
    strict_variant_mapping: true
  },
  source_document_ref: {
    artifact_id,
    artifact_type: "raw_dxf" | "mother_dxf",
    content_hash
  },
  source_objects: [
    {
      object_id,
      entity_id,
      bbox,
      slot_index,
      primary_layer,
      xdata_metadata,
      semantic_metadata,
      topo_role_metadata
    }
  ]
}
```

Rules:

- must include validated slot context
- must include variant-to-slot mapping
- must include strict geometry context validation
- resolver must confirm authoritative slot
- resolver must return selected slot and selected variant in output

## 13. Resolver Output Contract

Core Shell Resolver returns a canonical output envelope.

Canonical shape:

```js
resolver_output_v1: {
  version: 1,
  resolver_run: {
    run_id,
    resolver_version,
    mode,
    started_at,
    completed_at,
    input_hash,
    execution_authority: "core_shell_resolver"
  },
  execution_summary: {
    geometry_authority,
    branch_mode,
    selected_slot_index,
    selected_variant_key,
    source_object_count,
    selected_object_count,
    transformed_object_count,
    removed_object_count,
    warning_count,
    error_count
  },
  resolver_plan: {
    stages,
    operations,
    dependencies,
    validation
  },
  render_model: {
    objects,
    bbox,
    layers,
    validation
  },
  output_artifacts: {
    preview_json,
    preview_dxf,
    child_dxf,
    export_dxf
  },
  diagnostics: {
    warnings,
    errors,
    readiness
  }
}
```

Mother DXF may display resolver output, register resolver artifacts, and expose resolver summaries in `projectViewModel()`.

Mother DXF must not silently rewrite resolver output.

## 14. WYSIWYG Consistency Rule

The following must derive from the same resolver input snapshot:

- UI preview
- resolver preview
- child DXF
- export DXF
- DBR handoff

If they do not derive from the same input hash, the session must be marked with:

```txt
WYSIWYG_CONTRACT_MISMATCH
```

This is a blocking condition for child/export readiness.

Examples of mismatch:

- UI displays slot-aware geometry while resolver executes global branch geometry.
- UI displays INOX context while resolver uses MXD/VRATA parameters.
- UI displays `branch_mode = ALL` while resolver executes `BASE`.
- UI displays per-slot layer classification while child DXF uses global bbox classification.
- Preview and child DXF are generated from different parameter snapshots.
- DBR handoff uses an artifact whose resolver input hash cannot be reconstructed.

## 15. WYSIWYG Enforcement Points

WYSIWYG validation must run before:

- preview generation
- child DXF generation
- export generation
- DBR handoff

Before preview:

- compute resolver input hash
- compare UI projection context to resolver input context
- block if selected context, parameter set, rule set, branch mode, or geometry authority differ

Before child DXF:

- verify child generation uses the same resolver input hash as accepted preview, or explicitly supersedes preview with a new resolver run
- block if preview is stale
- block if domain or geometry validation changed after preview

Before export:

- verify export uses the current resolver output
- block if artifact lineage is incomplete

Before DBR handoff:

- verify DBR receives resolver-backed or explicitly marked legacy fallback output
- verify execution context is reconstructable
- block if WYSIWYG contract mismatch exists

### 15.1 Projection Hash Model

WYSIWYG enforcement compares projection and resolver hashes.

Canonical fields:

```js
ui_projection_hash
resolver_input_hash
resolver_output_hash
```

Rules:

- `ui_projection_hash` identifies the exact `projectViewModel()` projection shown to the user for preview/authoring decisions
- `resolver_input_hash` identifies the exact resolver input envelope used for execution
- `resolver_output_hash` identifies the exact resolver output envelope used for preview, child, export, or DBR handoff
- child/export readiness requires all three hashes to be current and mutually consistent according to WYSIWYG policy

## 16. Passive Projection Rule

Mother DXF may create passive projections before resolver activation.

Examples:

- `geometry_slot_model`
- `geometry_context_v1`
- `domain_context_v1`
- legacy vs slot comparison
- hygiene diagnostics
- parameter readiness diagnostics
- rule readiness diagnostics

Passive projections must be labeled as passive and must not affect execution unless included in resolver input and accepted by Core Shell Resolver.

A passive projection is not authoritative execution behavior.

## 17. Geometry Authority Rule

Phase 1:

- legacy branch model remains execution authority
- slot model remains passive projection
- resolver output must declare `geometry_authority = "legacy_branch"`

Phase 2:

- slot model may become execution authority only through resolver
- resolver output must declare `geometry_authority = "slot_model"`
- authoritative slot and variant selection must be visible in resolver diagnostics

Mother DXF must not activate slot-based execution independently.

## 18. Slot Model Activation Conditions

Slot model can become authoritative only if all conditions are true:

- `session_context_v1` is valid
- `domain_context_v1` is valid
- `geometry_context_v1` is valid
- slot model is valid
- variant mapping is valid
- parameter context is valid
- rule context is valid
- Core Shell Resolver confirms authoritative slot
- resolver output declares `geometry_authority = "slot_model"`
- WYSIWYG validation passes

If any condition fails, slot model remains passive and execution must use approved fallback behavior.

## 19. Child DXF Rule

Mother DXF must not generate child DXF through module-local transformation logic for new v2 behavior.

Child DXF generation must go through Core Shell Resolver.

Allowed Mother DXF responsibilities:

- prepare resolver input
- call resolver
- receive resolver output
- save child artifacts through Core Shell I/O
- register child artifacts in the artifact registry
- expose resolver diagnostics

Blocking conditions:

```txt
SESSION_CONTEXT_INVALID
DOMAIN_CONTEXT_INVALID
GEOMETRY_CONTEXT_INVALID
PARAMETER_CONTEXT_INVALID
RULE_CONTEXT_INVALID
WYSIWYG_CONTRACT_MISMATCH
CHILD_GENERATION_BLOCKED_DOMAIN_INVALID
```

## 20. Legacy Child DXF Fallback

Legacy child DXF paths may remain active until resolver v2 child generation is implemented and approved.

Legacy fallback rules:

- must be marked `execution_authority = "mother_dxf_legacy"`
- must be marked `migration_status = "deprecated_for_v2"`
- must include source session revision
- must include parameter snapshot identity
- must include branch mode
- must include generation summary
- must pass WYSIWYG validation against current UI/read-model context
- must not claim resolver-backed execution
- must not claim slot model authority

Legacy fallback is not a precedent for adding new transformations to Mother DXF.

## 21. DBR / Export Rule

DBR must receive only resolver-backed, context-valid outputs, or explicitly marked legacy fallback outputs during migration.

DBR handoff requires:

- valid `session_context_v1`
- valid `domain_context_v1`
- valid `geometry_context_v1`
- valid parameter context
- valid rule context
- resolver output generated from current input hash, or explicit legacy fallback summary
- no WYSIWYG mismatch
- registered artifact lineage

Mother DXF must not hand DBR an artifact whose execution context cannot be reconstructed.

## 22. Identity Model

Identifiers are stable contract keys across DB metadata and filesystem payloads.

Mutable labels, titles, statuses, and filenames must not be primary identities.

Canonical identifiers:

- `session_id`: identifies one Mother DXF authoring session and its revision history
- `session_revision`: monotonically increasing revision for optimistic concurrency and reproducibility
- `artifact_id`: identifies one durable file or structured snapshot registered as an artifact
- `variant_id`: identifies one child-output variant context
- `preview_id`: identifies one preview/dry-run result tied to a session revision and parameter set
- `param_set_id`: identifies one parameter snapshot
- `rule_set_id`: identifies one selected rule set
- `parameter_catalog_id`: identifies one parameter catalog
- `batch_id`: identifies one grouped orchestration run or package
- `job_id`: identifies one executable unit inside a batch
- `resolver_run_id`: identifies one resolver execution run

## 23. Session Envelope Contract

The session envelope is the stable authoring boundary.

Required sections:

- `metadata`: identity, lifecycle state, timestamps, actor attribution, revision, and concurrency fields
- `payload`: authoring summary, context references, catalog references, parameter set reference, validation summary, and document identity summary
- `path_references`: links to file-backed session, Mother JSON, raw DXF, Mother DXF, preview, child, and export artifacts

Required fields:

- `session_id`
- `session_revision`
- `created_by`
- `updated_by`
- `locked_by`
- lifecycle state
- `session_context_v1`
- current validation summary

Large parsed DXF state may remain file-backed and referenced from the envelope.

The session envelope is not required to store every heavy authoring payload directly in DB.

## 24. Artifact Registry Contract

The artifact registry defines how durable files and structured snapshots are identified and related.

Required fields:

- `artifact_id`
- `artifact_type`
- parent references
- lifecycle status
- checksum when available
- size when available
- path reference
- created timestamp
- producer context
- resolver lineage when artifact is preview, child, export, or DBR-facing output

Allowed parent references include:

- `session_id`
- `session_revision`
- `mother_artifact_id`
- `preview_id`
- `child_artifact_id`
- `batch_id`
- `job_id`
- `param_set_id`
- `rule_set_id`
- `parameter_catalog_id`
- `resolver_run_id`

The artifact registry stores artifact metadata and relationships. It does not own domain semantics.

### 24.1 Resolver Lineage

Resolver-backed and DBR-facing artifacts must record resolver lineage.

Canonical field:

```js
resolver_lineage: {
  resolver_run_id,
  resolver_input_hash,
  resolver_output_hash
}
```

Rules:

- `resolver_run_id` links the artifact to the resolver execution that produced or validated it
- `resolver_input_hash` links the artifact to the exact execution input
- `resolver_output_hash` links the artifact to the exact execution output
- legacy fallback artifacts must either include resolver lineage when available or explicitly declare legacy fallback execution authority

## 25. Artifact Types

Canonical artifact types:

- `raw_dxf`
- `sanitized_dxf`
- `mother_json`
- `mother_dxf`
- `child_metadata`
- `child_dxf`
- `preview_metadata`
- `preview_json`
- `preview_dxf`
- `resolver_input_json`
- `resolver_output_json`
- `rule_catalog`
- `parameter_catalog`
- `param_set`
- `event_stream`
- `batch_manifest`
- `job_manifest`
- `export_dxf`
- `dbr_handoff_manifest`

DXF artifacts are payload artifacts.

Metadata records for DXF artifacts are DB-friendly. DXF content itself remains file/object-storage friendly.

## 26. Path Reference Model

A DB record references filesystem/object-storage payload through artifact identity plus path reference.

Required path reference fields:

- `store`
- `root_key`
- `relative_path`
- `content_type`
- `checksum`
- `size`

DB records must not store machine-local absolute paths.

Path references describe storage location. They are not a replacement for artifact identity.

## 27. DB vs Filesystem Split

Mother DXF I/O is split into metadata plane and payload plane.

Metadata plane, DB-friendly:

- session metadata
- artifact registry records
- catalog metadata and searchable definitions
- param set metadata and values
- preview metadata
- child metadata
- batch/job metadata
- event records
- validation summaries
- generation summaries
- resolver input/output summaries
- path references

Payload plane, filesystem/object-storage friendly:

- raw DXF
- sanitized DXF
- Mother DXF
- child DXF
- preview DXF
- export DXF
- large parsed Mother JSON snapshots
- verbose preview JSON
- resolver input JSON
- resolver output JSON
- NDJSON event archives
- canonical catalog JSON mirrors

DB may mirror selected structured JSON as JSONB when needed for query, validation, or orchestration.

Filesystem snapshots remain the reproducibility and rollback payload layer.

## 28. Param Set Contract

A param set captures exact parameter values used for preview, child generation, export, or batch execution.

Required fields:

- `param_set_id`
- `parameter_catalog_id`
- catalog version
- scope: production program, technology profile, family, product, part, and product code context
- values
- override hierarchy
- validation
- frozen status
- lifecycle state

Parameter Catalog is not the same as a param set:

- Parameter Catalog defines possible parameter vocabulary.
- Param Set defines one concrete snapshot in that vocabulary.

Child, export, and batch execution must use frozen or reproducible parameter snapshots.

## 29. Rule Catalog Contract

A rule catalog defines named domain rules that may be referenced from Mother DXF metadata, document-level rule references, or resolver input.

Required fields:

- `catalog_id`
- `version`
- `rule_groups`
- rule definitions
- rule id
- rule version
- label
- status
- condition
- target scope
- action
- metadata
- lifecycle state

Rule catalogs are domain/profile-specific.

A rule catalog for one production program, family, product, part, or technology unit must not be treated as universal inventory for unrelated scopes.

## 30. Preview Contract

A preview captures a reproducible dry-run result. It is not itself the production artifact.

Required fields:

- `preview_id`
- `session_id`
- `session_revision`
- `param_set_id`
- `rule_set_id`
- branch mode
- geometry authority
- resolver input hash
- resolver output reference when resolver-backed
- generation summary
- warnings and validation findings
- lifecycle state
- path references for verbose preview JSON or preview DXF when retained

Preview metadata is DB-friendly.

Large resolver payloads and preview DXF outputs may remain filesystem-backed.

## 31. Child Contract

A child contract captures metadata for one generated child output.

Required fields:

- `child_artifact_id`
- `session_id`
- `session_revision`
- `mother_artifact_id`
- `variant_id`
- optional `job_id`
- `param_set_id`
- `rule_set_id`
- branch/mode metadata
- geometry authority
- resolver input hash or legacy fallback summary
- generation summary
- output path reference
- lifecycle state

Child DXF content remains file-backed.

Child metadata is queryable and may be mirrored as JSON.

## 32. Batch Contract

The batch contract describes grouped child generation orchestration while keeping Mother DXF focused on authoring and artifact preparation.

Required fields:

- `batch_id`
- `job_id` for each executable unit
- immutable batch and job manifests
- frozen param set references
- approved Mother artifact references
- resolver input references where applicable
- per-job status
- failure reason
- output artifact references
- lifecycle state

DBR or another orchestration layer may own production batch execution.

Mother DXF must not become the production batch orchestrator by accident.

## 33. Event Contract

Events form the append-only audit source for sessions, artifacts, previews, child generation, catalogs, resolver runs, DBR handoffs, and batches.

Required fields:

- `event_id`
- `timestamp`
- `severity`
- `type`
- `subject`
- `actor`
- `correlation_id`
- message/details payload

Session JSON may keep a small recent-event window for UI convenience.

The contractual audit source is the append-only event stream.

## 34. Semantic Contract

### 34.1 Stage 0 Sanitize Contract

Input: raw DXF.

Output: sanitized DXF.

Responsibilities:

- simplify DXF section payload
- keep relevant geometry
- normalize supported numeric payload to stable precision
- preserve viewer-readable DXF
- keep valid HEADER, TABLES, BLOCKS, ENTITIES, and EOF structure

Stage 0 does not imply full repair approval lifecycle.

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

### 34.2 Stage 1 Semantic Contract

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
- Every relevant semantic object must have exactly one primary dimensional class for legacy execution.
- Whole-block semantics are owned by the INSERT instance.

### 34.3 SEM Grammar

Metadata exists as exception/enrichment layer.

Canonical compact carrier:

```text
999
SEM:key=value;key=value;key=value
```

The `999` comment binds to the next entity unless explicitly document-level.

Document-level identity form:

```text
SEM:document=true;family={FAMILY};product={PRODUCT};part={PART};nominal_width={W};nominal_height={H}
```

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
- catalog-backed choices should be filtered by active production program / family / product / part context

SEM is evidence for `domain_context_v1`; it is not authority over `session_context_v1`.

### 34.4 XDATA Contract

Mother DXF XDATA uses application name:

```text
MOTHERDXF
```

Canonical branch/variant signal:

```text
GEOMETRY_VARIANT=<VALUE>
```

Rules:

- XDATA variant keys are evidence
- XDATA does not override `session_context_v1`
- XDATA does not independently activate slot execution
- XDATA variant keys may become executable only through resolver input and resolver validation

### 34.5 TOPO Contract

`TOPO` is a file-level `999` metadata family for part-level topology behavior.

Rules:

- `SEM` remains local entity/document metadata.
- `TOPO` describes part-level topology mode.
- `TOPO` and `SEM` must not be mixed as one grammar family.
- Approved Mother DXF must carry required TOPO metadata physically in DXF `999` rows when topology behavior is required.
- Session sidecar TOPO state is authoring/runtime convenience, not canonical approved artifact state.

Recognized topology families:

- `4-band parameter resize`
- `fixed envelope slide`
- `none / skip topology`

### 34.6 Enrichment Model

Mother DXF enrichment follows a three-level model:

1. 9-layer dimensional semantics
2. `999` metadata for presence / variant intent
3. rule-driven / operation-driven transform intent

Interpretation order:

1. dimensional semantics first
2. presence / variant metadata second
3. rule / operation intent third

Rule or operation references must not substitute for missing dimensional classification or missing metadata structure.

## 35. Geometry Branch Contract

Mother DXF may contain multiple alternative geometry branches inside one mother file when those branches share the same product/part contract, parameter set, label pipeline, and rule pipeline.

Rules:

- branch selection is not a layer contract
- untagged top-level geometry is implicit `BASE`
- tagged alternative geometry uses `MOTHERDXF` XDATA with `GEOMETRY_VARIANT=<VALUE>`
- `ALL` is only an authoring, inspection, and XDATA repair view
- preview/export/child must resolve exactly one source branch or one authoritative slot before execution
- resolved child output must not contain eliminated branch geometry or Mother DXF branch XDATA

Validation direction:

- untagged geometry in shifted branch slots should warn
- tagged branch geometry in implicit base slot should warn unless accepted as legacy/debug overlap
- child preview/export with `ALL` as materialization source should warn or refuse according to policy

## 36. Geometry Slot Model Contract

Slot model v1:

- `slot_width = 3000 mm`
- base geometry is slot `0`
- XDATA variants may occupy slots `1..N`
- slot `n` occupies X range `[n * slot_width, (n + 1) * slot_width)`
- each variant is complete geometry, not a delta
- no overlap between slots is allowed for strict mode
- per-slot bbox is required
- per-slot hygiene is required for strict mode
- per-slot 4-band / 9-layer classification is required for strict mode

Phase 1 slot model is passive.

Phase 2 slot model may become authoritative only through Core Shell Resolver.

## 37. Resolver Pipeline Contract

Canonical resolver pipeline:

1. load resolver input
2. validate session context
3. validate domain context
4. validate geometry context
5. resolve active geometry authority
6. isolate active branch or authoritative slot
7. load parameter context
8. load rule context
9. execute one movement stage
10. recompute local join graph and active geometry state
11. apply only stage-allowed repair / rejoin operators
12. run stage validation
13. continue to next declared movement stage
14. execute post-TOPO and later child rules
15. materialize preview / child / export output
16. return resolver output

Normative resolver rules:

- resolver must not search for arbitrary join candidates across the whole DXF
- resolver must not join across geometry branches or slots unless explicitly allowed by stage policy
- movement stages execute one at a time over previously stabilized geometry
- collision and repair logic operate on resolved active geometry for the same parameter set
- full raw DXF universe is not the execution domain
- SEM recompute is reserved future behavior, not default behavior

Stage taxonomy:

- `4_BAND_PARAMETER_RESIZE`
- `B_LAYER_OFFSET_9P5`
- `LEC_SLIDE`
- `REC_SLIDE`
- post-TOPO rigid offset stages
- final orientation stages
- child label application stages

## 38. Metadata Authoring Contract

Guided metadata authoring is controlled enrichment, not a free-text authoring model.

Supported authoring modes:

- presence condition
- geometry role
- operation reference
- post-TOPO group selection
- document/profile rule reference

Authoring principles:

- prefer explicit SEM metadata when intent is local, readable, and unambiguous
- use `rule_ref` only when local SEM is no longer clear or maintainable
- canonical SEM string is generated output of the authoring surface
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
- legacy mode may use global document bbox
- slot-aware mode must use per-slot bbox
- output is one of the 9 primary classes
- suggestion is a starting proposal, not immutable truth

## 39. Error Taxonomy

### SESSION_CONTEXT_INVALID

The required pre-DXF domain context is missing, incomplete, inconsistent, or unlocked.

Blocking for:

- raw DXF production intake
- preview
- child DXF
- export
- DBR handoff

### DOMAIN_CONTEXT_INVALID

`domain_context_v1` validation failed.

Blocking for:

- preview
- child DXF
- export
- DBR handoff

### GEOMETRY_CONTEXT_INVALID

`geometry_context_v1` validation failed for required execution mode.

Blocking for:

- slot-based preview
- slot-based child DXF
- slot-based export
- DBR handoff when slot authority is required

### PARAMETER_CONTEXT_INVALID

Parameter set, parameter catalog, resolved parameters, or override hierarchy is invalid for selected context.

Blocking for:

- preview
- child DXF
- export
- DBR handoff

### RULE_CONTEXT_INVALID

Rule set or rule catalog is invalid for selected production program, family, product, part, or technology unit.

Blocking for:

- preview
- child DXF
- export
- DBR handoff

### SEM_CONTEXT_MISMATCH

SEM evidence contradicts `session_context_v1`.

Policy determines whether it is warning or blocking.

Blocking when strict domain context is enabled.

### XDATA_VARIANT_UNMAPPED

XDATA variant key exists but cannot be mapped to valid expected variant policy or slot mapping.

Blocking for slot-based execution.

### SLOT_MODEL_GLOBAL_BBOX_LEAK

A global bbox or global 4-band/9-layer classification is used where slot-aware execution or preview is required.

Blocking for slot-authoritative execution.

### WYSIWYG_CONTRACT_MISMATCH

UI preview, resolver preview, child DXF, export, or DBR handoff does not derive from the same resolver input snapshot.

Blocking for:

- child DXF
- export
- DBR handoff

### CHILD_GENERATION_BLOCKED_DOMAIN_INVALID

Child generation was requested while required domain validation is invalid.

Blocking for child DXF.

### DBR_EXPORT_BLOCKED_CONTEXT_INVALID

DBR handoff was requested while context, artifact lineage, or execution reconstruction is invalid.

Blocking for DBR handoff.

## 40. Migration Timeline

### Phase 1 - Passive Projections

Goals:

- add passive `geometry_slot_model`
- add passive `geometry_context_v1`
- add passive `domain_context_v1`
- add legacy vs slot comparison
- add prefer-slot infrastructure disabled

Execution authority:

```js
geometry_authority: "legacy_branch"
```

### Phase 2 - Validation Gating

Goals:

- introduce `session_context_v1`
- require domain-first context before production DXF intake
- validate SEM as evidence
- validate XDATA as evidence
- validate parameter/rule scope compatibility
- add WYSIWYG gate checks

Execution authority remains legacy unless resolver accepts new input.

### Phase 3 - Resolver-Backed Preview

Goals:

- generate preview from `resolver_input_v1_minimal`
- register resolver input/output artifacts
- make UI preview use resolver output where available
- block stale preview promotion

### Phase 4 - Resolver-Backed Child DXF

Goals:

- generate child DXF through Core Shell Resolver
- keep legacy child fallback only as explicitly marked migration fallback
- enforce WYSIWYG before child generation

### Phase 5 - Resolver-Backed Export

Goals:

- generate export artifacts from resolver output
- require reconstructable resolver input hash
- require DBR handoff manifest
- enforce artifact lineage

### Phase 6 - Legacy Removal

Goals:

- remove or disable Mother DXF module-local transformation paths for v2 workflows
- retain only non-transformative authoring/projection/orchestration responsibilities in Mother DXF
- keep legacy readers only for historical artifact inspection where required

### 40.1 Migration Deadlines

Migration deadlines are contract gates for v2 rollout readiness:

- Phase 3 must be active before v2 release.
- Phase 4 must be active before INOX rollout.
- Phase 6 must be active before MDF rollout.

If a deadline is not met, the affected rollout must remain blocked or explicitly scoped as legacy-only with documented execution authority.

## 41. Stage 2 Compatibility Requirements

Stage 1 exists as a contract carrier for Stage 2.

Required direction:

- full 9-layer movement first where legacy model applies
- slot-aware movement first where slot authority applies
- repair second
- target-driven reconstruction when parameters are known
- metadata remains exception/enrichment layer, not dominant mechanism
- movement execution must be deterministic and stage-ordered
- production child generation must use resolved active geometry for the same parameter set

Mother DXF must remain enriched raw DXF.

It must stay valid and viewer-readable without prior transformation.

Geometry deletion, coordinate changes, and production materialization belong to resolver-backed child/export generation, not approved Mother DXF authoring state.

## 42. Contract Change Rule

This document does not approve runtime behavior changes by itself.

Runtime behavior changes require:

- explicit implementation task
- files/layers affected
- boundary impact statement
- rollback note
- validation path
- parity checks when replacing legacy behavior
- migration note when response shape, artifact semantics, or execution authority changes

Architecture-affecting changes must preserve the allowed dependency flow:

```txt
api -> core_shell
api -> modules only through core_shell orchestration contract
modules -> core_shell/services
core_shell must not import from modules
```

All durable writes must go through Core Shell storage/I/O interfaces.
