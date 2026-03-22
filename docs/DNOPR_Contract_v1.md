# DNOPR Contract v1

Status: Active  
Date: 2026-03-22  
Owner domain: `DNOPR`  
System of record: `ERP (Gosoft SAP ASE)`  
Module path: `src/modules/dnopr_lifecycle_v1/*`

## 1. Purpose

`DNOPR` je BI modul za praćenje i analitiku proizvodnog lifecycle-a radnog naloga.

Njegova svrha nije samo pregled radnih naloga, nego sustavno poboljšavanje:

- kvalitete planiranja proizvodnje
- kvalitete evidencije rada po operacijama
- kvalitete zatvaranja radnih naloga
- kvalitete generičkih tehnologija artikala
- upravljanja proizvodnim KPI-jevima

Modul se razvija po lancu:

`Lifecycle view -> KPI model -> KPI dependent action queue -> durable derivatives -> management view`

## 2. Business Context

Tvrtka koristi `Gosoft ERP` kao glavni operativni sustav i glavni source of truth.

Za artikle postoje generičke tehnologije, ali zbog konfiguracijske i dimenzionalne parametričnosti proizvoda:

- nije praktično definirati diskretni artikal za svaku kombinaciju parametara
- koriste se generički artikli
- nativna tehnologija generičkog artikla služi kao start point
- pri lansiranju konkretnog radnog naloga inženjeri često moraju revidirati planske operacije i minute

Zbog toga:

- odstupanje plana od generičkog artikla nije automatski greška
- razlika između `Artikal` i `Plan` je poslovno očekivana
- važnije je razlikovati `deviation` od pravog `anomaly` signala

## 3. Source Of Truth

`ERP (Gosoft SAP ASE)` ostaje glavni source of truth.

BI modul:

- ne prepravlja ERP
- ne imitira ERP
- ne preuzima ownership nad operativnim zapisom

BI modul radi:

- čitanje
- normalizaciju
- konfrontaciju
- signalizaciju odstupanja
- spremanje derivata za analitiku

Sve korekcije procesa i podataka vraćaju se u ERP operacije i ERP evidenciju.

## 4. Main ERP Sources

Glavni izvori:

- `V_DN`
- `V_DNOPR`
- `V_FEEDBACK`
- `ARTIKEL`
- `V_TehOpr_Var`

Semantika:

- `V_DN` = header radnog naloga
- `V_DNOPR` = planske operacije konkretnog radnog naloga
- `V_FEEDBACK` = actual ledger realizacije
- `ARTIKEL` = naziv artikla, JM, tehnološki ključ `tehid`
- `V_TehOpr_Var` = nativna tehnologija artikla

## 5. Lifecycle Status Semantics

Statusi koje modul trenutno koristi:

- `PL` = planiran
- `PF` = fiksno planiran
- `LN` = lansiran neaktivan
- `LA` = lansiran aktivan
- `KO` = završen
- `PP` = prognoza, poseban planski tip

Praktična lifecycle putanja za izvršne naloge:

`PL -> PF -> LN -> LA -> KO`

Napomena:

- formalni state model još nije konačno zaključen s planerskim inženjerom
- ovaj dokument zato razlikuje potvrđenu semantiku od radnih heuristika

## 6. Canonical Analytical Levels

Modul promatra nalog kroz tri razine:

### 6.1 Artikal

Referentna, nativna tehnologija artikla:

- `Artikal`
- `Naziv artikla`
- `JM`
- `tehid`
- nativne tehnološke operacije iz `V_TehOpr_Var`

### 6.2 Plan

Konkretna planska tehnologija radnog naloga:

- operacije iz `V_DNOPR`
- `Plan min`
- `Ops`

### 6.3 Actual

Stvarna realizacija:

- ledger iz `V_FEEDBACK`
- `Actual min`
- realizirane operacije

## 7. Core Measures

### 7.1 Art Ops

`Art Ops` = broj distinct operacija nativne tehnologije artikla iz `V_TehOpr_Var`

### 7.2 Artikal min

`Artikal min` = ukupno normirano vrijeme artikla prema nativnoj tehnologiji

Formula:

`SUM( (casvar + casfix) * kolicina ) / 60`

Napomena:

- izvorišna vremena tretiraju se kao sekunde
- prikaz se daje u minutama
- deduplikacija tehnoloških redaka radi se prije zbrajanja

### 7.3 Ops

`Ops` = broj planskih operacija konkretnog radnog naloga iz `V_DNOPR`

### 7.4 Plan min

`Plan min` = suma planiranih minuta operacija radnog naloga

### 7.5 Actual min

`Actual min` = suma realiziranih minuta iz `V_FEEDBACK`

## 8. Meaning Of Comparisons

### 8.1 Artikal vs Plan

Usporedba između:

- generičke tehnologije artikla
- planske tehnologije konkretnog naloga

Ova usporedba nije automatska greška. Ona je:

- baseline za reviziju plana
- signal koliko se plan udaljio od generičke osnove
- kandidat za kasniju korekciju generičke tehnologije

### 8.2 Plan vs Actual

