# MOTHER DXF Contract v0.1

## Status

This document is the repository-side contract for `mother_dxf_v1` as currently approved and implemented for the first useful slice.

It captures:

- module purpose
- stage boundaries
- Stage 0 sanitize contract
- Stage 1 semantic contract
- first useful slice scope
- current UX contract
- explicit deferred items

This is not a general DXF platform spec.
This is not a CAD editor spec.
This is not a Stage 2 engine implementation spec.

This document defines the internal contract for `MOTHER DXF` in `bi-backend`.

---

## 1. Purpose

`MOTHER DXF` is an internal thin DXF semantic mapper and stage-based processor for a controlled workflow:

1. `raw DXF`
2. `Stage 0 sanitize`
3. `sanitized DXF`
4. `Stage 1 semantic preparation`
5. `mother DXF`
6. later `Stage 2 child generation`
7. `child DXF`

The current implementation target is the **first useful slice**:

- import raw DXF
- sanitize Stage 0 payload
- build Stage 1 relevant-object model
- auto-suggest primary dimensional classes
- allow manual correction in UI
- validate
- export first `mother draft DXF`

---

## 2. Stage Boundaries

### Stage 0

Input:

- raw DXF

Output:

- sanitized DXF

Responsibilities:

- simplify DXF section payload
- keep relevant geometry
- normalize numeric payload to 3 decimals
- preserve viewer-readable DXF

Not in first useful slice:

- full assisted repair workflow
- repair candidate approval lifecycle
- gap healing
- micro-entity cleanup logic

### Stage 1

Input:

- sanitized DXF

Output:

- mother draft DXF

Responsibilities:

- build relevant semantic object model
- apply primary dimensional semantics through 9-layer scheme
- keep `A` as valid class
- keep `unclassified` distinct from `A`
- support manual correction workflow
- export viewer-readable mother draft

### Stage 2

Not implemented in v0.1 first useful slice.

Architecture requirement:

- Stage 1 exists as contract carrier for later Stage 2
- future engine must remain layer-driven first, repair second

---

## 3. Active Geometry Scope

### Supported active geometry in v0.1

- `LINE`
- `ARC`
- `INSERT`
- `BLOCK`

### Supported passthrough geometry in v0.1

- `CIRCLE`

`CIRCLE` may pass through Stage 0 and Stage 1 and may carry layer semantics, but it has no special repair intelligence in v0.1.

### Out of scope for active repair / advanced semantics in v0.1

- `LWPOLYLINE`
- `POLYLINE`
- `SPLINE`
- `ELLIPSE`
- `HATCH`
- `TEXT`
- `MTEXT`
- `DIMENSION`
- all other DXF entities not explicitly listed above

---

## 4. Relevant Semantic Objects

Relevant semantic objects in v0.1 are:

- all top-level scoped geometry entities in `ENTITIES`
- all `INSERT` block instances

Not separately relevant as user-facing semantic objects in v0.1:

- child entities inside `BLOCK` definitions

Interpretation:

- top-level entity = relevant object
- block instance = relevant object
- block internals = technical geometry, not primary user semantic objects

---

## 5. Stage 0 Sanitize Contract

### Section policy

Sanitized DXF may reduce sections to:

#### HEADER

```text
0
SECTION
2
HEADER
0
ENDSEC
```

#### TABLES

```text
0
SECTION
2
TABLES
0
ENDSEC
```

#### BLOCKS and ENTITIES

Remain present and carry geometry payload.

#### EOF

Must remain correct.

### Numeric policy

Default numeric normalization:

- round supported geometric numeric values to 3 decimals

Example:

- `46.9239999999990616 -> 46.924`

Current first useful slice behavior:

- rounding is applied to the supported subset payload
- no repair-specific higher precision handling is implemented yet

### Artifact states

Approved state model:

- `raw`
- `sanitized`
- `sanitized_repair_pending`
- `sanitized_ready_for_stage1`
- `mother_draft`
- `mother_validated`

Current first useful slice uses:

- `sanitized`
- `mother_draft`
- `mother_validated`

### Repair policy status

Full Stage 0 repair exists only as approved future contract, not as implemented first useful slice behavior.

Deferred:

- detect / propose / approve / apply
- per-candidate repair approval
- topology repair validation

---

## 6. Stage 1 Primary Semantic Contract

### Allowed primary layers

Only these are valid:

- `L`
- `R`
- `T`
- `B`
- `TL`
- `TR`
- `BL`
- `BR`
- `A`

### Meaning

- `L/R/T/B` = edge dimensional zones
- `TL/TR/BL/BR` = corner dimensional zones
- `A` = anchored / neutral / valid primary class

### Critical rule

`A` is valid.

`A` is not the same thing as `unclassified`.

### Exactly-one-primary-layer rule

Every relevant semantic object must have exactly one primary dimensional class.

This applies to:

- relevant top-level entities
- `INSERT` block instances

This does not apply in v0.1 to:

- child block internals as separate user semantic objects

---

## 7. Whole-Block Policy

Official v0.1 policy:

**Block instance behaves as one semantic group.**

Implications:

- click / hover / select on block instance acts on the whole block semantic group
- primary semantic source-of-truth lives on the `INSERT`
- block internals are not manually classified one by one

Source-of-truth:

- `INSERT` entity

Not source-of-truth:

- block definition internals

---

## 8. Metadata Contract

Metadata exists as exception layer.

Primary rule:

