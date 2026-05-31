# Mother DXF DB-ready I/O Skeleton v1

Ovo nije runtime kod.

Ovaj folder je arhitekturni skeleton za buduci Mother DXF DB-ready I/O sloj. Sadrzi samo komentare i imenovane placeholder funkcije u komentarima. Ne importira se iz `src/`, ne mijenja postojece API rute i ne uvodi DB, dependencyje ili DXF logiku.

## Svrha

Skeleton definira kako ce se postojeci file-oriented Mother DXF authoring model kasnije razdvojiti na:

- session envelope
- artifact registry
- path reference model
- preview metadata
- child metadata
- batch/job metadata
- rule catalog i parameter catalog reference
- frozen param setove
- append-only event stream

## Folder Layout

```text
docs/mother_dxf_io_v1_skeleton/
  README.md
  session/
    session_store_skeleton.js
    artifact_registry_skeleton.js
  preview/
    preview_io_skeleton.js
  child/
    child_metadata_skeleton.js
  batch/
    batch_io_skeleton.js
  catalogs/
    rule_catalog_loader_skeleton.js
    param_catalog_loader_skeleton.js
    param_set_skeleton.js
  events/
    event_stream_skeleton.js
  cli/
    mother_cli_skeleton.js
```

## DB-ready I/O Model

DB-ready I/O model dijeli podatke na metadata plane i payload plane.

Metadata plane:

- session metadata
- artifact records
- catalog versions
- param sets
- preview records
- child records
- batch/job records
- events

Payload plane:

- raw DXF
- sanitized DXF
- mother DXF
- child DXF
- preview DXF
- large JSON snapshots
- NDJSON event archives

U buducim fazama DB ce drzati queryable metadata i odabrani JSONB, dok ce filesystem ili object storage drzati DXF i velike snapshot payload artefakte.

## Artifact Registry Koncept

Artifact registry je buduci centralni indeks svih file-backed i JSON-backed artefakata. Svaki zapis treba imati:

- `artifact_id`
- `artifact_type`
- `store`
- `root_key`
- `relative_path`
- `content_type`
- `checksum_sha256`
- `size_bytes`
- `status`
- parent reference kao `session_id`, `preview_id`, `child_artifact_id`, `batch_id` ili `job_id`

Path reference model ne smije spremati lokalne absolute pathove u DB. DB cuva samo `root_key` i `relative_path`; runtime kasnije rjesava stvarni filesystem path kroz Core Shell storage konfiguraciju.

## Session Envelope Koncept

Session envelope razdvaja:

- `metadata`: id, lifecycle, timestamps, user attribution, `session_revision`
- `payload`: bands, catalog ids, param set id, validation summary, document identity summary
- `path_references`: reference na session JSON, mother JSON, raw DXF, mother DXF i povezane artifact recorde

Postojeci session JSON ostaje izvor za Phase 1. U kasnijim fazama runtime save/load moze proizvoditi i citati session envelope preko Core Shell I/O sloja.

## Preview, Child i Batch Metadata

Preview metadata treba vezati:

- `preview_id`
- `session_id`
- `session_revision`
- `param_set_id`
- `branch_mode`
- resolver/generation summary
- optional preview DXF artifact

Child metadata treba vezati:

- `child_artifact_id`
- `variant_id`
- `mother_artifact_id`
- `param_set_id`
- `param_overrides`
- output DXF path reference
- generation summary

Batch metadata treba vezati:

- `batch_id`
- `job_id`
- input manifests
- frozen param setove
- approved Mother DXF artifacte
- per-job child outpute

## Buduca Integracija

Buduca integracija treba ici kroz Core Shell storage/orchestration granicu:

- API ili CLI prima zahtjev.
- Core Shell stvara session/preview/child/batch envelope.
- Mother DXF runtime daje domain rezultat, ali ne odlucuje sam o DB/file backendu.
- Artifact registry registrira sve durable fajlove.
- Event stream biljezi audit trail.
- DBR kasnije konzumira approved Mother artefakte kroz Core Shell contract, a ne kroz direktne Mother runtime interne pozive.

Ovaj skeleton je samo mapa za tu implementaciju.
