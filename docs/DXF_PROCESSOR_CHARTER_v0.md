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

## Current Implementation Snapshot

As of 2026-04-26, the repository contains an early practical DCM authoring slice inside `mother_dxf_v1`.

Currently implemented:

- Stage 0 / Stage 1 Mother DXF session workflow
- guided `999` / `SEM:` metadata authoring
- Parameter Catalog JSON contract artifact
- MXD Rule Catalog JSON contract artifact
- Metadata Authoring modes:
  - presence condition
  - geometry role
  - operation reference
- pre-child simulation preview for simple `presence=conditional` visibility

Not yet implemented:

- ChildPlan
- rule expression evaluator
- Operation Catalog
- DBR
- approval-grade validator

This snapshot documents current code state. It does not narrow the long-term DXF Processor target.

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
- profile selection
- catalog-driven authoring
- rule / operation references as contract carriers

`DCM` je human-in-the-loop modul.

Ako inženjer naiđe na situaciju koju postojeći catalogi ne mogu jednoznačno opisati, to nije ad hoc metadata problem.

To je očekivani authoring gap:

- `needs_rule`
- `needs_catalog_entry`
- `needs_operation`

Takav gap treba evidentirati i riješiti kroz profile-specific catalog, ne kroz slobodno tipkanje neprovjerenih stringova.

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
- `MXD_DOOR_V0`
- future `INOX_*`
- future `WORKTOP_SINK_*`

Važno pravilo:

- technology profile ne smije razvaliti core
- technology-specific pravila moraju biti jasno odvojena od zajedničkog enginea
- profile-specific catalogi ne smiju postati hardcoded engine logic

Technology profile može uključivati:

- parameter catalog
- rule catalog
- future operation catalog

Ovo omogućuje da generički DCM ostane jedan, a da MXD, INOX, worktop/sink i drugi programi imaju svoje kontrolirane domain cataloge.

---

## 5A. Profile and Catalog Model

DXF Processor koristi generički engine i profile-specific cataloge.

Profile concept:

```json
{
  "profile_id": "MXD_DOOR_V0",
  "parameter_catalog": "parameter_catalog_mxd_door_v0.json",
  "rule_catalog": "rule_catalog_mxd_door_v0.json",
  "operation_catalog": "operation_catalog_mxd_door_v0.json"
}
```

Generički DCM zna:

- učitati profile
- prikazati cataloge
- voditi guided authoring
- validirati metadata shape
- detektirati `needs_rule` / `needs_catalog_entry`

Generički DCM ne zna hardcoded MXD, INOX ili worktop/sink business logiku.

Ta logika živi u profile-specific catalogima.

Catalog families:

- Parameter Catalog
- Rule Catalog
- future Operation Catalog
- future Variant / Anchor Catalog ako se pokaže potrebno

---

## 5B. Current MXD Door Profile Seed

Prvi stvarni profile/catalog seed nastao je kroz MXD/KSKR Mother DXF authoring.

Current artifacts:

- `src/modules/mother_dxf_v1/contracts/parameter_catalog_legacy_door_v0.json`
- `src/modules/mother_dxf_v1/contracts/rule_catalog_mxd_door_v0.json`

Current MXD draft rules:

- `THIRD_HINGE_ABOVE_SECOND_MIN_HEIGHT`
- `THIRD_HINGE_BELOW_SECOND_FALLBACK`

Ovi artefakti su privremeni module contract JSON artefakti.

Dugoročno, isti model može biti poslužen kroz Core Shell catalog service ili BI database interface.

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
2. profile selection
3. Parameter Catalog load
4. Rule Catalog load
5. future Operation Catalog load
6. mother DXF ingest
7. raw DXF sanitize
8. semantic priprema
9. guided `999` metadata authoring
10. `999` instruction parsing
11. rule / operation reference binding
12. child planning
13. child DXF generation
14. technology-specific operation processing
15. approval boundary
16. batch execution
17. produkcijski output

Važno:

- `DCM` pokriva pripremu i approval
- `DBR` pokriva execution i produkcijski run
- catalog loading and metadata authoring are DCM responsibilities
- execution of approved plans is DBR responsibility

---

## 8A. Geometry Strategy Patterns

DXF Processor mora podržati najmanje dva geometry authoring patterna.

### Pattern A: Variant Geometry Presence

Koristi se kada je broj varijanti mali i CAD-smisleno je ucrtati više alternativnih blockova.

