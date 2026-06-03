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

## Current Implementation Snapshot

As of 2026-04-26, the repository implementation has moved beyond the original first useful slice in the Stage 1.5 direction.

Currently implemented:

- guided metadata authoring in `src/api/ui/mother_dxf.html`
- canonical `SEM:` metadata generation for presence, geometry role, operation reference, and post-TOPO group records
- parser support for `SEM:` key/value records and `when` expressions using `==`, `!=`, `IN`, `>`, `>=`, `<`, `<=`, with shallow `AND` / `OR`
- parameter catalog exposure from a module contract JSON artifact
- MXD rule catalog exposure from a module contract JSON artifact
- document-level `rule_ref` evaluation for current rule catalog entries
- combined child preview with `SEM`, document rules, `TOPO`, post-TOPO rules, and validation findings
- child DXF save entrypoints for no-TOPO and TOPO POC modes
- DBR black-box reuse of existing `mother_dxf_v1` child generation entrypoints

Still not implemented:

- ChildPlan generation
- one single consolidated production-grade resolver shared cleanly between `mother_dxf_v1` and `DBR`
- approval-grade validation completeness across all domain movement cases
- final extraction of stage policy/orchestration out of `mother_dxf_v1/module_runtime.js`

This snapshot is descriptive of current code state. It does not replace the target architecture.

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

Partially implemented as preview and child-save bridge, but not yet fully
consolidated as one canonical shared resolver.

Current practical Stage 2 scope includes:

- entity inclusion / exclusion through `SEM` metadata
- document-level rule execution
- `TOPO` fixed-envelope simulation
- post-TOPO rigid offset rules
- child DXF save entrypoints
- early combined validation warnings

Architecture requirement remains:

- Stage 1 exists as contract carrier for Stage 2
- future engine must remain layer-driven and metadata-driven first, repair second
- movement execution must be deterministic and stage-ordered

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

Current canonical authored forms are:

Presence condition:

```text
999
SEM:feature=TRECA_SPOJNICA;presence=conditional;when=TRECA_SPOJNICA==Da
```

Geometry role:

```text
999
SEM:role=variant;feature=TRECA_SPOJNICA;variant=IZNAD_DRUGE;rule_ref={RULE_ID}
```

Prototype role:

```text
999
SEM:role=prototype;feature=VANJSKI_PANEL;variant=TEST_PROTO
```

Operation reference:

