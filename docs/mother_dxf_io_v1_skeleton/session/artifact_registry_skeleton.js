// Mother DXF DB-ready I/O skeleton: artifact registry.
//
// Svrha:
// - Opisuje buduci centralni registry za sve Mother DXF I/O artefakte.
// - Ovaj fajl nije runtime kod i ne smije se importati iz src.
//
// Artifact registry koncept:
// - Svaki durable fajl ili structured snapshot dobiva artifact_id.
// - Registry zapis opisuje tip artefakta, storage backend, path reference, content type, checksum, velicinu i lifecycle status.
//
// Artifact id generiranje:
// - Novi artefakti koriste mxd_art_<uuid>.
// - Legacy import moze zadrzati source filename kao metadata, ali artifact id mora biti novi stabilni identifikator.
// - Superseded artefakt se ne prepisuje nego dobiva novi artifact record.
//
// Path reference model:
// - Registry cuva store, root_key i relative_path.
// - DB ne cuva absolute pathove.
// - Runtime kasnije rjesava absolute path kroz Core Shell storage konfiguraciju.
//
// Buduca integracija s runtime-om:
// - Nakon save session/mother/child/preview fajla, Core Shell I/O sloj bi registrirao artifact.
// - Mother DXF runtime ne treba znati da li je registry DB-backed ili file-backed.
//
// Artefakti:
// - raw DXF
// - sanitized DXF
// - session JSON
// - mother JSON
// - mother DXF
// - preview JSON/DXF
// - child metadata/DXF
// - batch manifests
// - event streams
//
// Session/preview/child metadata:
// - Metadata recordi referenciraju artifact registry preko artifact_id.
// - Artifact registry ne smije preuzeti domain znacenje previewa, childa ili batcha.
//
// Event stream:
// - Registracija, validacija, supersede i archive akcije trebaju emitirati event.
//
// function registerArtifact() {}
// function resolveArtifactPath() {}
