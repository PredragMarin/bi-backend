# PROEL Tecna Sandbox Framework

## Purpose

Ovaj dokument daje privremeni integracijski framework za PROEL kao sistem integratora za prvi robot `Robot Tecna`.

Scope ovog dokumenta je iskljucivo sandbox i pilot faza:

- PostgreSQL sandbox pristup
- testni outbound/inbound tokovi
- `JSONB` payload model dok produkcijska schema jos nije zamrznuta
- osnovne upute za instalaciju i povezivanje
- sigurnosne i operativne napomene

Ovo nije finalni production contract. Produkcijska schema, tablice i detaljna poslovna semantika bit ce definirane u sljedecoj fazi nakon shop-floor validacije.

## Integration Context

`Robot Tecna` sluzi za tockasto elektrootporno zavarivanje strukture vratnog krila. U ovoj fazi robotske integracija se tretira kao DB-native sandbox pilot s dva osnovna zapisa:

- outbound robot job request
- inbound robot execution result

Pilot koristi:

- PostgreSQL 16+
- schema `robotics`
- envelope tablice `robotics.robot_jobs` i `robotics.robot_results`
- `JSONB` payload polja za fleksibilan sandbox exchange format

## Current Sandbox DB Coordinates

PROEL ce za sandbox dobiti PostgreSQL pristup na sljedece koordinate:

- Host: `192.168.100.158`
- Port: `5432`
- Database: `bi_baza`
- Schema: `robotics`
- Outbound table: `robotics.robot_jobs`
- Inbound table: `robotics.robot_results`
- Username: `marin`
- Password: isporucuje se zasebnim sigurnim kanalom

Napomena:

- Lozinka se ne smije hardkodirati u aplikaciji, skriptama ili dokumentaciji.
- Preporuka je koristiti environment varijable ili secure secret storage na PROEL strani.

## Network and Security Model

Pristup sandboxu nije zamisljen kao otvoreni javni DB endpoint.

Planirani sigurnosni model:

- PROEL ce dobiti VPN pristup
- pristup ce biti ogranicen na dedicirani i sigurni segment unutar naseg VLAN sloja
- detaljne VPN i network upute dostavit ce naknadno nas IT inzenjer
- DB credentiali dostavljaju se odvojeno od ovog dokumenta

Za sada PROEL treba racunati da su potrebni:

- validni DB credentiali
- odobren mrežni pristup prema sandbox PostgreSQL instanci
- pridrzavanje nacela najmanjih ovlasti

## Sandbox Scope Boundary

Ovaj sandbox je namjerno uzak:

- nema finalnog production scheduler modela
- nema finalnog production auth/workflow modela
- nema jos zamrznutih produkcijskih tablica za robotiku
- nema jos finalne relacijske podjele svih Tecna parametara u stupce

Namjena sandboxa:

- potvrditi outbound/inbound razmjenu
- potvrditi `JSONB` payload shape
- potvrditi operativni redoslijed rada
- potvrditi da PROEL i BI-backend mogu raditi preko zajednickog DB sandbox sloja

## Current Sandbox Tables

### `robotics.robot_jobs`

Namjena:

- zapis outbound job requesta za robot

Trenutni envelope stupci:

- `id BIGSERIAL PRIMARY KEY`
- `job_key TEXT UNIQUE NOT NULL`
- `robot_code TEXT NOT NULL`
- `job_type TEXT NOT NULL`
- `status TEXT NOT NULL`
- `external_product_ref TEXT NOT NULL`
- `request_payload JSONB NOT NULL`
- `requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`

### `robotics.robot_results`

Namjena:

- zapis inbound execution resulta za prethodno otvoreni job

Trenutni envelope stupci:

- `id BIGSERIAL PRIMARY KEY`
- `job_id BIGINT NOT NULL REFERENCES robotics.robot_jobs(id) ON DELETE CASCADE`
- `result_key TEXT UNIQUE NOT NULL`
- `status TEXT NOT NULL`
- `operator_id TEXT NOT NULL`
- `started_at TIMESTAMPTZ NOT NULL`
- `finished_at TIMESTAMPTZ NOT NULL`
- `result_payload JSONB NOT NULL`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- `UNIQUE (job_id)`

