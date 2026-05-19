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
- canonical `SEM:` metadata generation for presence, geometry role, and operation reference records
- parser support for `SEM:` key/value records and simple `when` expressions using `==` and `!=`
- parameter catalog exposure from a module contract JSON artifact
- MXD rule catalog exposure from a module contract JSON artifact
- pre-child simulation preview for simple `presence=conditional` visibility evaluation

Still not implemented:

- ChildPlan generation
- rule expression evaluator for catalog rules
- operation execution / geometry transform engine
- DBR execution
- final approval-grade validation engine described later in this document

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

### 15D. Planned Final Orientation Rule

Door parts in S4P4 technology are authored in raw DXF as DX orientation.
For left-opening doors, selected child DXF outputs must be mirrored as a final
child-level orientation transform because Lxxx/Sxxx stock has a face/back side
and produced pieces cannot be physically flipped.

This is planned as a document/profile rule, not entity-level SEM and not TOPO.
It executes after SEM filtering, TOPO materialization, and post-TOPO micro shift.

Canonical planned rule:

```text
999
RULE:stage=final_orientation;id=DOOR_SX_DX_MIRROR;geometry=mirror;axis=Y;when=STRANA_OTVARANJA IN [Lijeva (SX),Inverzna lijeva (INV SX)];normalize_bbox=true
```

Execution meaning:

- raw DXF coordinate system remains the authoring coordinate system
- `Desna (DX)` and `Inverzna desna (INV DX)` keep raw orientation
- `Lijeva (SX)` and `Inverzna lijeva (INV SX)` mirror around the Y axis
- after mirror, child geometry is normalized so final bbox starts at `minX=0`, `minY=0`
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
RULE:stage=child_label;id=S4P4_LBRA_LABEL_APPLICATION;operation=apply_label;coordinate_space=raw_part;anchor_transform=through_final_child;x=1276;y=39;z=0;label_width=50;label_height=20;rotation=0;collision_policy=warn;payload_carrier=TEXT;carrier_layer=0;carrier_height=1;carrier_color=1;carrier_h_align=1;carrier_v_align=2;payload_template=;|{{WORKORDERCODE}}|{{TIP_VRATA}}|{{SOURCE_REFERENCE}}|{{DIMENSION_SHORT}}|{{OPENING_SIDE_SHORT}};payload_field_DIMENSION_SHORT=format({{SIRINA_VRATA_DIV10}}x{{VISINA_VRATA_DIV10}});payload_field_SIRINA_VRATA_DIV10=number_expr(SIRINA_VRATA/10,integer);payload_field_VISINA_VRATA_DIV10=number_expr(VISINA_VRATA/10,integer);payload_field_OPENING_SIDE_SHORT=map(STRANA_OTVARANJA:{Desna (DX)=D,Lijeva (SX)=L,Inverzna desna (INV DX)=D,Inverzna lijeva (INV SX)=L})
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
- `TIP_VRATA`, `SIRINA_VRATA`, `VISINA_VRATA`, and `STRANA_OTVARANJA` are expected from configurator/catalog context unless DBR provides an override
- `DIMENSION_SHORT` formats width/height in decimeters as `SIRINA_VRATA/10` + `x` + `VISINA_VRATA/10`
- `SKRACENJE` is not part of the current production-tested label payload unless a future rule explicitly adds it
- `OPENING_SIDE_SHORT` must be mapped from controlled enum values; it must not use naive first-letter extraction because inverse values start with `Inverzna`

Planned child generation order becomes:

1. document SEM filtering
2. TOPO LEC/REC movement
3. post-TOPO rigid offset
4. final orientation mirror, when configured
5. bbox normalization
6. child label application / transformed raw anchor carrier emission
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

- `MXD_PPV_LAYER_B_OFFSET_9P5`

Current MXD rule example:

- `MXD_PPV_LAYER_B_OFFSET_9P5`
  - `profile_scope = MXD`
  - condition: `TIP_VRATA == PPV`
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

The current implementation intentionally stops before execution layers.

Not implemented:

- ChildPlan derivation
- rule expression evaluation
- operation catalog loading
- operation execution
- geometry copy / mirror / translate materialization
- DBR batch execution

Current metadata authoring can describe intent and references. It does not yet prove that a downstream child DXF can be generated for every authored record.

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
- Extend `trim_policy=rejoin` beyond endpoint-follower LINE repair when a real DXF case requires split/merge or non-LINE boolean repair.
- Keep `follower` as reserved TOPO semantics until a concrete case needs it.
- Revisit operation ordering only if combined `SEM`, `TOPO`, `9-layer`, or
  material allowance behavior produces a real conflict.
- Define the material allowance resolver concept, for example
  `@FAMILY.RED_GIPS=9.5`, after a POC case requires it.
- Normalize `family`, `product`, and `part` vocabulary in document-level SEM
  against the future DCM / DBR lifecycle model.
- Remove or consolidate legacy UI fallback paths once unified enriched preview
  and unified child save are stable across POC parts.
