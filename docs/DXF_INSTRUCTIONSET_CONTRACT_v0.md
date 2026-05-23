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
- `when` expression parsing for `==`, `!=`, `IN`, `>`, `>=`, `<`, `<=`
- shallow `AND` / `OR` composition in guided authoring
- guided UI authoring for presence, geometry role, operation reference, and post-TOPO group records
- Parameter Catalog reference through `src/modules/mother_dxf_v1/contracts/parameter_catalog_legacy_door_v0.json`
- Rule Catalog reference through `src/modules/mother_dxf_v1/contracts/rule_catalog_mxd_door_v0.json`
- metadata binding to entity `999` comments

Not yet implemented:

- full document-level `InstructionSet` aggregate object in runtime
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
SEM:role=variant;feature=TRECA_SPOJNICA;variant=IZNAD_DRUGE;rule_ref={RULE_ID}
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

Document-level SEM exception:

- `SEM:document=true` je document-level metadata, ne entity-level metadata
- canonical position je u `ENTITIES` sectionu prije prvog entity recorda
- resolver mora učitati `SEM:document=true` kao document context prije entity-level metadata evaluacije
- `SEM:document=true` se ne veže na sljedeći entity i ne smije utjecati na entity presence / variant evaluaciju

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
    "rule_ref": "{RULE_ID}"
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

Ovo poglavlje je nucleus generičkog `SEM` vocabularyja.

Sve nove `SEM:` formulacije moraju se prvo nominirati ovdje prije nego postanu canonical authoring pattern.

### 8.0 Vocabulary governance baseline

`SEM` vocabulary u `v0` održava se kroz tri razine discipline:

1. controlled keys
2. controlled expression operators
3. controlled value forms

Generic parser ne smije prihvaćati nove "zgodne" formulacije samo zato što zvuče smisleno.

Ako novi intent ne stane u ovdje odobreni shape, mora se dogoditi jedno od sljedećeg:

- proširenje ovog contracta
- novi catalog entry
- `rule_ref`
- `operation_ref`

No new grammar by example:

- novi key ne postaje canonical zato što se pojavio u screenshotu, testu, ili ad hoc `SEM:` stringu
- novi operator ne postaje canonical zato što ga je netko ručno upisao u `when`
- grammar ulazi u sustav tek nakon contract updatea

### 8.1 Current generic key nucleus

Ovo je trenutni generički nucleus ključeva koji se smatra odobrenim vocabulary baselineom:

| Key | Status | Meaning |
| --- | --- | --- |
| `feature` | current | Catalog-controlled feature / parameter key |
| `presence` | current | Presence mode such as `always`, `conditional`, `never` |
| `when` | current | Inline simple condition expression |
| `role` | current | Geometry role such as `variant`, `prototype`, `anchor`, `reference` |
| `variant` | current | Stable variant or prototype identifier |
| `rule_ref` | current | Reference to Rule Catalog logic |
| `operation_ref` | current | Reference to future Operation Catalog / execution intent |
| `document` | approved next | Marks document-level SEM record |
| `geometry` | approved next | Geometry intent family key |
| `axis` | approved next | Axis for geometry intent |
| `ref` | approved next | Parameter or family registry reference such as `@FAMILY.KEY` |
| `exclusive_group` | approved next | Mutually exclusive entity group marker |
| `instance` | approved next | Stable instance index for repeated semantic members |

Pravilo:

- `current` znači da je key već canonical u dokumentaciji ili implementaciji
- `approved next` znači da je key arhitekturno odobren, ali ne mora još biti izvršiv u runtimeu
- svi drugi keyevi su `non-canonical` dok se eksplicitno ne dodaju u ovaj baseline

### 8.2 Current generic value nucleus

Odobreni generički oblici vrijednosti u `v0` su:

- catalog key, npr. `TIP_VRATA`
- enum literal, npr. `EUROPA`
- stable variant id, npr. `IZNAD_DRUGE`
- stable rule id, npr. `MXD_PPV_LAYER_B_OFFSET_9P5`
- stable operation id, npr. `WORKTOP_SINK_PAIR_PLACEMENT`

Odobreni sljedeći oblici vrijednosti su:

- family registry ref, npr. `@FAMILY.BOTTOM_NARROW`
- numeric literal, npr. `9.5`
- document marker literal `true` u `document=true`

Display labels, slobodni opisni stringovi i improvizirani pseudo-natural-language izrazi nisu canonical vocabulary.

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

Operator registry discipline:

- `==` and `!=` su `current`
- svi ostali operatori su `non-canonical` dok se eksplicitno ne dodaju u contract
- novi operator mora imati:
  - grammar update
  - parser update
  - authoring UX update
  - canonical example

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

Catalog entry minimum discipline:

- svaki catalog-backed entry mora imati stabilni `id`
- svaki entry mora imati kratki `label` ili `description`
- svaki rule/operation entry mora imati eksplicitni `profile_scope`
- parameter entries moraju imati `scope.family/products/parts` i `default`, kako bi session mogao iz Parameter Cataloga derivirati početni Config Parameter Set
- `generic` je dozvoljen `profile_scope`, ali mora biti eksplicitno zapisan

Current concrete artifacts:

- `src/modules/mother_dxf_v1/contracts/parameter_catalog_legacy_door_v0.json`
- `src/modules/mother_dxf_v1/contracts/rule_catalog_mxd_door_v0.json`

UI pravilo:

- DCM authoring UI ne bi trebao poticati slobodno tipkanje catalog-controlled ključeva i vrijednosti.
- Ako catalog entry ne postoji, to je `needs_rule` / `needs_catalog_entry` situacija, ne razlog za ad hoc string u DXF-u.
- canonical `SEM` string u everyday authoring modu treba biti generated output, ne ručni input
- `rule_ref` i `operation_ref` u everyday authoring modu trebaju biti picker-based, ne free-text

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

Approval-grade direction:

- unknown `rule_ref` ne smije proći approval-grade validation
- strict runtime / approval export treba ga tretirati kao hard failure, ne kao tihi warning

### Rule 10

- `feature` koji ne postoji u aktivnom Parameter Catalogu treba biti validation problem

Ovo je contract rule; puni validator još nije implementiran.

### Rule 11

- `operation_ref` bez matcha u budućem Operation Catalogu treba biti validation problem

Dok Operation Catalog ne postoji, takav zapis smije biti draft metadata, ali ne approval-grade metadata.

Kad Operation Catalog postoji:

- unknown `operation_ref` ne smije proći approval-grade validation
- strict runtime / approval export treba ga tretirati kao hard failure

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
SEM:role=variant;feature=TRECA_SPOJNICA;variant=IZNAD_DRUGE;rule_ref={RULE_ID}
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

## 14A. `SEM-simple` vs `Rule Catalog` Boundary

`InstructionSet` mora jasno razlikovati dva authoring režima:

- explicitni `SEM-simple`
- catalog-backed `rule_ref`

### `SEM-simple`

`SEM-simple` je canonical izbor kada se intent može izraziti izravno u jednom ili više vezanih `SEM:` metadata zapisa nad istim entityjem.

`SEM-simple` je ispravan kada vrijedi sve ili gotovo sve od sljedećeg:

- uvjet je lokalno vezan uz jedan entity ili `INSERT`
- intent je jasan i ograničen na:
  - inclusion / exclusion
  - variant selection
  - cutout selection
  - jednostavni presence gating
- izraz koristi samo jednostavne operatore:
  - `==`
  - `!=`
  - `>`
  - `>=`
  - `<`
  - `<=`
- logika koristi samo plitke logičke spojeve:
  - `AND`
  - `OR`
- zapis ostaje čitljiv bez vanjskog lookup-a u Rule Catalog
- fallback ponašanje proizlazi iz komplementarnog ili drugog eksplicitnog `SEM` zapisa
- generic engine može evaluirati uvjet bez profile-specific proceduralne logike

Tipični `SEM-simple` primjeri su:

- feature je uključen, a visinski prag bira gornju ili donju varijantu
- jedan cutout vrijedi za skup varijanti brave, drugi za drugi skup varijanti
- jedan existing block ostaje aktivan samo kad parametar ili kombinacija nekoliko parametara zadovolji jednostavan uvjet
- dvije unaprijed nacrtane placement alternative ostaju međusobno isključive kroz `presence=conditional` uvjete za isti feature cluster

