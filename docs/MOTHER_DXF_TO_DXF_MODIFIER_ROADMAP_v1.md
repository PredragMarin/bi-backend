# MOTHER_DXF_TO_DXF_MODIFIER_ROADMAP_v1

## 1. Svrha

Ovaj dokument definira zdravu ciljnu arhitekturu i migration roadmap za proširenje `mother_dxf_v1` modula do razine da može pokriti praktični funkcionalni scope koji danas pokriva Zoranov `dxf-modifier`, ali u tanjem i kontroliranijem obliku.

Ovaj dokument je:

- roadmap
- arhitekturni overlay
- migration guide

Ovaj dokument nije:

- uputa za broad rewrite
- Stage 2 implementation spec
- zahtjev da se odmah zamijeni cijeli postojeći working chain

Praktični cilj je:

- zadržati jaku semantičku osnovu koja već postoji u `mother_dxf_v1`
- izvući korisno domain znanje koje je trenutno ugrađeno u `dxf-modifier`
- izbjeći prenošenje additive orchestration bloat-a iz sadašnjeg `dxf-modifier` modula

---

## 2. Pozadina

Već postoje dva odvojena asseta:

### `mother_dxf_v1`

Jake strane:

- stage-based design
- eksplicitne sanitize i semantic granice
- primarna 9-layer dimenzionalna klasifikacija
- relevant-object model
- manual correction workflow
- čist interni contract
- očuvan `999` metadata passthrough

Trenutno ograničenje:

- staje prije Stage 2 child generation sloja

### `dxf-modifier`

Jake strane:

- radi u praktičnom production-like flowu
- već pokriva payload ingest do child DXF exporta
- sadrži stvarno business znanje o parameter mappingu
- sadrži naučeno part-specific ponašanje
- već rješava realne downstream output zadatke

Trenutna slabost:

- centralni orchestration je gust
- postoji više convenience flowova uz canonical flow
- logika je razvučena kroz više translation layera
- postoji značajan glue code i hardcoded edge-case handling
- additive rast je smanjio arhitekturnu jasnoću

---

## 3. Strateška odluka

Preporučeni smjer:

- ne nastavljati širiti `dxf-modifier` kao dugoročni canonical engine
- ne raditi odmah rewrite cijelog working chaina od nule
- proširiti `mother_dxf_v1` u čist canonical manipulation core
- tretirati postojeći `dxf-modifier` kao:
  - referencu ponašanja
  - izvor domain znanja
  - privremeni workflow shell

Cilj nije:

- "napraviti da `mother_dxf_v1` izgleda kao `dxf-modifier`"

Cilj je:

- "napraviti da `mother_dxf_v1` pokrije istu korisnu funkcionalnost, ali u čišćem layered obliku"

---

## 4. AS-IS preklapanje

### Što oba modula već logički pokrivaju

- DXF ingest
- DXF parsing
- semantičku interpretaciju geometrije
- parameter-driven transformation intent
- export-oriented workflow

### Što `mother_dxf_v1` već radi bolje

- stage boundaries su eksplicitne
- semantic model je čist
- 9-layer dimenzionalna klasifikacija je first-class
- metadata se tretira kao sekundarni exception layer
- validation granica je eksplicitna

### Što `dxf-modifier` već radi bolje

- postoji praktični end-to-end child output flow
- već postoji payload ingest iz ERP-derived JSON-a
- već postoji part-specific transformation ponašanje
- već postoji downstream packaging/export workflow

### Glavni trenutni gap

Gap nije u osnovnoj semantičkoj filozofiji.

Glavni gap je:

- `mother_dxf_v1` nema izvedbene Stage 2 layere
- `dxf-modifier` već ima Stage 2-like praktično ponašanje, ali ugrađeno u teži orchestration shell

---

## 5. Canonical target flow

Ciljni canonical flow trebao bi biti:

1. host payload ili manual order payload input
2. canonical order normalization
3. mother DXF load
4. Stage 0 sanitize
5. Stage 1 semantic preparation
6. Stage 1.5 metadata / `999` instruction parse
7. Stage 2 child planning
8. Stage 3 child DXF materialization
9. output packaging
10. downstream handoff

Važno načelo:

- jedan canonical engine flow
- convenience flowovi mogu postojati samo oko njega, nikad umjesto njega

---

## 6. Ciljno slaganje po layerima

### Layer A: Input Contract Layer

Odgovornosti:

- primiti upstream payload
- validirati payload contract
- normalizirati transport-level shape u jedan interni canonical order model

Ne smije raditi:

- DXF manipulation
- filesystem workflow logiku
- downstream output odluke

### Layer B: Mother DXF Core

Odgovornosti:

- parse raw DXF-a
- sanitize dokumenta
- build relevant-object modela
- očuvanje `999` komentara
- podršku za 9-layer dimenzionalnu semantiku
- podršku za manual semantic correction

