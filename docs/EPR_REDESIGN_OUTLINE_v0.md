# EPR Redesign Outline v0

## 1. Svrha

Ovaj dokument definira radni outline za redefiniciju EPR modula prije pisanja novog compute/payroll scripta.

Cilj je zamijeniti implicitno legacy ponašanje eksplicitnim, preglednim policyjem i input kontraktima.

Ovo je živi dizajnerski dokument.
Treba rasti i mijenjati se dok ne postane stabilna podloga za implementaciju.

## 2. Cilj Redizajna

Redizajn treba proizvesti:
- jasan model izvora istine
- canonical input model
- eksplicitna attendance pravila
- eksplicitna payroll pravila i utjecaje
- determinističke review triggere
- scenario katalog koji može poslužiti kao baza za smoke testove i kasnije automatizirane testove

## 3. Dizajnerski Principi

- Policy mora biti definiran prije implementacije.
- Semantika inputa mora biti jasna prije finalizacije policyja.
- Niti jedna skrivena iznimka ne smije postojati samo u kodu.
- Svaki override mora imati jasno deklariran autoritet i scope.
- Svaki manual intervention path mora biti dokumentiran kao poslovni proces, a ne prikriven kao compute logika.
- Attendance logika i payroll logika mogu biti povezane, ali ne smiju biti stopljene u jedan nedokumentirani proceduralni blok.
- Nova implementacija mora raditi nad canonical facts slojem, a ne direktno nad raw ERP/HZZO formatima.

## 4. Radne Faze

### Faza 1. Izvori Istine

Cilj:
Definirati koji su upstream izvori autoritativni, koji su supporting, koji su override-only, a koji audit-only.

Output:
- source registry
- model povjerenja
- pravila za handling konflikata među izvorima
- smoke testovi izvora

Radni dokument:
- `docs/EPR_SOURCE_OF_TRUTH_v0.md`

### Faza 2. Canonical Input Model

Cilj:
Definirati normalizirani input kontrakt koji će koristiti buduća compute logika.

Output:
- canonical datasetovi
- semantika polja
- podjela na raw, normalized i derived polja
- input validation pravila

Planirani dokument:
- `docs/EPR_INPUT_CANONICAL_MODEL_v0.md`

### Faza 3. Domenski Rječnik

Cilj:
Definirati sve poslovne pojmove tako da ista riječ uvijek znači isto.

Output:
- glossary
- definicije domenskih eventa
- definicije day stateova
- definicije interval stateova

Planirani dokument:
- `docs/EPR_DOMAIN_VOCABULARY_v0.md`

### Faza 4. Attendance Policy

Cilj:
Definirati day-level i interval-level attendance odluke bez payroll prečaca.

Output:
- pravila po decision stepovima
- prioritet pravila
- dopuštene policy iznimke
- review triggeri

Planirani dokument:
- `docs/EPR_ATTENDANCE_POLICY_v0.md`

### Faza 5. Payroll Mapiranje

Cilj:
Definirati kako attendance ishodi utječu na payroll buckete.

Output:
- mapiranje payroll bucketa
- pravila prijelaza s dana na period
- policy za debt/overtime interakcije
- obrada non-workday slučajeva

Planirani dokument:
- `docs/EPR_PAYROLL_POLICY_v0.md`

### Faza 6. Scenario Katalog

Cilj:
Validirati policy na realnim i sintetičkim slučajevima prije implementacije.

Output:
- happy-path scenariji
- edge caseovi
- policy konfliktni scenariji
- očekivani daily i payroll ishodi

Planirani dokument:
- `docs/EPR_SCENARIO_CATALOG_v0.md`

### Faza 7. Implementacijski Kontrakt

Cilj:
Zamrznuti čistu implementacijsku granicu za budući script.

Output:
- compute faze
- granice modula
- artifact kontrakt
- validation path

Planirani dokument:
- `docs/EPR_IMPLEMENTATION_CONTRACT_v0.md`

## 5. Predložene Buduće Compute Faze

Novi script trebao bi biti organiziran kao staged computation:

1. Raw ingest
2. Tehnička validacija
3. Canonical normalizacija
4. Source reconciliation
5. Attendance decisioning
6. Derivacija review/anomaly signala
7. Payroll mapiranje
8. Period agregacija
9. Generiranje artefakata

## 6. Kategorije Odluka

Svako buduće pravilo treba pripadati točno jednoj od ovih kategorija:

- rule o autoritetu izvora
- normalizacijsko pravilo
- attendance policy pravilo
- payroll mapping pravilo
- review trigger
- data-quality failure pravilo
- manual override pravilo

## 7. Trenutni Rizici Koje Ovaj Redizajn Mora Ukloniti

- policy ponašanje postoji samo kao grananje u legacy compute logici
- iznimke se dodaju reaktivno da bi se zatvorio konflikt
- značenje raw inputa nije dovoljno eksplicitno
- review triggeri i payroll pravila su previše čvrsto spojeni
- daljnje širenje payroll logike bi povećalo fragilnost

## 8. Metoda Rada

Za svaku fazu redizajna:

1. Zapisati pravila običnim jezikom.
2. Identificirati nejasnoće i konflikte.
3. Svaku otvorenu stavku klasificirati kao policy, input ili data-quality problem.
4. Definirati smoke scenarije.
5. Potvrditi baseline faze.
6. Tek onda prijeći dalje.

## 9. Kontrola Promjena

Dok redizajn ne dođe do implementacijskog baselinea:

- ovaj outline je autoritativan za redoslijed rada
- detaljni fazni dokumenti su autoritativni unutar svoje domene
- otvorene stvari moraju ostati dokumentirane i ne smiju se tiho rješavati u kodu

## 10. Trenutni Sljedeći Korak

Aktivni sljedeći korak je:

- Faza 1: Izvori Istine

