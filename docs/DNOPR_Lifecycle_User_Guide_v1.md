# DNOPR Lifecycle User Guide v1

## Svrha

`Lifecycle DNOPR` je BI modul za praćenje cijelog životnog ciklusa radnog naloga kroz tri razine:

- `Artikal / nativna tehnologija`
- `Plan radnog naloga`
- `Actual realizacija u proizvodnji`

Modul koristi `Gosoft ERP` kao glavni source of truth i služi za:

- kontrolu kvalitete planiranja
- kontrolu kvalitete evidencije rada po operacijama
- usporedbu standardne tehnologije artikla sa stvarnim planom naloga
- usporedbu plana naloga sa actual realizacijom
- pripremu KPI i anomaly logike za BI sustav

## Source Of Truth

Modul čita podatke iz ERP-a i ne mijenja ERP zapise.

Glavni izvori:

- `V_DN` = header radnog naloga
- `V_DNOPR` = planirane operacije radnog naloga
- `V_FEEDBACK` = actual ledger realizacije
- `ARTIKEL` = naziv artikla, jedinica mjere, tehnološki ključ `tehid`
- `V_TehOpr_Var` = nativna tehnologija artikla

## Lifecycle Semantika

Glavni statusi koje pratimo:

- `PL` = planiran
- `PF` = fiksno planiran
- `LN` = lansiran neaktivan
- `LA` = lansiran aktivan
- `KO` = završen
- `PP` = prognoza, poseban planski tip

Osnovna izvedbena putanja je:

`PL -> PF -> LN -> LA -> KO`

Nisu svi koraci obavezni za svaki nalog, ali `LA` i `KO` su ključni za analizu actual realizacije i zatvaranja.

## Početni Ekran

Početni ekran prikazuje:

- broj radnih naloga u učitanom windowu
- broj planiranih operacija
- broj ledger zapisa
- broj distinct artikala
- aktivni vremenski window

Zadani window je:

- `today -90 dana`
- `today +90 dana`

Lista se pri učitavanju fokusira oko `Termin = danas`.

## Filteri

Filteri se primjenjuju na trenutno učitani window:

- `From`
- `To`
- `AdmCtr`
- `Projekt`
- `Status`
- `Search sifradn`
- `Sort`
- `Direction`

Napomena:

- `Projekt` ovisi o trenutno odabranom `AdmCtr`
- `Search` traži po `sifradn`

## Work Orders In Window

Ovo je glavni radni pogled modula. Svaki red predstavlja jedan radni nalog.

Ključne kolone:

- `Termin` = planirani početak naloga
- `RN` = poslovna šifra radnog naloga (`sifradn`)
- `Projekt` = grupa / projekt kojem nalog pripada
- `Status` = trenutni lifecycle status
- `AdmCtr` = administrativni ili proizvodni centar
- `Artikal` = šifra artikla
- `Naziv artikla` = naziv iz `ARTIKEL`
- `JM` = jedinica mjere artikla
- `Kol` = količina naloga
- `Art Ops` = broj operacija nativne tehnologije artikla iz `V_TehOpr_Var`
- `Artikal min` = ukupno normirano vrijeme artikla prema nativnoj tehnologiji
- `Ops` = broj planiranih operacija na konkretnom nalogu iz `V_DNOPR`
- `Ledger` = broj actual zapisa iz `V_FEEDBACK`
- `Plan min` = suma planiranih minuta operacija naloga
- `Art/Plan variance` = `Plan min - Artikal min`
- `Actual min` = suma actual minuta iz `V_FEEDBACK`
- `Last feedback` = zadnji evidentirani actual zapis

## Kako Čitati Artikal Vs Plan Vs Actual

To je središnja logika modula.

### 1. Artikal

`Artikal min` i `Art Ops` predstavljaju nativni standard artikla.

Izračun:

- iz `ARTIKEL` dohvaćamo `tehid`
- u `V_TehOpr_Var` dohvaćamo tehnološke operacije artikla
- `Art Ops` = broj distinct tehnoloških operacija
- `Artikal min` = suma `((casvar + casfix) * kolicina)` za sve operacije, prikazana u minutama

