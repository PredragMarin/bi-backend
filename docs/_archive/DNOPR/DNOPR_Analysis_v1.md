# DNOPR Analysis v1

Status: Draft  
Date: 2026-03-17  
Scope: `Radni nalozi <> Operacije` lifecycle analiza nad ERP Gosoft podacima za Upravljački centar PINOX

## 1. Poslovni cilj

Cilj analize je pratiti puni lifecycle jednog radnog naloga kroz vrijeme:
- otvaranje radnog naloga,
- vezane operacije i njihove promjene statusa,
- povratne proizvodne događaje,
- završetak naloga,
- prijenos gotovog proizvoda na stanje skladišta gotovih proizvoda.

Primarni analitički fokus:
- statusni tok radnog naloga kroz vrijeme,
- trajanje između ključnih faza,
- otvoreni nalozi po danu,
- zatvoreni nalozi po danu,
- backlog i WIP slika za PINOX,
- sljedivost od naloga do operacije i završnog skladišnog ishoda.

Planirani volumeni:
- YTD princip,
- očekivano do ~20 radnih naloga po radnom danu,
- primarni operativni obuhvat: `Upravljački centar PINOX`.

## 2. Izvori podataka

Obavezni izvori iz ERP Gosoft baze:
- `DN`
- `DNOPR`
- `V_FEEDBACK`

Očekivani dodatni izvori za kompletan lifecycle:
- šifrarnici statusa radnih naloga,
- šifrarnici statusa operacija,
- tablice potvrde završetka/proizvodnih povrata,
- tablice skladišnih primki ili kretanja gotovih proizvoda,
- matični podaci artikla/proizvoda,
- radni centri / upravljački centri.

Napomena:
- `ERP (Gosoft SAP ASE)` ostaje read-only izvor.
- Svi dohvatni upiti moraju ići kroz Core Shell SQL allowlist sloj.

## 3. Poslovna pitanja

Analiza mora omogućiti odgovore na sljedeća pitanja:
- Kada je radni nalog otvoren?
- Koje operacije pripadaju radnom nalogu?
- U kojem je statusu svaka operacija i kada se status promijenio?
- Kada je operacija stvarno započela i završila?
- Postoje li feedback događaji bez odgovarajuće operacije ili naloga?
- Kada je nalog prešao u završeni status?
- Kada je gotovi proizvod stavljen na skladište gotovih proizvoda?
- Koliko traje put od otvaranja naloga do skladišnog zatvaranja?
- Gdje nastaju zastoji: prije prve operacije, unutar operacija, između završetka i skladištenja?

## 4. Analitička semantika

Jedinica promatranja:
- primarno `radni_nalog_id`,
- sekundarno `radni_nalog_id + operacija_id`,
- događajno `event_ts`.

Vremenska semantika:
- svi timestampovi interpretiraju se u zoni `Europe/Zagreb`,
- YTD znači od `01-01 tekuće godine 00:00:00` do trenutka izvršavanja,
- dnevne metrike agregiraju se po lokalnom datumu događaja,
- statusni snapshot za dan predstavlja zadnje poznato stanje do kraja dana.

Predložene lifecycle faze naloga:
1. `created`
2. `released`
3. `in_progress`
4. `operation_complete`
5. `production_complete`
6. `stock_posted`
7. `closed`

Napomena:
- stvarni maping statusa mora biti potvrđen nakon uvida u ERP statusna polja i šifrarnike.
- do potvrde mapinga nema promjene poslovnih pravila, samo dokumentiranje i validacija.

## 5. Predloženi kanonski model

### 5.1 Fact: work_order_header

Minimalna polja:
- `work_order_id`
- `product_id`
- `product_code`
- `product_name`
- `qty_planned`
- `qty_completed`
- `order_status_raw`
- `order_status_mapped`
- `pino_x_center_code`
- `created_ts`
- `released_ts`
- `completed_ts`
- `closed_ts`

### 5.2 Fact: work_order_operation

Minimalna polja:
- `work_order_id`
- `operation_id`
- `operation_seq`
- `operation_code`
- `work_center_code`
- `operation_status_raw`
- `operation_status_mapped`
- `planned_start_ts`
- `actual_start_ts`
- `actual_end_ts`
- `qty_good`
- `qty_scrap`

### 5.3 Fact: work_order_event_log

Event-sourced sloj za rekonstrukciju lifecycle-a:
- `event_id`
- `event_source` (`DN`, `DNOPR`, `V_FEEDBACK`, `stock`)
- `work_order_id`
- `operation_id`
- `event_type`
- `event_status_raw`
- `event_status_mapped`
- `event_ts`
- `actor_id`
- `payload_raw`

### 5.4 Fact: stock_completion

Minimalna polja:
- `work_order_id`
- `product_id`
- `warehouse_doc_id`
- `warehouse_code`
- `posted_ts`
- `qty_posted`

## 6. Potrebni SQL extracti

Prvi inkrement treba definirati allowlist upite za:
- `DN_YTD_PINOX`
- `DNOPR_YTD_PINOX`
- `V_FEEDBACK_YTD_PINOX`
- `DN_STATUS_DIM`
- `DNOPR_STATUS_DIM`
- `WORK_CENTER_DIM`
- `STOCK_POSTING_YTD_PINOX`

