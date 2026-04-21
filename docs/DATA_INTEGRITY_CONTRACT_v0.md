# Data Integrity Contract v0

## 1. Svrha

Ovaj dokument definira početni data integrity contract za novi EPR operativni model nad vlastitom PostgreSQL bazom.

Cilj je jasno odvojiti:
- source of data
- source of truth
- ručne korekcije
- izvedene payroll rezultate
- audit trag

Ovo je živi dokument.
Treba se pooštravati prije svake veće implementacije tablica, admin UI-a i workflow logike.

## 2. Temeljna Premisa

- Gosoft ERP je `source of data`, ne više `source of truth`.
- PostgreSQL BI baza je `source of truth` za operativno stanje zaposlenika i attendance evidencije.
- Raw import se nikad ne uređuje ručno.
- Poslovna istina nastaje kroz canonical/current sloj i eksplicitne override zapise.
- Svaka ručna promjena mora biti auditabilna i objašnjiva.
- Nijedan payroll rezultat ne smije biti generiran iz neodobrenog ili nejasnog operativnog stanja.

## 3. Ciljevi Contracta

Contract mora omogućiti:
- jasno vlasništvo nad svakim entitetom
- jasno podrijetlo svakog poslovno bitnog podatka
- kontrolirane mutacije nad zapisima
- vremensku konzistentnost employment i attendance podataka
- review i approval workflow prije payroll obračuna
- kasniju tranziciju s ERP importa na direktni RFID ingest bez rušenja modela

## 4. Kategorije Entiteta

Svaki entitet u sustavu mora pripadati točno jednoj kategoriji:

- `RAW`
  Neizmijenjen trag uvezen iz vanjskog izvora.
- `CANONICAL`
  Trenutna poslovna istina koju compute i payroll koriste.
- `OVERRIDE`
  Eksplicitna ručna korekcija ili odluka koja mijenja canonical stanje.
- `DERIVED`
  Izračunati rezultat, sažetak, export ili pomoćni output.
- `AUDIT`
  Povijest promjena, review odluke i dokazni trag.

## 5. Ownership Contract

Za svaku tablicu mora biti unaprijed zapisano:
- naziv tablice
- kategorija tablice
- svrha tablice
- owner procesa
- smije li se ručno uređivati
- koristi li se u computeu
- koristi li se u payrollu

Početni ciljani ownership model:

- `employee_profile`
  Kategorija: `CANONICAL`
  Svrha: operativna istina o općim podacima zaposlenika
  Ručna izmjena: da, uz audit

- `employee_payroll_context`
  Kategorija: `CANONICAL`
  Svrha: operativna istina o osjetljivom payroll i HR kontekstu zaposlenika
  Ručna izmjena: da, uz audit i strogu kontrolu pristupa

- `employee_import_raw`
  Kategorija: `RAW`
  Svrha: neizmijenjena kopija ERP employee importa
  Ručna izmjena: ne

- `attendance_import_raw`
  Kategorija: `RAW`
  Svrha: neizmijenjena kopija imported attendance događaja
  Ručna izmjena: ne

- `attendance_event_current`
  Kategorija: `CANONICAL`
  Svrha: current operational attendance state
  Ručna izmjena: ograničeno, uz audit ili kroz override mehanizam

- `attendance_override`
  Kategorija: `OVERRIDE`
  Svrha: eksplicitna poslovna korekcija canonical attendance stanja
  Ručna izmjena: da

- `payroll_export_run`
  Kategorija: `DERIVED`
  Svrha: zaključani export/output payroll obračuna
  Ručna izmjena: ne

- `audit_log`
  Kategorija: `AUDIT`
  Svrha: trajni zapis promjena, review odluka i approval koraka
  Ručna izmjena: ne kroz business UI

## 5A. DB Object Taxonomy

PostgreSQL objekti u BI bazi ne trebaju svi biti istog tipa.
Radi preglednosti i kontrole razvoj mora razlikovati:

- `BASE TABLE`
  Fizička tablica s podacima koji se upisuju i čuvaju.

- `VIEW`
  Read model za pregled, UI, reporting ili current-state projekciju.

- `MATERIALIZED VIEW`
  Cacheirani read model za teže upite ili periodne sažetke.
  Ne koristiti dok za to ne postoji jasan performansni razlog.

- `LOOKUP TABLE`
  Mala referentna tablica za statuse, šifre, tipove ili policy kataloge.