Usporedba između:

- planirane izvedbe naloga
- stvarne realizacije rada

Ova usporedba ima puni smisao tek za završene naloge (`KO`), dok je za `LA` više WIP signal.

## 9. Shared Session Dataset Principle

`DNOPR` se tretira kao jedan BI modul s jednim session datasetom.

To znači:

- jedan session load
- više izvedenih UI pogleda
- nema potrebe za novim punim ERP loadom pri prelasku između pogleda unutar istog sessiona

Target UX:

- `Lifecycle`
- `Action Queue`
- budući KPI-dependent viewovi

svi moraju dijeliti isti lifecycle session context.

## 10. Current UI Views

### 10.1 Lifecycle View

Glavni pogled modula.

Prikazuje:

- radne naloge u zadanom time windowu
- artikal / plan / actual usporedbe
- detalj jednog naloga
- operacije po nalogu
- ledger timeline
- signals

### 10.2 Action Queue View

Operativni derivirani pogled nad istim lifecycle datasetom.

Služi za:

- prioritetizaciju nalaza
- owner role mapiranje
- preporučene akcije
- operativni review problematičnih naloga

Napomena:

- dugoročni cilj je da bude `view switch` unutar istog `dnopr.html` sessiona
- postojeća odvojena stranica je privremeni v1 inkrement

## 11. Current Signals Model

Modul razlikuje:

- `anomaly`
- `deviation`

### 11.1 Anomaly

Signal koji upućuje na vjerojatni operativni problem ili sumnjivo stanje.

Primjeri:

- `LA_NO_ACTUAL`
- `KO_NO_ACTUAL`
- `LN_STALE`
- `PLAN_ACTUAL_GAP` za `KO`

### 11.2 Deviation

Signal odstupanja od generičke osnove ili WIP stanja koji nije automatski greška.

Primjeri:

- `GENERIC_OPS_DEVIATION`
- `GENERIC_TIME_DEVIATION`
- `WIP_PLAN_ACTUAL_DRIFT`

## 12. Signal Semantics Rules

### 12.1 Generic baseline deviations

`Art/Ops mismatch` i `Art/Plan gap` ne tretiraju se kao hard anomaly.

Razlog:

- generički artikli služe kao start point
- planski nalog može biti legitimno revidiran
- odstupanje od generičkog baseline-a nije nužno greška

Zato su ti signali klasificirani kao `deviation`.

### 12.2 Plan/Actual semantics by status

`Plan/Actual` signal se statusno uvjetuje:

- `PL`, `PF`, `LN` -> ne prikazivati završni `Plan/Actual gap`
- `LA` -> prikazivati kao `WIP` deviation
- `KO` -> prikazivati kao pravi završni `anomaly`

To znači:

- `PL/PF` bez actual nije problem sam po sebi
- `LA` može legitimno imati djelomični actual
- `KO` je trenutak kada plan vs actual dobiva puni KPI smisao

## 13. Work Orders In Window Contract

Glavne kolone:

- `Termin`
- `RN`
- `Projekt`
- `Status`
- `AdmCtr`
- `Artikal`
- `Naziv artikla`
- `JM`
- `Kol`
- `Art Ops`
- `Artikal min`
- `Ops`
- `Ledger`
- `Plan min`
- `Art/Plan variance`
- `Actual min`
- `Signals`
- `Last feedback`

## 14. Selected Work Order Contract

Desni panel prikazuje:

- `RN`
- `DNID`
- `Projekt`
- `Status`
- `AdmCtr`
- `Artikal`
- `Naziv artikla`
- `JM`
- `Kol`
- `Artikal min`
- signal badgeove
- planirane termine
- datume lansa i konca

## 15. Operations By Work Order Contract

Operacije po nalogu prikazuju:

- planske operacije iz `V_DNOPR`
- planirane minute
- actual minute
- variance

Na dnu postoji sumarni red:

- `Artikal min`
- `Plan min`
- `Actual min`
- `Variance`

To služi lokalnoj konfrontaciji:

- standard artikla
- plan naloga
- actual realizacija

## 16. Action Queue Contract

`Action Queue` nije zaseban BI modul, nego KPI-dependent operativni view istog `DNOPR` modula.

Minimalna polja queue reda:

- `priority`
- `queue_type`
- `owner_role`
- `AdmCtr`
- `Projekt`
- `RN`
- `Status`
- `Artikal`
- `signal_label`
- `signal_detail`
- `recommended_action`
- `Termin`
- `Last feedback`

Početne kategorije:

- `Planning Queue`
- `Execution Queue`
- `Closing Queue`
- `Review Queue`

## 17. KPI Direction

KPI model još nije finalno zaključen, ali glavne domene su:

### 17.1 Planning quality

- koliko plan odstupa od generičke tehnologije
- koliko DN plan zahtijeva reviziju
- koliko se ista odstupanja ponavljaju po artiklu ili projektu

### 17.2 Execution evidence quality

- koliko `LA` naloga ima kvalitetan actual trag
- koliko stvarna izvedba prati plan
- koliko su operacije dobro evidentirane