## Integration Pattern

Sandbox pattern je trenutno:

1. BI-backend ili operator kreira outbound job u `robotics.robot_jobs`
2. PROEL/robotics integracija cita pending/queued job
3. robot izvrsava posao
4. PROEL/integracija upisuje inbound result u `robotics.robot_results`
5. job i result se povezuju preko `job_id` i poslovno preko `job_key`

U ovoj fazi nema jos finalnog message broker modela ni finalnog state machine workflowa. Fokus je na jednostavnom DB roundtrip sandboxu.

## Recommended Status Values

Za sandbox v0 preporucuju se sljedeci statusi:

Job status:

- `queued`
- `ready`
- `in_progress`
- `completed`
- `failed`
- `interrupted`

Result status:

- `completed`
- `failed`
- `interrupted`

Ako PROEL interno koristi dodatne statuse, neka ih za sada mapira na gornji set ili ih drzi unutar `JSONB` payloada.

## Tecna Sandbox Payload Model

## Outbound Job Request JSONB

Trenutni sample format:

```json
{
  "schemaVersion": "robotics.tecna.job-request.v1",
  "jobIdentity": {
    "jobKey": "tecna_ui_1774365867367_261216",
    "jobType": "tecna_spot_weld",
    "robotCode": "TECNA_01",
    "sourceSystem": "bi_backend",
    "sourceModule": "robotics_tecna_smoke"
  },
  "productionContext": {
    "workOrderRef": "RN-TECNA-3000-001",
    "productRef": "KRILO-TECNA-3000-001",
    "productFamily": "protuprovalna_vrata",
    "routingOperationCode": "SPOT_WELD_FRAME"
  },
  "doorSpec": {
    "vVis": 2080,
    "vSir": 990,
    "vTip": "pp_main_port",
    "sheetSetCode": "FRAME_STD_A"
  },
  "programSelection": {
    "programCode": "TECNA_FRAME_V1",
    "algorithmMode": "parametric_group_shift",
    "revision": "demo-r1"
  },
  "processTargets": {
    "expectedSpotCount": 112,
    "targetCurrentKa": 11.8,
    "targetForceKn": 2.5,
    "cycleProfile": "standard_frame_cycle"
  },
  "trace": {
    "requestedByUserId": "smoke_test",
    "requestedAt": "2026-03-24T15:24:27.367Z",
    "comment": "Dummy outbound payload for Tecna DB smoke pilot."
  }
}
```

### Meaning of Outbound Fields

`jobIdentity`

- jedinstveni identitet joba
- `jobKey` se koristi kao poslovna referenca kroz cijeli tok

`productionContext`

- poslovna referenca na RN/proizvod
- u sandboxu sluzi za povezivanje robot joba s proizvodnim kontekstom

`doorSpec`

- ulazni parametri koje Tecna algoritam koristi
- u ovoj fazi kljucni parametri su:
  - `vVis`
  - `vSir`
  - `vTip`

`programSelection`

- identifikacija programa i algoritamske varijante

`processTargets`

- ocekivane procesne ciljne vrijednosti
- u sandboxu sluze za validaciju shapea payload-a, ne kao finalni production contract

`trace`

- operator/sustav koji je kreirao zahtjev
- timestamp i komentar

## Inbound Result Report JSONB

Trenutni sample format:

```json
{
  "schemaVersion": "robotics.tecna.result-report.v1",
  "status": "completed",
  "jobIdentity": {
    "jobKey": "tecna_ui_1774365867367_261216",
    "resultKey": "tecna_ui_1774365867367_261216_result_1774365867389",
    "jobType": "tecna_spot_weld",
    "robotCode": "TECNA_01"
  },
  "executionContext": {
    "workOrderRef": "RN-TECNA-3000-001",
    "productRef": "KRILO-TECNA-3000-001",
    "operatorId": "OP-3000-01",
    "executionMode": "automatic"
  },
  "executionWindow": {
    "startedAt": "2026-03-24T15:19:27.389Z",
    "finishedAt": "2026-03-24T15:24:27.389Z",
    "executionSeconds": 360
  },
  "processSummary": {
    "executedSpotCount": 121,
    "avgCurrentKa": 11.8,
    "avgForceKn": 2.55,
    "programInterrupted": false
  },
  "qualitySummary": {
    "missedCurrentPointCount": 0,
    "missedForcePointCount": 0,
    "warningCodes": [],
    "failureCode": ""
  },
  "trace": {
    "reportedAt": "2026-03-24T15:24:27.389Z",
    "comment": "Dummy inbound payload for Tecna DB smoke pilot."
  }
}
```

