# Zajednički forenzički izvještaj - Heartbeat disruption (192.168.100.18 <-> 192.168.100.93)

Datum izvještaja: 2026-02-26  
Pripremio: BI POC forenzička analiza  
Promatrani glavni incident: 2026-02-25 oko 17:29 UTC (18:29 CET)

## 1. Executive Summary

1. Primarni uzrok glavnog prekida heartbeat capture-a je **planirani Windows restart na Control PC-u (192.168.100.18)**.
2. Na Remote PC-u (192.168.100.93) **nije nađen restart u incidentnom prozoru**, pa remote host nije uzrok tog konkretnog prekida.
3. U control NDJSON logu postoji velika rupa bez događaja (nema ni OK ni NOK), što pokazuje da je **collector proces bio nedostupan**, ne da je veza samo degradirala.
4. Nakon povratka collectora, link se odmah vraća u stabilan OK režim s vrlo niskim latencijama (2-8 ms), bez znakova trajne LAN degradacije.
5. Trenutna implementacija je osjetljiva na restart/gašenje jer procesi nisu service-managed i nemaju trajni process-level audit log.

## 2. Opseg i izvori dokaza

Control PC (192.168.100.18):
- `_poc/heartbeat_monitoring/control/logs/raw/heartbeat_2026_02_25.ndjson`
- `_poc/heartbeat_monitoring/control/logs/raw/heartbeat_2026_02_26.ndjson`
- `_poc/heartbeat_monitoring/control/state/run_state.json`
- Windows Event Log (`System`, `WindowsUpdateClient/Operational`)

Remote PC (192.168.100.93):
- Forenzički izvještaj dostavljen od korisnika (incident window + 365d pregled)
- Evidencija o update/restart događajima i runtime procesu `heartbeat_remote_server.js`

## 3. Rekonstrukcija događaja (timeline)

### 3.1 Incident timeline (UTC)

1. `2026-02-25T17:29:03.390Z` - zadnji heartbeat event prije prekida na control strani (seq_no=11504, status OK).
2. `2026-02-25T17:29:07Z` (≈) - Windows planirani restart iniciran na control PC-u (`Event ID 1074`, `MoUsoCoreWorker.exe`, NT AUTHORITY\\SYSTEM).
3. `2026-02-25T17:29:28Z` - OS shutdown potvrđen (`Event ID 13`).
4. `2026-02-25T17:29:41Z` - OS startup (`Event ID 12`), event log service ponovno starta (`6005`).
5. `2026-02-25T20:51:39.501Z` - prvi heartbeat event nakon prekida (seq_no=11505, status OK).

### 3.2 Veličina prekida capture-a

- Gap između eventa: `12156.111 s` (~3h 22m 36s)
- Od: `2026-02-25T17:29:03.390Z`
- Do: `2026-02-25T20:51:39.501Z`

## 4. Kvantitativna analiza heartbeat podataka

### 4.1 Dan 2026-02-25 (control raw)

- `total_events`: 13,757
- `OK`: 13,680
- `NOK`: 77
- `status_code breakdown`:
- `OK`: 13,680
- `TIMEOUT`: 53
- `LATENCY_HIGH`: 24
- `seq_no` kontinuitet unutar zapisa: uredan (`1 -> 13757`, bez unutarnjih rupa u samom fajlu)
- Maksimalni gap: samo incidentni gap 3h22m

### 4.2 Dan 2026-02-26 (control raw, do trenutka analize)

- `total_events`: 2,051
- `OK`: 2,051
- `NOK`: 0
- `status_code breakdown`: `OK` isključivo
- `seq_no` kontinuitet: uredan (`13758 -> 15808`)
- maksimalni međuevent interval: ~5.045 s (nominalno za interval 5 s)

Tumačenje:
- Izvan incidentnog perioda, link i endpoint su vrlo stabilni.
- Nema uzorka koji bi ukazao na kontinuiran LAN fault ili trajan server-side problem.

## 5. Analiza po hostu

### 5.1 Control PC (192.168.100.18)

Nalazi:
1. Postoji dokazani planirani restart zbog Windows Update mehanizma (`MoUsoCoreWorker.exe`).
2. Restart se poklapa s početkom NDJSON rupe.
3. Nakon restarta nije postojao pouzdan auto-restart heartbeat collectora kao servisa.
4. Collector logika piše runtime poruke na konzolu (`stdout/stderr`), bez dedicated process crash log fajla.

Zaključak:
- Glavni incident je posljedica host-level restarta i lifecycle upravljanja procesom, ne nužno mreže.

### 5.2 Remote PC (192.168.100.93)

Nalazi iz dostavljenog izvještaja:
1. U incidentnom prozoru (`17:00-21:30 UTC`) nema restart/shutdown događaja.
2. Tog dana postoje planirani restarti ranije ujutro (izvan incidentnog prozora).
3. `heartbeat_remote_server.js` je pokrenut kasnije ručno.
4. Nema potvrđenog auto-start mehanizma ni trajnog endpoint process loga.