### 17.3 Closing quality

- koliko su `KO` nalozi vjerodostojno zatvoreni
- koliko `KO` naloga ima sumnjiv actual trag

### 17.4 Technology quality

- koji generički artikli sustavno traže reviziju
- gdje generička tehnologija više ne odgovara realnosti

## 18. Target Architecture v1

### 18.1 Runtime pattern

1. ERP fetch za wide session window
2. normalizacija u lifecycle read model
3. derivacija signala
4. derivacija KPI mjera
5. render više UI pogleda nad istim datasetom
6. spremanje KPI-dependent derivata kroz storage interface

### 18.2 Technical layering

- `src/core_shell/*` = shared platform
- `src/modules/dnopr_lifecycle_v1/*` = domain logic
- `src/api/*` = transport/UI

### 18.3 Storage principle

Durable writes ne smiju ići direktno iz modula na disk ili DB.

Sve ide kroz Core Shell storage interface, kako bi kasnija migracija na `Postgres` bila backend-agnostic.

## 19. Postgres Migration Direction

Skora migracija na `Postgres` odgovara ovom modulu ako se zadrži ova disciplina:

- ERP ostaje source of truth
- `Postgres` postaje BI derivative store

U `Postgres` će smisla imati spremati:

- kanonske KPI factove po `dnid`
- dnevne snapshotove statusa i signala
- agregate po `admctr`, `projekt`, `artikal`, `radnik`
- action queue artefakte
- management summary facts

## 20. Relationship To MES_ASIST

Postojeći `MES_ASIST` dokumenti imaju djelomični konceptualni overlap s `DNOPR`, ali nisu istog scope-a.

`DNOPR` fokus:

- lifecycle radnog naloga
- `Artikal vs Plan vs Actual`
- planiranje, evidencija i zatvaranje naloga
- KPI i action queue za proizvodni proces

`MES_ASIST` fokus:

- near-real-time eventing
- watchdog/polling
- incident/action orchestration
- eskalacija i operativni response model

Zaključak:

- `MES_ASIST` nije kanonski dokumentacijski okvir za `DNOPR`
- relevantne ideje iz `MES_ASIST` mogu se po potrebi ugraditi u odgovarajuća poglavlja ovog contract dokumenta
- cilj je da se dugoročno održava samo `DNOPR_Contract_v1.md` kao važeći dokument za ovu domenu
- `MES_ASIST` dokumenti ostaju privremena referenca i postupno se napuštaju

## 21. Durable Derivatives Plan

Kada KPI logika sazrije, spremati treba:

- `work_order_kpi_fact`
- `work_order_signal_fact`
- `daily_open_orders_snapshot`
- `daily_action_queue_snapshot`
- `admctr_kpi_daily`
- `projekt_kpi_daily`
- `artikel_kpi_daily`

## 22. Management View Direction

Management view je zadnji sloj modula, ne početni.

On ne smije biti sirovi lifecycle ekran, nego agregirani pogled:

- KPI po centrima
- KPI po projektima
- trendovi
- sezonalnost
- otvorene akcije
- najveća odstupanja
- najveći rizici

## 23. Current Backlog Priorities

### P0

- stabilizirati semantiku statusa i mjera
- ujediniti `Lifecycle` i `Action Queue` pod jednim session modelom

### P1

- definirati prve kanonske KPI-jeve
- doraditi signal pravila s poslovnim vlasnicima

### P2

- KPI-dependent viewovi
- action ownership model
- durable derivatives

### P3

- management summary
- YTD trendovi
- sezonalnost

## 24. Open Questions

Treba potvrditi s planerskim inženjerom:

- formalni state model lifecycle-a
- što je “dobro zatvoren” `KO`
- kako točno razlikovati legitimnu reviziju od planskog problema
- koji KPI-jevi su najvažniji za shop floor transformaciju

Treba potvrditi s operativnim korisnicima:

- koji queue format je zaista upotrebljiv voditeljima
- koji owner role i recommended actions imaju najviše smisla

## 25. Documentation Policy For DNOPR

`DNOPR_Contract_v1.md` je kanonski dokument modula.

To znači:

- nova pravila i semantika trebaju se ugrađivati u odgovarajuće poglavlje ovog dokumenta
- pomoćni DNOPR draft dokumenti ne trebaju se trajno množiti
- superseded DNOPR radni dokumenti idu u arhivu

Za ovu domenu ciljano se ide prema stanju u kojem se održava jedan važeći contract dokument:

- `DNOPR_Contract_v1.md`

`MES_ASIST` dokumenti nisu dugoročni dokumentacijski target za `DNOPR`.

## 26. Architecture Change Note

Files touched by layer:

- `docs/DNOPR_Contract_v1.md` - kanonski contract dokument modula

Boundary impact:

- nema runtime promjene
- konsolidira poslovnu, analitičku i arhitekturnu logiku DNOPR modula u jedan važeći dokument

Rollback note:

- siguran rollback je uklanjanje ovog dokumenta i povratak na prethodne DNOPR radne dokumente