Pravilo evaluacije višestrukih `presence=conditional` redova na istom entityju:

- više uvjeta za isti parametar s `==` operatorom tretiraju se kao `OR` - dovoljno je da jedan bude true
- uvjeti za različite parametre tretiraju se kao `AND` - svi moraju biti true
- `!=` uvjeti tretiraju se kao `AND` - svi exclusion uvjeti moraju biti zadovoljeni

Primjer:

```text
999
SEM:feature=BRAVA;presence=conditional;when=BRAVA==CILINDAR
999
SEM:feature=BRAVA;presence=conditional;when=BRAVA==elektricna D-smart
```

Rezultat: `BRAVA` je vidljiva ako je `BRAVA==CILINDAR` OR `BRAVA==elektricna D-smart`.

### `Placement-by-presence`

`SEM-simple` u v0 izričito dopušta placement resolved through mutually exclusive
presence conditions when raw DXF already contains more than one pre-drawn
alternative.

Canonical example:

```text
999
SEM:feature=TRECA_SPOJNICA;presence=conditional;when=(TRECA_SPOJNICA==Da) AND (VISINA_VRATA<2040)
```

```text
999
SEM:feature=TRECA_SPOJNICA;presence=conditional;when=(TRECA_SPOJNICA==Da) AND (VISINA_VRATA>=2040)
```

Meaning:

- lower third-hinge alternative survives in the low-height range
- upper third-hinge alternative survives in the high-height range
- no separate Rule Catalog entry is required when geometry alternatives are
  already drawn in raw DXF

### `Rule Catalog`

`rule_ref` je canonical izbor kada intent više nije dovoljno jasan ili održiv kao eksplicitni `SEM-simple` zapis.

`Rule Catalog` treba koristiti kada vrijedi bilo što od sljedećeg:

- isto pravilo se ponavlja na više entityja, partova ili profileova
- logika više nije lako čitljiva iz samog metadata zapisa
- treba profile-specific domain knowledge koji ne treba curiti u generic metadata layer
- pravilo predstavlja stabilan reusable business izraz kojem treba dati trajni identitet
- uvjet prelazi simple local expression i postaje formula, policy ili složen decision rule
- odluka ovisi o širem planning ili operation contextu, a ne samo o lokalnom entity intentu
- downstream execution treba prepoznati named rule kao stabilan semantic marker

### Normativno pravilo

Sustav treba preferirati `SEM-simple` kad god se traženi intent može izraziti:

- lokalno
- čitljivo
- jednoznačno
- bez skrivene domain logike

`Rule Catalog` je escalation path.

On nije default zamjena za jednostavne i umjereno složene lokalne uvjete.

### Boundary examples

Ovo su tipični `SEM-simple` slučajevi:

- `3BRITVELA_GORNJA` je uključena kada je feature prisutan, a dodatni uvjet `VISINA_VRATA>=204cm` potvrdi gornju varijantu
- `3BRITVELA_DONJA` je komplementarni fallback za isti feature kada vrijedi niži prag
- `CUTOUT_BRAVA` ostaje aktivan za skup varijanti poput `CILINDAR`, `NUKI`, `DSMART`
- `CUTOUT_COMFORTLOCK` ostaje aktivan za skup varijanti poput `COMFORTLOCK`, `EUROPA_PLUS`

Ovo su tipični `Rule Catalog` slučajevi:

- isti named rule treba reuse na više family-ja partova
- odluka uključuje profile-specific izvedbena pravila koja nisu prikladna za direktan `SEM` zapis
- logika više nije pregledna bez dodatnog tumačenja
- named rule treba postati approval-grade referenca u planning i execution layeru

---

## 14B. `TOPO` v0

`TOPO` je file-level `999` metadata family.

`TOPO` je odvojen od entity-level `SEM` familyja.

- `SEM` ostaje entity-level semantic metadata
- `TOPO` opisuje part-level topology behavior
- `TOPO` i `SEM` su strogo odvojeni

`TOPO` ne zamjenjuje `9-layer` zoning.

`9-layer` ostaje local zoning model.

`TOPO` dodaje file-level behavior mode nad već klasificiranom geometrijom.

