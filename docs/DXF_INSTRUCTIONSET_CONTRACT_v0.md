# DXF_INSTRUCTIONSET_CONTRACT_v0

## 1. Svrha

Ovaj dokument definira nultu verziju `InstructionSet` contracta za `999` metadata layer unutar budućeg `DCM` modula.

Njegova svrha je:

- dati jasan model kako `999` komentari ulaze u DXF Processor
- razdvojiti dimenzionalnu semantiku od metadata/instruction layera
- postaviti pravila za parsing, binding i validation
- omogućiti da budući Stage 2 radi nad strukturiranim instruction objektima, a ne nad sirovim stringovima

Ovo nije finalni production spec.

Ovo je:

- `v0` contract
- početni design okvir
- baza za prve smoke implementacije i prve technology profile

---

## Current Implementation Snapshot

As of 2026-04-26, the repository implementation includes the first practical `SEM:` metadata authoring slice inside `mother_dxf_v1`.

Currently implemented:

- `SEM:` key/value parsing
- simple `when` expression parsing for `==` and `!=`
- guided UI authoring for presence, geometry role, and operation reference records
- Parameter Catalog reference through `src/modules/mother_dxf_v1/contracts/parameter_catalog_legacy_door_v0.json`
- Rule Catalog reference through `src/modules/mother_dxf_v1/contracts/rule_catalog_mxd_door_v0.json`
- metadata binding to entity `999` comments

Not yet implemented:

- full document-level `InstructionSet` aggregate object in runtime
- multi-`SEM:` guided authoring per entity
- catalog-backed rule expression evaluation
- Operation Catalog
- ChildPlan integration

This section describes current code state. The rest of the document defines the intended contract direction.

---

## 2. Položaj u arhitekturi

`InstructionSet` pripada u:

- `DCM`
- nakon Stage 1 semantic preparation
- prije `ChildPlan` derivationa

Canonical redoslijed je:

1. raw DXF
2. sanitize
3. semantic klasifikacija
4. `999` instruction parsing
5. `InstructionSet`
6. `ChildPlan`
7. child materialization

Važno pravilo:

- `InstructionSet` je sekundarni layer
- primarni source of truth za geometrijski smisao i dalje ostaje:
  - Stage 1 dimenzionalna semantika
  - relevant-object model

---

## 3. Temeljna načela

### Načelo 1

- layer-first, metadata-second

To znači:

- objekt se prvo razumije kroz geometriju i 9-layer klasifikaciju
- tek zatim metadata može dodati dodatni meaning ili operation hint

### Načelo 2

- `999` metadata ne smije zamijeniti Stage 1

To znači:

- `999` ne smije postati prečac za potpuno zaobilaženje semantic modela

### Načelo 3

- parser mora biti strict

To znači:

- unknown key nije tiho dopušten
- duplicate key nije tiho dopušten
- loš format nije tiho dopušten

### Načelo 4

- parsed instructions moraju biti strukturirane

To znači:

- kasniji layeri ne rade nad raw `999` stringovima
- rade nad validiranim instruction objektima

### Načelo 5

- technology-specific meaning ne smije curiti u generic parser

To znači:

- parser smije znati format
- ali technology profile daje dublje značenje gdje je to potrebno

---

## 4. Input format

Canonical `999` metadata format u `v0` je:

```text
999
SEM:key=value;key=value;key=value
```

Current canonical authored forms are:

Presence condition:

```text
999
SEM:feature=TRECA_SPOJNICA;presence=conditional;when=TRECA_SPOJNICA==Da
```

Geometry role:

```text
999
SEM:role=variant;feature=TRECA_SPOJNICA;variant=IZNAD_DRUGE;rule_ref=THIRD_HINGE_ABOVE_SECOND_MIN_HEIGHT
```

Prototype role:

```text
999
SEM:role=prototype;feature=VANJSKI_PANEL;variant=TEST_PROTO
```

