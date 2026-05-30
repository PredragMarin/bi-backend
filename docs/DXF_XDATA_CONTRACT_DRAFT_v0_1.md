# DXF XDATA Contract Draft v0.1

Status: working draft  
Date: 2026-05-07  
Scope: urgent implementation guidance for Mother DXF geometry-branch authoring and DBR production-like batch execution

## 1. Purpose

This document defines a pragmatic XDATA-based metadata contract for the current
delivery window.

The goal is not to build the final perfect semantic system. The goal is to:

1. distinguish intentional variant overlaps from real raw DXF defects
2. let upstream CAD preparation carry enough variant identity
3. let `mother_dxf_v1` behave safely during selection, TOPO, SEM, and layer work
4. let `DBR` later consume already prepared Mother DXF artifacts and generate child batches

This draft is intentionally narrow and favors delivery speed over theoretical completeness.

## 2. Urgent Engineering Context

We need to support a near-term test run for the S4PP4 line on production-like data:

- 20 doors per day
- 12 parts per door
- multiple parts requiring fixed-envelope TOPO behavior

Current `mother_dxf_v1` is strong enough for useful authoring, but the system now hits
an architectural limit:

- some geometry overlaps are true defects
- some geometry overlaps are intentional variant alternates
- without variant metadata, sanitize and downstream authoring cannot tell them apart

The chosen short-term strategy is:

1. improve upstream CAD preparation
2. annotate alternative geometry branches in DXF XDATA
3. let `mother_dxf_v1` become geometry-branch-aware
4. keep `DBR` focused on headless execution over already curated Mother DXF inputs

## 3. Minimal XDATA Contract

### 3.1 Application Name

Use one registered XDATA application name:

- `MOTHERDXF`

This keeps the namespace stable and aligned with the current Mother DXF implementation.

### 3.2 Minimal Required Keys

For alternative geometry branches, use exactly one required key:

- `GEOMETRY_VARIANT`

Example:

- `GEOMETRY_VARIANT=ECO`

Alternative in the same zone:

- `GEOMETRY_VARIANT=EU_PPV`

Base geometry remains untagged. In the current Mother DXF convention, untagged
top-level geometry is the implicit `BASE` branch.

### 3.3 Interpretation Rule

If two geometries overlap and at least one branch carries:

- `GEOMETRY_VARIANT=<value>`

then the overlap is treated as:

- `expected_variant_overlap`

and not as:

- `raw_geometry_conflict`

This is a legacy/diagnostic interpretation only. The preferred authoring
convention for new multi-branch Mother DXF inputs is spatially separated
branches, not overlapping alternative branches.

### 3.4 Spatial Branch Layout Convention

For product/part cases that keep multiple alternative geometries in one Mother
DXF file, the recommended layout is:

- implicit `BASE`: untagged geometry, bbox minimum at `X=0`, `Y=0`
- first tagged branch, for example `GEOMETRY_VARIANT=ECO`: bbox minimum at
  `X=3000`, `Y=0`
- additional tagged branches, if needed: next 3000 mm X slots

The `3000` mm slot is a pragmatic authoring convention aligned with the current
3 m x 1.5 m technology base. It is not a child output coordinate requirement.

Rules:

- branch geometry outside the implicit base slot must be tagged with XDATA
- untagged geometry outside the implicit base slot is a validation warning
- tagged branch geometry in the implicit base slot is a validation warning unless
  explicitly accepted for a legacy/debug file
- `ALL` is an authoring/debug view only
- child preview and child export must resolve to exactly one branch
- final child DXF must not contain eliminated branch geometry or Mother DXF
  branch XDATA
- final child geometry is normalized after branch isolation and resolver
  execution so bbox minimum is `X=0`, `Y=0`

### 3.5 Optional Future Keys

Not required for v0.1, but allowed later:

- `PRODUCT_SCOPE`
- `ROLE`
- `EXCLUDE_IF`
- `TOPO_GROUP_HINT`

These are explicitly out of scope for the current urgent delivery unless a later step proves they are necessary.

## 4. AutoCAD Preparation Guidance

## 4.1 Preparation Target

The upstream CAD operator should deliver:

1. cleaner raw DXF geometry
2. alternative geometry branch annotated with XDATA
3. spatially separated branch geometry where practical, preferably in 3000 mm
   X slots
4. as little ambiguous overlap as possible without variant identity

This work is upstream preparation, not downstream Mother DXF cleanup.

## 4.2 What Must Be Annotated

Annotate:

- alternative blocks
- branch-only cutouts
- branch-only finishing features
- any alternative geometry set occupying the same functional zone

Do not spend time annotating every trivial line in the part unless the feature is truly variant-driven.