### Meaning of Inbound Fields

`status`

- sandbox execution outcome

`jobIdentity`

- poveznica na outbound job
- `jobKey` mora odgovarati prethodno otvorenom jobu

`executionContext`

- operator, proizvod i osnovni execution mode

`executionWindow`

- vrijeme pocetka i zavrsetka
- trajanje izvodenja

`processSummary`

- agregirani procesni rezultat
- broj tocaka
- prosjecna struja
- prosjecna sila
- indikator prekida programa

`qualitySummary`

- sandbox mjesto za quality/failure signalizaciju

## Sample Failure Payload

Za neuspjesni ili prekinuti Tecna run preporucuje se sljedeci sandbox shape:

```json
{
  "schemaVersion": "robotics.tecna.result-report.v1",
  "status": "interrupted",
  "jobIdentity": {
    "jobKey": "tecna_ui_demo_failed_001",
    "resultKey": "tecna_ui_demo_failed_001_result_001",
    "jobType": "tecna_spot_weld",
    "robotCode": "TECNA_01"
  },
  "executionContext": {
    "workOrderRef": "RN-TECNA-FAIL-001",
    "productRef": "KRILO-TECNA-FAIL-001",
    "operatorId": "OP-TECNA-02",
    "executionMode": "automatic"
  },
  "executionWindow": {
    "startedAt": "2026-03-24T16:00:00Z",
    "finishedAt": "2026-03-24T16:03:10Z",
    "executionSeconds": 190
  },
  "processSummary": {
    "executedSpotCount": 47,
    "avgCurrentKa": 10.9,
    "avgForceKn": 2.1,
    "programInterrupted": true
  },
  "qualitySummary": {
    "missedCurrentPointCount": 6,
    "missedForcePointCount": 3,
    "warningCodes": ["LOW_CURRENT_CLUSTER", "FORCE_DROP_ZONE_B"],
    "failureCode": "PROGRAM_INTERRUPTED"
  },
  "trace": {
    "reportedAt": "2026-03-24T16:03:10Z",
    "comment": "Sandbox interrupted execution report."
  }
}
```

## Expected SQL Access Pattern

PROEL za sada treba koristiti iskljucivo parametrizirane SQL upite.

### Read pending jobs

Primjer:

```sql
SELECT
  id,
  job_key,
  robot_code,
  job_type,
  status,
  external_product_ref,
  request_payload,
  requested_at,
  created_at,
  updated_at
FROM robotics.robot_jobs
WHERE robot_code = $1
  AND status IN ($2, $3)
ORDER BY created_at ASC;
```

Preporucene vrijednosti:

- `$1 = 'TECNA_01'`
- `$2 = 'queued'`
- `$3 = 'ready'`

### Insert execution result

Primjer:

```sql
INSERT INTO robotics.robot_results (
  job_id,
  result_key,
  status,
  operator_id,
  started_at,
  finished_at,
  result_payload
)
VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb);
```

### Update job status

Primjer:

```sql
UPDATE robotics.robot_jobs
SET status = $1,
    updated_at = NOW()
WHERE id = $2;
```

## Recommended PROEL Installation/Setup Steps

### 1. Local prerequisites on PROEL side

Preporuceni alati:

- PostgreSQL client library po izboru PROEL tima
- `pgAdmin 4` ili drugi DB client za ručni pregled
- opcionalno `psql` za command-line testove

Preporuceni sigurni config model:

- host/port/db/user u config datoteci ili env varijablama
- password u secure secret storage ili env varijabli
- bez hardkodiranja credentiala u source code