To je referentna, generička tehnologija artikla.

### 2. Plan

`Ops` i `Plan min` predstavljaju plansku tehnologiju konkretnog radnog naloga.

To nije nužno isto što i nativna tehnologija artikla. Inženjer može:

- dodati operacije
- izbaciti operacije
- promijeniti tehnološki slijed
- prilagoditi nalog realnoj potrebi proizvodnje

### 3. Actual

`Actual min` predstavlja stvarnu realizaciju evidentiranu kroz `Start/Stop` logiku u `V_FEEDBACK`.

To je stvarni trag rada na nalogu.

## Tumačenje Odstupanja

Najvažnije usporedbe su:

- `Artikal min vs Plan min`
- `Plan min vs Actual min`

Tipična značenja:

- `Plan min` blizu `Artikal min`
  - planska tehnologija prati generički standard
- `Plan min` značajno odstupa od `Artikal min`
  - nalog je ručno revidiran ili je standard artikla zastario
- `Actual min` značajno odstupa od `Plan min`
  - problem može biti u planiranju, izvedbi ili evidenciji rada
- `KO` uz slab actual trag
  - moguća nekonzistentnost zatvaranja naloga

## Selected Work Order

Desni panel prikazuje detalj odabranog naloga:

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

Ispod se vide:

- planirani termini naloga
- datumi lansa i završetka
- request identifikator backend dohvaćanja

## Operacije Po Nalogu

Ovdje se vidi planska tehnologija konkretnog radnog naloga iz `V_DNOPR`.

Kolone:

- `Oper`
- `Opis`
- `Status`
- `StdOper`
- `DM`
- `Artikal min`
- `Plan min`
- `Actual min`
- `Variance`
- `Next`

Na dnu tablice je sumarni red `Ukupno`:

- ukupno `Artikal min`
- ukupno `Plan min`
- ukupno `Actual min`
- ukupno `Variance`

Taj red služi za lokalnu konfrontaciju:

- standard artikla
- plan naloga
- actual realizacija

## Ledger Timeline

`Ledger timeline` prikazuje kronološki actual trag iz `V_FEEDBACK`.

To je dokaz da je rad na operacijama zaista evidentiran.

Posebno je važan za naloge sa statusom:

- `LA`
- `KO`

Ako je nalog aktivan ili završen, a ledger je slab ili nelogičan, to je signal za provjeru evidencije.

## Što Modul Trenutno Pomaže Otkriti

Modul već sada pomaže identificirati:

- zastarjele ili nepodesne generičke tehnologije artikala
- planirane naloge koji nisu dovoljno prilagođeni realnoj proizvodnji
- nedovoljno evidentiranje actual rada
- neusklađenost između tehnologije artikla, plana naloga i actual realizacije
- sumnjive završetke naloga

## Operativna Upotreba

Preporučeni način rada:

1. filtrirati po `AdmCtr`
2. filtrirati po `Projekt`
3. fokusirati se na `LA` i `KO`
4. gledati `Artikal min`, `Plan min`, `Actual min`
5. otvoriti detalj naloga
6. provjeriti planske operacije
7. provjeriti ledger timeline
8. označiti gdje je problem:

- generička tehnologija artikla
- planiranje naloga
- evidencija rada
- zatvaranje naloga

## Što Slijedi U Sljedećim Verzijaма

Planirane nadogradnje modula:

- anomaly pravila po statusima `PL/PF/LN/LA/KO`
- KPI po `AdmCtr`, projektu, artiklu i radniku
- agregati za YTD, trend i sezonalnost
- klasifikacija kvalitete planiranja
- klasifikacija kvalitete evidencije
- označavanje sumnjivih `KO` naloga
- preporuke za korekciju generičke tehnologije

## Zaključak

`Lifecycle DNOPR` nije samo pregled radnih naloga. To je BI alat za:

- učenje iz odstupanja
- poboljšanje planiranja
- poboljšanje evidencije rada
- poboljšanje generičkih tehnologija artikala
- izgradnju KPI sustava za proizvodnju
