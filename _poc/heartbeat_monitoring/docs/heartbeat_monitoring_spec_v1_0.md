# Heartbeat Monitoring stabilnosti veze (Control 192.168.100.18 <-> Remote 192.168.100.93)

Status: Draft za arhivu  
Namjena: POC validacija dostupnosti, latencije, jittera i prekida linka; kasnija moguca integracija u BI Core Shell.  
Opseg: Bez kodiranja; funkcionalni, operativni i podatkovni okvir.

## 1. Cilj i Scope
### 1.1 Cilj
Uspostaviti pouzdan sustav koji mjeri:
1. dostupnost endpointa,
2. kvalitetu odziva (latency/jitter),
3. kontinuitet OK/NOK perioda,
4. uzroke degradacije veze.

### 1.2 Scope (POC)
1. Remote endpoint na `192.168.100.93`.
2. Kontrolni agent na `192.168.100.18`.
3. Primarni NDJSON event log.
4. Analitika i sekundarni timeline output.
5. Operativni rezim za vise-dnevni rad.

### 1.3 Out of scope (POC)
1. Alarming/notification platform.
2. Graficki dashboard.
3. Produkcijski HA cluster.

## 2. Arhitektura (logicka)
1. **Remote Endpoint Module (PC A: 192.168.100.93)**: izlaze HTTP `/heartbeat` i vraca standardiziran odgovor.
2. **Heartbeat Collector Module (PC B: 192.168.100.18)**: svakih 5s salje request, mjeri i logira rezultat.
3. **Analytics Module (PC B)**: klasificira evente u OK/NOK prema pravilima i pragovima.
4. **Timeline Generator (PC B)**: kondenzira evente u kontinuirane periode i razloge prijelaza.
5. **Storage Layer (PC B)**: NDJSON primarni log + timeline artefakti + agregati.

## 3. Uloge hostova
### 3.1 PC A (Remote endpoint)
- IP: `192.168.100.93`
- Uloga: stabilna "tocka istine" za heartbeat.
- Endpoint: `GET /heartbeat` (ili `POST`, ali konzistentno kroz cijeli POC).

### 3.2 PC B (Control)
- IP: `192.168.100.18`
- Uloga: aktivno testiranje, logiranje, analiza, timeline.

## 4. Protokol i Contract
### 4.1 Request contract (Control -> Remote)
Obavezno:
1. `request_id` (UUID)
2. `seq_no` (int, monotono rastuci)
3. `sender_ip` (`192.168.100.18`)
4. `sent_ts` (ISO8601 UTC)
5. `timeout_ms` (int)
6. `interval_ms` (int)

Preporuceno:
1. `agent_version`
2. `test_run_id`

### 4.2 Response contract (Remote -> Control)
Obavezno:
1. `status = OK`
2. `server_ts` (ISO8601 UTC)

Preporuceno:
1. `receiver_ip` (`192.168.100.93`)
2. `uptime_sec`
3. `endpoint_version`
4. `host_id`

## 5. Primarni NDJSON event log (Control)
Svaki heartbeat zapis = jedan JSON red.

Obavezna polja:
1. `local_ts`
2. `request_id`
3. `seq_no`
4. `sender_ip`
5. `receiver_ip`
6. `status_class` (`OK | NOK`)
7. `status_code` (`OK | TIMEOUT | CONNECTION_REFUSED | HTTP_4XX | HTTP_5XX | NETWORK_ERROR | LATENCY_HIGH`)
8. `latency_ms` (`null` ako nema odgovora)
9. `http_status` (`null` ako nema HTTP odgovora)
10. `remote_ts` (`null` ako nije primljen)
11. `timeout_ms`
12. `interval_ms`

Preporuceno:
1. `error_message`
2. `jitter_ms` (rolling)
3. `test_run_id`
4. `agent_version`

## 6. Pravila klasifikacije (Analytics)
### 6.1 Bazna pravila
1. `OK` ako je odgovor primljen i `latency_ms <= threshold_ms`.
2. `NOK` ako:
- nema odgovora (`TIMEOUT`, `NETWORK_ERROR`, ...),
- HTTP greska,
- ili `latency_ms > threshold_ms` (`LATENCY_HIGH`).

Napomena: kod `LATENCY_HIGH`, `http_status` ostaje stvarni HTTP status (npr. `200`), a `status_class=NOK`.

### 6.2 Anti-noise (hysteresis)
Preporuka:
1. Prijelaz `OK -> NOK` nakon `N` uzastopnih NOK (npr. `N=2`).
2. Prijelaz `NOK -> OK` nakon `M` uzastopnih OK (npr. `M=2`).

