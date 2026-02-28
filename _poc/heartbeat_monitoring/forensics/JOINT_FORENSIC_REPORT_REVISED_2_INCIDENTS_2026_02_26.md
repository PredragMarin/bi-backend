# Revidirani zajednički forenzički izvještaj (2 incidenta, 2 hosta)

Datum: 2026-02-26  
Sustav: Heartbeat POC (Control `192.168.100.18` <-> Remote `192.168.100.93`)  
Autor: BI POC forenzička konsolidacija

## 1) Svrha i opseg

Ovaj dokument kombinira:
1. postojeću forenziku na `192.168.100.18` (control),
2. dostavljenu forenziku na `192.168.100.93` (remote, raniji incident),
3. zajedničku interpretaciju za Core Shell implementaciju.

Fokus je na jasnoj distinkciji dva incidenta i ponašanju svakog hosta unutar svakog incidenta.

## 2) Sažetak za IT admina (Executive)

1. Evidentirana su **dva odvojena incidenta** 25.02.2026.
2. **Incident A (oko 01:59 UTC):** primarni uzrok je restart na remote hostu `192.168.100.93` (Windows Update + dodatni TrustedInstaller restart), što je proizvelo TIMEOUT-e na control strani.
3. **Incident B (oko 17:29 UTC):** primarni uzrok je restart na control hostu `192.168.100.18` (Windows Update), što je proizvelo višesatni monitoring gap bez zapisa.
4. U oba slučaja ključni tehnički problem je isti: procesi nisu vođeni kao servis/supervisor s autostartom nakon boota i trajnim process-lifecycle logiranjem.
5. Mreža/LAN može uzrokovati kratke NOK spikeove, ali dostupni dokazi pokazuju da su glavna dva incidenta host-level restart događaji.

## 3) Incident katalog

## Incident A (raniji) - Remote restart uzrokuje TIMEOUT na control

- Incident ID: `INC-A-2026-02-25-0159Z`
- UTC prozor: `2026-02-25 01:59:26Z - 02:05:11Z`
- Lokalno (CET): `02:59:26 - 03:05:11`
- Trajanje: oko 6 min
- Primarni pogođeni servis: `heartbeat_remote_server.js` na `192.168.100.93`

Primarni dokaz (iz dostavljene .93 forenzike):
- `Event ID 1074` u `02:59:22` lokalno, proces `MoUsoCoreWorker.exe`, planned restart.
- Potom `Event ID 1074` u `03:01:45` lokalno, proces `TrustedInstaller.exe`, planned upgrade restart.
- Control NDJSON pokazuje seriju `TIMEOUT` od `01:59:26Z` do oporavka `02:05:11Z`.

## Incident B (kasniji) - Control restart uzrokuje monitoring gap

- Incident ID: `INC-B-2026-02-25-1729Z`
- UTC marker početka: `2026-02-25 17:29:03.390Z` (zadnji event prije prekida)
- Lokalno (CET): oko `18:29`
- Trajanje monitoring gape-a: `12156.111 s` (~3h 22m 36s)
- Primarni pogođeni servis: `heartbeat_collector.js` na `192.168.100.18`

Primarni dokaz (control forenzika):
- `Event ID 1074` u `18:29:07` lokalno, `MoUsoCoreWorker.exe`, planned restart.
- `Event ID 13` shutdown i `Event ID 12` boot odmah nakon toga.
- NDJSON rupa: `17:29:03.390Z` -> `20:51:39.501Z`.

## 4) Matrica ponašanja po hostu i po incidentu

| Incident | Host | Što se dogodilo na hostu | Dokaz | Utjecaj na heartbeat |
|---|---|---|---|---|
| A | `192.168.100.93` | Planned restart (Windows Update), pa dodatni planned upgrade restart | `1074 (MoUsoCoreWorker)`, `1074 (TrustedInstaller)`, `13/12` | Endpoint nedostupan, control vidi TIMEOUT |
| A | `192.168.100.18` | Collector ostaje aktivan i bilježi NOK/TIMEOUT sekvencu | NDJSON `status_code=TIMEOUT` u incidentnom prozoru | Točna detekcija prekida remote endpointa |
| B | `192.168.100.18` | Planned restart (Windows Update) i gašenje collectora | `1074`, `13`, `12`, `6006/6005` | Monitoring gap (nema eventova ni OK ni NOK) |
| B | `192.168.100.93` | Nema restarta u prozoru incidenta B | Dostavljena .93 forenzika (no restart in window) | Nije primarni uzrok Incidenta B |