- `AUDIT TABLE`
  Fizička history tablica za dokazni trag.

Početno pravilo za EPR:
- poslovna istina ide u `BASE TABLE`
- UI i pregledni read modeli po mogućnosti idu kroz `VIEW`
- `MATERIALIZED VIEW` se uvodi tek kad obični view i indeksirani upiti više nisu dovoljni
- lookup i status kataloge treba izdvojiti iz proceduralnog koda kad postanu stabilni i zajednički

## 5B. Inicijalni EPR DB Objektni Katalog

Ovo nije finalni schema design.
Ovo je početni katalog da zadržimo kontrolu nad vrstama objekata i njihovom ulogom.

### 5B.1 Employee Domena

- `employee_import_raw`
  Object type: `BASE TABLE`
  Kategorija: `RAW`
  Svrha: sirovi import employee podataka iz Gosofta
  Payroll utjecaj: ne direktno

- `employee_profile`
  Object type: `BASE TABLE`
  Kategorija: `CANONICAL`
  Svrha: current operativna istina o općim employee podacima
  Payroll utjecaj: indirektno

- `employee_payroll_context`
  Object type: `BASE TABLE`
  Kategorija: `CANONICAL`
  Svrha: current operativna istina o satnici, bonusima, nagradama, discipline i payroll parametrima
  Payroll utjecaj: da

- `employee_profile_history`
  Object type: `AUDIT TABLE`
  Kategorija: `AUDIT`
  Svrha: povijest izmjena općeg employee profila
  Payroll utjecaj: indirektno, dokazno

- `employee_payroll_context_history`
  Object type: `AUDIT TABLE`
  Kategorija: `AUDIT`
  Svrha: povijest izmjena osjetljivog payroll i HR konteksta zaposlenika
  Payroll utjecaj: indirektno, dokazno

- `v_employee_profile_self`
  Object type: `VIEW`
  Kategorija: `CANONICAL`
  Svrha: read model za zaposlenika nad vlastitim općim podacima
  Payroll utjecaj: ne direktno

- `v_employee_profile_manager`
  Object type: `VIEW`
  Kategorija: `CANONICAL`
  Svrha: read model za management nad općim operativnim podacima zaposlenika
  Payroll utjecaj: ne direktno

- `v_employee_payroll_context_hr`
  Object type: `VIEW`
  Kategorija: `CANONICAL`
  Svrha: read model za HR i payroll voditelja nad osjetljivim employee payroll kontekstom
  Payroll utjecaj: ne direktno

### 5B.2 Attendance Domena

- `attendance_import_raw`
  Object type: `BASE TABLE`
  Kategorija: `RAW`
  Svrha: sirovi imported attendance eventi iz Gosofta
  Payroll utjecaj: ne direktno

- `attendance_import_batch`
  Object type: `BASE TABLE`
  Kategorija: `RAW`
  Svrha: batch identitet importa, source metadata i kontrola ingest ciklusa
  Payroll utjecaj: ne direktno

- `attendance_event_current`
  Object type: `BASE TABLE`
  Kategorija: `CANONICAL`
  Svrha: current operativni attendance event koji ulazi u compute
  Payroll utjecaj: da

- `attendance_override`
  Object type: `BASE TABLE`
  Kategorija: `OVERRIDE`
  Svrha: eksplicitne ručne korekcije i override odluke nad attendance događajima
  Payroll utjecaj: da

- `attendance_review_case`
  Object type: `BASE TABLE`
  Kategorija: `AUDIT`
  Svrha: review slučajevi, statusi i odluke nad attendance konfliktima
  Payroll utjecaj: indirektno

- `attendance_event_history`
  Object type: `AUDIT TABLE`
  Kategorija: `AUDIT`
  Svrha: history canonical attendance stanja i njegovih promjena
  Payroll utjecaj: indirektno, dokazno

- `v_attendance_event_current`
  Object type: `VIEW`
  Kategorija: `CANONICAL`
  Svrha: UI/read model za pregled operativnog attendance stanja
  Payroll utjecaj: ne direktno

- `v_attendance_review_queue`
  Object type: `VIEW`
  Kategorija: `AUDIT`
  Svrha: operativni pregled otvorenih review slučajeva
  Payroll utjecaj: ne direktno

### 5B.3 External Absence Domena

- `hzzo_import_raw`
  Object type: `BASE TABLE`
  Kategorija: `RAW`
  Svrha: sirovi HZZO import i mapirani redovi
  Payroll utjecaj: ne direktno

