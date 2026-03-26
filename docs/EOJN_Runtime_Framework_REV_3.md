# EOJN Runtime Framework v2026-03 REV_3

Projekt: `bi-backend`  
Use case: `eojn_v1`  
Datum: `26.03.2026`

### 1. Svrha i opseg
EOJN modul je punopravni BI modul za:
1. periodicko automatsko prikupljanje EOJN `Postupaka` i `Objava`,
2. viseslojno filtriranje (`Layer 1` -> `Layer 2`),
3. odrzavanje jedne kanonske workliste po `TenderId`,
4. odrzavanje povezane liste `Objava` za tender-e koji su prosli `L1 pass`,
5. odrzavanje review workflowa, watch statusa i audit traila,
6. buduce slanje SMS alerta za potvrene target hitove,
7. transparentan heartbeat, run audit i ingest ledger kroz filesystem artefakte,
8. kasniju migraciju na PostgreSQL bez razbijanja EOJN poslovne logike.

### 2. Arhitektonska nacela
1. Core shell ostaje genericki (`runtime`, `validate`, `manifest`, `store`, `API/UI`, `logging`, `scheduler integration`).
2. EOJN domena i scoring politika su iskljucivo u modulu.
3. Determinizam je obavezan za isti snapshot input + isti `rules_version`.
4. Nema silent korekcija; svaka nesigurnost ide u warning/action sloj ili rucni review.
5. Human-in-the-loop je obavezan kad `Layer 2` dokaz nije dostupan ili nije dovoljno jak.
6. Svi durable write-ovi moraju ici kroz Core Shell storage/service sloj.
7. Operator-facing source-of-truth mora biti canonical latest-state, ne dnevna shortlist/queue logika.
8. `Integrity over continuity` je vodece operativno nacelo.

### 3. Scheduler i izvrsavanje
1. Fiksni termini runa: `06:00` i `15:00` (`Europe/Zagreb`).
2. Raspored vrijedi 365 dana godisnje (ukljucujuci vikende/praznike).
3. Konfiguracija ostaje u kodu kao konstante, ne kroz UI.
4. Retry politika u produkcijskom scheduler sloju ostaje planirana:
   - `5` retry pokusaja,
   - razmak `5 min`.
5. Run lock politika mora biti definirana u produkcijskom scheduler okruzenju:
   - ne smije doci do nekontroliranog overlap-a dvaju EOJN ciklusa,
   - ako prethodni run traje predugo, mora ostati vidljiv u audit/alert sloju.
6. Za lokalnu/test fazu scheduler summary i `run_audit` vec daju dokaz pokusaja i outcome-a runa.
7. U produkciji backend mora biti podignut kao servis, a scheduler kao non-interactive izvrsavanje.

### 4. Layer model EOJN
1. `Layer 1` (metadata + hard negative + scope/intent + score)
2. `Layer 2` (budget/troskovnik evidence scan + item detection + profile scoring)
3. `Canonical latest state` (`TenderId` latest-state projection)
4. `Notice history` (timeline svih relevantnih `Objava` za tracked tendere)
5. `Watchlist workflow` (manual audit + review lifecycle)
6. `Alert layer` (SMS za confirmed strong target hitove)
7. `Ops layer` (`run_audit`, `ingest_ledger`, continuity/integrity health)

### 5. Pragovi i policy konstante
Obavezno kao lako promjenjive konstante:
1. `TARGET_HIT_THRESHOLD`
2. `WATCH_CANDIDATE_MIN`
3. `WATCH_CANDIDATE_MAX`
4. `RUN_TIMES = ["06:00","15:00"]`
5. `RETRY_MAX = 5`
6. `RETRY_INTERVAL_MIN = 5`
7. `PROCUREMENT_SAFETY_OVERLAP_DAYS = 2`
8. `NOTICE_SAFETY_OVERLAP_DAYS = 2`
9. `RETENTION_MONTHS = 24`
10. `UI_REFRESH_MIN = 10`

Napomena:
- U REV_3 pragovi vise ne smiju biti promatrani kao jedan globalni L2 score za sve use caseove.
- Glavni EOJN signal mora biti vezan uz aktivni primarni use-case profil.

### 6. Layer semantika
1. Layer 1 strong negative:
   - automatski reject prema L1 pravilima i hard negative sloju.
2. Layer 1 pass:
   - tender ulazi u canonical latest-state listu ako proe L1 gate.
3. Layer 2 watch candidate:
   - slab ili srednji dokaz ide u rucni pregled, ne u automatski alert.
4. Layer 2 target hit:
   - jak signal samo ako postoji stvarni dokaz iz aktivnog primarnog use-case profila.