## 4.3 Recommended AutoCAD Resource Model

For v0.1, use one shared APPID:

- `MOTHERDXF`

Each annotated object or block instance should carry XDATA values such as:

- `GEOMETRY_VARIANT=ECO`

or:

- `GEOMETRY_VARIANT=EU_PPV`

## 4.4 Recommended Annotation Granularity

Preferred:

- annotate the top-level block instance if the whole block is one variant feature

Acceptable fallback:

- annotate the child entities if the block is already exploded or only part of its children belong to the variant

Avoid mixed practice inside one feature unless necessary.

## 4.5 Naming Convention

Use uppercase ASCII keys.

Key name:

- `GEOMETRY_VARIANT`

Value naming recommendations:

- short
- stable
- product-facing
- no spaces if avoidable

Good examples:

- `FRIZURA`
- `ECO`
- `EU_PPV`
- `EUROPA`
- `EUROMAX`

Avoid:

- ad hoc free text
- mixed casing
- long descriptive sentences

## 4.6 AutoCAD Operator Notes

The CAD operator needs only a small repeatable habit:

1. identify alternative branch geometry
2. attach XDATA under `MOTHERDXF`
3. set `GEOMETRY_VARIANT`
5. save DXF
6. run sanitize check
7. fix flagged raw defects in CAD
8. repeat until acceptable

## 4.7 Upstream Sanitize Workflow

The upstream engineer should use the sanitize diagnostics loop like this:

1. prepare raw DXF in CAD
2. attach variant XDATA
3. load into sanitize-oriented Mother DXF workflow
4. review:
   - degenerate lines
   - micro lines
   - overlap clusters
   - expected variant overlaps
5. return to CAD
6. correct geometry
7. repeat

This is the preferred operational model. Downstream Mother DXF authoring should not be the place where raw CAD defects are discovered for the first time.

## 5. Sanitizer Classification Rules

## 5.1 Current and Target Classes

The sanitize layer should classify geometry findings into:

1. `real_defect`
2. `expected_variant_overlap`
3. `unknown_overlap`

## 5.2 Classification Draft

### A. Real Defect

Examples:

- degenerate line
- micro line
- accidental duplicate
- broken contour
- unexplained overlap with no variant identity

### B. Expected Variant Overlap

Condition:

- one branch is untagged base geometry and the other carries `GEOMETRY_VARIANT`
- or two overlapping branches carry different `GEOMETRY_VARIANT` values
- same or overlapping spatial zone

Meaning:

- allowed until variant resolution
- should not block downstream work
- should remain visible as context, but not as a hard error
- legacy/diagnostic tolerance only; new authoring should prefer spatially
  separated branches

### B2. Spatially Separated Branch

Condition:

- untagged base geometry occupies the implicit base slot
- tagged branch geometry occupies a distinct branch slot such as `X=3000`, `Y=0`
- branch identity is available through `GEOMETRY_VARIANT`

Meaning:

- preferred multi-branch Mother DXF layout
- selectable and authorable through active branch context
- branch is eliminated before child resolver execution when it is not selected
- selected branch is normalized during child materialization

### C. Unknown Overlap

Condition:

- overlap detected
- overlap exists but no branch distinction is available

Meaning:

- suspicious
- requires CAD-side clarification

## 6. Mother DXF Refactor Plan for XDATA

## 6.1 Objective

`mother_dxf_v1` must become geometry-branch-aware without trying to become a fully generic semantic engine in this delivery window.

The short-term role of XDATA in Mother DXF is:

- geometry branch filtering
- branch-safe selection
- branch-safe TOPO authoring
- branch-safe SEM authoring

## 6.2 V1 Behavior Target

Add an `Active Geometry Variant` concept to the session/UI.

When active branch is:

- `GEOMETRY_VARIANT=EU_PPV`

then:

- untagged base geometry is suppressed
- entities/blocks with `GEOMETRY_VARIANT=EU_PPV` are visible and selectable
- entities/blocks with another `GEOMETRY_VARIANT` are dimmed or hidden
- TOPO, SEM, Force Assign Layer, and Force XDATA Add operate only on the active branch

When active branch is `BASE`, untagged geometry is the selected source branch
and tagged branch geometry is suppressed.

When active branch is `ALL`, the UI may show all branch slots for inspection,
selection hygiene, or XDATA repair, but `ALL` must not be used as a child
preview/export source.

## 6.3 Required Mother DXF Changes

### A. XDATA Read Path

Extend current XDATA parsing to expose:

- `GEOMETRY_VARIANT`

per object and per block-bearing object where applicable.

### B. Session State

Add session/UI state:

- `active_geometry_variant`

Possible values:

- empty / none
- `ECO`
- `EU_PPV`
- etc.