- `hzzo_import_batch`
  Object type: `BASE TABLE`
  Kategorija: `RAW`
  Svrha: batch kontrola HZZO ingest procesa
  Payroll utjecaj: ne direktno

- `v_hzzo_conflict_candidates`
  Object type: `VIEW`
  Kategorija: `AUDIT`
  Svrha: pregled HZZO vs attendance konfliktnih kandidata
  Payroll utjecaj: ne direktno

### 5B.4 Payroll Domena

- `payroll_run`
  Object type: `BASE TABLE`
  Kategorija: `DERIVED`
  Svrha: identitet payroll obračunskog runa za period
  Payroll utjecaj: da

- `payroll_run_employee`
  Object type: `BASE TABLE`
  Kategorija: `DERIVED`
  Svrha: employee-level payroll rezultat za određeni run
  Payroll utjecaj: da

- `payroll_export_artifact`
  Object type: `BASE TABLE`
  Kategorija: `DERIVED`
  Svrha: export metadata, pointeri i lock trag za payroll outpute
  Payroll utjecaj: da

- `payroll_run_history`
  Object type: `AUDIT TABLE`
  Kategorija: `AUDIT`
  Svrha: history run statusa, approvala i export prijelaza
  Payroll utjecaj: indirektno, dokazno

- `v_payroll_ready_queue`
  Object type: `VIEW`
  Kategorija: `DERIVED`
  Svrha: pregled perioda i zaposlenika spremnih za payroll approval
  Payroll utjecaj: ne direktno

### 5B.5 Shared Audit i Lookup Domena

- `audit_log`
  Object type: `AUDIT TABLE`
  Kategorija: `AUDIT`
  Svrha: generički audit poslovno važnih promjena
  Payroll utjecaj: indirektno

- `status_catalog`
  Object type: `LOOKUP TABLE`
  Kategorija: `LOOKUP`
  Svrha: stabilni status kodovi ako prerastemo check constraint pristup
  Payroll utjecaj: ne direktno

- `source_system_catalog`
  Object type: `LOOKUP TABLE`
  Kategorija: `LOOKUP`
  Svrha: stabilni source system kodovi i značenja
  Payroll utjecaj: ne direktno

- `review_reason_catalog`
  Object type: `LOOKUP TABLE`
  Kategorija: `LOOKUP`
  Svrha: stabilni reason codeovi za review i approval tok
  Payroll utjecaj: ne direktno

## 5C. Procjena Broja Objekata za EPR

Početni operativni raspon za EPR nije alarmantan.
Naprotiv, to je znak da odgovornosti nisu stisnute u par nejasnih tablica.

Gruba procjena po fazama:

- Faza 1, minimalni operativni baseline
  Oko `8-12` fizičkih tablica i `2-4` viewa

- Faza 2, attendance + review + HZZO baseline
  Oko `12-18` fizičkih tablica i `4-8` viewova

- Faza 3, puni payroll i audit baseline
  Oko `18-30` fizičkih tablica i `6-12` viewova

Ova količina je za PostgreSQL mala do umjerena i ne predstavlja nikakav problem sama po sebi.

## 5D. Pravilo Klasifikacije Novih Objekata

Svaki novi DB objekt mora pri definiciji imati zapisano:
- `object_type`
- `data_category`
- `domain_owner`
- `edit_mode`
- `payroll_relevance`

Minimalne dopuštene `object_type` vrijednosti:
- `BASE TABLE`
- `VIEW`
- `MATERIALIZED VIEW`
- `LOOKUP TABLE`
- `AUDIT TABLE`

Minimalne dopuštene `data_category` vrijednosti:
- `RAW`
- `CANONICAL`
- `OVERRIDE`
- `DERIVED`
- `AUDIT`
- `LOOKUP`

## 5E. Data Sensitivity i Access Contract

Podatkovna klasifikacija i pristup moraju biti definirani jednako strogo kao ownership i provenance.

Za svaki canonical i derived objekt mora postojati:
- `sensitivity_level`
- `read_scope`
- `write_scope`

Minimalne `sensitivity_level` vrijednosti:
- `GENERAL_INTERNAL`
  Opći interni podaci bez payroll osjetljivosti.
- `SELF_VISIBLE`
  Podaci koje smije vidjeti i sam zaposlenik na kojeg se odnose.
