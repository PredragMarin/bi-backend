// Mother DXF DB-ready I/O skeleton: event stream.
//
// Svrha:
// - Opisuje buduci append-only event stream za session, artifact, preview, child, batch i catalog lifecycle.
// - Ovaj fajl nije runtime kod i ne smije se importati iz src.
//
// Event stream model:
// - Svaki event ima event_id, timestamp, severity, type, subject, actor, correlation_id, message i details.
// - Legacy activity_log se mapira u durable event stream.
// - Session envelope moze zadrzati samo zadnjih 50-200 eventa za UI convenience.
//
// Buduca uloga:
// - Omoguciti audit trail za authoring, validation, preview, export, child generation i batch jobs.
// - Omoguciti DB append table u kasnijim fazama.
// - Omoguciti filesystem NDJSON fallback u Phase 1/2.
//
// Buduca integracija s runtime-om:
// - API boundary kasnije dodaje actor i correlation id.
// - Core Shell I/O sloj append-a event nakon durable actions.
// - Mother DXF runtime ne treba direktno znati gdje se event sprema.
//
// Artefakti:
// - sessions/<session_id>/events.ndjson
// - batches/<batch_id>/events.ndjson
// - optional DB event table.
//
// Artifact registry:
// - Event stream file moze biti registry artifact ako se archive-a kao durable payload.
// - Eventi referenciraju artifact id u subject ili details kada je relevantno.
//
// Path reference model:
// - Event stream file koristi relative path.
//
// Session/preview/child metadata:
// - Lifecycle transitions se ne smiju oslanjati samo na metadata status.
// - Svaka bitna promjena treba imati odgovarajuci event.
//
// function appendEvent() {}
// function loadEventStream() {}