### C. Viewer Filtering

Implement:

- visible + selectable if object matches active branch
- hidden if object belongs to a different branch
- base geometry visible only when no active branch is selected

### D. Selection Gating

Selection must ignore non-active branch objects during:

- click select
- drag select
- helper tools
- overlap resolution

### E. Sanitize Awareness

Sanitize must reinterpret overlaps using XDATA:

- base + tagged branch overlap -> `expected_variant_overlap`
- different tagged branches in the same zone -> `expected_variant_overlap`
- unexplained overlap with no branch distinction -> `unknown_overlap`

### F. Authoring Safety

When branch mode is active:

- TOPO mover assignment must not accidentally include inactive branch geometry
- `Force Assign Layer` must not hit inactive branch geometry
- `Metadata Authoring` must be scoped to active branch geometry only

## 6.4 Scope We Explicitly Avoid in This Phase

Do not attempt now:

- multi-group variant logic
- complex compatibility matrix between multiple variant families
- dynamic rule-catalog driven variant activation
- fully generic variant engine

The delivery target is branch-safe authoring, not ultimate semantic completeness.

## 6.5 Suggested Mother DXF Delivery Order

1. XDATA parse exposure for `GEOMETRY_VARIANT`
2. `Active Geometry Variant` UI control
3. viewer gating
4. selection gating
5. sanitize reinterpretation
6. TOPO/SEM/Layer authoring gating

## 7. DBR Completion Plan for Production-Like Batch Runs

## 7.1 DBR Mission in This Delivery Window

`DBR` should not solve upstream CAD ambiguity.

`DBR` should ingest:

- ERP work orders
- config parameter snapshots
- approved Mother DXF files

and produce:

- child DXF batches

in a file-drop execution mode.

## 7.2 Required Inputs

Per production order / per door:

- ERP work order row(s)
- frozen parameter snapshot
- Mother DXF references for the 12 parts
- designated drop folder target

## 7.3 Production-Like Execution Shape

Target daily run:

- 2 doors
- 12 parts each
- total 24 child DXF outputs per day

DBR should operate as:

1. ingest batch
2. map order -> kit -> part jobs
3. resolve each part against frozen parameter snapshot
4. generate child DXF
5. drop files into designated output folder
6. emit execution summary

## 7.4 Minimal DBR Boundary for Test Run

For the test run, DBR may continue to use the current Mother DXF child-generation path as a controlled black-box dependency if needed.

That is acceptable only as a temporary execution bridge.

DBR should not become a long-term wrapper around Mother DXF internals.

## 7.5 Recommended DBR V0.1 Delivery Scope

### A. Inputs

DBR must accept:

- ERP order identity
- frozen parameter snapshot
- part -> Mother DXF mapping
- drop-folder target

### B. Execution

For each part job:

1. load correct Mother DXF artifact
2. pass frozen parameters
3. request child DXF generation
4. write output file to drop folder
5. persist per-part execution status

### C. Output Naming

Use a deterministic file naming convention:

- `<order>__<door>__<part>__<variant>.dxf`

Exact naming can be tuned later, but v0.1 must be:

- deterministic
- grep-friendly
- human-readable

### D. Result Summary

For each batch run produce:

- generated count
- failed count
- failed part list
- output folder path

## 7.6 Suggested DBR Delivery Steps

1. finish ingest path for ERP work orders
2. freeze parameter snapshot per job
3. resolve Mother DXF reference per part
4. implement file-drop writer
5. implement batch summary
6. run daily smoke with 2 x 12 parts

## 7.7 What DBR Should Not Try to Do Now

Do not put into the urgent DBR scope:

- CAD sanitation
- variant authoring
- raw defect repair
- manual semantic editing

Those belong upstream or in Mother DXF authoring.

DBR should execute approved inputs, not invent missing intent.

## 8. Immediate Team Guidance

## 8.1 CAD Team

Start annotating alternative geometry branches with:

- `GEOMETRY_VARIANT`

under XDATA app name:

- `MOTHERDXF`

## 8.2 Mother DXF Team

Implement geometry-branch-aware V1 behavior:

- read XDATA
- expose active geometry branch
- filter selection and visibility
- reinterpret sanitize overlaps

## 8.3 DBR Team

Stay narrow:

- ingest ERP
- freeze parameters
- map Mother DXF
- generate child files
- drop files to designated folder

## 9. Recommended Short-Term Delivery Decision

For the next-week objective, the highest-value path is:

1. upstream CAD cleanup + XDATA annotation
2. Mother DXF geometry-branch-aware V1
3. DBR file-drop batch runner over already curated Mother DXF inputs

This is the fastest path to a production-like test run without pretending the full long-term architecture is already complete.
