# DXF_PROCESSOR_CHARTER_v0

## 1. Svrha

Ovaj dokument je nulta verzija chartera za budući company-wide DXF Processor sustav.

Njegova svrha je:

- postaviti jasnu logičku i semantičku sliku sustava
- razdvojiti `DCM` i `DBR`
- predvidjeti technology-oriented derivate
- odmah uključiti `Stacker / Combiner` kao sastavni dio prvog OPS derivata
- omogućiti daljnji razvoj bez ponavljanja obrasca hipertrofiranog, hardcoded modula

Ovo nije finalni spec.

Ovo je:

- početni charter
- radni okvir
- zajednički referentni dokument za daljnje odluke

---

## 2. Polazište

Trenutno postoje dvije važne činjenice:

1. Zoranov postojeći `dxf-modifier` radi i ide u testnu produkciju.
2. Njegova struktura nije dugoročno održiva jer je previše logike utrpano u jedan modul.

Zaključak:

- postojeći modul je vrijedan kao dokaz da koncept radi
- ali nije dobar kao dugoročni arhitekturni uzor

Treba profitirati iz oba aspekta:

- zadržati praktično naučeno ponašanje
- ne prenositi nekontrolirano postojeću strukturu

---

## 3. Temeljna podjela sustava

Budući DXF Processor sustav sastoji se od dva glavna operativna moda:

### `DCM`

- `DXF Core Module`
- `DXF_CORE_MODULE`

Uloga:

- priprema
- engine
- manual authoring
- semantic obrada
- parametrizacija
- preview
- approval

`DCM` je human-in-the-loop modul.

### `DBR`

- `DXF Batch Runner`
- `DXF_BATCH_RUNNER`

Uloga:

- batch execution
- headless run
- unattended processing
- output packaging
- produkcijski handoff

`DBR` je headless execution modul.

---

## 4. Glavno arhitekturno načelo

`DCM` i `DBR` zajedno čine jedan company-wide DXF Processor.

To znači:

- ne gradimo odvojene sustave za svaku tehnologiju
- gradimo jedan zajednički DXF Processor
- različite tehnologije postaju derivati nad istim procesorom

Time dobivamo:

- zajednički core
- stabilniji razvoj
- lakše održavanje
- čišće dodavanje novih tehnologija

---

## 5. Technology derivatives

DXF Processor mora podržavati više technology-oriented derivata.

Prvi konkretni derivat je:

### `OPS_S4P4`

To je prvi technology profile za:

- Salvagnini liniju
- OPS postprocesor
- S4P4 proizvodni tok

Kasniji očekivani derivati mogu biti:

- `LASER`
- `MORBIDELLI`
- drugi budući technology profili

Važno pravilo:

- technology profile ne smije razvaliti core
- technology-specific pravila moraju biti jasno odvojena od zajedničkog enginea

---

## 6. Uloga `mother_dxf_v1`

`mother_dxf_v1` je predviđen kao temelj budućeg canonical DXF enginea.

Njegova posebna vrijednost je:

- Stage 0 sanitize
- Stage 1 semantic preparation
- 9-layer dimenzionalna klasifikacija
- podrška za `999` metadata model

Strategijski smjer je:

- `mother_dxf_v1` dograditi u canonical manipulation core
- ne razvijati budući sustav na obrascu sadašnjeg `dxf-modifiera`

Time `mother_dxf_v1` postaje jezgra `DCM` modula.

---

## 7. Uloga postojećeg `dxf-modifiera`

Postojeći `dxf-modifier` ostaje važan kao:

- referenca ponašanja
- izvor domenskog znanja
- izvor naučenih edge caseova
- dokaz da praktični workflow može raditi

Ali ne treba ga tretirati kao finalni arhitekturni blueprint.

Njegova sadašnja vrijednost je:

- učenje iz realnih runova
- promatranje što djeluje u praksi
- prepoznavanje gdje sustav gubi fleksibilnost

Primjer te izgubljene fleksibilnosti je:

- dodavanje novog parta traži previše hardcoded zahvata

To je upravo obrazac koji novi sustav mora izbjeći.

---

## 8. Canonical flow

Budući canonical flow kroz `DCM` i `DBR` je:

1. input payload / order context
2. mother DXF ingest
3. raw DXF sanitize
4. semantic priprema
5. `999` instruction parsing
6. child planning
7. child DXF generation
8. technology-specific operation processing
9. approval boundary
10. batch execution
11. produkcijski output

Važno:

- `DCM` pokriva pripremu i approval
- `DBR` pokriva execution i produkcijski run

---

## 9. `Stacker / Combiner` u prvom charteru

`Stacker / Combiner` mora biti uvršten već u ovaj prvi charter.

Razlog:

- nalazi se na direktnoj razvojnoj putanji prvog OPS derivata
- nije sporedan dodatak
- nije kasniji luksuz
- već sada je dio praktičnog tokа koji vodi do proizvodnog outputa