**Every object must first be resolved by primary dimensional classification. Metadata is added only when dimensional classification alone is insufficient.**

### Compact format

```text
999
SEM:key=value;key=value;key=value
```

### Binding rule

`999` comment binds to the next entity.

### Vocabulary policy

For v0.1 contract, validation is intended to be strict:

- unknown key = validation problem
- duplicate key = validation error
- empty value = validation error

### First useful slice status

Current implementation:

- preserves / passes through `999` comments if present

Not yet implemented:

- rich metadata authoring UX
- full strict metadata editing workflow in UI

---

## 9. Auto-Suggestion Contract

Stage 1 auto-suggestion in v0.1 is:

- `bbox-based`

### Basis

For top-level entity:

- entity bounding box

For block instance:

- resolved instance bounding box

### Inputs

Four bands:

- left
- right
- top
- bottom

### Output

Initial suggestion into one of:

- `L`
- `R`
- `T`
- `B`
- `TL`
- `TR`
- `BL`
- `BR`
- `A`

This is a starting proposal, not immutable truth.

---

## 10. Manual Correction UX Contract

The first useful slice includes interactive UI.

Required interactions:

- 2D viewer
- hover highlight
- click select
- rectangle select
- deselect
- force assign to any of the 9 primary classes
- corner override through manual assign to `TL/TR/BL/BR`
- zoom
- pan
- semantic color coding

### Semantic color behavior

Viewer color reflects current primary semantic class.

Selection and hover are additional visual states on top of semantic color.

### Input helper behavior

Current implementation also includes helper UX:

- selection panel shows internal parsed entity id
- selection panel shows semantic pointer like `Ln426 | ...`
- raw input viewer shows line-number gutter
- active source line is visually marked
- selected raw segment is natively selectable for copy/paste inspection

Important note:

- for `INSERT`, line pointer is resolved to the `BLOCK` definition start line, not the insertion line in `ENTITIES`

This is intentional because the block definition is semantically more useful for inspection.

---

## 11. Validation Contract

### Minimal Stage 0 gate

Useful-slice minimum:

- parser accepts current supported subset
- sanitized output keeps valid `HEADER/TABLES/BLOCKS/ENTITIES/EOF` structure
- numeric payload is normalized for supported subset
- output remains viewer-readable

### Minimal Stage 1 gate

Required:

- every relevant object has exactly one primary class
- no primary layer outside the allowlist
- `A` is treated as valid
- whole-block policy is respected through `INSERT`
- output remains viewer-readable

### Not yet part of current gate

- full topology validation
- CAM/postprocessor validation
- Stage 2 geometric target validation

---

## 12. Identity and Lineage

Current internal identity model:

- parsed entities get internal ids like `ent_160`
- these are internal parsed/runtime identifiers
- they are not DXF contract payload

These ids are used for:

- UI selection
- assignment updates
- session model
- export materialization

They are not currently written back into the DXF as explicit metadata.

---

## 13. First Useful Slice Scope

Included:

- parse supported DXF subset
- Stage 0 sanitize
- Stage 1 relevant-object model
- bbox auto-suggestion
- manual force assign
- validation
- mother draft export
- helper UI for raw DXF inspection

Explicitly deferred:

- full Stage 0 assisted repair
- detect/propose/approve/apply repair flow
- full metadata authoring UX
- Stage 2 engine implementation
- cluster semantics
- advanced topology heuristics
- block-internal semantic editing

---

## 14. Stage 2 Compatibility Requirement

Stage 2 is not implemented yet, but current design must not block it.

Required future direction:

- full 9-layer move first
- repair second
- target-driven reconstruction when parameters are known
- metadata remains exception layer, not dominant mechanism

Current v0.1 structure preserves that direction by:

- keeping primary semantics on relevant objects
- keeping whole-block truth on `INSERT`
- keeping `A` separate from `unclassified`
- not overloading metadata

---

## 15. Repo Boundary Mapping

### `src/modules`

Domain and use-case logic for `mother_dxf_v1`.

### `src/core_shell`

Shared DXF parsing, geometry helpers, and session/export storage helpers.

### `src/api`

Routes and interactive UI only.

This follows the repository layering contract:

- `api -> core_shell`
- `api -> modules` only through orchestration surface
- `modules -> core_shell/services/helpers`

---

## 16. Current Implemented Files

Current first useful slice is implemented primarily in:

- `src/modules/mother_dxf_v1/module_runtime.js`
- `src/core_shell/dxf/index.js`
- `src/core_shell/geometry/index.js`
- `src/core_shell/storage/mother_dxf_store.js`
- `src/api/routes/mother_dxf_v1.js`
- `src/api/ui/mother_dxf.html`

---

## 17. Change Discipline

Future changes to this contract should explicitly state:

- what changed
- whether it affects Stage 0, Stage 1, or Stage 2 compatibility
- whether it changes first useful slice behavior
- whether it is backward-compatible for stored mother drafts

## 18. Structural Invariant

Mother DXF is enriched raw DXF. It is not a derived format or parsed intermediate.

The runtime may write exclusively:
- Layer assignment on an existing entity
- 999 comment lines as metadata carrier

The runtime must never:
- add an entity that was not present in the source
- delete an entity
- modify geometry (coordinates, radii, shapes)

Criteria for downstream operations (deletion, geometry change) are carried
exclusively through metadata and are executed only during child DXF generation.

Mother DXF must be a valid, non-parametrised DXF at all times —
functional in any viewer or postprocessor without prior transformation.

This is a contract without exception.
