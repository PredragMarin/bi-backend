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
- dugoročno preuzima daily production run lifecycle koji je ranije bio pokriven
  improviziranim DXF OPS/Zoran flowom

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
- Gosoft ostaje source of truth za DN/POTREBA podatke
- BI PostgreSQL ne klonira Gosoft DN/POTREBA tablice

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

#### Parameter Abbreviation Placeholder

Trenutni canonical keyevi ostaju dugi configurator/domain nazivi, npr.:

- `KONF_ID`
- `MODEL_VRATA`
- `TIP_VRATA` (legacy alias modela)
- `VISINA_VRATA`, `VISINA_EFF`
- `SIRINA_VRATA`
- `STRANA_OTVARANJA`
- `BOJA_DOVRATNIKA`
- `BOJA_METALNIH_DRZACA_PANELA`
- `VANJSKI_PANEL`
- `UNUTARNJI_PANEL`
- `VANJSKE_UKRASNE_LETVE`
- `UNUTARNJE_UKRASNE_LETVE`
- `ELEKTROPRIHVATNIK`
- `HIDRAULICKI_ZATVARAC`

Ovi nazivi se već pojavljuju u payloadima za postojeći DXF OPS/Zoran flow i
trebaju ostati canonical dok se ne definira stabilna abbreviation policy.

Placeholder za buduću migraciju:

- `parameter_abbrev`
- `aliases_json`
- `external_payload_keys_json`
- `display_group`

Pravilo do tada:

- DBR `parameter_snapshot` smije čuvati dugi canonical key
- DBR ne smije renameati configurator key samo zbog kraćeg naziva
- abbreviation se smije koristiti samo kao dodatni alias/display hint
- canonical `parameter_key` mora ostati join point između catalog, payloada i
  resolvera

Primjer buduće alias semantike:

```json
{
  "parameter_key": "VISINA_VRATA",
  "parameter_abbrev": "H",
  "aliases_json": ["door_height", "height_mm"],
  "external_payload_keys_json": ["VISINA_VRATA"]
}
```

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

## Daily Import Direction v0

Trenutni DBR UI/API `Create Order` je ručni skeleton:

```text
1 DBR order -> 1 kit batch -> 12 part jobs
```

To nije konačni dnevni production workflow.

Stvarni operativni cilj je:

```text
paste N SIFRADN/RN vrijednosti
-> fetch N Gosoft DN redova kroz ERP allowlist
-> kreirati N DBR production orders
-> kreirati N kit batcheva
-> expandati svaki batch u 12 part jobova za PPV/OPS_S4P4
```

Primjer:

```text
20 SIFRADN -> 20 orders -> 20 batches -> 240 part jobs
```

### Postojeći DXF OPS/Zoran Flow Kao Referenca

Repo sadrži postojeći flow koji pokazuje korisno ponašanje:

- `src/modules/dxf_ops_host_v1/adapters/db_fetch_dxf_ops_host.js`
- `src/modules/gosoft_request_module_v1/runtime.js`
- `src/modules/gosoft_request_module_v1/request_templates/dxf_manipulation_smoke_request.json`
- `scripts/dxf_ops_host_smoke.js`

Ti fileovi su migracijska referenca, ne dugoročna DBR dependency.

Važno pravilo:

- DBR ne smije dugoročno ovisiti o `dxf_ops_host_v1`
- DBR ne smije postati wrapper oko starog DXF OPS/Zoran modula
- korisna ponašanja se portaju u čisti DBR import layer
- stari flow ostaje referenca za parser/gate/payload semantiku dok se ne ugasi

### Čisti DBR Import Layer

Predloženi novi DBR import sloj:

```text
src/modules/dbr_v1/domain/sifradn_import_parser.js
src/modules/dbr_v1/domain/production_order_mapper.js
src/modules/dbr_v1/adapters/erp_fetch_dbr_orders.js
src/modules/dbr_v1/contracts/dbr_sifradn_import_contract_v0.json
```