### Kako ga tretirati

`Stacker / Combiner` se ne tretira kao poseban treći batch sustav.

Tretira se kao:

- technology-specific operation family
- unutar prvog `OPS_S4P4` profila

To znači:

- `combine`
- `decombine`
- `stack`
- eventualni srodni kratki transformation tokovi

spadaju u technology-specific operation layer, a ne u zaseban paralelni sustav.

---

## 10. Poseban status `Combiner` operacije

Za prvi OPS derivat postoji konkretna potreba:

- logički set partova može se privremeno grupirati u jedan izvedeni tehnološki derivat
- taj derivat ima kratak lifecycle
- nakon jedne operacije na liniji partovi ponovno nastavljaju odvojeno dalje kroz firmu

Zato se `Combiner` ne definira kao:

- novi quasi-batch
- novi samostalni modul
- novi odvojeni workflow svijet

Nego kao:

- jedna specifična operation nad partovima
- unutar technology-specific OPS profila

To je ključna odluka jer zadržava arhitekturu čistom.

---

## 11. Što `DCM` mora pokrivati

`DCM` mora pokrivati:

- mother DXF pripremu
- semantic klasifikaciju
- `999` instruction handling
- child planning
- child generation
- preview
- manual correction
- approval
- technology-specific operation preview gdje je potrebno

`DCM` ne smije postati:

- headless batch runner
- produkcijski scheduler
- execution queue engine

---

## 12. Što `DBR` mora pokrivati

`DBR` mora pokrivati:

- headless batch run
- approved input ingest
- technology profile execution
- operation execution po pravilima profila
- output packaging
- manifests
- audit trail
- produkcijski handoff

`DBR` ne smije pokrivati:

- ručni authoring
- ručnu semantičku pripremu
- ad hoc UI driven korekcije

---

## 13. Approval boundary

Između `DCM` i `DBR` mora postojati jasan approval boundary.

To znači:

- `DCM` proizvodi pripremljen i odobren package
- `DBR` nikada ne radi direktno nad neodobrenim ručnim inputom

To je jedno od ključnih sigurnosnih i arhitekturnih pravila sustava.

---

## 14. Razvojna strategija

Razvoj neće ići tako da se odmah pokuša dobiti puni `DBR` output.

Preporučeni smjer je:

1. iscrpno kristalizirati charter i logičke odnose
2. pažljivo graditi `DCM`
3. koristiti mnogo smoke testova
4. paralelno modelirati `DBR` kroz simulator / POC
5. tek nakon toga graditi puni `DBR`

Ovaj pristup smanjuje rizik da se u `DBR` prerano ugradi pogrešna tehnologijska logika.

---

## 15. DBR simulator kao POC

Prije punog `DBR` modula preporučuje se:

- `DBR simulator POC`

Njegova svrha je:

- modelirati batch lifecycle
- testirati handoff iz `DCM`
- modelirati manifests i run states
- modelirati technology-oriented execution profile
- otkriti rupe prije stvarne produkcijske automatizacije

To je posebno važno jer se očekuje više technology-specific `DBR` derivata.

---

## 16. Najvažniji arhitekturni rizici

Najveći rizici koje treba izbjeći su:

- da `DCM` opet postane jedan pretrpani modul
- da se technology-specific pravila hardcodiraju u core
- da `Combiner` preraste u novi paralelni batch sustav
- da se approval boundary zamagli
- da convenience flowovi postanu canonical flow
- da dodavanje novog parta opet traži stotine linija novog koda

---

## 17. Smjer daljnjeg rada

Iz ovog chartera proizlazi preporučeni redoslijed rada:

1. zaključati nomenklaturu
2. potvrditi `DCM` i `DBR` scope
3. potvrditi `OPS_S4P4` kao prvi technology profile
4. potvrditi `Stacker / Combiner` kao operation family unutar tog profila
5. definirati canonical artefakte između `DCM` i `DBR`
6. definirati `InstructionSet`
7. definirati `ChildPlan`
8. napraviti `DBR simulator POC`
9. graditi `DCM`
10. tek nakon toga graditi puni `DBR`

---

## 18. Nulta verzija zaključka

Nulta verzija zaključka glasi:

- gradimo jedan company-wide `DXF Processor`
- njegova dva glavna moda su:
  - `DCM`
  - `DBR`
- prvi technology derivative je `OPS_S4P4`
- `Stacker / Combiner` je first-line dio tog derivata
- `Combiner` je operation, ne zaseban batch sustav
- `mother_dxf_v1` je buduća canonical osnova
- postojeći `dxf-modifier` ostaje referenca i izvor naučenog ponašanja
- razvoj se vodi pažljivo, sa smoke testovima, simulatorima i postupnim kristaliziranjem contracta
