# DBR Radni Outline v0

## Status

Radni outline i checkpoint za prvi skeleton DBR modula.

Ovaj dokument je implementacijska referenca za nastavak DBR rada. Još nije
production contract.

## Svrha

DBR je production batch engine za generiranje child DXF fileova iz approved
Mother DXF artefakata.

DBR nije branch od `mother_dxf_v1`.

DCM / Mother DXF ostaje design-time human-in-the-loop modul koji kreira,
enricha, validira i approve-a Mother DXF fileove po jednoj part geometriji.

DBR kasnije u production execution fazi konzumira approved Mother DXF
artefakte.

## Trenutni Kontekst

Unutar `mother_dxf_v1` već postoji developer/test bridge:

- postoji NO TOPO child generator
- postoji TOPO mover translation POC
- unified child generation UX može interno izabrati TOPO ili NO TOPO prema
  session metadati
- ti pathovi su prihvatljivi kao black-box mock resolver za prvi DBR POC

Resolver internals su namjerno izvan scopea za DBR skeleton.

## Scope Prvog DBR Skeletona

U scopeu prvog skeletona:

- PostgreSQL-backed DBR/catalog foundation
- DBR module skeleton bez resolver implementacije
- product-to-kit mapping za prvi PPV/OPS S4P4 POC
- DBR production order, kit batch i part job lifecycle zapisi
- Mother artifact registry reference
- parameter catalog foundation
- rule catalog registry s `JSONB` payloadom
- seed path za početni PPV kit mapping i catalog rows

Izvan scopea:

- migracija postojećeg file-based `mother_dxf_v1` session storagea
- rewrite Core Shell DXF parsera/serializera
- rewrite Mother DXF authoring/export flowova
- implementacija production resolver internalsa
- finalna rule engine semantika

## Implementirano Do Sada

PostgreSQL foundation za DBR/catalog je dodan u Core Shell sloju.

Dodane migrations:

- `src/core_shell/migrations/catalog/001_create_catalog_foundation.up.sql`
- `src/core_shell/migrations/catalog/001_create_catalog_foundation.down.sql`
- `src/core_shell/migrations/dcm/001_create_dcm_foundation.up.sql`
- `src/core_shell/migrations/dcm/001_create_dcm_foundation.down.sql`
- `src/core_shell/migrations/dbr/001_create_dbr_foundation.up.sql`
- `src/core_shell/migrations/dbr/001_create_dbr_foundation.down.sql`

Dodani seed:

- `src/core_shell/db/seeds/003_dbr_catalog_seed.js`

Seed radi:

- pokreće `catalog`, `dcm` i `dbr` foundation migrations
- seeda `catalog.parameter_catalog` iz postojećeg Mother DXF parameter catalog
  JSON-a
- seeda `catalog.rule_catalog` iz postojećeg Mother DXF rule catalog JSON-a
- seeda `catalog.product_kit_mapping` za `product_code=PPV`,
  `technology_profile=OPS_S4P4`, `kit_version=PPV_OPS_S4P4_v0`

Dodani Core Shell DB services:

- `src/core_shell/services/catalog_db_service.js`
- `src/core_shell/services/dbr_db_service.js`

Provjereno:

- `node -c src/core_shell/db/seeds/003_dbr_catalog_seed.js`
- `node -c src/core_shell/services/catalog_db_service.js`
- `node -c src/core_shell/services/dbr_db_service.js`

Nije dirano:

- `mother_dxf_v1` file-based session storage
- postojeće API routes
- Core Shell DXF parser/serializer
- postojeći child generator

## Postojeći PostgreSQL Foundation

Repo već sadrži:

- `pg` dependency
- PostgreSQL config loader: `src/core_shell/config/db_config.js`
- PostgreSQL pool helper: `src/core_shell/db/client/postgres_pool.js`
- query helper: `src/core_shell/db/helpers/query.js`
- SQL file runner: `src/core_shell/db/helpers/migration_runner.js`
- PostgreSQL smoke script: `scripts/postgres_smoke_test.js`
- postojeći migration style pod `src/core_shell/migrations/*`

ORM se trenutno ne koristi. Postojeći pattern je raw SQL kroz `pg`.

