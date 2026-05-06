# Mother DXF Resolver Snapshot 2026-05-06

## Purpose
This snapshot records the current resolver state in `mother_dxf_v1` before broader consolidation into a stronger shared resolver engine.

The goal is to preserve:
- exact repo locations of current resolver behavior
- separation between shared geometric primitives and local policy/orchestration
- the current handoff point toward a future production-grade resolver reusable by `DBR`

This is a repo-state snapshot, not a target-state design.

## Executive Verdict
As of `2026-05-06`, the repo contains:

1. a real shared geometric repair core in `src/core_shell/services/dxf_line_repair_service.js`
2. additional repair policy and orchestration logic still living in `src/modules/mother_dxf_v1/module_runtime.js`
3. an early `DBR` dependency on `mother_dxf_v1` child-generation entrypoints

Therefore:

- we do **not** yet have one single universal production resolver
- we **do** have a central reusable repair primitive layer
- we are at the first credible moment to begin consolidating policy/orchestration into a stronger shared resolver engine

## Current Resolver Topology

### A. Shared repair primitive layer
File:
- [src/core_shell/services/dxf_line_repair_service.js](/home/marin/app/src/core_shell/services/dxf_line_repair_service.js)

This file currently contains the main reusable line-repair primitives:

- `collectLineCandidates(objects)`
- `resolveSlidingLineVertexPairing(originalLineShape, lineCandidates, selfRef, vertexName)`
- `buildReciprocalTrim(pairing, simulatedShapeMap, intersection, options = {})`
- `applyTrimRejoinToTranslatedLine(originalLineShape, translatedLineShape, lineCandidates, selfRef, simulatedShapeMap, options = {})`

These functions already act as a shared geometric repair core.

### B. Shared low-level geometry primitives
File:
- [src/core_shell/geometry/index.js](/home/marin/app/src/core_shell/geometry/index.js)

Resolver-relevant primitives currently used by the repair service:

- `lineLineIntersection(...)`
- `trimLineToPoint(...)`

These are already outside `mother_dxf_v1`.

## Current Mother DXF-local resolver policy/orchestration
File:
- [src/modules/mother_dxf_v1/module_runtime.js](/home/marin/app/src/modules/mother_dxf_v1/module_runtime.js)

The following functions are still local to `mother_dxf_v1` and represent policy/orchestration rather than pure geometry primitives:

### 1. Document-rule execution layer
- `applyDocumentRulesToSimulationMap(session, objects, parameters, objectMap, topologyMode)`
- `applyBottomOffsetEnvelopeVerticalPostPass(objectMap, objects, preRuleShapeSnapshot, offsetY)`

Current role:
- resolve document-level `rule_ref`
- evaluate catalog conditions
- target object subsets, especially by `primary_layer`
- apply geometry offsets
- invoke shared trim/rejoin primitives
- run local post-pass adjustments for edge cases such as bottom-offset envelope verticals

### 2. Standard no-TOPO parametric simulation
- `buildStandardGeometrySimulationMap(objects, parameters)`

Current role:
- compute no-TOPO standard parametric movement
- call shared trim/rejoin core

### 3. TOPO fixed-envelope simulation
- `buildTopoGeometrySimulationMap(session, objects, parameters, topologyMode)`
- `sustainFixedEnvelopeBoundaries(objectMap, objects, envelope)`

Current role:
- select mover entities from file-level and entity-level TOPO metadata
- compute per-zone deltas
- apply X-slide movement
- call shared trim/rejoin core
- maintain fixed-envelope boundary behavior

### 4. Preview orchestrator
- `simulateChildPreview(session)`

Current role:
- select which simulation path runs
- combine:
  - standard no-TOPO simulation
  - TOPO simulation
  - document-rule execution
- package preview output

### 5. Materialization path for child generation
- `materializeChildDocumentTopoPoc(session, config)`
- `generateChildDxfTopoPoc(session, parameterSet)`
- `generateChildDxfTopoPocForSession({ sessionId, parameterSet, storeRoot })`

Current role:
- build child document generation output
- currently represents the strongest existing route toward production execution

## Current DBR dependency
File:
- [src/modules/dbr_v1/module_runtime.js](/home/marin/app/src/modules/dbr_v1/module_runtime.js)

Observed current dependency:
- `dbr_v1` already calls `motherDxfRuntime.generateChildDxfTopoPocForSession(...)`

This means the resolver story is no longer purely theoretical:
- `DBR` already touches the `mother_dxf_v1` generation path
- consolidation pressure is now real

## What is already centralized
The following are already centralized enough to count as shared primitives:

- line candidate collection
- line pairing by original shared vertex
- line-line intersection
- trim to intersection
- reciprocal trim
- bounded extension checks via repair options

In practical terms, the repo already has one shared **repair primitive service**, not multiple independent math engines.

## What is still split
The following are still split across `mother_dxf_v1` policy/orchestration functions:

- when a rule should run
- which objects are eligible
- which boundaries are authoritative
- fixed-envelope sustain behavior
- bottom-offset edge adjustment behavior
- document-level catalog rule execution sequencing
- TOPO zone-specific mover selection

So the repo is currently:

- centralized at the primitive math/repair level
- partially decentralized at the policy/orchestration level

## Current migration threshold assessment
This is the first credible migration point if the target is:
- one stronger shared resolver engine that can cover the majority of `Mother DXF` and later `DBR` needs

Reason:

1. the difficult geometry primitives are already extracted
2. no-TOPO and TOPO paths have both been exercised
3. document-rule-driven repair is now live
4. `DBR` already has a runtime dependency on the child-generation path

This does **not** mean all edge behavior is fully generalized.

It means the repo has crossed the threshold where continued feature growth inside `mother_dxf_v1/module_runtime.js` will create more drag than value unless policy consolidation begins.

## Recommended consolidation target
The likely future shared resolver engine should separate:

### Layer A. Geometry primitives
Shared:
- candidate collection
- pairing
- trim
- reciprocal trim
- bounds-aware repair

### Layer B. Repair policy presets
Shared, named modes, for example:
- `standard_parametric_resize`
- `fixed_envelope_slide_x`
- `fixed_envelope_bottom_offset`

### Layer C. Domain orchestration
Thin caller-specific orchestration from:
- `mother_dxf_v1`
- `dbr_v1`

This would allow `DBR` to call a shared resolver by mode/policy instead of reusing `mother_dxf_v1` as an implicit production resolver shell.

## Current risk
If more edge-specific behavior is added only inside `mother_dxf_v1/module_runtime.js`, the repo risks:

- policy drift
- mixed responsibilities
- a growing gap between preview logic and future production logic
- harder future extraction into a `DBR`-grade shared resolver

## Snapshot conclusion
Current repo state is best described as:

- **one shared geometric repair core**
- **multiple Mother DXF-local resolver policies**
- **an active opportunity for resolver consolidation**

The next clean architectural step is not more ad hoc repair growth.
It is extraction of policy modes from `mother_dxf_v1/module_runtime.js` into a shared resolver-oriented service layer.

## File Map
Shared primitives:
- [src/core_shell/services/dxf_line_repair_service.js](/home/marin/app/src/core_shell/services/dxf_line_repair_service.js)
- [src/core_shell/geometry/index.js](/home/marin/app/src/core_shell/geometry/index.js)

Mother DXF-local policy/orchestration:
- [src/modules/mother_dxf_v1/module_runtime.js](/home/marin/app/src/modules/mother_dxf_v1/module_runtime.js)

Current DBR dependency touchpoint:
- [src/modules/dbr_v1/module_runtime.js](/home/marin/app/src/modules/dbr_v1/module_runtime.js)