- `MANAGEMENT_CONFIDENTIAL`
  Podaci vidljivi managementu, ali ne svakom korisniku.
- `HR_PAYROLL_CONFIDENTIAL`
  Osjetljivi payroll i HR podaci vidljivi samo HR/payroll ulozi i usko definiranom managementu.

Početna pravila pristupa:
- `employee_profile`
  `sensitivity_level`: `SELF_VISIBLE`
  `read_scope`: zaposlenik na kojeg se odnosi, management prema ovlastima, HR
  `write_scope`: administrativne uloge uz audit

- `employee_payroll_context`
  `sensitivity_level`: `HR_PAYROLL_CONFIDENTIAL`
  `read_scope`: HR, payroll voditelj, eksplicitno ovlašten management
  `write_scope`: HR/payroll administracija uz audit i razlog promjene

Pravila:
- osjetljivi payroll podaci ne smiju se štititi samo skrivanjem polja u UI-u
- read modeli moraju biti odvojeni po ulozi i razini povjerljivosti
- write prava moraju biti stroža od read prava
- svaka promjena nad `HR_PAYROLL_CONFIDENTIAL` podacima mora imati puni audit trag

## 6. Provenance Contract

Svaki poslovno bitan zapis mora imati podrijetlo.

Minimalna provenance polja po zapisu:
- `source_system`
- `source_record_id`
- `ingested_at`
- `created_at`
- `updated_at`
- `created_by`
- `updated_by`
- `change_reason`

Dozvoljene početne `source_system` vrijednosti:
- `GOSOFT_IMPORT`
- `HZZO_IMPORT`
- `MANUAL_ENTRY`
- `MANUAL_CORRECTION`
- `SYSTEM_DERIVED`
- `RFID_DIRECT`

Pravila:
- `RAW` tablice moraju čuvati originalni izvorni identitet.
- `CANONICAL` tablice moraju moći pokazati iz kojeg raw ili override traga proizlaze.
- `OVERRIDE` zapis mora imati eksplicitnog autora i razlog promjene.
- `DERIVED` zapis mora imati referencu na input snapshot ili approval baseline iz kojeg je nastao.

## 7. Mutation Contract

Mutacije se dijele u 4 klase:

- `INSERT_ONLY`
  Dodavanje bez prepisivanja postojećih zapisa.
- `UPSERT_ALLOWED`
  Dopušten insert/update uz audit i kontrolirana pravila.
- `APPEND_ONLY_HISTORY`
  Novi povijesni zapis bez izmjene starog.
- `IMMUTABLE_AFTER_LOCK`
  Dopušteno do lock/approval trenutka, nakon toga read-only.

Početna pravila mutacije:

- `RAW` tablice
  Mutacija: `INSERT_ONLY`
  Pravilo: raw import se ne smije ručno ispravljati

- `CANONICAL` tablice
  Mutacija: `UPSERT_ALLOWED`
  Pravilo: promjena mora imati audit i autora

- `OVERRIDE` tablice
  Mutacija: `APPEND_ONLY_HISTORY`
  Pravilo: override se ne briše tiho, nego se poništava novim zapisom ili statusom

- `DERIVED` tablice
  Mutacija: `IMMUTABLE_AFTER_LOCK`
  Pravilo: nakon approval/export trenutka rezultat se ne prepisuje

## 8. Temporal Contract

Vrijeme je dio integriteta.

Za employee podatke:
- svaki employee mora imati točno definiran employment raspon
- `datum_pocetka <= datum_kraja` kad je `datum_kraja` zadan
- `NULL datum_kraja` znači još aktivan
- ne smiju postojati nelogični ili neobjašnjeni preklapajući employment periodi

Za attendance podatke:
- event mora imati konzistentan vremenski raspon
- negativni interval nije dozvoljen kao canonical truth
- open interval može postojati samo kao privremeni review state, ne kao zaključani payroll state
- isti fizički događaj ne smije završiti u dva conflicting canonical eventa bez eksplicitnog review statusa

## 9. Status Contract

Sustav ne smije koristiti samo “record postoji”.
Operativni status mora biti eksplicitan.

Predloženi minimalni statusi za attendance event/current day state:
- `IMPORTED`
- `REVIEW_REQUIRED`
- `CORRECTED`
- `APPROVED`
- `LOCKED_FOR_PAYROLL`

Predloženi minimalni statusi za payroll run:
- `DRAFT`
- `VALIDATED`
- `APPROVED`
- `EXPORTED`
- `CANCELLED`