Operation reference:

```text
999
SEM:operation_ref=WORKTOP_SINK_PAIR_PLACEMENT;feature=VANJSKI_PANEL
```

Current implemented metadata families:

| Family | Required keys | Optional keys | Purpose |
| --- | --- | --- | --- |
| Presence condition | `feature`, `presence`, `when` | `rule_ref` | Conditional visibility / inclusion intent |
| Geometry role | `role`, `feature` | `variant`, `rule_ref`, `operation_ref` | Mark existing geometry as variant, prototype, anchor, or reference |
| Operation reference | `operation_ref`, `feature` | `role`, `variant`, `rule_ref` | Carry future operation intent into ChildPlan |

Binding pravilo:

- `999` komentar se veže na sljedeći entity

`mother_dxf_v1` već podržava to binding pravilo kao passthrough osnovu.

`InstructionSet v0` zadržava isto pravilo.

---

## 5. V0 parsing model

`InstructionSet` parser u `v0` mora:

1. prepoznati `999` comment koji počinje s `SEM:`
2. izdvojiti key/value parove
3. validirati sintaksu
4. vezati instrukciju na relevant object
5. proizvesti strukturirani instruction record

Parser u `v0` ne mora još:

- rješavati kompleksne višelinijske macro instrukcije
- podržavati nested strukture
- podržavati proceduralni mini-language

`v0` ostaje namjerno jednostavan.

---

## 6. Canonical V0 shape

Canonical parsed shape za jedan instruction zapis:

```json
{
  "instruction_id": "ins_001",
  "entity_id": "ent_12",
  "raw_comment": "SEM:feature=TRECA_SPOJNICA;presence=conditional;when=TRECA_SPOJNICA==Da",
  "namespace": "SEM",
  "keys": {
    "feature": "TRECA_SPOJNICA",
    "presence": "conditional",
    "when": "TRECA_SPOJNICA==Da"
  },
  "when_expression": {
    "parameter": "TRECA_SPOJNICA",
    "operator": "==",
    "expected": "Da"
  },
  "status": "valid",
  "validation": {
    "ok": true,
    "errors": [],
    "warnings": []
  }
}
```

`InstructionSet` za cijeli dokument:

```json
{
  "document_id": "session_x",
  "instructions": [],
  "validation": {
    "ok": true,
    "errors": [],
    "warnings": []
  }
}
```

Family-specific examples:

Presence condition result:

```json
{
  "entity_id": "ent_174",
  "namespace": "SEM",
  "keys": {
    "feature": "TRECA_SPOJNICA",
    "presence": "conditional",
    "when": "TRECA_SPOJNICA==Da"
  },
  "when_expression": {
    "parameter": "TRECA_SPOJNICA",
    "operator": "==",
    "expected": "Da"
  },
  "instruction_family": "presence_condition"
}
```

Geometry role result:

```json
{
  "entity_id": "ent_174",
  "namespace": "SEM",
  "keys": {
    "role": "variant",
    "feature": "TRECA_SPOJNICA",
    "variant": "IZNAD_DRUGE",
    "rule_ref": "THIRD_HINGE_ABOVE_SECOND_MIN_HEIGHT"
  },
  "instruction_family": "geometry_role"
}
```

Operation reference result:

```json
{
  "entity_id": "ent_220",
  "namespace": "SEM",
  "keys": {
    "role": "prototype",
    "feature": "WORKTOP_SINK",
    "variant": "K1_LEFT_CANONICAL",
    "operation_ref": "WORKTOP_SINK_PAIR_PLACEMENT"
  },
  "instruction_family": "operation_reference"
}
```

---

## 7. Obavezna polja parsed instruction zapisa

Svaki parsed instruction zapis u `v0` mora imati:

- `instruction_id`
- `entity_id`
- `raw_comment`
- `namespace`
- `keys`
- `status`
- `validation`

`status` u `v0` može biti:

- `valid`
- `invalid`
- `ignored`

---

## 8. V0 vocabulary

U `v0` ne zaključavamo još puni production vocabulary.

Ali zaključavamo kategorije ključeva koje sustav očekuje.

### A. Operation keys

Primjeri:

- `operation_ref`
- `op` (legacy / transitional)
- `action` (legacy / transitional)

Namjena:

- referenca na operation koji kasniji profile-specific layer može interpretirati
- `operation_ref` ne smije nositi rule meaning; rule meaning ide kroz `rule_ref`

### B. Feature and parameter keys

Primjeri:

- `feature`
- `presence`
- `when`

Namjena:

- controlled feature selection from Parameter Catalog
- simple presence / visibility conditions
- condition expression over catalog parameter values

Canonical rule:

- `feature` mora biti catalog key, ne display label
- `when` lijeva strana mora referencirati isti catalog namespace
- enum vrijednost u `when` expressionu mora biti iz allowed values za taj parameter gdje je to moguće

### C. Geometry role keys

Primjeri:

- `role`
- `variant`

Namjena:

- označiti entity/block kao existing variant, prototype, anchor ili reference geometry
- prenijeti geometry intent u ChildPlan bez mijenjanja Mother DXF geometrije

`role` u trenutnom contractu može biti:

- `variant`
- `prototype`
- `anchor`
- `reference`

### D. Rule reference keys

Primjeri:

- `rule_ref`

Namjena:

- referenca na Rule Catalog zapis
- izbjegavanje embedanja pune domain logike u `999` komentar

### E. Technology keys

Primjeri:

- `profile`
- `tech`
- `post`

Namjena:

- technology-specific hint

Važno:

- puni allow-list vocabulary dolazi iz profile-specific cataloga
- generic parser poznaje format, ali profile/catalog definira dublje značenje

---

## 9. Expression Grammar v0

Inline `when` expression grammar u trenutnoj implementaciji namjerno je mali.

Trenutno podržano:

```text
PARAM==VALUE
PARAM!=VALUE
```

Primjeri:

```text
TRECA_SPOJNICA==Da
STRANA_OTVARANJA!=Lijeva (SX)
```

Trenutno nije podržano:

- `>`
- `>=`
- `<`
- `<=`
- `AND`
- `OR`
- unit-aware range parsing
- nested expressions

Složenija domain logika ne treba se širiti kao inline `when` string u DXF komentaru.

Za složene slučajeve koristi se:

```text
rule_ref={RULE_ID}
```

gdje `RULE_ID` mora postojati u Rule Catalogu za aktivni profile.

---

## 10. Catalog Relationship

`InstructionSet` nije samostalan vocabulary izvor.

Catalog relationship:

- `feature` mora dolaziti iz Parameter Cataloga
- enum vrijednosti u `when` expressionu trebaju dolaziti iz Parameter Catalog allowed values
- `rule_ref` mora dolaziti iz Rule Cataloga
- `operation_ref` treba doći iz budućeg Operation Cataloga ili drugog odobrenog profile-specific registra
- `role` mora dolaziti iz `InstructionSet` role vocabularyja
- `variant` mora biti stabilni operation/variant id, ne slobodni opis

Current concrete artifacts:

- `src/modules/mother_dxf_v1/contracts/parameter_catalog_legacy_door_v0.json`
- `src/modules/mother_dxf_v1/contracts/rule_catalog_mxd_door_v0.json`

UI pravilo:

- DCM authoring UI ne bi trebao poticati slobodno tipkanje catalog-controlled ključeva i vrijednosti.
- Ako catalog entry ne postoji, to je `needs_rule` / `needs_catalog_entry` situacija, ne razlog za ad hoc string u DXF-u.

Binding consequences:

- unknown `feature` -> `needs_catalog_entry`
- unknown `rule_ref` -> `needs_rule`
- unknown `operation_ref` -> `needs_operation`