Ovo sprjecava "treperenje" statusa kod kratkih spikeova.

## 7. Timeline output contract
Svaki red predstavlja jedan kontinuirani period.

Polja:
1. `period_start_ts`
2. `period_end_ts`
3. `state` (`OK | NOK`)
4. `duration_sec`
5. `transition_reason` (npr. `latency_high`, `signal_timeout`, `http_error`, `signal_restored`)
6. `events_count`
7. `worst_latency_ms` (za OK periode)
8. `nok_primary_code` (za NOK periode)

Granice perioda:
- `period_start_ts`: timestamp prvog eventa u periodi.
- `period_end_ts`: timestamp zadnjeg eventa u periodi.

## 8. Agregati kvalitete (po runu i po danu)
Obavezni KPI:
1. `availability_pct`
2. `total_events`
3. `ok_events`
4. `nok_events`
5. `loss_pct`
6. `latency_p50_ms`
7. `latency_p95_ms`
8. `latency_p99_ms`
9. `latency_max_ms`
10. `jitter_p95_ms`

Definicije:
- Event-level dostupnost: `availability_pct = (ok_events / total_events) * 100`.
- Time-level dostupnost (preporuceno dodatno): `OK_duration / total_duration * 100`.
- `jitter_ms`: rolling `abs(latency_n - latency_(n-1))` za uzastopne valjane latencije.

## 9. Operativni okvir
### 9.1 Konfiguracija
1. `heartbeat_interval_sec` (default `5`)
2. `request_timeout_ms` (default `1500`)
3. `latency_threshold_ms` (default `50`)
4. `nok_consecutive_threshold` (default `2`)
5. `ok_recovery_threshold` (default `2`)

### 9.2 Pouzdanost
1. Agent radi kao servis (auto-restart).
2. Endpoint radi kao servis (auto-restart).
3. NTP sinkronizacija obavezna na oba hosta.

### 9.3 Log lifecycle
1. Rotacija logova dnevno (`heartbeat_YYYY_MM_DD.ndjson`).
2. Retention (npr. `30-90` dana za POC).
3. Zastita od neogranicenog rasta fajla.

## 10. Struktura direktorija (POC sandbox)
Na Control PC (`192.168.100.18`), izolirani root npr.:
`/poc/heartbeat_monitor/` (ili Windows ekvivalent)

1. `config/`
- `settings.json`
2. `logs/raw/`
- primarni NDJSON heartbeat logovi
3. `logs/timeline/`
- timeline output
4. `logs/aggregate/`
- KPI summary output
5. `state/`
- `run_state.json` (zadnji `seq_no`, runtime state)
6. `docs/`
- ova specifikacija i revizije

Restart/replay semantika:
- Nakon restarta agenta, `seq_no` se nastavlja iz `run_state.json`.
- `test_run_id` se rotira po runu (svaki start novog validacijskog ciklusa).

## 11. Test plan (POC validacija)
1. Normal run: `30-60` min bez prekida.
2. Timeout scenarij: simulirati prekid mreze `1-2` min.
3. High latency scenarij: umjetno opterecenje endpointa.
4. Endpoint error scenarij: namjerni HTTP `5xx`.
5. Recovery scenarij: povratak na normalu i potvrda timeline prijelaza.
6. Long run: `24h+` stabilnosti i rotacije loga.

## 12. Rizici i mitigacije
1. **Clock drift**
Mitigacija: NTP obavezan, periodicka provjera.
2. **False NOK zbog kratkog spika**
Mitigacija: hysteresis (`N/M` uzastopnih).
3. **Prevelik log**
Mitigacija: dnevna rotacija + retention.
4. **Nejasna dijagnostika**
Mitigacija: granularni `status_code` i `error_message`.
5. **Single point endpoint**
Mitigacija (kasnije): sekundarni endpoint za cross-check.

## 13. Kriteriji uspjeha POC-a
1. Konzistentan capture heartbeat dogadaja bez gubitka log zapisa.
2. Jasno odvojeni OK/NOK periodi s tocnim razlozima prijelaza.
3. KPI metrike dostupne po runu/danu.
4. Dokazano reproducibilna detekcija prekida i oporavka.
5. Spreman artefakt za kasniji prijenos u BI Core Shell.

## 14. Verzija i change log
- `v1.0 (POC arhiva)`: inicijalna konsolidirana specifikacija s contractom, analizom i operativnim pravilima.

## 15. Minimalni sigurnosni okvir (POC)
1. Opcionalni auth token za `/heartbeat` ako je mreza shared.
2. Allowlist izvora na remote strani: samo `192.168.100.18`.
