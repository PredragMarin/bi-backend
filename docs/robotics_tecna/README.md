# Robotics Tecna Dummy Smoke

Ovo je izolirani pilot za prvi robot use case: `Robot Tecna` za tockasto elektrootporno zavarivanje strukture vratnog krila.

Scope ove faze:

- ne uvodi jos storage boundary za module
- ne uvodi finalnu robotics schemu
- koristi mali relational envelope i `JSONB` payload
- sluzi samo za DB-native dummy outbound/inbound roundtrip
- payload template datoteke su u `fixtures/robotics_tecna/*`

## DB Objects

Up migracija kreira:

- `robotics.robot_jobs`
- `robotics.robot_results`

Tablice su namjerno uske:

- stabilni envelope stupci za identitet i status
- `request_payload JSONB` za outbound Tecna job
- `result_payload JSONB` za inbound Tecna execution report

## Dummy Tecna Payload Intent

Outbound request nosi:

- identitet joba
- `robotCode = TECNA_01`
- `jobType = tecna_spot_weld`
- referencu proizvoda/RN
- ulazne parametre `vVis`, `vSir`, `vTip`
- program selection i process targete
- trace meta podatke za request

Inbound result nosi:

- referencu na job i proizvod
- trajanje izvodenja
- broj tocaka
- prosjecnu struju i silu
- start/end timestamp
- operator ID
- failure summary
- quality summary i execution context

JSONB sample datoteke:

- `fixtures/robotics_tecna/job_request.sample.json`
- `fixtures/robotics_tecna/result_report.sample.json`

## Execution

Ako koristis vanjski secret file:

```powershell
$env:BI_DB_ENV_FILE="C:\Users\Marin\.secrets\bi-backend-postgres.env"
npm run db:robotics:tecna:smoke
```

To:

1. provjerava `SELECT 1`
2. pokrece robotics migraciju
3. inserta dummy Tecna job
4. inserta dummy Tecna execution result
5. radi join readback
6. brise inserted job red

Za rollback cijele dummy sheme:

```powershell
$env:BI_DB_ENV_FILE="C:\Users\Marin\.secrets\bi-backend-postgres.env"
npm run db:robotics:tecna:cleanup
```

## Browser/API Sandbox

Default runtime je `3000`:

```powershell
$env:BI_DB_ENV_FILE="C:\Users\Marin\.secrets\bi-backend-postgres.env"
node src/api/server.js
```

Browser UI:

- `http://127.0.0.1:3000/ui/robotics-tecna`

Ako zelis paralelnu instancu bez diranja glavnog porta, opcionalno digni server na `3001`:

```powershell
$env:PORT="3001"
$env:BI_DB_ENV_FILE="C:\Users\Marin\.secrets\bi-backend-postgres.env"
node src/api/server.js
```

API rute:

- `POST /api/robotics/v1/tecna/bootstrap`
- `GET /api/robotics/v1/tecna/jobs`
- `POST /api/robotics/v1/tecna/jobs`
- `GET /api/robotics/v1/tecna/jobs/:jobKey`
- `POST /api/robotics/v1/tecna/jobs/:jobKey/result`

Potvrden testni krug:

1. bootstrap sandbox
2. create job
3. create result
4. readback detail

## Boundary Impact

- `core_shell`: samo migration i DB smoke tooling
- `modules`: bez promjena
- `api`: bez promjena

## Rollback Note

Ako ovaj pilot zelis ukloniti:

1. pokreni cleanup varijantu
2. ukloni `src/core_shell/migrations/robotics/*`
3. ukloni `scripts/robotics_tecna_smoke_test.js`
4. ukloni `docs/robotics_tecna/README.md`