Ove situacije trebaju biti vidljive u DCM authoring workflowu.

Ne smiju se rješavati tihim fallbackom na raw string.

---

## 11. Validation pravila

### Rule 1

- namespace mora biti podržan

U `v0` podržan je samo:

- `SEM`

### Rule 2

- svaki key mora biti jedinstven unutar jednog `999` komentara

Duplicate key:

- validation error

### Rule 3

- key ne smije biti prazan

Prazan key:

- validation error

### Rule 4

- value ne smije biti prazna

Prazna value:

- validation error

### Rule 5

- comment mora biti vezan na sljedeći entity

Ako binding nije moguć:

- validation error

### Rule 6

- unknown key u strict modu je validation problem

Za `v0` preporuka je:

- parser podržava `strict=true`
- ali developer smoke faza može privremeno koristiti i tolerantni mod uz warninge

### Rule 7

- parser ne smije šutke odbacivati loš zapis

Ako je zapis loš:

- mora ostati vidljiv kroz validation rezultat

### Rule 8

- invalid `when` expression je validation error

U trenutnoj implementaciji invalid je svaki `when` koji nije parsabilan kao:

- `PARAM==VALUE`
- `PARAM!=VALUE`

### Rule 9

- `rule_ref` bez matcha u aktivnom Rule Catalogu treba biti validation problem

Ovo je contract rule; puni validator još nije implementiran.

### Rule 10

- `feature` koji ne postoji u aktivnom Parameter Catalogu treba biti validation problem

Ovo je contract rule; puni validator još nije implementiran.

### Rule 11

- `operation_ref` bez matcha u budućem Operation Catalogu treba biti validation problem

Dok Operation Catalog ne postoji, takav zapis smije biti draft metadata, ali ne approval-grade metadata.

### Rule 12

- `role` mora biti jedan od podržanih geometry role vrijednosti

Za `v0` podržano je:

- `variant`
- `prototype`
- `anchor`
- `reference`

### Rule 13

- `presence=conditional` mora imati validan `when` ili validan `rule_ref`

Ako uvjet ne može stati u `when` grammar, mora ići kroz Rule Catalog.

---

## 12. Binding model

Binding ide po ovom pravilu:

- jedan `999` comment pripada sljedećem DXF entityju

U `v0` jedan entity može imati:

- `0` instructions
- `1` instruction
- više instruction zapisa ako postoji više uzastopnih `999` komentara

Ali preporučeni working model za `v0` je:

- jedan semantic instruction record po entityju

Više zapisa po entityju ostavljamo kao dopuštenu, ali kasnije dodatno specificiranu mogućnost.

Production direction:

- UI treba podržati više semantic records po entityju
- runtime mora zadržati njihov redoslijed
- validator mora moći ocijeniti kombinaciju svih records za isti entity
- ChildPlan dobiva agregirani instruction view po entityju

---

## 13. Relationship prema relevant-object modelu

`InstructionSet` se ne veže direktno na cijeli dokument kao nejasni string pool.

Veže se na:

- relevant semantic objects
- odnosno na njihove `entity_id` identitete

To je važno jer:

- child planning mora znati kojem objektu instruction pripada
- instruction ne smije ostati “lebdeći komentar”

---

## 14. Geometry Role Model

Geometry role metadata opisuje kako se postojeća geometry u Mother DXF-u treba tretirati u kasnijem planning/materialization layeru.

Supported role vocabulary:

- `variant`
- `prototype`
- `anchor`
- `reference`

Meanings:

- `variant` = postojeća alternativna geometrija; child planning bira hoće li ostati aktivna
- `prototype` = source geometry za kasnije copy / mirror / translate / placement materialization
- `anchor` = semantic reference point ili placement anchor
- `reference` = pomoćna referentna geometrija za planning / validation

Mother DXF runtime ne izvršava ove roleove kao geometrijske operacije.