File-level `TOPO` binding rule:

- file-level `TOPO:mode=...` metadata pripada document setup bloku
- canonical position je u `ENTITIES` sectionu prije prvog entity recorda, nakon `SEM:document=true` ako je document SEM prisutan
- resolver mora učitati file-level `TOPO` metadata prije entity-level `TOPO` role metadata evaluacije
- entity-level `TOPO:role=...` metadata ostaje neposredno prije entityja na koji se odnosi

### `fixed_envelope_slide`

Prvi `TOPO` mode u `v0` je:

```text
999
TOPO:mode=fixed_envelope_slide;sliding_band=L;fixed_dimension=X;inner_side=RIGHT;outer_side=LEFT
```

Napomena: ovaj 5-field oblik je parcijalan topology hint i nije production-complete executable contract.
Za production intent `fixed_envelope_slide` mora nositi i executable fields opisane ispod.

Semantika polja:

- `sliding_band`
- koji primary layer nosi sliding entitete
- `fixed_dimension`
- os po kojoj se slide događa
- `inner_side`
- koja strana sliding banda je inner anchor
- `outer_side`
- koja strana sliding banda je outer anchor

### Required executable fields for `fixed_envelope_slide`

Za executable `fixed_envelope_slide` intent potrebna su dodatna polja:

- `group` — stable topology group id
- `axis` — os po kojoj se slide događa; v0 koristi `X`
- `lec_parameter` — configurator key za lijevi cutout delta input
- `lec_nominal` — nominalna lijeva vrijednost u Mother DXF-u
- `rec_parameter` — configurator key za desni cutout delta input
- `rec_nominal` — nominalna desna vrijednost u Mother DXF-u
- `delta_rule` — formula za izračun delta, npr. `config_minus_nominal`
- `lec_delta_factor` — faktor primjene delte za `LEC`
- `rec_delta_factor` — faktor primjene delte za `REC`
- `follower_policy` — kako se ponašaju rigid followers; v0 vrijednost: `rigid`
- `trim_policy` — što se radi s `LINE` geometrijom; v0 vrijednost: `rejoin`. Za `fixed_envelope_slide` resolver materializira endpoint-follower repair: horizontalni LINE endpoint koji je u mother DXF-u dodirivao vertikalni mover endpoint slijedi taj mover endpoint na novoj X poziciji.

### X-axis machining convention

Za `fixed_envelope_slide` v0 vrijedi:

- v0 envelope axis je `X`
- `LEFT` / `RIGHT` se čitaju duž machine-local `X` osi
- ovo je machining constraint choice za v0, ne geometrijska nužnost

### Zone vocabulary

TOPO `fixed_envelope_slide` v0 više ne koristi `chain` model.

Executable draft radi nad jednim partom i dvama side-specific cutout zonama:

- `LEC` = Left End Cutout
- `REC` = Right End Cutout

Ovo znači:

- jedan Mother DXF session opisuje jedan part under processing
- lijeva i desna strana mogu imati različite delta inpute
- broj delta input kanala nije isto što i broj partova

### Entity roles

Za executable `fixed_envelope_slide` draft vrijede sljedeće role:

- `mover` — entitet koji se pomiče sa sliding operacijom
- `follower` — rezervirano, nije potrebno za LBRA POC
- anchored default — entitet bez eksplicitne role oznake

### Executable draft syntax

File-level:

```text
999
TOPO:mode=fixed_envelope_slide;group=LBRA_X_SLIDE;axis=X;lec_parameter=LIJEVI_CUTOUT_DIFF;lec_nominal=890;rec_parameter=DESNI_CUTOUT_DIFF;rec_nominal=890;delta_rule=config_minus_nominal;lec_delta_factor=-1.0;rec_delta_factor=1.0;trim_policy=rejoin
```

Entity-level:

```text
999
TOPO:role=mover;group=LBRA_X_SLIDE;zone=LEC
```

```text
999
TOPO:role=mover;group=LBRA_X_SLIDE;zone=REC
```

### Anchor identifikacija

Za `fixed_envelope_slide` vrijedi:

- anchor entiteti su `A` layer
- sliding entiteti su `L` layer members kada je `sliding_band=L`