## Predložena Granica Modula

DBR modul:

- drži production-oriented batch logiku
- importa ili prima production orders
- mapira product codeove na kit parts
- kreira part jobs
- poziva child generation kao black box
- sprema execution statuse i summaryje
- proizvodi execution reports

DCM / Mother DXF:

- drži authoring i approval Mother DXF artefakata
- drži human validation workflow
- ne drži dnevni production batch execution

Core Shell:

- drži PostgreSQL config i connection pool
- drži shared DB query helpere
- drži migration/seed infrastrukturu
- drži shared artifact/storage boundary
- može pružiti DB services koje koriste DBR i catalog readers

ERP / SQL source sistemi:

- read-only su input za production orders i configurator values
- DBR ne smije pisati u njih u prvom POC-u

## Prvi POC Product Kit

Product: `PPV`

Technology profile: `OPS_S4P4`

Part list:

- `KSKR`
- `LBRA`
- `OBRA`
- `OBRIT`
- `OSPY`
- `OMET`
- `LBRIT`
- `LHOR`
- `LMET`
- `SBRA`
- `SBRIT`
- `SHOR`

## PostgreSQL Schema Outline

Preporučeni schemas:

- `catalog`
- `dcm`
- `dbr`

### `catalog.parameter_catalog`

Svrha: stabilni registry configurator parametara.

Važno pravilo:

- `parameter_key` ostaje canonical external/domain key
- ne renameati duge postojeće keyeve samo zato da budu kraći
- opcionalni `parameter_abbrev` / `aliases_json` nisu dio prvog DDL-a; mogu se
  dodati kasnijom migracijom kad abbreviation policy sazrije

Implementirani stupci:

- `id`
- `catalog_id`
- `schema_version`
- `parameter_key`
- `code`
- `label`
- `type`
- `unit`
- `min_value`
- `max_value`
- `step_value`
- `values_json`
- `source`
- `status`
- `created_at`
- `updated_at`

### `catalog.rule_catalog`

Svrha: registry za buduće rule artefakte.

Trenutni rule JSON je samo smoke artefakt i nije production semantika.

Koristimo `JSONB` kao privremeni payload carrier dok se stvarna rule semantika
ne stabilizira.

Implementirani stupci:

- `id`
- `catalog_id`
- `schema_version`
- `rule_id`
- `profile_id`
- `label`
- `feature`
- `applies_to_variant`
- `expression`
- `result`
- `status`
- `payload`
- `created_at`

### `catalog.product_kit_mapping`

Svrha: mapirati product i technology profile na required part jobs.

Implementirani stupci:

- `id`
- `product_code`
- `technology_profile`
- `part_code`
- `part_sequence`
- `required`
- `kit_version`
- `status`
- `created_at`

Prvi seed:

- `product_code`: `PPV`
- `technology_profile`: `OPS_S4P4`
- `kit_version`: `PPV_OPS_S4P4_v0`
- parts: `KSKR`, `LBRA`, `OBRA`, `OBRIT`, `OSPY`, `OMET`, `LBRIT`,
  `LHOR`, `LMET`, `SBRA`, `SBRIT`, `SHOR`

### `dcm.mother_artifact_registry`

Svrha: DBR-facing registry approved Mother DXF artefakata.

Implementirani stupci:

- `id`
- `product_code`
- `part_code`
- `technology_profile`
- `mother_session_id`
- `artifact_path`
- `artifact_hash`
- `approval_status`
- `approved_at`
- `approved_by`
- `document_sem`
- `metadata_summary`
- `created_at`

`mother_session_id` je privremeni bridge prema file-based session storageu.
DDL sadrži TODO komentar:

`TODO: migrate to dcm session id when file-based storage is replaced`

### `dbr.dbr_production_order`

Svrha: interni DBR snapshot production ordera.

Gosoft ostaje source of truth. Ova tablica čuva samo Gosoft ID/key hint i
frozen audit `parameter_snapshot`, ne kopiju ERP sadržaja.

Implementirani stupci:

- `id`
- `gosoft_dn_id`
- `gosoft_dn_key`
- `parameter_snapshot`
- `status`
- `created_at`
- `updated_at`

### `dbr.dbr_kit_batch`