Parser treba pokriti:

- multiline paste input
- optional header `RN` ili `SIFRADN`
- trim/uppercase normalization
- duplicate removal
- invalid line warnings
- max item limit

ERP adapter treba:

- koristiti `src/core_shell/services/erp_fetch_service.js`
- koristiti allowlisted query `V_DN_BY_SIFRADN`
- ne pisati u Gosoft
- ne čitati iz PostgreSQL `gosoft_bridge` sheme jer ona ne postoji u ovoj fazi

Mapper treba:

- mapirati Gosoft DN row u DBR frozen `parameter_snapshot`
- koristiti `gosoft_dn_id` kao reference hint
- koristiti `sifradn`/RN kao `gosoft_dn_key`
- zadržati Gosoft/configurator payload kao frozen audit snapshot
- ne klonirati DN/POTREBA tablice u BI PostgreSQL

Minimalni API smjer za sljedeću fazu:

```text
POST /api/dbr/v1/import/sifradn-list
```

Predloženi body:

```json
{
  "sifradnPaste": "26T16V50\n26T16V51",
  "productCode": "PPV",
  "technologyProfile": "OPS_S4P4",
  "dryRun": true
}
```

Prvi implementation mode treba biti `dryRun=true` preview bez DB writea.
Tek nakon validiranog previewa omogućiti import koji piše DBR orders/batches/jobs.

### Import Gateovi

Gateovi za prvi import v0, portani kao DBR-owned rules:

- SIFRADN/RN not found
- SIFRADN/RN not unique
- status mora zadovoljiti production gate, inicijalno `LA`
- status `KO` je forbidden
- količina mora biti podržana; inicijalni POC može zahtijevati `kolicina=1`
- configurator/opombe payload mora biti parsabilan ako je potreban za snapshot
- count gate mora potvrditi `orders = ready source rows`

Svaki blocked item mora u responseu nositi warning/error s originalnim SIFRADN/RN.

### Batch Semantics

DBR production batch nije jedan dnevni run u ovom DDL-u.

Trenutno:

```text
dbr.dbr_production_order = jedan source DN/order snapshot
dbr.dbr_kit_batch = jedan kit za jedan production order
dbr.dbr_part_job = jedan required part unutar kit batcha
```

Dnevni run je u v0 izvedeni envelope/report iz više production ordera i batcheva.
Ako kasnije treba durable daily-run header, dodaje se nova DBR migracija, npr.
`dbr.dbr_daily_run`, a postojeći `dbr_kit_batch` ostaje per-order/per-kit.

## Rizici Za Pratiti

- product-to-part mapping može biti nepotpun ili pogrešan
- approved Mother DXF artifact može nedostajati za required part
- Mother artifact može biti stale u odnosu na trenutni production intent
- ERP/configurator parameter names možda neće odgovarati Mother DXF metadata
  keyevima
- abbreviation policy za configurator parametre ne smije razbiti canonical keys
- partial batch failure ne smije overwriteati uspješne jobs
- output artifact naming mora biti idempotent i traceable
- rule catalog semantika još nije stabilna
- PostgreSQL foundation ne smije slučajno migrirati Mother DXF session storage
- DBR import ne smije ostati direktno vezan za `dxf_ops_host_v1`

## Sljedeći Implementacijski Korak

Foundation, DBR API v0 i DBR Operator Cockpit v0 su implementirani i smoke
provjereni.

Sljedeći čisti implementacijski korak:

- definirati `dbr_sifradn_import_contract_v0.json`
- implementirati DBR-owned SIFRADN/RN parser
- implementirati DBR ERP fetch adapter kroz `erp_fetch_service.js`
- implementirati production order mapper za frozen snapshot
- dodati `POST /api/dbr/v1/import/sifradn-list` prvo kao `dryRun` preview
- zatim dodati import mode koji kreira N orders, N batches i N*12 jobs

Ne implementirati resolver internals dok import contract i artifact selection
policy nisu odvojeno definirani.
