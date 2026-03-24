# DNOPR P INOX Action Plan v1

## Svrha

Ovaj dokument definira prvi operativni akcijski plan za administrativni centar `P INOX` na temelju signala iz `DNOPR Lifecycle` modula i pripadnog `Action Queue` pogleda.

Cilj nije zatvoriti sve action redove odjednom, nego:

- uvesti redoslijed rada
- svesti nered na upravljive radne valove
- odvojiti tipove problema
- potvrditi glavne uzroke odstupanja u ERP evidenciji
- stvoriti osnovu za kasnije KPI upravljanje

## Polazište

Trenutno stanje u `P INOX` pokazuje:

- velik broj action redova
- isti `RN` često ima više signala
- isti uzrok se vjerojatno pojavljuje na više naloga
- voditelj ne može krenuti od "svega", nego mora imati početni redoslijed

Zato ovaj plan ne tretira `Action Queue` kao listu za ručno prolazak redak po redak, nego kao ulaz u kontrolirani triage proces.

## Osnovno Pravilo

Ne kreće se od svih action redova.

Kreće se po ovoj logici:

1. `AdmCtr = P INOX`
2. `Priority = HIGH`
3. statusni rez po fazi lifecycle-a
4. tek nakon toga planning i technology korekcije

## Prioritetni Redoslijed

### 1. Closing Cleanup

Prvi fokus:

- `Status = KO`
- `Queue = Closing Queue`
- signal tipično:
  - `KO bez actual`
  - `Plan/Actual gap`

Zašto prvo:

- `KO` formalno zatvara lifecycle
- ako je završetak nevjerodostojan, svi kasniji KPI-i su kompromitirani
- to je najskuplja vrsta loše evidencije jer djeluje kao "gotovo"

Primarna akcija voditelja:

- provjeriti je li nalog stvarno dovršen
- provjeriti postoji li stvarni trag rada i knjiženja
- provjeriti je li status `KO` postavljen prerano ili ručno bez punog pokrića
- u ERP-u uskladiti evidenciju prije daljnjih analiza

### 2. Execution Cleanup

Drugi fokus:

- `Status = LA`
- `Queue = Execution Queue`
- signal tipično:
  - `LA bez actual`
  - `WIP plan/actual`

Zašto drugo:

- `LA` predstavlja aktivnu proizvodnju
- tu se još može pravovremeno popraviti evidencija rada
- čišćenjem `LA` reda sprječava se proizvodnja novih loših `KO` zapisa

Primarna akcija voditelja:

- provjeriti da li se rad stvarno odvija
- provjeriti jesu li radnici evidentirali `start/stop`
- provjeriti postoji li samo djelomična ili zakašnjela evidencija
- dopuniti ili ispraviti actual trag dok je nalog još živ

### 3. Launch Readiness Cleanup

Treći fokus:

- `Status = LN`
- signal tipično:
  - `LN star`

Zašto treće:

- `LN` ne mora biti kritičan kao `KO` i `LA`
- ali stari `LN` nalozi zagađuju plan i lažno prikazuju spremnost proizvodnje

Primarna akcija voditelja:

- provjeriti je li nalog stvarno krenuo
- provjeriti treba li status prebaciti u `LA`
- provjeriti treba li korigirati `termin_zac`
- provjeriti treba li nalog vratiti u planski status ili drugačije revidirati

### 4. Planning Review

Četvrti fokus:

- `Status = PF`, `PL`, dio `LN`
- `Queue = Planning Queue`
- signal tipično:
  - `Plan revizija ops`
  - `Art/Plan odstupanje`

Zašto tek četvrto:

- generički artikli su po definiciji baseline, ne obavezna preslika
- svako odstupanje od generičke tehnologije nije greška
- planning review dolazi nakon što se smiri osnovna evidencijska i statusna disciplina

Primarna akcija voditelja / planera:

- provjeriti je li revizija plana opravdana
- provjeriti treba li korigirati `DNOPR`
- označiti artikle i projekte gdje se ista vrsta revizije stalno ponavlja

## Operativni Triage Model

Voditelj ne bi trebao gledati 500+ naloga kao jednu masu.

Preporučeni dnevni redoslijed rada:

1. Otvoriti `P INOX`
2. Filtrirati `Priority = HIGH`
3. Proći `KO`
4. Proći `LA`
5. Proći `LN`
6. Tek zatim pregledati `Planning Queue`

## Što Je Jedna Radna Jedinica

Osnovna radna jedinica nije action red, nego:

- jedan `RN`
- ili skup `RN` s istim obrascem problema

Drugim riječima:

- ako isti signal pogađa više naloga istog artikla ili projekta
- to treba tretirati kao batch problem, ne kao više izoliranih incidenata

## Grupiranje Po Uzroku

Action redove treba pokušati svesti na ove grupe uzroka:

### A. Krivi ili zastarjeli status

Primjeri:

- `LN star`
- `KO` bez punog pokrića

### B. Nedovoljna evidencija rada

Primjeri:

- `LA bez actual`
- `KO bez actual`

### C. WIP odstupanje

Primjeri:

- `WIP plan/actual`

### D. Planska revizija

Primjeri:

- `Plan revizija ops`
- `Art/Plan odstupanje`

### E. Sustavno tehnološko odstupanje

Primjeri:

- isti artikal stalno traži značajnu ručnu korekciju plana

## Preporučeni Prvi Tjedan Rada

### Dan 1-2

Fokus:

- `P INOX`
- `Priority = HIGH`
- `Status = KO`

Ishod:

- popis tipičnih razloga za nekonzistentno zatvaranje

### Dan 3-4

Fokus:

- `P INOX`
- `Priority = HIGH`
- `Status = LA`

Ishod:

- popis tipičnih rupa u actual evidenciji rada

### Dan 5

Fokus:

- `Status = LN`
- zatim prvi planning review presjek

Ishod:

- razdvajanje problema statusa od problema planiranja

## Minimalni Operativni Ciljevi

Prvi val rada ne treba ciljati "savršenstvo", nego ove rezultate:

- smanjiti broj `KO bez actual`
- smanjiti broj `LA bez actual`
- očistiti stare `LN`
- identificirati top artikle i top projekte s trajnim planning devijacijama

## Što Još Nedostaje Modulu

Za sljedeću verziju `Action Queue` rada trebamo:

- top pattern pregled po artiklu
- top pattern pregled po projektu
- batch orijentirani grouping
- preporučeni "first action" po tipu signala
- razlikovanje:
  - pojedinačni incident
  - serijski problem
  - tehnološki problem

## Zaključak

`Action Queue` nije lista koju treba ručno "odraditi" od vrha do dna.

To je alat za:

- triage
- grupiranje uzroka
- uvođenje reda u korekciju ERP evidencije
- pripremu budućih KPI i management pogleda

Za `P INOX` prvi operativni princip glasi:

- prvo zatvaranje (`KO`)
- zatim aktivni nalozi (`LA`)
- zatim stari lansirani (`LN`)
- tek onda planske i tehnološke korekcije
