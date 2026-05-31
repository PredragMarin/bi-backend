// Mother DXF DB-ready I/O skeleton: preview I/O.
//
// Svrha:
// - Opisuje buduci durable preview metadata model za resolver/materialization previewe.
// - Ovaj fajl nije runtime kod i ne smije se importati iz src.
//
// Preview id:
// - Svaki persisted preview dobiva preview_id.
// - Preporuceni oblik je mxd_prev_<uuid>.
// - Preview referencira session_id, session_revision, param_set_id, branch_mode i resolver mode.
//
// Preview metadata:
// - Cuva generation summary, warnings, validation hints, branch mode i param snapshot reference.
// - Full verbose resolver preview moze zivjeti kao filesystem JSON snapshot.
// - DB treba drzati queryable summary i path reference.
//
// Preview DXF artifact:
// - Ako se preview DXF persistira, registrira se kao artifact kroz artifact registry.
// - Preview DXF ostaje filesystem/object-storage payload.
// - Preview metadata cuva preview_dxf_artifact_id.
//
// Buduca integracija s runtime-om:
// - Runtime preview endpoint danas vraca JSON i DXF text transientno.
// - Kasnije Core Shell I/O sloj moze omotati rezultat u preview metadata bez promjene domain resolvera.
// - Preview default treba biti read-only; write-through mode mora biti eksplicitan.
//
// Artefakti:
// - sessions/<session_id>/previews/<preview_id>/preview.json
// - sessions/<session_id>/previews/<preview_id>/preview.dxf
//
// Artifact registry:
// - preview.json i optional preview.dxf dobijaju zasebne artifact recorde.
// - Preview metadata cuva path references, ne absolute pathove.
//
// Param setovi i rule katalozi:
// - Preview mora referencirati frozen ili draft param set koji je koristen.
// - Rule catalog version mora biti zabiljezen kroz session payload ili preview metadata.
//
// Event stream:
// - Preview requested/generated/failed/promoted/superseded eventovi idu u event stream.
//
// function createPreviewMetadata() {}
// function persistPreviewArtifacts() {}