Zaključak:
- Remote host nije uzrok glavnog prekida u 18:29 CET prozoru.

## 6. Mogući uzroci heartbeat disrupcije (rankirano)

### 6.1 Visoka vjerojatnost (potvrđeno dokazima)

1. **Planned OS restart na control hostu** (Windows Update Orchestrator).
2. **Nedostatak service supervision sloja** (proces ne preživi restart automatski).

### 6.2 Srednja vjerojatnost (za ostale manje prekide/NOK evente)

1. Kratki mrežni jitter/packet-loss u LAN-u (manifestira se kao `TIMEOUT`, ali bez trajnog učinka).
2. Kratki endpoint stall/spike latencije (`LATENCY_HIGH`).
3. Operaterski faktor (zatvoren terminal/proces) kod ručnog starta.

### 6.3 Niža vjerojatnost za promatrani glavni incident

1. Remote host restart u tom prozoru (nema dokaza).
2. Dugotrajni server outage na 192.168.100.93 (nema NOK serije nakon povratka; odmah stabilan OK).
3. Core API regresija (nema dokaza u priloženom heartbeat uzorku).

## 7. Utjecaj na procese i observability gap

Trenutno ponašanje:
1. Node procesi ovise o sesiji/ručnom pokretanju.
2. Kod host restarta procesi se gase; bez startup policy ostaju ugašeni do ručnog pokretanja.
3. Nema jedinstvenog process lifecycle loga (start/stop/crash reason, exit code, signal).

Posljedica:
- Incident je moguće objasniti tek korelacijom više izvora (NDJSON + Windows Event Log), a ne iz jednog centralnog artefakta.

## 8. Preporuke za BI Core Shell (production-grade minimum)

### 8.1 Process supervision i autostart (obavezno)

1. Pokretati svaki modul kao **Windows Service** ili kroz robustan supervisor (npr. NSSM/PM2 + startup).
2. Uključiti restart policy:
- restart on failure,
- restart after reboot,
- exponential backoff.
3. Definirati dependency order (network-up prije heartbeat collectora).

### 8.2 Unified lifecycle logging (obavezno)

1. Centralni `process_lifecycle.log` po modulu:
- start_ts, stop_ts, exit_code, signal, pid, parent_pid, host, version.
2. Odvojeni `stdout.log` i `stderr.log` uz rotaciju.
3. Pri bootu obavezno emitirati `HOST_BOOT_DETECTED` marker event u NDJSON stream.

### 8.3 Boot/restart-aware analytics (obavezno)

1. Analytics treba razlikovati:
- `PROCESS_DOWN` (agent ne radi),
- `LINK_DOWN` (agent radi, ali endpoint NOK).
2. Timeline generator proširiti s event tipom `collector_unavailable`.
3. KPI report proširiti metrikom `monitor_coverage_pct` (koliko je vremena agent stvarno bio aktivan).

### 8.4 Windows Update governance (preporučeno)

1. Aktivni sati i update policy uskladiti s operativnim SLA prozorima.
2. Uvesti kontrolirani maintenance window (planirano gašenje/podizanje + audit).
3. Za kritične monitore razmotriti GPO pravilo "No auto-restart with logged on users" i/ili orchestrirani restart kroz IT change.

### 8.5 Cross-host forensics readiness (preporučeno)

1. Sinkronizacija vremena (NTP) validirana dnevno.
2. Jedinstveni correlation_id/test_run_id kroz sve hostove.
3. Dnevni export minimalnog forenzičkog paketa:
- raw NDJSON,
- timeline,
- KPI,
- process lifecycle,
- host reboot events summary.

## 9. Što poslati IT administratoru (action list)

1. Potvrditi update/restart politiku za radne stanice koje vrte BI nadzorne procese.
2. Odobriti service-mode deployment heartbeat modula na oba hosta.
3. Odobriti centralizirani log retention (najmanje 30-90 dana).
4. Definirati maintenance window i komunikaciju prije update restarta.
5. Definirati recovery SLO: maksimalno dopušteno vrijeme bez collectora nakon boota.

## 10. Finalni zaključak

1. Glavni prekid heartbeat capture-a u promatranom incidentu je uzrokovan planiranim restartom control hosta zbog Windows Update mehanizma.
2. Remote host nije restartan u istom prozoru i nije primarni uzrok tog prekida.
3. Rješenje nije samo mrežno; ključno je uvesti service supervision + lifecycle logging + boot-aware analytics u Core Shell.
4. Nakon tih mjera, isti tip incidenta će biti:
- automatski mitigiran (autostart/restart),
- forenzički jednoznačno objašnjiv iz jednog centralnog skupa logova.

---

Priložene ključne putanje (control strana):
- `_poc/heartbeat_monitoring/control/logs/raw/heartbeat_2026_02_25.ndjson`
- `_poc/heartbeat_monitoring/control/logs/raw/heartbeat_2026_02_26.ndjson`
- `_poc/heartbeat_monitoring/control/state/run_state.json`
