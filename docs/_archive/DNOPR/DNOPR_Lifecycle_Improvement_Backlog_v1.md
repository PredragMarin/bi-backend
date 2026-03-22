# DNOPR Lifecycle Improvement Backlog v1

## Svrha

Ovaj dokument služi kao radni backlog za paralelni razvoj:

- `A` poboljšanje `DNOPR Lifecycle` modula
- `B` podrška transformaciji evidencije operacija u proizvodnji
- `C` zadržavanje `Gosoft ERP` kao glavnog source of truth

Dokument nije tehnički changelog nego upravljačka lista prioriteta.

## Glavni Cilj

Cilj modula nije samo prikaz radnih naloga nego stvaranje BI sustava koji može odgovoriti na 5 ključnih pitanja:

1. Je li generička tehnologija artikla bliska realnoj proizvodnji?
2. Je li planska tehnologija radnog naloga kvalitetno pripremljena?
3. Je li actual rad pravilno evidentiran po operacijama?
4. Je li završetak radnog naloga (`KO`) semantički vjerodostojan?
5. Koje korekcije treba napraviti u ERP-u i u tehnološkim standardima?

## Radne Struje

### Stream A: Modul

Fokus:

- data model
- read model
- UI
- KPI i anomaly sloj
- BI derivati

### Stream B: Proces

Fokus:

- disciplina planiranja
- disciplina evidencije rada
- kvaliteta zatvaranja naloga
- korekcije tehnologija artikala
- operativna edukacija korisnika

### Stream C: Governance

Fokus:

- ERP ostaje source of truth
- BI samo čita, normalizira, analizira i signalizira
- korekcije se vraćaju u ERP procese

## Prioriteti

### P0: Semantička Stabilizacija

Bez ovoga KPI i anomaly logika neće biti pouzdani.

Zadaci:

- zaključati semantiku statusa `PL/PF/LN/LA/KO/PP`
- zaključati definiciju lifecycle prijelaza
- potvrditi jedinice vremena u svim izvorima
- potvrditi pravilo zatvaranja `KO`
- potvrditi ulogu ručnog vs automatskog prijelaza statusa
- potvrditi što znači “dobro evidentiran nalog”

Output:

- formalni state model
- formalna definicija mjera i statusa

### P1: KPI Jezgra Po Nalogu

Zadaci:

- standardizirati `Artikal min`
- standardizirati `Plan min`
- standardizirati `Actual min`
- uvesti `Art vs Plan variance`
- uvesti `Plan vs Actual variance`
- brojati `Art Ops`, `Ops`, `Actual covered ops`
- definirati `coverage score`

Output:

- kanonski KPI set po `dnid`

### P2: Anomaly Pravila

Zadaci:

- `LA` bez dovoljno actual evidencije
- `KO` bez vjerodostojnog actual traga
- `LN` koji predugo stoji bez aktivacije
- veliko odstupanje `Artikal min vs Plan min`
- veliko odstupanje `Plan min vs Actual min`
- veliki nesrazmjer `Art Ops vs Ops`
- nelogični statusni prijelazi
- nalog završen ručno bez procesa koji to podupire

Output:

- anomaly catalog v1
- severity model

### P3: Agregati

Zadaci:

- agregati po `admctr`
- agregati po `projekt`
- agregati po `artikal`
- agregati po `radnik`
- agregati po statusu
- dnevni/YTD snapshoti

Output:

- KPI dashboard sloj
- BI derivati za trend i sezonalnost

### P4: Operativna Podrška

Zadaci:

- vodič za korištenje modula
- operativna pravila za lansiranje naloga
- operativna pravila za evidenciju start/stop rada
- pravila za zatvaranje `KO`
- pravila za korekciju tehnologije artikla

Output:

- lokalna uputstva
- SOP za korisnike

## KPI Kandidati

### Planiranje

- udio `PL` naloga koji kasnije traže veliku ručnu korekciju
- udio `PF` naloga po centru
- prosječno odstupanje `Artikal min vs Plan min`
- prosječno odstupanje `Art Ops vs Ops`

### Izvedba

- prosječno odstupanje `Plan min vs Actual min`
- udio `LA` naloga s potpunim actual tragom
- udio naloga s praznim ili slabim feedback tragom
- prosječno vrijeme od `LN` do prvog `LA` signala

### Zatvaranje

- udio `KO` naloga s potpunim evidencijskim tragom
- udio `KO` naloga s anomaly zastavicama
- vrijeme od zadnjeg actual eventa do `KO`

### Kvaliteta Tehnologije

- artikli s najvećim trajnim odstupanjem `Artikal min vs Plan min`
- artikli s najvećim nesrazmjerom `Art Ops vs Ops`
- projekti gdje se generička tehnologija sustavno revidira

## Anomaly Pravila v1

### Statusne anomalije

- `PL` nalog s actual tragom
- `LN` nalog bez prelaska u `LA` nakon predugog vremena
- `KO` nalog bez relevantnog actual traga
- nelogičan povratak iz višeg statusa u niži

### Planske anomalije

- `Ops = 0` uz izvršni nalog
- `Plan min = 0` uz postojeće operacije
- veliko odstupanje između `Artikal min` i `Plan min`

### Evidencijske anomalije

- `LA` s premalo feedback zapisa
- actual rad bez pokrića u planskim operacijama
- operacije bez actual pokrića kad bi ga trebale imati

### Tehnološke anomalije

- prevelik broj ručnih odstupanja od generičke tehnologije
- artikli čija nativna tehnologija očito ne odgovara realnosti

## Predloženi Redoslijed Implementacije

### Faza 1

- zaključati mjere i jedinice
- dodati formalni lifecycle state model
- uvesti prve anomaly flagove po nalogu

### Faza 2

- dodati agregate po `admctr`, `projekt`, `artikal`
- dodati KPI panel u UI
- uvesti filtere po anomaly tipu

### Faza 3

- spremati dnevne derivate
- napraviti YTD KPI sloj
- uvesti trend i sezonalnost

### Faza 4

- povezati BI nalaze s operativnim uputstvima
- formalizirati povratnu petlju prema tehnologiji i planiranju

## Operativne Aktivnosti Izvan Modula

Modul sam po sebi neće popraviti proces. Potrebne su i organizacijske aktivnosti:

- definirati minimalni standard evidencije operacija
- definirati kada nalog smije prijeći u `KO`
- definirati odgovornost za korekciju DNOPR plana
- definirati odgovornost za korekciju nativne tehnologije artikla
- uvesti pregled anomaly nalaza po centrima
- koristiti nalaze modula za edukaciju korisnika

## Pravilo Source Of Truth

`Gosoft ERP` ostaje glavni operativni izvor istine.

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

## Sljedeći Dokumenti

Nakon ovog backloga slijede:

- `Lifecycle State Model`
- `KPI Definition Sheet`
- `Anomaly Catalog`
- `Operational SOP`

## Zaključak

Najveća vrijednost modula nije u tome da pokaže pojedini DN, nego da omogući stalno poboljšavanje:

- tehnologije artikala
- planiranja DN-a
- actual evidencije rada
- discipline zatvaranja proizvodnje

To je osnova za budući KPI sustav proizvodnje.