## 5) Dodatna kvantitativna slika (control NDJSON)

`heartbeat_2026_02_25.ndjson`:
- `total_events=13757`
- `OK=13680`
- `NOK=77`
- `TIMEOUT=53`
- `LATENCY_HIGH=24`
- najveći gap: `12156.111 s` (`17:29:03.390Z` -> `20:51:39.501Z`)

`heartbeat_2026_02_26.ndjson` (do vremena analize):
- `total_events=2051`
- `OK=2051`
- `NOK=0`
- max međuevent interval ≈ `5.045 s` (nominalno)

Zaključak:
- Izvan incidentnih prozora link radi stabilno.
- Glavni incidenti koreliraju s OS restart događajima, ne s trajnim LAN problemom.

## 6) Mogući uzroci heartbeat disrupcije (ukupno, prošireno)

Visoka vjerojatnost (dokazano):
1. Planned restart na hostu koji nosi kritičnu heartbeat komponentu.
2. Nedostatak service supervision/autostarta nakon boota.

Srednja vjerojatnost (za manje NOK epizode):
1. Kratki LAN jitter/packet-loss.
2. Kratki endpoint stall ili CPU/disk spike na remote hostu.
3. Ručno zatvaranje terminala/procesa.

Niža vjerojatnost (za ova dva glavna incidenta):
1. Trajni LAN outage.
2. Dugotrajni remote server outage nevezan uz restart.
3. Aplikacijska regresija kao primarni uzrok oba incidenta.

## 7) Što zaključujemo o “restart policy” u firmi

1. Na oba hosta prisutan je Windows Update mehanizam koji može inicirati planned restart (`MoUsoCoreWorker`, ponekad i `TrustedInstaller`).
2. Aktivni sati smanjuju rizik u radnom prozoru, ali ne štite noćne operativne servise ako nisu service-managed.
3. Bez formalnog ops okvira (maintenance window + autostart + watchdog) isti tip incidenta će se ponavljati.

## 8) Preporuka za BI Core Shell (prioritetno)

P1 - Obavezno prije produkcije:
1. Sve long-running module (collector, remote endpoint, gateway watcheri) pokretati kao servis/supervisor.
2. Uključiti `restart on failure` + `start at boot` + retry/backoff.
3. Dodati trajni lifecycle log (`start/stop/exit_code/signal/pid/host/version`).

P2 - Observability i forenzika:
1. Uvesti boot marker event (`HOST_BOOT_DETECTED`) u telemetry stream.
2. Razdvojiti uzroke u analyticsu: `PROCESS_DOWN` vs `LINK_DOWN`.
3. Dodati `monitor_coverage_pct` KPI (koliki dio vremena je agent bio stvarno živ).

P3 - Windows update governance:
1. Definirati maintenance policy za računala koja nose BI procese.
2. Uskladiti Active Hours/GPO s operativnim potrebama.
3. Uvesti proceduru nakon patch restarta: automatski health-check i potvrda da su svi moduli podignuti.

## 9) Konkretne akcije za IT admin tim

1. Odobriti service-mode deployment za heartbeat komponente na `.18` i `.93`.
2. Definirati standardni supervisor (npr. Windows Service/NSSM/PM2 uz startup policy).
3. Uvesti centralizirani retention za process logs (30-90 dana).
4. Uvesti alert kada je monitor proces down > 1 interval.
5. Formalno dokumentirati patch/restart maintenance window i recovery checklist.

## 10) Konačni zaključak

- Incident A i Incident B su različiti po mjestu uzroka, ali istog operativnog tipa: OS planned restart + nedovoljno robustan process lifecycle.
- Incident A: uzrok na `.93`, efekt vidljiv na `.18` kao TIMEOUT serija.
- Incident B: uzrok na `.18`, efekt kao monitoring gap bez zapisa.
- Najveći dobitak za Core Shell dolazi iz uvođenja service supervision sloja, a ne iz same promjene heartbeat business logike.

---

Referentni artefakti:
- `c:\Users\Marin\bi-backend\_poc\heartbeat_monitoring\forensics\JOINT_FORENSIC_REPORT_2026_02_26.md`
- `c:\Users\Marin\bi-backend\_poc\heartbeat_monitoring\control\logs\raw\heartbeat_2026_02_25.ndjson`
- `c:\Users\Marin\bi-backend\_poc\heartbeat_monitoring\control\logs\raw\heartbeat_2026_02_26.ndjson`
- `c:\Users\Marin\bi-backend\_poc\heartbeat_monitoring\control\state\run_state.json`