Ovo većinom već postoji u `mother_dxf_v1`.

### Layer C: Instruction Layer

Odgovornosti:

- parse `999` metadata u strukturirane instruction objekte
- interpretacija jednostavnih feature flagova
- interpretacija dediciranih code-specific direktiva
- zadržavanje pravila da je dimenzionalna klasifikacija primarna, a metadata sekundarna

Važno pravilo:

- instruction layer nadograđuje Stage 1
- instruction layer ne zamjenjuje Stage 1

### Layer D: Child Planning Layer

Odgovornosti:

- odlučiti koji child partovi se moraju generirati
- izvesti transformation intent po childu
- mapirati canonical order podatke + semantic model + instruction set u child planove

Output:

- stabilni child plan objekti

To je ključni bridge koji je trenutno zamagljen unutar `dxf-modifiera`.

### Layer E: Child Materialization Layer

Odgovornosti:

- izvršiti stvarnu DXF parametrizaciju i transformaciju
- primijeniti dimenzionalne vrijednosti
- primijeniti feature on/off ponašanje
- primijeniti code-specific part skripte
- generirati child DXF stringove ili fileove

To je budući Stage 2 engine.

### Layer F: Output Packaging Layer

Odgovornosti:

- naming
- export manifeste
- packaging
- strukturu output foldera
- downstream handoff contract

Ne smije raditi:

- semantičku interpretaciju
- ad hoc business logiku

### Layer G: UI / Workflow Layer

Odgovornosti:

- user sessione
- manual correction UX
- preview
- operativni run status
- file selection / save
- external workflow glue

Ne smije postati canonical manipulation engine.

---

## 7. Canonical domain objekti

Kako bi se izbjeglo ponavljano prevođenje identiteta, budući design treba koristiti mali i stabilni set objekata.

### `CanonicalOrder`

Nosi:

- order identitet
- upstream request context
- configuration parametre
- order-level semantičke vrijednosti

### `MotherDocument`

Nosi:

- sanitized DXF
- relevant-object graph
- Stage 1 assignments
- validation state

### `InstructionSet`

Nosi:

- parsane `999` direktive
- feature flagove
- part-specific operation direktive
- validation nalaze

### `ChildPlan`

Nosi:

- child identitet
- poveznicu na source objekt
- potrebni transformation intent
- potrebne parametre
- output naming seed

### `ChildArtifact`

Nosi:

- generirani DXF
- output metadata
- lineage natrag prema orderu i child planu

Glavno design pravilo je:

- ti objekti trebaju ostati eksplicitni kroz canonical flow
- izbjegavati višestruko pretvaranje istog identiteta u nepovezane ad hoc shapeove

---

## 8. Mapiranje postojećeg `dxf-modifier` znanja u ciljne layere

### Zadržati i migrirati konceptualno

- part-specific rule znanje
- transformation semantiku koja se već dokazala u production-like korištenju
- naming logiku koja je još važeća
- downstream output očekivanja
- validirane payload zahtjeve

### Preseliti u čišće layere

- payload normalize logika -> Layer A
- DXF semantic interpretacija -> Layer B
- `999` instruction ponašanje -> Layer C
- part selection i child intent -> Layer D
- stvarni child generation -> Layer E
- manifest/export/report logika -> Layer F

### Ne prenositi direktno

- convenience latest-payload flowove kao engine ponašanje
- miješani orchestration i business logic u jednom root fileu
- ponavljane identity translation korake
- hardcoded fallback lance koji služe samo kao operativni shortcutovi
- backup/test runtime foldere kao dio production strukture

---

## 9. Što `mother_dxf_v1` još treba

Kako bi dosegao praktičnu paritetu s `dxf-modifierom`, `mother_dxf_v1` treba ove nove capability grupe.

### Capability grupa 1: Structured `999` Instruction Parsing

Potrebno:

- strict parser za `999` semantic metadata komentare
- jasan vocabulary za podržane flagove i direktive
- validation za duplicate/unknown key slučajeve
- binding instruction seta na relevant object

Trenutni status:

- komentari se čuvaju
- execution semantika još nije implementirana

### Capability grupa 2: Child Planning

Potrebno:

- mapiranje iz semantic object + order config + instruction set u child plan
- part selection strategija
- stabilan child plan model

Trenutni status:

- nije implementirano u `mother_dxf_v1`

### Capability grupa 3: Code-Specific Script Hooks

Potrebno:

- dedicated script hookovi po podržanom kodu ili part tipu
- kontrolirana operation library za jednostavne on/off ili param-driven promjene
- eksplicitna granica između generic enginea i per-code skripte

Trenutni status:

- nije implementirano u `mother_dxf_v1`

### Capability grupa 4: Child DXF Materialization