```text
999
SEM:operation_ref=WORKTOP_SINK_PAIR_PLACEMENT;feature=VANJSKI_PANEL
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
- authors canonical `SEM:` comments through guided UI controls
- supports multiple `SEM:` metadata comments per target entity and preserves their order
- parses key/value metadata records into structured `semantic_metadata`
- parses simple `when` expressions with `==` and `!=`

Not yet fully implemented:

- full strict metadata editing workflow in UI
- catalog rule execution

---

## 8A. Three-Level Enrichment Model

Mother DXF enrichment follows one generic three-level model.

This model is not tied to one specific part.

It is intended to hold across:

- `MXD`
- future `INOX`
- other future product families that adopt the same DCM contract

### Level 1: 9-Layer Dimensional Semantics

First-level enrichment is dimensional and positional.

It is carried through:

- primary `9-layer` assignment
- whole-object / whole-block semantic placement
- relevant-object classification before metadata interpretation

This level remains primary.

Every object must first be understandable through dimensional semantics alone as far as that is possible.

### Level 2: `999` Metadata for Presence / Variant Intent

Second-level enrichment carries conditional inclusion intent over already classified geometry.

Typical meanings at this level are:

- `presence`
- `variant`
- `role`
- `exclusive_group`
- `instance`

Typical examples:

```text
999
SEM:feature=TRECA_SPOJNICA;presence=conditional;when=TRECA_SPOJNICA==Da
```

```text
999
SEM:role=variant;feature=TRECA_SPOJNICA;variant=IZNAD_DRUGE;rule_ref={RULE_ID}
```

Purpose of this level:

- decide whether an entity participates
- decide which pre-expanded variant is eligible
- keep Mother DXF geometry unchanged while carrying decision intent

### Level 3: Rule-Driven / Operation-Driven Transform Intent

Third-level enrichment carries downstream execution intent for child generation.

This level does not execute geometry changes inside Mother DXF.

It only declares the logic and references needed later by:

- rule evaluation
- `ChildPlan`
- child materialization

Typical meanings at this level are:

- `rule_ref`
- `operation_ref`
- future `geometry=offset;axis=...;ref=...`
- future `ref=@FAMILY.KEY`

This level is where profile-specific logic enters the flow.

Important distinction:

- the structure of this level is generic
- the catalog content is profile-specific

That means:

- `MXD` and `INOX` may use different parameter spaces, rules, and operations
- but they should still fit the same three-level enrichment architecture

### Generic Rule

The three levels are cumulative, not competing.

Interpretation order is:

1. dimensional semantics first
2. presence / variant metadata second
3. rule / operation intent third

Metadata must not be used to bypass missing dimensional classification.

Rule or operation references must not be used as substitutes for missing metadata structure.

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

## 15. Guided Metadata Authoring

The current DCM UI includes guided metadata authoring for controlled enrichment.

Supported authoring modes:

- `Presence condition`
- `Geometry role`
- `Operation reference`

`Presence condition` builds metadata of this form:

```text
SEM:feature={PARAMETER_KEY};presence=conditional;when={PARAMETER_KEY}=={VALUE}
SEM:feature={PARAMETER_KEY};presence=conditional;when={PARAMETER_KEY}!={VALUE}
```

`Geometry role` builds metadata of this form:

```text
SEM:role={variant|prototype|anchor|reference};feature={PARAMETER_KEY};variant={VARIANT_ID}
```

If a rule is selected, `Geometry role` may append:

```text
;rule_ref={RULE_ID}
```

`Operation reference` builds metadata of this form:

```text
SEM:operation_ref={OPERATION_OR_RULE_ID};feature={PARAMETER_KEY}
```

Current limitation:

- `Variant / operation id` remains a text field until a Variant Catalog / Operation Catalog exists.
- `Rule ref` is selected from the current rule catalog.
- The UI builds metadata records; it does not execute rule or operation semantics.
- Canonical `SEM` preview should be treated as generated output, not as the primary authoring input.

---

## 15A. Metadata Authoring Boundary

Mother DXF authoring treba preferirati explicitni `SEM` metadata zapis kada se intent može izraziti lokalno, čitljivo i jednoznačno nad postojećim entityjem.

To uključuje:

- presence gating
- variant selection
- cutout selection
- simple equality / inequality uvjete koji stanu u trenutni `when` grammar
- komplementarne fallback grane

`Rule Catalog` nije default authoring put.

On se koristi tek kada:

- isti izraz treba reusable named rule
- logika više nije dovoljno čitljiva iz samog `SEM` zapisa
- treba profile-specific domain meaning
- uvjet prelazi simple local metadata expression, npr. threshold ili compound logiku

Operational principle:

- prvo `SEM-simple`
- zatim `rule_ref` samo kada explicitni metadata authoring više nije dobar ili održiv prikaz intenta

Everyday authoring direction:

- `Metadata Authoring` nije free-text editor
- default authoring treba biti picker-driven i catalog-backed gdje god je to moguće
- canonical `SEM` string je output authoring surfacea, ne početna authoring rečenica
- raw `SEM` edit može postojati samo kao admin/debug fallback, jasno odvojen od everyday moda

Catalog scope direction:

- catalog-backed choices trebaju biti filtrirane po aktivnom profile scopeu
- `MXD`, `INOX`, i budući profili mogu imati različite catalogs
- grammar ostaje generički; catalog scope određuje koje su vrijednosti dopuštene u konkretnom authoring contextu

---

## 15B. `TOPO` v0 Boundary

`TOPO` je file-level `999` metadata family za part-level topology behavior.

`TOPO` je odvojen od entity-level `SEM` familyja.

- `SEM` ostaje local entity metadata
- `TOPO` opisuje part-level topology mode
- `TOPO` i `SEM` se ne miješaju

Prvi `TOPO` mode u `v0` je:

```text
999
TOPO:mode=fixed_envelope_slide;group=LBRA_X_SLIDE;axis=X;lec_parameter=LIJEVI_CUTOUT_DIFF;lec_nominal=890;rec_parameter=DESNI_CUTOUT_DIFF;rec_nominal=890;delta_rule=config_minus_nominal;lec_delta_factor=-1.0;rec_delta_factor=1.0;trim_policy=rejoin
```

Za `fixed_envelope_slide` vrijedi:

- sliding entiteti assignaju se ručno kroz postojeći forced layer assignment workflow
- resolver ne radi automatic band detection
- anchor entiteti su `A` layer
- executable topology opisuje jedan part under processing
- `LEC` i `REC` su dvije side-specific cutout zone istog parta
- lijevi i desni delta input mogu biti različiti bez uvođenja `chain` semantike

Structural invariant i dalje vrijedi:

- Mother DXF ostaje enriched raw DXF
- `TOPO` metadata ne mijenja geometriju
- simulation resolver koristi `TOPO` samo za preview/validation
- produkcijska geometrijska materializacija ostaje child generation concern

Approved Mother DXF must carry TOPO metadata physically in DXF `999` rows when topology behavior is required.
TOPO syntax and field semantics are owned by `DXF_INSTRUCTIONSET_CONTRACT_v0.md`.
Session sidecar TOPO state is authoring/runtime convenience only, not canonical approved artifact state.

## 15B.1 Metadata Authoring IA Recovery

Current Mother DXF `Metadata Authoring` UI is no longer a generic topology authoring surface.
It has drifted into a specialized `fixed_envelope_slide` authoring form.

Observed hard constraints in the current UI/runtime:

- `topoMode` is hardcoded to `fixed_envelope_slide`
- `topoAxis` is hardcoded to `X`
- file-level TOPO input is generated only from `LEC` / `REC` parameter pairs
- entity-level TOPO input is generated only as `role=mover` with `zone=LEC|REC`
- runtime validation currently accepts only `mode=fixed_envelope_slide`
- runtime executable TOPO path currently accepts only `axis=X`

This means the current Stage 1 panel is operationally a:

- `fixed envelope slide authoring panel`

and not a:

- generic `TOPO` authoring panel
- generic `4_BAND_PARAMETER_RESIZE` authoring panel

Because of that, historical parts such as `KSKR` cannot be ergonomically or honestly re-authored through the current Stage 1 form.

### Required IA Split

Stage 1 must be reorganized around explicit topology family selection before any mode-specific fields appear.

Required top-level choice:

- `Topology Family`
- allowed v1 values:
- `4-band parameter resize`
- `fixed envelope slide`
- `none / skip topology`

Everything below that choice must be family-specific instead of globally shared.

### Shared Stage 1 Surface

The following controls may stay shared:

- topology family selector
- topology summary / saved state
- generated file-level `999` preview
- save / clear actions
- target inspector entrypoint

The following controls must stop being globally hardcoded:

- `Mode`
- `Axis`
- `Group`
- side parameter inputs
- mover role semantics

### Family-Specific UI: `4-band parameter resize`

When `Topology Family = 4-band parameter resize`, Stage 1 must show:

- nominal reference summary
- parameter mapping for `L`, `R`, `T`, `B`
- derived corner behavior note for `TL`, `TR`, `BL`, `BR`
- band assignment workflow wording
- target inspector grouped by:
- `L`
- `R`
- `T`
- `B`
- `TL`
- `TR`
- `BL`
- `BR`

The authoring language for this family must be:

- `band`
- `corner band`
- `parameter mapping`
- `nominal delta`

and must not use:

- `LEC`
- `REC`
- `slide`

### Family-Specific UI: `fixed envelope slide`

When `Topology Family = fixed envelope slide`, Stage 1 may continue to show:

- group
- axis
- `LEC` parameter + nominal
- `REC` parameter + nominal
- delta factors
- trim policy
- mover role
- zone
- `LEC` / `REC` target inspector

The authoring language for this family must stay:

- `LEC`
- `REC`
- `mover`
- `slide`

### Non-Negotiable UX Rule

Stage 1 must never present one topology family through another family's vocabulary.

Specifically:

- `KSKR` / `4-band` authoring must not be forced through `LEC/REC`
- `fixed envelope slide` authoring must not be forced through `L/R/T/B/TL/TR/BL/BR`

### Delivery Strategy

This reorganization is approved as an incremental IA recovery, not a full UX rewrite.

Recommended order:

1. keep current `fixed_envelope_slide` path working
2. introduce explicit topology family selector
3. isolate current form under `fixed envelope slide`
4. add a new `4-band parameter resize` Stage 1 form
5. only after both flows are explicit, simplify shared chrome and inspector behavior

### 15C. Post-TOPO Micro Shift Rule

Mother DXF supports a document-level post-TOPO rigid offset rule for cases where
an explicitly selected entity group must move after TOPO materialization.

Document-level:

```text
999
RULE:stage=post_topo;id=MICRO_SHIFT_SET_X;geometry=offset;target_group=MICRO_SHIFT_SET;axis=X;value_expr=-SKRACENJE;unit=mm;default=0;post_repair=bounded_trim_rejoin
```

Entity-level selection marker:

```text
999
SEM:post_topo_group=MICRO_SHIFT_SET
```

Execution order is fixed for v0:

1. document SEM filtering
2. TOPO LEC/REC movement
3. post-TOPO rigid offset
4. preview repair / validation

DBR v0 inherits this behavior through the existing `mother_dxf_v1` child
generation bridge.

### 15F. Canonical Resolver Pipeline Discipline

The repository now treats resolver ordering as a contract topic, not a deferred
implementation detail.

Canonical resolver pipeline for current Mother DXF / child generation work is:

1. active geometry branch isolation
2. document-level `SEM` context load
3. entity-level `SEM` selection / inclusion resolution
4. entity-level variant gating and placement-by-presence resolution
5. build initial resolved active geometry for the current parameter set
6. execute one movement stage
7. recompute local join graph and active geometry state
8. apply only stage-allowed repair / rejoin operators
9. run stage validation
10. continue to the next declared movement stage
11. execute post-TOPO and later child rules
12. serialize child DXF

Normative rules:

- resolver must not search for arbitrary join candidates across the whole DXF
- resolver must not join across geometry branches
- movement stages execute one at a time over previously stabilized geometry
- collision and repair logic operate on resolved active geometry for the same parameter set, not on the full raw DXF universe
- `SEM recompute` is a reserved future branch, not default behavior

### 15F.1 Geometry Branch Contract

Mother DXF supports multiple alternative geometry branches inside one mother file
when they share the same product/part contract, parameter set, label pipeline,
and rule pipeline. This is a branch-selection contract, not a layer contract.

Current branch convention:

- untagged top-level geometry is implicit `BASE`
- tagged alternative geometry uses `MOTHERDXF` XDATA with `GEOMETRY_VARIANT=<VALUE>`
- recommended authoring layout is `BASE` bbox minimum at `X=0`, `Y=0` and
  the first tagged branch, for example `ECO`, bbox minimum at `X=3000`, `Y=0`
- additional branches may use later 3000 mm X slots
- `ALL` is only an authoring, inspection, and XDATA repair view
- combined child preview and child DXF export must resolve exactly one source
  branch before SEM, TOPO, document rules, final orientation, labels, and
  serialization
- resolved child output must not contain eliminated branch geometry or Mother DXF
  branch XDATA
- selected branch geometry is normalized to bbox minimum `X=0`, `Y=0` during
  child materialization

For current catalog behavior, `MODEL_VRATA=ECO` selects the `ECO` branch. Other
non-empty `MODEL_VRATA` values select implicit `BASE` unless an explicit non-ALL
branch mode is supplied by a diagnostic/authoring call.

Validation target:

- untagged geometry in a shifted branch slot should warn
- tagged branch geometry in the implicit base slot should warn unless accepted as
  a legacy/debug overlap file
- child preview/export with `ALL` as source should warn or refuse materialization

Implementation note 2026-05-28:

- Combined Child Preview renders only entities present in the resolver simulation
  item set, so non-selected branch geometry is not drawn as fallback raw geometry
- no-TOPO child materialization applies the same branch selection and document
  filtering before document rules, SEM inclusion, final orientation, labels,
  normalization, and serialization
- Metadata Authoring branch-sensitive actions require an active concrete branch
  (`BASE` or tagged variant) when a multi-branch file is detected; `ALL` remains
  available for inspection and XDATA repair
- document rules may declare `target_scope.geometry_branch`; `MXD_LAYER_B_OFFSET_9P5`
  is scoped to implicit `BASE` and must not execute for `ECO` branch materialization
- Mother DXF consumes Core Shell resolver branch helpers for branch mode derivation,
  object branch filtering, and branch-scoped rule matching so DBR and UI do not
  grow separate branch semantics

### 15F.2 Resolver Harness and Assertion Checks

Resolver extraction is currently guarded by behavior-parity diagnostics, not by
a replacement execution engine.

Current commands:

- `npm run resolver:harness`
  - runs the fixture-based Mother DXF resolver harness
  - writes per-fixture snapshots under `tests/resolver_harness/output/`
  - writes human-readable reports, including `resolver_plan_report.md`
  - writes machine-readable assertion data in `resolver_plan_assertions_report.json`
  - writes extraction readiness data in `extraction_readiness_report.json`
- `npm run resolver:assertions`
  - runs the same harness
  - reads `resolver_plan_assertions_report.json`
  - prints a compact assertion summary
  - default mode is diagnostic-only; existing warning assertions do not fail the command
- `npm run resolver:parity`
  - runs the same harness
  - fails only when extracted/shared parity checks drift
  - ignores known sequencing warning assertions so safe slices can be gated before sequencing work is complete
- `npm run resolver:footprint`
  - prints the current Mother DXF runtime resolver/TOPO/repair footprint
  - diagnostic-only cleanup inventory; it must not be used as proof that code is safe to delete
- `npm run resolver:checkpoint`
  - runs the parity gate and runtime footprint inventory together
  - produces a pre-cleanup checkpoint summary
  - passing checkpoint does not approve deletion from Mother DXF runtime; it only confirms rollback/parity guardrails are intact
- `npm run resolver:cleanup-scope`
  - reads the latest checkpoint/readiness reports and prints cleanup eligibility by resolver area
  - diagnostic-only; it must not approve deletion from Mother DXF runtime by itself
  - expected current result is that repair, preview, child generation, TOPO metadata, and document rules remain `do_not_cleanup`
- `npm run resolver:activation-candidates`
  - reads the latest readiness and parity reports and writes `activation_candidate_report.json`
  - lists only paths that are eligible for a future explicit façade flag
  - diagnostic-only; it does not activate shared resolver execution
- `npm run resolver:shadow-parity`
  - reruns activation candidates with default runtime mode and `activation_candidate_shadow` mode
  - fails if comparable result, warnings, errors, or config output drift
  - confirms the shadow flag records trace only and keeps `active=false`
- `npm run resolver:status`
  - runs checkpoint, cleanup scope, activation candidate, and shadow parity checks
  - writes `resolver_extraction_status_report.json` and `resolver_extraction_status_report.md`
  - final extraction status is report-only; it does not approve production activation or Mother runtime cleanup
- `npm run resolver:sequencing-risk`
  - writes `sequencing_risk_report.json` and `sequencing_risk_report.md` for blocked multi-stage movement paths
  - identifies document-rule Y movement plus TOPO X movement overlap and required stage-stabilization work
  - diagnostic-only; it does not redefine resolver ordering
- `npm run resolver:stage-boundaries`
  - writes `stage_boundary_report.json` and `stage_boundary_report.md` over all harness snapshots
  - classifies no-boundary, shadow-only candidate, and blocked movement paths
  - diagnostic-only; it does not execute stage boundary geometry
- `npm run resolver:slices [slice_id]`
  - reads the latest extraction readiness report and prints `extraction_slices`
  - optional slice id filters to one extraction bucket, for example `slice_1_no_movement`
- `npm run resolver:readiness [candidate|review|blocked] [detail]`
  - reads the latest extraction readiness report without rerunning the harness
  - optional status argument filters the printed snapshot list
  - optional detail argument further filters `candidate` snapshots by candidate kind or `blocked` snapshots by blocker kind
  - candidate detail values: `no_movement`, `topo_x_only`, `other_candidate`
  - blocked detail values: `fixture_or_entrypoint_gap`, `sequencing_risk`, `runtime_review`
- `RESOLVER_ASSERTIONS_STRICT=1 npm run resolver:assertions`
  - enables future gate behavior
  - fails when warning-level resolver plan assertions are present
  - currently expected to fail while known sequencing warnings remain unresolved

Extraction readiness is a diagnostic classification over snapshots:

- `candidate`
  - no warning-level blockers observed in the snapshot
  - eligible for future extraction review, not automatic production approval

Readiness report also carries `extraction_slices`:

- `slice_1_no_movement`
  - first recommended extraction bucket; candidate snapshots with no movement stages

Slice 1 extraction status:

- `src/core_shell/services/dxf_no_movement_summary_service.js` provides shared no-movement summary logic
- current use is shadow/parity-only inside resolver harness
- it must not replace Mother DXF runtime behavior until parity is stable and an explicit activation step is approved
- `resolver_plan_assertions_report.json` includes no-movement parity counts
- Strict assertion mode also treats no-movement parity mismatches as a gate failure
- `slice_2_topo_x_only`
  - second recommended extraction bucket; candidate snapshots with only TOPO X movement
  - `src/core_shell/services/dxf_topo_x_summary_service.js` provides shared TOPO X-only summary diagnostics
  - current use is shadow/parity-only inside resolver harness
  - it must not replace Mother DXF runtime TOPO execution until parity is stable and an explicit activation step is approved
  - `resolver_plan_assertions_report.json` includes TOPO X-only parity counts
  - Strict assertion mode also treats TOPO X-only parity mismatches as a gate failure
- `hold_sequencing_risk`
  - blocked snapshots that must stay out of execution extraction until sequencing is resolved

Candidate snapshots may expose a diagnostic `candidate_kind`:

- `no_movement`
  - observed path has no movement stages and is suitable for earliest non-movement parity extraction review
- `topo_x_only`
  - observed path has only TOPO simulation movement on X axis
- `other_candidate`
  - candidate path that does not fit the two narrow early extraction buckets
- `review`
  - no blocking warning, but info-level historical behavior needs explicit review
- `blocked`
  - diagnostic error or warning-level sequencing risk is present
  - execution extraction must not proceed from this snapshot until the blocker is understood

Blocked snapshots may expose a diagnostic `kind`:

- `fixture_or_entrypoint_gap`
  - fixture cannot exercise the requested runtime path, usually missing executable TOPO metadata
- `sequencing_risk`
  - observed execution order needs explicit resolver sequencing/recalculation review
- `runtime_review`
  - generic warning-level runtime blocker that is not yet classified more narrowly

Current assertion classes are diagnostic signals over observed runtime behavior:

- `DOCUMENT_RULE_Y_BEFORE_TOPO_X`
  - observed document-rule Y movement and TOPO X movement in one runtime plan
  - marks sequencing / recomputation review before movement execution extraction
- `DOCUMENT_RULE_Y_9P5_NOT_RUNTIME_TOPO_Y`
  - observed B-layer Y 9.5 document-rule movement that is not exposed as TOPO `moved_entities` Y movement
  - warns future validation not to rely only on TOPO movement summaries for this stage
- `POST_TOPO_AXIS_WITH_ZERO_DELTA`
  - observed post-TOPO rule stage with declared axis but zero `dx/dy` in movement inventory
  - keeps this historical branch visible before execution logic extraction
- `REORDER_CANDIDATE`
  - observed multi-stage plan requiring explicit sequencing review

Contract status:

- these commands must not change Mother DXF runtime behavior
- they must remain safe to run against fixture snapshots
- `src/core_shell/services/dxf_resolver_diagnostics_service.js` owns shared resolver diagnostic summary construction
- `resolveMotherDxfRuntimePlan({ resolverDiagnostics: true })` may return `shared_resolver_diagnostics` for shadow/parity summaries
- `shared_resolver_diagnostics` is diagnostic-only and must not drive production geometry
- `dxf_resolver_diagnostics_service.js` also owns shared diagnostics parity comparison helpers
- resolver harness compares façade `shared_resolver_diagnostics` against local shadow diagnostics through that shared comparison helper and records façade parity counts
- `resolver:parity` is the current narrow gate for already extracted shared diagnostics; it does not approve sequencing-risk execution extraction
- strict mode is intentionally opt-in until the resolver execution pipeline is explicit and stable
- readiness report is machine-readable and may be used by future CI/DBR gates as a diagnostic input
- future DBR CI can consume the JSON reports, but DBR must not infer production geometry from these diagnostic reports alone
- after shared resolver activation, Mother DXF runtime cleanup must proceed from an explicit footprint inventory and parity-backed replacement plan, not from ad hoc deletion
- before any Mother DXF runtime cleanup PR, `npm run resolver:checkpoint` must pass and the cleanup scope must reference the footprint categories being removed or delegated
- cleanup scope may be reviewed with `npm run resolver:cleanup-scope`; this command is evidence for discussion, not approval to remove runtime code
- activation candidates may be reviewed with `npm run resolver:activation-candidates`; this command is evidence for a future flag, not the flag itself
- `resolveMotherDxfRuntimePlan({ sharedResolverMode: "activation_candidate_shadow" })` may record an activation-candidate shadow trace, but it must not replace Mother runtime execution or change geometry
- shadow parity may be checked with `npm run resolver:shadow-parity`; this is required before any future activation of a shared resolver execution flag
- final extraction status may be reviewed with `npm run resolver:status`; green status means shadow-only guardrails pass, not that production activation is approved
- sequencing-risk paths must remain blocked until document-rule movement, geometry stabilization, TOPO movement, and repair validation are explicit stage boundaries
- `src/core_shell/services/dxf_stage_boundary_service.js` defines the shadow-only Stage Boundary Plan used to describe required checkpoints; it does not execute geometry

### 15F.2 Execution Boundary Implementation Contract

This section is the implementation contract for the next resolver execution slice.
It is derived from current harness reports and must not be treated as already
implemented runtime behavior.

Current diagnostic facts:

- `resolver:status` is green only for shadow execution: `green_for_shadow_only`
- production activation remains `not_approved`
- cleanup remains `no`
- stage-boundary report covers 16 snapshots:
  - `no_boundary_needed`: 6
  - `candidate_shadow_only`: 2
  - `blocked`: 8
- the explicit sequencing blocker is `mother_dxf__SBRA_130526_Europa_B9P5_session_7e6c604d / child_topo_poc`
- that blocker has stage order `document_rules -> topo_simulation`, axes `Y,X`, and 17 overlapping entity ids between the document-rule stage and the TOPO stage

Required execution semantics for the first real stage-boundary engine:

1. Build resolved active geometry for the current parameter set.
2. Execute exactly one movement stage.
3. Stabilize geometry state after that stage.
4. Recompute local join graph after that stage.
5. Apply only stage-allowed repair for that stage.
6. Validate that stage result.
7. Continue to the next movement stage only after the previous stage is stable.
8. Serialize child DXF only after all movement stages and validations complete.

For the current sequencing blocker, the required order is:

1. Execute `MXD_LAYER_B_OFFSET_9P5` as explicit document-rule `Y +9.5 mm` stage.
2. Stabilize and recompute active geometry and local joins.
3. Execute `LBRA_X_SLIDE` TOPO `X` stages on the stabilized geometry.
4. Run stage-local repair / rejoin validation after each movement stage.
5. Only then allow child serialization.

Forbidden implementation shortcuts:

- do not search for repair candidates across the whole DXF universe
- do not join across geometry branches
- do not execute document-rule movement and TOPO movement as one merged transform
- do not let TOPO movement use stale pre-document-rule join graph state
- do not silently patch geometry with new substitute lines
- do not treat this contract as approval to remove Mother DXF runtime code
- do not activate production DBR usage until parity and stage-boundary checks pass

Acceptance criteria for a future implementation PR:

- `npm run resolver:checkpoint` passes
- `npm run resolver:shadow-parity` passes
- `npm run resolver:sequencing-risk` either reports zero sequencing blockers or reports the blocker as handled by an explicit execution-boundary implementation
- `npm run resolver:stage-boundaries` shows the target path no longer blocked by `CROSS_AXIS_OVERLAP` or `MULTI_STAGE_REPAIR` without an execution boundary
- `npm run resolver:status` remains `behavior_change=false` unless the PR is explicitly approved as a behavior-changing activation PR
- any behavior-changing activation must be behind an explicit façade flag first

First implementation target:

- create a shared execution-boundary engine behind the façade
- keep default mode delegated to Mother DXF runtime
- run the new engine in shadow mode first
- compare the shadow output against the existing runtime output with volatile timestamp and DXF handle normalization
- do not clean up legacy runtime paths until the shadow engine proves parity and the domain owner approves activation

Implemented shadow envelope status:

- `src/core_shell/services/dxf_integral_resolver_service.js` now builds `integral_resolver_shadow_v1` as a standalone Core Shell artifact
- it assembles the observed resolver plan, stage-boundary plan, extraction readiness, blockers, and DBR handoff contract
- it is diagnostic-only: `production_ready=false`, `activation_allowed=false`, `execution_status=not_executed_shadow`
- `src/core_shell/services/dxf_no_movement_execution_service.js` executes the first narrow no-movement shadow slice
- the no-movement execution slice is limited to projected runtime result finalization: no TOPO movement, repair, trim, extend, rejoin, or child DXF serialization
- `src/core_shell/services/dxf_topo_x_execution_service.js` executes the narrow TOPO X-only shadow slice from the projected runtime result
- the TOPO X-only execution slice validates movement summary parity only; it does not yet execute coordinate movement, repair, trim, extend, rejoin, block explosion, or child DXF serialization independently
- `CORE_RESOLVER_STRICT=1` / `sharedResolverMode=core_shell_strict` refuses legacy Mother runtime fallback before loading Mother runtime
- `npm run resolver:strict-probe` verifies that strict mode currently fails honestly with `legacy_fallback_used=false` until native session projection is implemented
- `npm run resolver:integral-shadow` writes the standalone report used by `npm run resolver:status`
- this implementation does not execute movement geometry and does not replace Mother DXF runtime behavior

### 15G. Stage Taxonomy

Current and target resolver discipline recognizes these stage families:

#### `4_BAND_PARAMETER_RESIZE`

Canonical base movement model for freely resizable parts.

#### 4-band Core Shell / DBR Contract Status

Current rounded-off authoring and preview contract:

- Mother DXF can author a dedicated 4-band metadata record without using fixed-envelope `LEC/REC` vocabulary. The UI must not imply that SEM executes after TOPO; SEM presence/variant filters define effective geometry before 4-band resolver movement.
- Saved file-level metadata uses `TOPO:mode=4_band_parameter_resize` with `profile=standard_parametric_resize`.
- The required base band keys are `l/r/t/b_parameter`, `l/r/t/b_nominal`, `l/r/t/b_axis`, and `l/r/t/b_delta_factor`.
- Corner bands `TL/TR/BL/BR` are derived from adjacent base bands and are not separately parameterized in this authoring slice.

Confirmed Core Shell preview resolver mapping:

- Core Shell accepts the projected `4_band_parameter_resize` runtime model as explicit input to the shared `standard_parametric_resize` preview path.
- Band offsets are metadata-driven: `(actual - nominal) * delta_factor` on `l/r/t/b_axis`.
- Corner bands continue to be derived from adjacent base bands.
- `topology_delta_modifier` catalog rules may modify final base-band offsets before 4-band movement execution. In this KSKR slice, `HIDRAULICKI_ZATVARAC==Skriveni` adds `+5` mm to the `L` band on `X`, and `VANJSKA_VRATA==Da` adds `-30` mm to the `R` band on `X`; `TL/BL` and `TR/BR` inherit through adjacent-band composition. Core Shell emits `SUPERPOSED_TOPOLOGY_DELTA` warnings for catalog rules marked with `warning_on_superposition=true` when that modifier reinforces an existing offset on the same band/axis.
- 4-band resolver movement is explicit-layer-only: follower movement for circle/arc/insert entities requires deterministic authoring through the effective primary layer, not resolver proximity inference.
- Mother DXF can surface `core_shell_4_band_shadow` diagnostics for parity inspection.
- Mother DXF `/simulate` resolves SEM presence/variant filters before the Core Shell 4-band shadow resolver, then renders the shadow map as preview-only `simulated_shapes`.
- Mother DXF may export `core_shell_4_band_shadow_child_dxf_v0` as a diagnostic DXF for external viewer validation; this must stay marked diagnostic-only and must not drive DBR production child generation yet.

DBR boundary:

- this record is a Core Shell resolver contract input, not a Mother DXF private UI convention;
- DBR must resolve it through Core Shell resolver services when production activation is approved;
- current status is confirmed Core Shell preview resolver, not DBR production activation.

- `L` and `R` bands move on `X`
- `T` and `B` bands move on `Y`
- `TL`, `TR`, `BL`, `BR` move on both `X` and `Y`

#### `B_LAYER_OFFSET_9P5`

Specialized fixed-envelope preparation stage.

- mover set: functional lower band represented operationally as `B` layer, optionally completed by explicit forced assignment
- static set: `A` layer neighbors
- movement: `Y +9.5 mm`
- expected repair: `A`-layer verticals previously joined to the `B` band are shortened / retrimmed to the new join position exactly `9.5 mm` higher
- boundary restriction: mover / anchored boundary for this stage may cross only vertical lines

Validation requirements:

- contour closedness
- no protruding unshortened lines
- no fake patch lines
- no non-vertical boundary crossings on that stage boundary

#### `LEC_SLIDE`

Manual left cutout mover stage.

- mover set is selected manually by engineering authoring and may include free entities, block instances, and cutout-linked technology holes
- movement is isolated `X` slide over previously stabilized geometry
- all resulting extension / shortening / rejoin distances are tied exactly to the declared slide delta
- no new geometry, no new gaps, and no substitute patch lines are allowed

Validation requirements:

- old joins relocate by exact stage delta
- contour remains closed where closure is expected
- mover swept path must stay free of all entities outside the mover set

#### `REC_SLIDE`

Mirror-equivalent stage to `LEC_SLIDE`.

- may use different parameter sources and nominal references
- otherwise follows the same movement, join relocation, and validation semantics

### 15H. `SEM` Resolution Forms

Current approved `SEM` execution forms are:

1. `selection`
   - conditional inclusion / exclusion of a feature or geometry group
2. `variant_gate`
   - entity or block stays active only when parameter value matches expected variant id
3. `placement-by-presence`
   - multiple pre-drawn alternatives are present in raw DXF and mutually exclusive `presence=conditional` expressions decide which alternative survives for the current parameter set
4. stage tags
   - `SEM:post_topo_group=...` and related stage-binding markers

`placement-by-presence` is canonical when:

- both or more geometric alternatives are already drawn in raw DXF
- the current parameter set should leave exactly one alternative active
- no extra geometry transform is needed to realize placement

Example pattern:

- lower third-hinge geometry active when `(TRECA_SPOJNICA==Da) AND (VISINA_VRATA<2040)`
- upper third-hinge geometry active when `(TRECA_SPOJNICA==Da) AND (VISINA_VRATA>=2040)`

This is a valid placement mechanism and does not require a separate Rule Catalog
entry when the alternatives are already physically drawn in raw DXF.

### 15D. Planned Final Orientation Rule

Door parts in S4P4 technology are authored in raw DXF as DX orientation.
For left-opening doors, selected child DXF outputs must be mirrored as a final
child-level orientation transform because Lxxx/Sxxx stock has a face/back side
and produced pieces cannot be physically flipped.

This is planned as a document/profile rule, not entity-level SEM and not TOPO.
It executes after SEM filtering, TOPO materialization, and post-TOPO micro shift.

Canonical planned rules:

```text
999
RULE:stage=final_orientation;id=DOOR_SX_DX_MIRROR_X_UNSTACKED;geometry=mirror;axis=X;when=STRANA_OTVARANJA IN [Lijeva (SX),Inverzna lijeva (INV SX)];parts=[KSKR,OBRA,OSPY,OBRIT,OMET];normalize_bbox=true
RULE:stage=final_orientation;id=DOOR_SX_DX_MIRROR_Y_STACKED;geometry=mirror;axis=Y;when=STRANA_OTVARANJA IN [Lijeva (SX),Inverzna lijeva (INV SX)];parts=[LBRA,LBRIT,LHOR,LMET,SBRA,SBRIT,SHOR,KDDV,KDLV,KDHOR,PS];normalize_bbox=true
```

Execution meaning:

- raw DXF coordinate system remains the authoring coordinate system
- `Desna (DX)` and `Inverzna desna (INV DX)` keep raw orientation
- `Lijeva (SX)` and `Inverzna lijeva (INV SX)` mirror around the explicit catalog axis: X for unstacked parts and Y for stacked parts
- after mirror, child geometry is normalized so final bbox starts at `minX=0`, `minY=0`
- Mother DXF preview emits `MISSING_FINAL_ORIENTATION_RULE` when `STRANA_OTVARANJA` and part scope match one of these rules but the document has no explicit active `rule_ref` for it
- MODEL_VRATA drives geometry branch selection for BASE/ECO resolver preview: `ECO` selects ECO branch; other non-empty values select BASE branch unless an explicit non-ALL branch mode is supplied
- `topology_mode=none` preview uses identity geometry as its base. No implicit legacy layer resize may run without explicit TOPO metadata or document rule activation.
- diagnostic Core Shell 4-band child export must materialize the same final-oriented simulation map shown in Combined Child Preview and must not execute final orientation a second time
- future technology-level face/back processing may extend this with an XOR-like
  effective orientation rule, but `STRANA_OTVARANJA` remains the door-side source parameter

### 15E. Planned S4P4 Child Label Application Rule

S4P4 technology child DXFs may require a label application hit. In production,
the label is not interpreted as font geometry; it is a downstream label payload
placed at a controlled X/Y coordinate. OPS treats the label placement like any
other punch/hit at a coordinate. Mother DXF therefore owns the placement anchor,
label envelope, rotation, collision/safe-distance semantics, and payload
template. DBR owns final placeholder materialization during batch processing.

The DXF `TEXT` entity is only the production-tested carrier for the payload.
TEXT height, color, and alignment are carrier syntax required by the downstream
chain; they are not the physical label size. Physical label size must be carried
explicitly by the rule as `label_width` / `label_height` so the authoring UI
and validation can check placement and collision.

For LBRA, the planned label application rule is authored relative to raw DXF
coordinates:

```text
999
RULE:stage=child_label;id=S4P4_LBRA_LABEL_APPLICATION;operation=apply_label;coordinate_space=raw_part;anchor_transform=through_final_child;x=1276;y=39;z=0;label_width=50;label_height=20;rotation=0;collision_policy=warn;payload_carrier=TEXT;carrier_layer=0;carrier_height=1;carrier_color=1;carrier_h_align=1;carrier_v_align=2;payload_template=;|{{WORKORDERCODE}}|{{MODEL_VRATA}}|{{SOURCE_REFERENCE}}|{{DIMENSION_SHORT}}|{{OPENING_SIDE_SHORT}};payload_field_DIMENSION_SHORT=format({{SIRINA_VRATA_DIV10}}x{{VISINA_VRATA_DIV10}});payload_field_SIRINA_VRATA_DIV10=number_expr(SIRINA_VRATA/10,integer);payload_field_VISINA_VRATA_DIV10=number_expr(VISINA_VRATA/10,integer);payload_field_OPENING_SIDE_SHORT=map(STRANA_OTVARANJA:{Desna (DX)=D,Lijeva (SX)=L,Inverzna desna (INV DX)=D,Inverzna lijeva (INV SX)=L})
```

The resolver must treat `coordinate_space=raw_part` as an anchor that follows
the same child transform chain as the part geometry, including final SX/DX
orientation and bbox normalization. If a future rule uses
`coordinate_space=final_child`, the label hit is placed after orientation and
normalization without additional transform.

The carrier emitted into child DXF is expected to follow this production-tested
shape after DBR materializes placeholders:

```text
0
TEXT
8
0
10
1276
11
1276
20
39
21
39
30
0
40
1
1
;|26T01V01|PPV30|SPANJA B3|80x196|L
50
0
62
1
72
1
73
2
0
```

Contractual split:

- label anchor: `x/y/z` in the declared coordinate space
- label envelope: `label_width` x `label_height`, used for placement preview and collision validation
- label rotation: production hit rotation and envelope orientation
- payload carrier: DXF `TEXT` syntax used to transfer payload downstream
- payload template: output format using direct and derived placeholders
- payload fields: resolver definitions for derived placeholders such as `DIMENSION_SHORT` and `OPENING_SIDE_SHORT`
- payload context: merged DBR batch row, document-level `999` metadata, and config parameter set
- canvas readability: UI-only concern; it must not change child DXF carrier height or production geometry

Payload resolver policy:

- direct placeholders resolve from merged context in this order: DBR batch row overrides document-level `999`, which overrides config parameter set
- `WORKORDERCODE` and `SOURCE_REFERENCE` are expected from DBR/document metadata context
- `MODEL_VRATA` (legacy alias `TIP_VRATA`), `SIRINA_VRATA`, `VISINA_VRATA`, `VISINA_EFF`, and `STRANA_OTVARANJA` are expected from configurator/catalog context unless DBR provides an override
- `DIMENSION_SHORT` formats width/height in decimeters as `SIRINA_VRATA/10` + `x` + `VISINA_VRATA/10`
- `SKRACENJE` is not part of the current production-tested label payload unless a future rule explicitly adds it; `VISINA_EFF` is available as a derived payload parameter for downstream DBR usage
- `OPENING_SIDE_SHORT` must be mapped from controlled enum values; it must not use naive first-letter extraction because inverse values start with `Inverzna`

Planned child generation order becomes:

1. document SEM filtering
2. TOPO LEC/REC movement
3. post-TOPO rigid offset
4. final orientation mirror, when configured
5. bbox normalization
6. child label application / transformed raw anchor carrier emission after orientation so emitted TEXT is not mirrored
7. serialize child DXF

---

## 16. Parameter Catalog

Parameter Catalog defines the controlled parameter vocabulary used during Mother DXF authoring.

Current artifact:

- `src/modules/mother_dxf_v1/contracts/parameter_catalog_legacy_door_v0.json`

Current use:

- drives the Metadata Authoring `Parameter` dropdown
- drives enum value choices for `Expected value`
- prevents free typing of known feature keys and known enum values

Parameter Catalog is not the same as `Config Parameter Set`.

- Parameter Catalog defines the possible parameter space.
- Config Parameter Set is one concrete case/sample point in that space.
- Parameter entries carry `scope.family/products/parts` so the active family/product/part context can filter the catalog.
- Parameter entries carry `default` so a new session can derive a useful nominal Config Parameter Set directly from the active catalog instead of using ad hoc bootstrap values.

Current status:

- implemented as a module contract JSON artifact
- loaded by `src/modules/mother_dxf_v1/module_runtime.js`
- exposed to the UI through `projectViewModel`

Future direction:

- move catalog loading behind a Core Shell catalog service or BI database interface when the catalog model stabilizes.

---

## 17. Rule Catalog

Rule Catalog defines named domain rules that may be referenced from Mother DXF metadata.

Current artifact:

- `src/modules/mother_dxf_v1/contracts/rule_catalog_mxd_door_v0.json`

Current MXD draft rules:

- `MXD_LAYER_B_OFFSET_9P5`

Current MXD rule example:

- `MXD_LAYER_B_OFFSET_9P5`
  - `profile_scope = MXD`
  - condition: `MODEL_VRATA IN [Europa, EuroMax]`
  - target scope: `Layer B`
  - action: `offset Y +9.5 mm`
  - post repair: `bounded local trim/rejoin`

Current use:

- drives the Metadata Authoring `Rule ref` dropdown
- allows `SEM:` metadata to refer to a known rule id instead of embedding full domain logic in DXF comments

Current limitation:

- rule catalog is visible and selectable
- rule expressions are not yet evaluated by the runtime
- approval-grade validation over rule expressions is not yet implemented

Rule Catalog is domain/profile-specific. It is not a universal hardcoded rule table for all future products.

Current catalog content in `rule_catalog_mxd_door_v0.json` is `MXD`-specific and must not be treated as `INOX` rule inventory.

---

## 18. Current Limitations

The current implementation no longer stops before all execution layers, but it is
still not yet a fully consolidated production resolver.

Still limited or incomplete:

- one shared canonical resolver contract between `mother_dxf_v1` and `DBR`
- full movement-stage coverage for all domain cases
- approval-grade validation completeness for all cutout relocation and branch-sensitive situations
- final reduction of legacy heuristic repair paths inside `mother_dxf_v1/module_runtime.js`

Current metadata authoring and child generation are practical and real, but
they do not yet guarantee universal downstream correctness for every authored
geometry case.

---

## 19. Repo Boundary Mapping

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

## 20. Current Implemented Files

Current first useful slice is implemented primarily in:

- `src/modules/mother_dxf_v1/module_runtime.js`
- `src/modules/mother_dxf_v1/contracts/parameter_catalog_legacy_door_v0.json`
- `src/modules/mother_dxf_v1/contracts/rule_catalog_mxd_door_v0.json`
- `src/core_shell/dxf/index.js`
- `src/core_shell/geometry/index.js`
- `src/core_shell/storage/mother_dxf_store.js`
- `src/api/routes/mother_dxf_v1.js`
- `src/api/ui/mother_dxf.html`

---

## 21. Change Discipline

Future changes to this contract should explicitly state:

- what changed
- whether it affects Stage 0, Stage 1, or Stage 2 compatibility
- whether it changes first useful slice behavior
- whether it is backward-compatible for stored mother drafts

## 22. Structural Invariant

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

## 23. Validation Gate

Mother DXF cannot be declared approved without a completed validation run.

The validator is an integral part of DCM. It uses the same evaluation engine
as the simulator and the batch runner.

The validator operates in three modes:

Auto mode:
- Runs all parameter combinations according to a configured grid and pitch.
- No user interaction during run.
- Output is a complete validation report with PASS / WARNING / FAIL per combination.

Step mode:
- User advances one combination at a time.
- Each step renders geometry in the viewer.
- Used for edge case inspection and WARNING review.

Focused mode:
- User locks one or more parameters to fixed values.
- Validator runs combinations only over the free parameters.
- Used for conflict-suspicious parameter subsets.

Grid configuration:
- Numeric parameters use min/max from configurator segment and a user-defined pitch.
- Enum and boolean parameters use all defined variants by default.
- Engine calculates total combination count before run and displays it to the user.
- User may adjust grid or pitch before confirming run.

Conflict signals:
- Validator checks predefined conflict signal types per Mother DXF.
- Signal types include: overlap, out_of_bounds, negative_space, missing_variant, anchor_resolve_fail.
- Conflict signals are configurable per Mother DXF, not hardcoded in engine.

Result grades:
- PASS: geometrically clean, no conflict signals triggered.
- WARNING: conflict candidate, not a certain failure, requires human review.
- FAIL: certain geometric conflict or invalid state.

WARNING and FAIL results are individually accessible in Step mode directly
from the validation report.

Approval gate rule:
- All FAIL results must be resolved before Mother DXF can be approved.
- WARNING results must be explicitly reviewed and confirmed by the authoring engineer.
- A full Auto mode run across all allowed parameter ranges with configured
  conflict signals must complete before final approval is granted.

## 24. Non-Normative Appendix: POC TODO

Delete this appendix when the listed items are resolved or promoted into
normative contract sections.

Open POC debt:
- Tighten metadata vocabularies after real POC validation, especially `TOPO`
  executable field names and possible compact aliases.
- Keep `follower` as reserved TOPO semantics until a concrete case needs it.
- Define the material allowance resolver concept, for example
  `@FAMILY.RED_GIPS=9.5`, after a POC case requires it.
- Normalize `family`, `product`, and `part` vocabulary in document-level SEM
  against the future DCM / DBR lifecycle model.
- Remove or consolidate legacy UI fallback paths once unified enriched preview
  and unified child save are stable across POC parts.
- Replace remaining ad hoc repair heuristics with deterministic stage-ordered
  movement, join relocation, and validation rules.