Roleovi su contract carrier za:

- ChildPlan
- validator
- future operation/materialization layer

Variant pattern example:

```text
999
SEM:role=variant;feature=TRECA_SPOJNICA;variant=IZNAD_DRUGE;rule_ref=THIRD_HINGE_ABOVE_SECOND_MIN_HEIGHT
```

Prototype pattern example:

```text
999
SEM:role=prototype;feature=WORKTOP_SINK;variant=K1_LEFT_CANONICAL;operation_ref=WORKTOP_SINK_PAIR_PLACEMENT
```

Interpretation boundary:

- `InstructionSet` records the intent
- `ChildPlan` resolves the selected variant or placement plan
- child materialization executes geometry changes
- Mother DXF remains enriched raw DXF

---

## 15. Relationship prema technology profileovima

Generic `InstructionSet` parser radi:

- format parsing
- basic validation
- binding

Technology profile radi:

- profile-specific meaning
- profile-specific allow-list
- profile-specific operation mapping
- parameter catalog selection
- rule catalog selection
- operation catalog selection

Primjer:

- `MXD_DOOR_V0` može tumačiti `feature=TRECA_SPOJNICA` i `rule_ref=THIRD_HINGE_ABOVE_SECOND_MIN_HEIGHT`
- `OPS_S4P4` može kasnije tumačiti `operation_ref=combine` ili dedicated operation catalog entries
- drugi future profile možda to neće podržavati

Time se zadržava:

- jedan generic parser
- više profile-specific interpretacija
- isti DCM authoring engine nad više domain cataloga

---

## 16. Relationship prema `Combiner` operationi

Za prvi `OPS_S4P4` derivative:

- `Combiner` je važna operation family

Zato `InstructionSet v0` mora ostaviti mjesto za operation hintove poput:

- `operation_ref=combine`
- `operation_ref=decombine`
- `group=...`
- `part=...`

Ali `InstructionSet v0` još ne zaključava punu semantics tih operationa.

To dolazi u:

- technology profile pravilima
- i kasnije u `ChildPlan` / operation execution layeru

---

## 17. Current Gaps

Current implementation gaps:

- parser postoji, ali full document-level `InstructionSet` aggregate još nije runtime artifact
- guided UI trenutno upserta jedan active `SEM:` record po entityju
- Rule Catalog se prikazuje i referencira, ali rule expression se ne evaluira
- Operation Catalog nije implementiran
- ChildPlan nije implementiran
- approval-grade metadata validation nije implementiran
- catalog binding errors još nisu puni blocking approval gate
- multi-record authoring po entityju još nije UX capability

---

## 18. Što `InstructionSet v0` još nije

`InstructionSet v0` još nije:

- finalna registry specifikacija svih operationa
- finalna allow-list svih ključeva
- puni production execution spec
- policy engine
- macro language
- replacement for Parameter Catalog / Rule Catalog / Operation Catalog

To je namjerno.

`v0` služi da:

- stabilizira format
- stabilizira binding
- stabilizira validation razinu
- omogući prve smoke implementacije

---

## 19. Preporučeni prvi smoke use caseovi

Za prve smoke implementacije preporučuju se samo jednostavni slučajevi:

1. presence condition over catalog feature
2. geometry role tag for a variant block
3. geometry role tag for a prototype block
4. rule reference selection from Rule Catalog
5. one `operation_ref` hint without full batch semantics

To je dovoljno da se potvrdi:

- parser
- binding
- validation
- downstream prijenos u `ChildPlan`

---

## 20. Sljedeći korak nakon ovog dokumenta

Nakon `InstructionSet v0` dokumenta prirodni sljedeći korak je:

- `ChildPlan v0`
- profile/catalog contract formalization

Jer tek kombinacija:

- semantic model
- `InstructionSet`
- Parameter Catalog
- Rule Catalog
- future Operation Catalog

može dati smislen i stabilan child planning layer.