Razlikovanje `inner` / `outer` anchor strane je geometrijsko, ne po layer tipu.

Za `sliding_band=L` i `fixed_dimension=X`:

- `A` entiteti čiji je `bbox.centerX < L_band_bbox.minX` tretiraju se kao `outer anchor`
- `A` entiteti čiji je `bbox.centerX > L_band_bbox.maxX` tretiraju se kao `inner anchor`

### Band membership

Band membership se ne detektira automatski.

Inženjer ručno assigna sliding entitete kroz postojeći forced layer assignment workflow.

Resolver čita postojeći layer assignment iz sessiona.

To znači:

- nema automatic band detection
- nema sliding band heuristics
- nema nove auto layer logike

### Structural invariant

Mother DXF ostaje enriched raw DXF.

Normativno pravilo: `TOPO` mora biti fizički prisutan kao `999` red u approved Mother DXF-u kada je topology behavior potreban.

Session sidecar metadata nije dovoljan kao canonical approved artifact state.

`TOPO` metadata ne mijenja geometriju u Mother DXF-u.

Geometrijska materializacija događa se samo u child generation layeru.

Simulation resolver smije koristiti `TOPO` za preview i validation.

Simulation resolver nije produkcijski output layer.

Status note: current implementation stores partial `TOPO` metadata for authoring/runtime convenience.

Executable `TOPO` contract is not yet complete.

UI i resolver još ne izvršavaju ovaj executable draft.

Ovo je authoring contract target za sljedeći POC.

Trenutna implementacija čuva parcijalni `TOPO` metadata.

### Resolver ordering discipline

Operation ordering is no longer treated as a deferred topic.

Current canonical discipline is:

1. document-level `SEM` context load
2. entity-level `SEM` inclusion / exclusion
3. entity-level variant gating and placement-by-presence resolution
4. build resolved active geometry for the current parameter set
5. execute one movement stage
6. recompute local join graph and stage-active geometry
7. apply stage-allowed repair operators
8. validate stage result
9. continue to the next declared stage
10. execute `RULE:stage=post_topo`
11. execute final child-level rules such as final orientation and label application

Normative constraints:

- each movement stage runs over previously stabilized geometry
- no cross-branch pairing is allowed
- collision and join logic operate on resolved active geometry, not on the full raw DXF set
- `SEM recompute` remains a reserved future branch and is off by default

### Post-TOPO rigid group offset

`RULE:stage=post_topo` je document-level `999` metadata za zadnji rigidni
pomak nakon `SEM` filtering i `TOPO` materializacije.

Canonical v0 oblik:

```text
999
RULE:stage=post_topo;id=MICRO_SHIFT_SET_X;geometry=offset;target_group=MICRO_SHIFT_SET;axis=X;value_expr=-SKRACENJE;unit=mm;default=0;post_repair=bounded_trim_rejoin
```

Target entiteti nose entity-level marker:

```text
999
SEM:post_topo_group=MICRO_SHIFT_SET
```

Execution order:

1. document-level `SEM` inclusion / exclusion
2. `TOPO` fixed-envelope slide
3. `RULE:stage=post_topo` rigid offset
4. bounded preview repair / validation

`value_expr` v0 podržava numerički parametar ili aritmetički izraz nad
numeričkim configurator parametrima. Ako vrijednost nije numerička, koristi se
`default`.

### Planned final orientation rule

`RULE:stage=final_orientation` is a planned document/profile-level child
transform for final handedness/orientation changes. It is not entity-level SEM
and not TOPO.

Canonical planned form:

```text
999
RULE:stage=final_orientation;id=DOOR_SX_DX_MIRROR;geometry=mirror;axis=Y;when=STRANA_OTVARANJA IN [Lijeva (SX),Inverzna lijeva (INV SX)];normalize_bbox=true
```

Semantics:

- `geometry=mirror` with `axis=Y` maps `x'=-x`, `y'=y`
- `normalize_bbox=true` translates the final child so bbox starts at `0,0`
- rule execution happens after SEM, TOPO, and post-TOPO offset
- `STRANA_OTVARANJA` is the canonical parameter source for DX/SX behavior

### Planned child label application rule

