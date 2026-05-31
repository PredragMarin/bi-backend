// Mother DXF DB-ready I/O skeleton: session store.
//
// Svrha:
// - Opisuje buduci session envelope model za Mother DXF authoring.
// - Ovaj fajl nije runtime kod i ne smije se importati iz src.
//
// Session envelope model:
// - metadata cuva identitet, lifecycle, timestamps, user attribution i concurrency podatke.
// - payload cuva authoring summary, bands, catalog ids, param set reference i validation summary.
// - path_references cuva artifact registry reference na session JSON, mother JSON, raw DXF i exporte.
//
// Metadata/payload/path_references separation:
// - Postojeci veliki session JSON trenutno mijesa metadata, domain state, parsed document i activity log.
// - Buduci model odvaja queryable metadata od velikih filesystem snapshot artefakata.
// - Full parsed document treba zivjeti kao mother.json snapshot ili DB JSONB samo u kontroliranoj hybrid fazi.
//
// Session revision:
// - session_revision ce biti optimistic concurrency signal.
// - Svaki durable authoring save povecava revision.
// - Preview i child metadata trebaju referencirati revision nad kojim su nastali.
//
// Buduca integracija s runtime save/load:
// - Postojeci save/load ostaju netaknuti dok se ne uvede Core Shell I/O boundary.
// - Kasnije runtime save/load moze pozvati session envelope builder prije filesystem/DB persistence sloja.
// - Ovaj skeleton ne poziva runtime i ne implementira storage.
//
// Artefakti:
// - sessions/<session_id>/session.json
// - sessions/<session_id>/mother.json
// - sessions/<session_id>/snapshots/<revision_id>.json
// - path references na raw/sanitized/mother/child/preview artefakte.
//
// Artifact registry:
// - Session envelope nikada ne smije nositi absolute path.
// - Svaki path reference treba imati artifact_id, store, root_key, relative_path i content_type.
//
// Param setovi i katalozi:
// - Session payload referencira config_parameter_set_id, parameter_catalog_id i rule_catalog_id.
// - Embedded legacy catalog snapshots mogu ostati samo kao migration/replay snapshot.
//
// Event stream:
// - Session envelope moze nositi zadnjih 50-200 eventa za UI.
// - Durable audit mora ici u append-only event stream.
//
// function createSessionEnvelope() {}
// function loadSessionEnvelope() {}
// function saveSessionEnvelope() {}