Primjer:

- treća spojnica iznad druge
- treća spojnica ispod druge

Mother DXF nosi više postojećih alternativnih blockova.

Metadata opisuje:

- feature
- role
- variant
- optional `rule_ref`

ChildPlan kasnije bira koja varijanta ostaje aktivna.

### Pattern B: Prototype Geometry + Placement Plan

Koristi se kada bi sve kombinacije u Mother DXF-u eksplodirale u previše preklopljenih blockova.

Primjer:

- radna ploča / sudoper
- više cutout prototype blockova
- mirror
- translate
- calculated offset
- left/right placement

Mother DXF nosi prototype geometry na canonical insertion lokaciji.

Metadata opisuje:

- `role=prototype`
- feature
- variant
- operation reference

ChildPlan / operation layer kasnije odlučuje koliko instanci nastaje i gdje se materializiraju.

Ovaj pattern čuva Structural Invariant:

- Mother DXF ne mijenja geometriju
- child generation izvodi transformacije tek nakon approval boundaryja

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
- profile/catalog selection
- catalog-driven metadata authoring
- `needs_rule` / `needs_catalog_entry` detection
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
- approved catalog/profile version usage
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
3. formalizirati profile/catalog contracte
4. formalizirati Rule Catalog validation
5. definirati Operation Catalog
6. definirati `ChildPlan v0`
7. koristiti mnogo smoke testova
8. paralelno modelirati `DBR` kroz simulator / POC
9. tek nakon toga graditi puni `DBR`

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

## 16. Catalog Admin Direction

Current state:

- catalogi su JSON contract artefakti u repozitoriju
- Mother DXF UI ih konzumira za authoring
- Mother DXF UI nije dugoročni catalog maintenance UI

Dugoročni smjer:

- poseban `Catalog Admin` / `DCM Catalogs` UI

Catalog Admin treba pokrivati:

- Parameter Catalog
- Rule Catalog
- Operation Catalog
- Profile Catalog
- import/export JSON
- versioning
- draft/active/deprecated lifecycle
- validation cataloga

Mother DXF UI ostaje operativni authoring ekran.

Catalog Admin postaje servisni engineering ekran.

---

## 17. Najvažniji arhitekturni rizici

Najveći rizici koje treba izbjeći su:

- da `DCM` opet postane jedan pretrpani modul
- da se technology-specific pravila hardcodiraju u core
- da `Combiner` preraste u novi paralelni batch sustav
- da se approval boundary zamagli
- da convenience flowovi postanu canonical flow
- da dodavanje novog parta opet traži stotine linija novog koda
- da catalogi postanu hardcoded engine logic
- da `rule_ref` postane slobodno tipkani string bez Rule Cataloga
- da Mother DXF UI postane Catalog Admin
- da prototype transformacije krenu prije `ChildPlan` contracta

---

## 18. Smjer daljnjeg rada

Iz ovog chartera proizlazi preporučeni redoslijed rada:

1. zaključati nomenklaturu
2. potvrditi `DCM` i `DBR` scope
3. potvrditi profile/catalog model
4. potvrditi `OPS_S4P4` kao prvi OPS technology profile
5. potvrditi MXD door profile seed
6. potvrditi `Stacker / Combiner` kao operation family unutar OPS profila
7. definirati canonical artefakte između `DCM` i `DBR`
8. definirati `InstructionSet`
9. definirati Parameter / Rule / Operation Catalog contracte
10. definirati `ChildPlan`
11. napraviti `DBR simulator POC`
12. graditi `DCM`
13. tek nakon toga graditi puni `DBR`

---

## 19. Nulta verzija zaključka

Nulta verzija zaključka glasi:

- gradimo jedan company-wide `DXF Processor`
- njegova dva glavna moda su:
  - `DCM`
  - `DBR`
- prvi technology derivative je `OPS_S4P4`
- `Stacker / Combiner` je first-line dio tog derivata
- `Combiner` je operation, ne zaseban batch sustav
- `mother_dxf_v1` je buduća canonical osnova
- DCM je generički engine s profile-specific catalogima
- MXD door profile je prvi stvarni catalog seed
- postojeći `dxf-modifier` ostaje referenca i izvor naučenog ponašanja
- razvoj se vodi pažljivo, sa smoke testovima, simulatorima i postupnim kristaliziranjem contracta