Potrebno:

- engine koji primjenjuje transformacije na mother geometriju i emitira child DXF
- robusna veza između child plana i generiranog outputa

Trenutni status:

- Stage 2 je deferred u sadašnjem contractu

### Capability grupa 5: Output Packaging

Potrebno:

- export naming
- child file packaging
- output manifest
- handoff-ready artifact struktura

Trenutni status:

- to trenutno nije odgovornost `mother_dxf_v1` modula

---

## 10. Preporučena migration strategija

### Phase 1: Freeze i dokumentiranje trenutnog preklapanja

Cilj:

- sačuvati radno razumijevanje
- zaustaviti implicitni drift

Zadaci:

- dokumentirati trenutne granice `mother_dxf_v1`
- dokumentirati korisna ponašanja `dxf-modifiera`
- identificirati transformacijska pravila koja se moraju zadržati

### Phase 2: Proširenje `mother_dxf_v1` modula instruction layerom

Cilj:

- pretvoriti `999` passthrough u strukturirani instruction parsing

Zadaci:

- definirati podržani instruction vocabulary
- implementirati strict instruction parser
- attachati instruction set na semantic objekte

### Phase 3: Dodavanje child planning modela

Cilj:

- prijeći iz "mother semantics only" u "actionable child planning"

Zadaci:

- definirati `ChildPlan`
- dodati plan derivation iz semantic modela + order configa + instructions
- zadržati plan generation determinističkim i testabilnim

### Phase 4: Dodavanje child materialization enginea

Cilj:

- generirati child DXF outpute iz stabilnih planova

Zadaci:

- definirati kontrolirani transformation API
- prvo implementirati jednostavne feature on/off operacije
- zatim dodati code-specific script hookove

### Phase 5: Dodavanje packaging i handoff sloja

Cilj:

- proizvoditi artefakte koji mogu stati umjesto sadašnjeg `dxf-modifier` outputa

Zadaci:

- child naming
- export manifest
- packaging
- downstream-ready output folder

### Phase 6: Postupna zamjena

Cilj:

- omogućiti da `mother_dxf_v1` postane canonical engine

Zadaci:

- prvo ga koristiti iza postojećeg workflow shella
- uspoređivati outpute sa sadašnjim `dxf-modifierom`
- tek onda gasiti dupliciranu logiku

---

## 11. Guardrails za zdrav rast

### Guardrail 1

- jedan canonical engine flow

### Guardrail 2

- Stage 1 dimenzionalna semantika ostaje primarna

### Guardrail 3

- `999` metadata je additive, ne primarna istina

### Guardrail 4

- bez centralnog god-file orchestrationa za core engine logiku

### Guardrail 5

- business logika, DXF transform logika i output workflow moraju ostati odvojeni

### Guardrail 6

- convenience operativni flowovi moraju ostati izvan engine corea

### Guardrail 7

- izbjegavati prevođenje identiteta kroz mnogo nepovezanih shapeova

### Guardrail 8

- per-code skripte moraju se priključivati kroz bounded operation contract, a ne ad hoc mutirati cijeli engine

---

## 12. Što sačuvati iz postojećeg rada

Sadašnji istraživački razvoj već je proizveo vrijedno znanje.

To znanje ne treba baciti.

Sačuvati:

- razumijevanje kako se DXF ponaša pod određenim transformacijama
- poznata feature-flag ponašanja
- poznate code-specific operacije
- dokazana output očekivanja
- dokazane edge caseove koji utječu na realne fileove

Ne sačuvati slijepo:

- sadašnji orchestration shape
- additive shortcut flowove
- velike mixed-purpose fileove
- flat hardcoded strukture u kojima je domain meaning skriven

---

## 13. Sažetak odluke

Preporučeni arhitekturni smjer je:

- zadržati `mother_dxf_v1` kao buduću canonical engine osnovu
- koristiti `dxf-modifier` kao referencu ponašanja, a ne kao dugoročni engine blueprint
- razvijati `mother_dxf_v1` kroz eksplicitne Stage 2 layere
- migrirati capability, a ne code mass

Željeno krajnje stanje je:

- `mother_dxf_v1` pokriva korisnu manipulation funkcionalnost koju danas pokriva `dxf-modifier`
- ali to radi kroz:
  - eksplicitne stageove
  - stabilne domain objekte
  - bounded instruction handling
  - tanji orchestration

---

## 14. Neposredni sljedeći korak

Sljedeći koristan arhitekturni korak nije broad coding.

To je:

- definirati budući `InstructionSet` contract za `999` metadata
- definirati budući `ChildPlan` contract
- zatim provesti jedan ili dva stvarna parta kroz taj novi canonical flow

To daje kontrolirani dokaz da `mother_dxf_v1` može postati čišći nasljednik.