Minimalni tehnički zahtjevi za svaki upit:
- parametriziran period,
- `ORDER BY` po poslovno relevantnom timestampu,
- limit/maxRows definiran u allowlistu,
- bez dinamičkog SQL-a iz modula,
- sanitizirane greške prema postojećem ERP gateway obrascu.

## 7. Pravila spajanja podataka

Osnovni join put:
- `DN.work_order_id -> DNOPR.work_order_id`
- `DNOPR.operation keys -> V_FEEDBACK operation/reference keys`
- `DN.work_order_id -> stock posting reference`

Rizici koji se moraju eksplicitno validirati:
- više feedback zapisa za istu operaciju,
- feedback bez stabilnog jedinstvenog ključa,
- razlika između statusnog stanja i stvarnog događajnog vremena,
- retroaktivne izmjene statusa,
- djelomična skladišna knjiženja,
- ponovno otvaranje već zatvorenog naloga.

## 8. KPI i izlazi

Minimalni izlazi za v1:
- `order_lifecycle_table`
- `operation_lifecycle_table`
- `event_timeline`
- `daily_ytd_summary`
- `current_open_orders`
- `aging_report`
- `data_quality_findings`

Minimalni KPI:
- broj otvorenih naloga,
- broj zatvorenih naloga,
- prosječno vrijeme od otvaranja do prve operacije,
- prosječno vrijeme od zadnje operacije do skladištenja,
- prosječno ukupno lifecycle vrijeme,
- broj naloga bez skladišnog zatvaranja,
- broj operacija bez feedback potvrde,
- broj statusnih konflikata između izvora.

## 9. Preporučena repo implementacija

Predloženi novi modul:
- `src/modules/dnopr_lifecycle_v1/*`

Predložena struktura:
- `src/modules/dnopr_lifecycle_v1/module_manifest.json`
- `src/modules/dnopr_lifecycle_v1/module_runtime.js`
- `src/modules/dnopr_lifecycle_v1/contracts/run_contract.json`
- `src/modules/dnopr_lifecycle_v1/contracts/event_model_v1.json`
- `src/modules/dnopr_lifecycle_v1/adapters/db_fetch_dnopr.js`
- `src/modules/dnopr_lifecycle_v1/domain/build_lifecycle.js`
- `src/modules/dnopr_lifecycle_v1/domain/aggregate_ytd.js`

Core Shell dodaci:
- novi query allowlist unosi u `src/core/erp_gateway/query_allowlist.js`
- registry unos kroz postojeći module runtime mehanizam
- durable output kroz `src/core_shell/storage/*`

API princip:
- ako se uvede route, mora biti eksplicitna i verzionirana
- primjer: `/api/dnopr-lifecycle/v1/run-db`

## 10. Faze izvedbe

### Faza 1: Source profiling
- popisati sva relevantna polja iz `DN`, `DNOPR`, `V_FEEDBACK` i dodatnih tablica,
- potvrditi join ključeve,
- potvrditi statusna polja i statusne šifrarnike,
- uzeti 10-20 stvarnih naloga za ručnu validaciju lifecycle-a.

### Faza 2: Contract + fetch
- definirati module manifest,
- definirati input/output contracts,
- dodati SQL allowlist upite,
- implementirati backend fetch adapter.

### Faza 3: Lifecycle engine
- složiti canonical event timeline,
- mapirati raw status -> mapped lifecycle state,
- izračunati order/operation trajanja,
- označiti data quality konflikte.

### Faza 4: YTD outputs
- dnevni YTD summary,
- otvoreni nalozi snapshot,
- aging report,
- validacijski i audit artefakti.

## 11. Otvorena pitanja

Treba potvrditi:
- točna PK/FK veza između `DN` i `DNOPR`,
- koje polje pouzdano označava otvaranje naloga,
- koje polje pouzdano označava zatvaranje naloga,
- kako se u ERP-u prepoznaje knjiženje na skladište gotovih proizvoda,
- postoji li jednoznačna veza `V_FEEDBACK` -> operacija -> nalog,
- radi li PINOX filtriranje preko radnog centra, upravljačkog centra, pogona ili druge organizacijske oznake.

## 12. Prvi preporučeni inkrement

Prvi isporučivi inkrement treba dati:
- dokumentirani source map,
- allowlist SQL upite za YTD dohvat,
- sirovi extract validation,
- jedan deterministic lifecycle output za mali validacijski uzorak naloga.

To je dovoljno da se prijeđe iz "data discovery" u stabilan BI modul bez preskakanja arhitekturnih granica.

## 13. Architecture Change Note

Files touched by layer:
- `docs/DNOPR_Analysis_v1.md` - dokumentacija / analitička specifikacija

Boundary impact:
- nema runtime promjene
- definira budući modul kao `src/modules/dnopr_lifecycle_v1/*`
- potvrđuje da ERP SQL dohvat ide kroz Core Shell allowlist, a durable write kroz Core Shell storage

Rollback note:
- siguran rollback jednostavnim uklanjanjem ovog dokumenta ili revertom commita jer nema produkcijskog behavior utjecaja
