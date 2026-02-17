# MES-ASIST Architecture v1

## 1. Context
`MES-asist` je modul unutar BI core shell-a za near-real-time obradu MES signala iz ERP/GOSOFT view-a `V_FEEDBACK`, s ciljem pokretanja operativnih akcija (SMS, andon, eskalacija, servisne reakcije).

Primarni principi:
- inkrementalni polling (watchdog ritam 10-30s),
- kanonski event model (odvojen od sirove strukture `V_FEEDBACK`),
- pravila i procesna logika izvan koda (versioned rules),
- idempotentna i auditabilna obrada.

## 2. Module Boundaries

U opsegu modula:
- dohvat i normalizacija `V_FEEDBACK` zapisa,
- klasifikacija događaja i kreiranje incidenta,
- orchestration akcija (SMS/file drop, status tracking),
- ingest povratnih SMS događaja (NDJSON),
- stanje, watermark, dedup i heartbeat.

Izvan opsega modula:
- UI za operativne timove,
- duboka ERP transakcijska korekcija,
- fizička kontrola strojeva (andon izvršenje je integracijski izlaz/hook).

## 3. Components

1. `watchdog`
- periodički scheduler tick-a,
- health/heartbeat signal,
- single-runner zaštita (lock).

2. `fetch adapter`
- zajednički SQL fetch sloj (`core/sql/shared_fetch`),
- inkrementalni upit nad `V_FEEDBACK` (watermark po `ts` + tie-breaker ID).

3. `mapper / normalizer`
- mapira 50+ sirovih kolona u kanonski event model,
- validira obavezna polja i tipove,
- zadržava raw payload za audit.

4. `incident engine`
- klasificira event kroz rules DSL,
- određuje severity, prioritet, action profile i SLA,
- vodi lifecycle incidenta.

5. `action router`
- generira akcije po pravilima (SMS, andon, servis, voditelj, logistika),
- upravlja eskalacijama i timeout-ima.

6. `SMS I/O adapters`
- outbox JSON file drop prema SMS gatewayu,
- inbox NDJSON reader za status i reply događaje.

7. `state store`
- watermark, dedup index, incident state, inbox offset,
- audit trail događaja i odluka.

## 4. Layer Responsibilities

`Core layer`:
- runtime integracija, shared SQL i shared ledger infrastruktura.

`Module layer (mes_asist_v1)`:
- domena (mapper, rules, lifecycle, routing, SMS profile).

`Integration layer`:
- file drop, NDJSON ingestion, vanjski gateway ugovori.

`Operations layer`:
- heartbeat, metrike, alarm pragovi, replay i recovery.

## 5. Data Flow (High Level)

1. Watchdog tick.
2. Inkrementalni fetch novih `V_FEEDBACK` zapisa.
3. Mapping u canonical event + validacija.
4. Rule evaluation i incident lifecycle update.
5. Kreiranje akcija i SMS outbox JSON drop (ako treba).
6. Čitanje SMS inbox NDJSON i korelacija po `sms_key/correlation_id`.
7. Update incident/action state.
8. Persist state + heartbeat + metrics.

## 6. Non-Functional Architecture Targets

- Throughput: stabilan rad pri burst-ovima događaja iz proizvodnje.
- Latency: reakcija u sekundama (tipično < 30s od eventa do akcije).
- Reliability: at-least-once ingest, effectively-once izlaz kroz dedup.
- Traceability: puni audit od raw eventa do zatvaranja incidenta.
- Evolvability: promjena pravila bez promjene jezgre.

## 7. Suggested Repo Placement

- `src/modules/mes_asist_v1/*` za domensku logiku.
- `src/core/sql/shared_fetch.js` za zajednički SQL pristup.
- `src/core/watchdog/*` za heartbeat i scheduler pomoćne funkcije.
- `out/mes_asist/*` za runtime state i operativne artefakte.

