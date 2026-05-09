# DXF XDATA Contract Draft v0.1

Status: working draft  
Date: 2026-05-07  
Scope: urgent implementation guidance for Mother DXF variant-aware authoring and DBR production-like batch execution

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
2. annotate variant families in DXF XDATA
3. let `mother_dxf_v1` become variant-aware
4. keep `DBR` focused on headless execution over already curated Mother DXF inputs

## 3. Minimal XDATA Contract

### 3.1 Application Name

Use one registered XDATA application name:

- `MOTHERDXF`

This keeps the namespace stable and aligned with the current Mother DXF implementation.

### 3.2 Minimal Required Keys

For variant-bearing geometry, use exactly two required keys:

- `FEATURE_FAMILY`
- `VARIANT_KEY`

Example:

- `FEATURE_FAMILY=FRIZURA`
- `VARIANT_KEY=ECO`

Alternative in the same zone:

- `FEATURE_FAMILY=FRIZURA`
- `VARIANT_KEY=EU_PPV`

### 3.3 Interpretation Rule

If two geometries overlap and share:

- same `FEATURE_FAMILY`
- different `VARIANT_KEY`

then the overlap is treated as:

- `expected_variant_overlap`

and not as:

- `raw_geometry_conflict`

### 3.4 Optional Future Keys

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
2. variant-bearing geometry annotated with XDATA
3. as little ambiguous overlap as possible without variant identity

This work is upstream preparation, not downstream Mother DXF cleanup.

## 4.2 What Must Be Annotated

Annotate:

- variant blocks
- variant-only cutouts
- variant-only finishing features
- any alternative geometry set occupying the same functional zone

Do not spend time annotating every trivial line in the part unless the feature is truly variant-driven.

## 4.3 Recommended AutoCAD Resource Model

For v0.1, use one shared APPID:

- `MOTHERDXF`

Each annotated object or block instance should carry XDATA values such as:

- `FEATURE_FAMILY=FRIZURA`
- `VARIANT_KEY=ECO`

or:

- `FEATURE_FAMILY=FRIZURA`
- `VARIANT_KEY=EU_PPV`

## 4.4 Recommended Annotation Granularity

Preferred:

- annotate the top-level block instance if the whole block is one variant feature

Acceptable fallback:

- annotate the child entities if the block is already exploded or only part of its children belong to the variant

Avoid mixed practice inside one feature unless necessary.

## 4.5 Naming Convention

Use uppercase ASCII keys.

Key names:

- `FEATURE_FAMILY`
- `VARIANT_KEY`

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

1. identify variant-bearing geometry
2. attach XDATA under `MOTHERDXF`
3. set `FEATURE_FAMILY`
4. set `VARIANT_KEY`
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

- same `FEATURE_FAMILY`
- different `VARIANT_KEY`
- same or overlapping spatial zone

Meaning:

- allowed until variant resolution
- should not block downstream work
- should remain visible as context, but not as a hard error

### C. Unknown Overlap

Condition:

- overlap detected
- missing or incomplete XDATA identity

Meaning:

- suspicious
- requires CAD-side clarification

## 6. Mother DXF Refactor Plan for XDATA

## 6.1 Objective

`mother_dxf_v1` must become variant-aware without trying to become a fully generic semantic engine in this delivery window.

The short-term role of XDATA in Mother DXF is:

- variant filtering
- variant-safe selection
- variant-safe TOPO authoring
- variant-safe SEM authoring

## 6.2 V1 Behavior Target

Add an `Active Variant Key` concept to the session/UI.

When active variant is:

- `VARIANT_KEY=EU_PPV`

then:

- entities/blocks with `VARIANT_KEY=EU_PPV` are visible and selectable
- entities/blocks with `VARIANT_KEY=ECO` are dimmed or hidden
- TOPO, SEM, Force Assign Layer, and Force XDATA Add operate only on the active variant

## 6.3 Required Mother DXF Changes

### A. XDATA Read Path

Extend current XDATA parsing to expose:

- `FEATURE_FAMILY`
- `VARIANT_KEY`

per object and per block-bearing object where applicable.

### B. Session State

Add session/UI state:

- `active_variant_key`

Possible values:

- empty / none
- `ECO`
- `EU_PPV`
- etc.

### C. Viewer Filtering

Implement:

- visible + selectable if object matches active variant
- dimmed or hidden if object belongs to a different variant in the same family

### D. Selection Gating

Selection must ignore non-active variant objects during:

- click select
- drag select
- helper tools
- overlap resolution

### E. Sanitize Awareness

Sanitize must reinterpret overlaps using XDATA:

- same family + different variant -> `expected_variant_overlap`
- no XDATA -> `unknown_overlap`

### F. Authoring Safety

When variant mode is active:

- TOPO mover assignment must not accidentally include inactive variant geometry
- `Force Assign Layer` must not hit inactive variant geometry
- `Metadata Authoring` must be scoped to active variant geometry only

## 6.4 Scope We Explicitly Avoid in This Phase

Do not attempt now:

- multi-group variant logic
- complex compatibility matrix between multiple variant families
- dynamic rule-catalog driven variant activation
- fully generic variant engine

The delivery target is variant-safe authoring, not ultimate semantic completeness.

## 6.5 Suggested Mother DXF Delivery Order

1. XDATA parse exposure for `FEATURE_FAMILY` and `VARIANT_KEY`
2. `Active Variant Key` UI control
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

Start annotating variant-bearing geometry with:

- `FEATURE_FAMILY`
- `VARIANT_KEY`

under XDATA app name:

- `MOTHERDXF`

## 8.2 Mother DXF Team

Implement variant-aware V1 behavior:

- read XDATA
- expose active variant
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
2. Mother DXF variant-aware V1
3. DBR file-drop batch runner over already curated Mother DXF inputs

This is the fastest path to a production-like test run without pretending the full long-term architecture is already complete.

