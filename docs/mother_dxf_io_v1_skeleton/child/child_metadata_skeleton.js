// Mother DXF DB-ready I/O skeleton: child metadata.
//
// Svrha:
// - Opisuje buduci metadata envelope za generirani child DXF output.
// - Ovaj fajl nije runtime kod i ne smije se importati iz src.
//
// Child artifact id:
// - Svaki child DXF output dobiva child_artifact_id.
// - Child DXF payload ostaje filesystem/object-storage artefakt.
// - Metadata record cuva status, generation summary i path reference.
//
// Variant id:
// - variant_id identificira kombinaciju profile/part/branch/mode/param set.
// - Preporuceni oblik je mxd_var_<profile>_<part>_<short_hash>.
// - Legacy suffixi kao _child_topo_poc.dxf i _child_no_topo.dxf mapiraju se u variant_metadata.child_mode.
//
// Param overrides:
// - Child metadata referencira param_set_id.
// - Request-specific vrijednosti idu u param_overrides.
// - Za batch/production run param set mora biti frozen prije child materialization.
//
// Buduca integracija s runtime-om:
// - Postojeci runtime moze i dalje proizvoditi dxf_text i generation_summary.
// - Core Shell I/O sloj kasnije ce od toga stvoriti child metadata i registrirati child DXF artifact.
// - Mother DXF runtime ne smije sam uvoditi DB writes.
//
// Artefakti:
// - sessions/<session_id>/children/<variant_id>/child.json
// - sessions/<session_id>/children/<variant_id>/child.dxf
//
// Artifact registry:
// - child.dxf dobiva artifact record.
// - child.json moze dobiti artifact record ako se sprema kao snapshot.
// - Child metadata referencira mother_artifact_id i param_set_id.
//
// Path reference model:
// - Child output path je relative path pod session ili batch/job layoutom.
// - DB metadata cuva relative_path, content_type, checksum i size.
//
// Event stream:
// - Child generation requested/generated/failed/approved/superseded eventovi idu u append-only stream.
//
// function createChildMetadata() {}
// function registerChildArtifact() {}