### 2. Connectivity validation

Nakon dostave network pristupa i credentiala:

1. potvrditi da se moze otvoriti TCP konekcija prema `192.168.100.158:5432`
2. potvrditi login na `bi_baza`
3. pokrenuti:

```sql
SELECT 1;
```

4. potvrditi da postoje:

```sql
SELECT schema_name
FROM information_schema.schemata
WHERE schema_name = 'robotics';
```

### 3. Table visibility check

```sql
SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_schema = 'robotics'
ORDER BY table_name;
```

Ocekivano:

- `robot_jobs`
- `robot_results`

### 4. Read sandbox jobs

PROEL zatim treba moci citati `robotics.robot_jobs` i parsirati `request_payload`.

### 5. Write sandbox result

Nakon simulirane ili stvarne obrade, PROEL treba moci upisati `robotics.robot_results` record i azurirati `robot_jobs.status`.

## Minimal End-to-End Sandbox Test

PROEL sandbox acceptance test je uspjesan ako sljedece prodje:

1. DB konekcija uspjesna
2. `SELECT 1` uspjesan
3. moguce procitati barem jedan `TECNA_01` job
4. moguce parsirati outbound `JSONB` payload
5. moguce upisati inbound result `JSONB`
6. moguce azurirati status joba
7. moguce ponovno procitati povezani `job` + `result`

## pgAdmin Manual Check

Ako PROEL koristi `pgAdmin 4`, rucna saved connection treba imati:

- Name: `BI PostgreSQL`
- Host: `192.168.100.158`
- Port: `5432`
- Maintenance database: `bi_baza`
- Username: `marin`
- Password: dostavlja se sigurnim kanalom

Rucne provjere:

```sql
SELECT 1;

SELECT *
FROM robotics.robot_jobs
ORDER BY created_at DESC
LIMIT 20;

SELECT *
FROM robotics.robot_results
ORDER BY created_at DESC
LIMIT 20;
```

## API/UI Sandbox Availability

Pored direktnog DB pristupa postoji i interni browser/API sandbox na BI-backend strani za demonstraciju i testiranje:

- UI: `http://localhost:3000/ui/robotics-tecna`
- API base: `/api/robotics/v1/tecna`

Napomena:

- ovaj UI/API nije primarni integracijski kanal za PROEL
- sluzi kao demonstracijski i testni alat na BI-backend strani

## Rules for PROEL During Sandbox Phase

PROEL treba u ovoj fazi pratiti sljedeca pravila:

- koristiti samo sandbox `robotics` objekte koji su ovdje navedeni
- ne uvoditi vlastite nekontrolirane tablice u `bi_baza`
- ne oslanjati se na finalnost ovog `JSONB` modela
- sve SQL operacije raditi parametrizirano
- sve promjene statusa i failure signalizacije drzati konzistentno izmedu envelope stupaca i `JSONB` payloada

## Known Temporary Limitations

Ova faza ima namjerne privremene nedostatke:

- `JSONB` payload jos nije finalni production contract
- neka polja ce se kasnije preseliti iz `JSONB` u stvarne stupce
- finalni scheduler semantics jos nisu definirani
- finalni security/access model jos nije zamrznut
- finalna produkcijska schema za robotiku jos nije odobrena

## Next Planned Evolution

Planirana evolucija ide ovim redom:

1. sandbox `JSONB` exchange
2. realniji Tecna business payload v1
3. shop-floor validation
4. stabilizacija semantike
5. izdvajanje stabilnih polja u relacijske stupce
6. produkcijski robotics schema i contract freeze

## Contact and Coordination

Za VPN i network pristup:

- naknadne upute dostavlja nas IT inzenjer

Za DB credentiale:

- password se dostavlja odvojenim sigurnim kanalom

Za semantiku Tecna payload-a i proizvodni kontekst:

- koordinacija s BI-backend timom i proizvodnim vlasnikom procesa

## Document Status

- Status: `Sandbox v0`
- Audience: `PROEL system integrator`
- Domain: `Robot Tecna`
- Contract maturity: `temporary / pre-production`