Svrha: jedan production batch za jedan product kit.

Implementirani stupci:

- `id`
- `production_order_id`
- `batch_key`
- `product_code`
- `technology_profile`
- `kit_version`
- `status`
- `started_at`
- `finished_at`
- `summary`

### `dbr.dbr_part_job`

Svrha: execution state za jedan part unutar jednog kit batcha.

Implementirani stupci:

- `id`
- `kit_batch_id`
- `part_code`
- `part_sequence`
- `mother_artifact_id`
- `parameter_snapshot`
- `child_artifact_path`
- `child_artifact_hash`
- `status`
- `generation_summary`
- `warnings`
- `errors`
- `started_at`
- `finished_at`
- `idempotency_key`

## Connection i Adapter Pattern

Koristiti postojeći Core Shell PostgreSQL foundation:

- config: `src/core_shell/config/db_config.js`
- pool: `src/core_shell/db/client/postgres_pool.js`
- query helper: `src/core_shell/db/helpers/query.js`
- migration runner: `src/core_shell/db/helpers/migration_runner.js`

Moduli ne smiju kreirati vlastite low-level PostgreSQL cliente.

Preferirani prvi services:

- `src/core_shell/services/catalog_db_service.js`
- `src/core_shell/services/dbr_db_service.js`

DBR module code treba pozivati Core Shell DB services, ne direktno `pg`.

## Migration i Seed Plan

Prve migrations:

- `src/core_shell/migrations/catalog/001_create_catalog_foundation.up.sql`
- `src/core_shell/migrations/catalog/001_create_catalog_foundation.down.sql`
- `src/core_shell/migrations/dcm/001_create_dcm_foundation.up.sql`
- `src/core_shell/migrations/dcm/001_create_dcm_foundation.down.sql`
- `src/core_shell/migrations/dbr/001_create_dbr_foundation.up.sql`
- `src/core_shell/migrations/dbr/001_create_dbr_foundation.down.sql`

Prvi seed:

- učitati parameter catalog rows iz postojećeg Mother DXF parameter catalog
  JSON-a
- učitati rule catalog kao registry rows samo s `JSONB` payloadom
- seedati `PPV / OPS_S4P4` kit mapping s 12 poznatih part codeova

## Prvi DBR POC Execution Shape

Prvi DBR POC treba dokazati logistiku, ne resolver completeness.

POC flow:

1. Kreirati ili importati jedan PPV production order.
2. Zamrznuti jedan parameter snapshot.
3. Kreirati jedan kit batch.
4. Expandati kit batch u 12 part jobs.
5. Svaki part job povezati s approved Mother DXF artifact referencom.
6. Pozvati postojeći child generation kao black-box resolver.
7. Spremiti child artifact reference i generation summaries.
8. Proizvesti jedan execution report.

## Rizici Za Pratiti

- product-to-part mapping može biti nepotpun ili pogrešan
- approved Mother DXF artifact može nedostajati za required part
- Mother artifact može biti stale u odnosu na trenutni production intent
- ERP/configurator parameter names možda neće odgovarati Mother DXF metadata
  keyevima
- partial batch failure ne smije overwriteati uspješne jobs
- output artifact naming mora biti idempotent i traceable
- rule catalog semantika još nije stabilna
- PostgreSQL foundation ne smije slučajno migrirati Mother DXF session storage

## Sljedeći Implementacijski Korak

Sljedeći chat treba nastaviti od implementiranog PostgreSQL foundationa.

Najprije provjeriti DB connectivity i seed izvršenje:

- potvrditi `BI_DB_ENV_FILE` / `BI_DB_*` konfiguraciju
- pokrenuti postojeći PostgreSQL smoke ako treba
- pokrenuti `node src/core_shell/db/seeds/003_dbr_catalog_seed.js`
- provjeriti da su `catalog`, `dcm` i `dbr` schemas nastale
- provjeriti da `catalog.product_kit_mapping` sadrži `PPV / OPS_S4P4` kit

Nakon toga implementirati samo DBR module skeleton:

- DBR module manifest/skeleton
- minimal smoke script
- minimalni batch POC koji još ne implementira resolver internals

Ne implementirati resolver internals u prvom DBR skeletonu.