5. Nije moguce pribaviti L2 dokaz (`download/parse fail`):
   - slucaj ide u `suspect/manual_review`,
   - bez automatskog target-hita dok rucni pregled ne potvrdi.
6. L2 vise ne smije mijesati razlicite use caseove u jednu zbirnu incidencu.

### 7. Canonical state model
1. Jedna canonical lista `Postupaka`:
   - jedan red po `TenderId`,
   - samo tenderi koji su prosli L1 pass.
2. Jedna povezana lista `Objava`:
   - vise redova po istom `TenderId`,
   - timeline za tracked tendere.
3. Jedna append-only povijest review odluka.
4. `WATCH` je filter nad canonical latest-state, ne zasebna primary lista.
5. Dnevni run-folder artefakti ostaju audit/debug sloj.

### 8. Heartbeat, run audit i ingest ledger
1. Heartbeat se vise ne smije svesti samo na scheduler je pokusao.
2. Glavni runtime audit artefakt je:
   - `out/eojn_v1/_state/run_audit.ndjson`
3. Glavni coverage/forensics artefakt je:
   - `out/eojn_v1/_state/ingest_ledger.ndjson`
4. Scheduler-side summary log ostaje:
   - brz operativni pregled
   - ali nije jedini dokaz
5. Minimalni run audit payload mora pokriti:
   - `run_id`
   - `run_type`
   - `started_at`
   - `finished_at`
   - `status`
   - `counts`
   - `mode`
   - `out_dir`
6. Minimalni ingest ledger payload mora pokriti:
   - `entity_type`
   - `entity_id`
   - `seen_at`
   - `run_id`
   - `l1_status`

### 9. Continuity i integrity
1. `Continuity` mjeri jesu li ciklusi `06:00` i `15:00` izvrseni.
2. `Integrity` mjeri je li pokriven sav relevantni raw EOJN period bez gubitka podataka.
3. Pad ciklusa je continuity problem.
4. Gubitak coverage-a je integrity problem.
5. Recovery model:
   - koristi zadnji uspjesni watermark,
   - dodaje safety overlap,
   - deduplicira vec viene entitete,
   - pomice state samo nakon uspjeha.
6. Prazan vikend run nije failure ako je tehnicki uspjesan i bez novih raw promjena.
7. `EMPTY_SUCCESS` je valjan operativni ishod.

### 10. Frontend (single web UI)
1. Uloge:
   - `SALES_LEAD`: write/audit
   - `VIEWER`: read-only
2. UI je canonical worklist browser + detail/audit panel.
3. Auto-refresh prikaza: `10 min`.
4. Potrebni UX alati:
   - search,
   - filter,
   - sort,
   - pregled notice timeline-a,
   - audit statusa po tenderu.
5. `Run date` nije primarni operatorski filter i ostaje samo advanced/debug opcija.

### 11. Status model
1. EOJN izvorni status:
   - `TenderStatus` (iz EOJN).
2. Interni workflow/review status:
   - `PENDING`
   - `WATCH`
   - `REJECT`
   - `HOLD`
3. Lifecycle status moze biti dodatni odvojeni sloj.
4. EOJN status i interni status moraju ostati odvojena polja.

### 12. Retencija i audit trail
1. Retencija artefakata i logova: `24 mjeseca`.
2. Audit ledger akcija iz UI-a je obavezan (append-only history).
3. Svaka promjena workflow statusa mora imati `who/when/what`.
4. Cleanup ne smije ukloniti minimalni audit dokaz.
5. Osjetljivi tokeni i auth tragovi ne smiju ostati u clear tekstu u logovima.

### 13. DB migration smjer
1. Filesystem-first model ostaje trenutno operativan.
2. Ciljni DB model mora zadrzati minimalno:
   - `eojn_tender_latest`
   - `eojn_notice_history`
   - `eojn_review_decision_history`
   - `eojn_run_audit`
   - `eojn_ingest_state`
   - `eojn_ingest_ledger`
   - `eojn_ref_catalog`
3. Kasnije po potrebi:
   - `eojn_kpi_daily`
4. Migracija se ne radi tako da EOJN business code direktno postane SQL-centric.
5. Migracija se radi zamjenom storage backenda iza stabilnog Core Shell contracta.

### 14. Zakljucak REV_3
EOJN je definiran kao stabilniji modul s:
1. fiksnim periodickim runtime ritmom,
2. jednom canonical worklistom po `TenderId`,
3. linked notice history modelom,
4. append-only run audit i ingest ledger tragom,
5. recovery logikom watermark + overlap,
6. jasnim odvajanjem continuity i integrity statusa,
7. human-in-the-loop review slojem,
8. cistim smjerom prema PostgreSQL migraciji.