Pravila:
- `REVIEW_REQUIRED` podaci ne smiju automatski ući u zaključani payroll export
- `LOCKED_FOR_PAYROLL` zapis više se ne mijenja direktno
- svaka promjena zaključanog stanja mora otvoriti novi correction/revision trag

## 10. Constraint Contract

Strukturalni integritet mora biti u bazi.
Poslovni integritet mora biti u aplikaciji.

### 10.1 Baza Mora Čuvati

- primary key
- foreign key
- unique ključeve gdje poslovno vrijede
- check constraints za enumeracije i osnovna pravila raspona
- not null samo tamo gdje je stvarno obvezno

### 10.2 Aplikacija Mora Čuvati

- cross-record konfliktna pravila
- source priority pravila
- approval workflow pravila
- review trigger logiku
- payroll lock i export discipline

## 11. Review i Approval Contract

Podaci koji utječu na payroll moraju prolaziti kroz review/approval discipline.

Minimalna pitanja koja sustav mora moći odgovoriti:
- tko je otvorio review
- zašto je review otvoren
- tko je review zatvorio
- je li izvršena korekcija ili samo potvrda
- koji canonical zapis je odobren za payroll

Pravila:
- review nije isto što i korekcija
- korekcija nije isto što i approval
- approval mora biti posljednji korak prije payroll locka

## 12. Audit Contract

Svaka ručna ili sistemska poslovno važna promjena mora ostaviti audit trag.

Minimalni audit zapis mora sadržavati:
- entitet
- record id
- tip promjene
- prije stanje
- poslije stanje
- autor promjene
- vrijeme promjene
- razlog promjene

Audit mora omogućiti:
- rekonstrukciju odluke
- objašnjenje payroll rezultata
- rollback kroz novi korektivni zapis, ne tiho brisanje povijesti

## 13. Payroll Lock Contract

Nakon što je period odobren za payroll:
- attendance canonical state za taj period smatra se zaključanim
- export rezultat postaje referentni derived artifact
- naknadna promjena otvara correction/revision flow
- correction mora biti eksplicitno označen kao post-payroll intervencija

## 14. Soft Delete i History Contract

Početno pravilo:
- ne koristiti tihi hard delete za poslovno osjetljive tablice

Preferirani pristupi:
- statusno gašenje zapisa
- `valid_to` / `closed_at`
- correction zapis koji supersedira stari
- audit/history tablica za sve bitne promjene

## 15. Minimalni Obvezni Meta Stupci

Svaka nova canonical, override ili derived tablica treba razmotriti barem ova polja:
- `id`
- `source_system`
- `source_record_id`
- `status`
- `created_at`
- `created_by`
- `updated_at`
- `updated_by`
- `change_reason`

Za raw tablice:
- `import_batch_id`
- `ingested_at`
- `source_system`
- `source_record_id`
- `raw_payload_checksum`

## 16. Zabranjeni Obrasci

- ručna izmjena raw imported zapisa
- tiho prepisivanje canonical stanja bez audita
- brisanje poslovno bitnih zapisa bez povijesnog traga
- payroll export iz `REVIEW_REQUIRED` stanja bez eksplicitnog approvala
- business pravila skrivena samo u UI-u ili samo u compute kodu bez dokumentiranog contracta

## 17. Kontrolna Pitanja Prije Svake Nove Tablice

Prije dodavanja nove tablice mora postojati odgovor:

1. Je li tablica `RAW`, `CANONICAL`, `OVERRIDE`, `DERIVED` ili `AUDIT`?
2. Tko joj je owner?
3. Smije li se ručno uređivati?
4. Koje je podrijetlo podataka?
5. Koji je lifecycle statusa?
6. Koja pravila integriteta čuva baza?
7. Koja pravila integriteta čuva aplikacija?
8. Kako se promjena auditira?
9. Može li utjecati na payroll?
10. Kako se zaključava i kako se korigira nakon zaključavanja?

## 18. Trenutni Sljedeći Koraci

Na temelju ovog contracta sljedeće treba definirati:

- faza 1 obvezni EPR objekti koje stvarno implementiramo odmah
- employee domain schema baseline
- attendance domain schema baseline
- approval i review lifecycle
- canonical/current vs override granicu
- minimalni audit schema baseline
- koji će read modeli biti `VIEW`, a koji ostaju samo aplikacijski queryji