`RULE:stage=child_label` is a planned child enrichment rule for inserting a
production label application hit. The label is not modeled as visible font
geometry; the DXF `TEXT` entity is only a downstream payload carrier. Mother
DXF defines placement, label envelope, rotation, collision policy, and payload
template. DBR materializes placeholders during batch processing.

Canonical planned LBRA form:

```text
999
RULE:stage=child_label;id=S4P4_LBRA_LABEL_APPLICATION;operation=apply_label;coordinate_space=raw_part;anchor_transform=through_final_child;x=1276;y=39;z=0;label_width=50;label_height=20;rotation=0;collision_policy=warn;payload_carrier=TEXT;carrier_layer=0;carrier_height=1;carrier_color=1;carrier_h_align=1;carrier_v_align=2;payload_template=;|{{WORKORDERCODE}}|{{TIP_VRATA}}|{{SOURCE_REFERENCE}}|{{DIMENSION_SHORT}}|{{OPENING_SIDE_SHORT}};payload_field_DIMENSION_SHORT=format({{SIRINA_VRATA_DIV10}}x{{VISINA_VRATA_DIV10}});payload_field_SIRINA_VRATA_DIV10=number_expr(SIRINA_VRATA/10,integer);payload_field_VISINA_VRATA_DIV10=number_expr(VISINA_VRATA/10,integer);payload_field_OPENING_SIDE_SHORT=map(STRANA_OTVARANJA:{Desna (DX)=D,Lijeva (SX)=L,Inverzna desna (INV DX)=D,Inverzna lijeva (INV SX)=L})
```

Field semantics:

- `operation=apply_label` identifies the production hit semantics
- `x/y/z` define the label anchor in the declared coordinate space
- `label_width` and `label_height` define the physical label envelope for preview, safe placement, and collision checks
- `rotation` rotates the production label hit/envelope
- `collision_policy` controls validation behavior, for example `warn` or `error`
- `payload_carrier=TEXT` maps payload output to a DXF `TEXT` carrier entity
- `carrier_height=1` is the OPS S4P4 carrier requirement and must not be changed for canvas readability
- `carrier_layer`, `carrier_color`, `carrier_h_align`, and `carrier_v_align` map to standard DXF TEXT carrier group codes
- `payload_template` may contain direct and derived placeholders in `{{PLACEHOLDER}}` form
- `payload_field_*` entries define derived placeholders with controlled resolver operations such as `format`, `number_expr`, and `map`
- direct placeholders resolve from merged DBR batch row, document-level `999` metadata, and config parameter set context
- `DIMENSION_SHORT` is the production-tested width/height short form and currently excludes `SKRACENJE`
- `OPENING_SIDE_SHORT` must use enum mapping, not naive first-letter extraction
- `coordinate_space=raw_part` means the label anchor follows the same child transform chain as geometry
- `anchor_transform=through_final_child` means mirror/rotate/normalize transforms are applied to the anchor/envelope before carrier emission
- canvas readability and helper rectangles are UI policy only and must not alter production DXF geometry or carrier height

Production-tested carrier shape after DBR materialization:

```text
0
TEXT
8
0
10
1276
11
1276
20
39
21
39
30
0
40
1
1
;|26T01V01|PPV30|SPANJA B3|80x196|L
50
0
62
1
72
1
73
2
0
```

Planned ordering extension:

1. document-level `SEM` inclusion / exclusion
2. placement-by-presence and variant gating
3. resolved active geometry domain
4. movement stages one by one with join recompute and validation
5. `TOPO` fixed-envelope slide where applicable
6. `RULE:stage=post_topo` rigid offset
7. `RULE:stage=final_orientation` mirror / normalization
8. `RULE:stage=child_label` label hit / transformed raw anchor carrier emission

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

- `MXD_DOOR_V0` može tumačiti `rule_ref=MXD_PPV_LAYER_B_OFFSET_9P5` kao `MXD`-specific catalog-backed rule
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
- Rule Catalog se prikazuje i referencira, ali rule expression se ne evaluira
- Operation Catalog nije implementiran
- ChildPlan nije implementiran
- approval-grade metadata validation nije implementiran
- catalog binding errors još nisu puni blocking approval gate

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
