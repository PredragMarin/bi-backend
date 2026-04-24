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
  "raw_comment": "SEM:op=combine;part=KSKR;flag=on",
  "namespace": "SEM",
  "keys": {
    "op": "combine",
    "part": "KSKR",
    "flag": "on"
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

- `op`
- `action`
- `mode`

Namjena:

- opis operation intenta

### B. Target keys

Primjeri:

- `part`
- `target`
- `group`

Namjena:

- opis na što se instruction odnosi

### C. Feature keys

Primjeri:

- `flag`
- `feature`
- `enable`
- `disable`

Namjena:

- feature on/off semantika

### D. Parameter keys

Primjeri:

- `width`
- `height`
- `offset`
- `variant`

Namjena:

- jednostavni param-driven input

### E. Technology keys

Primjeri:

- `profile`
- `tech`
- `post`

Namjena:

- technology-specific hint

Važno:

- puni allow-list vocabulary treba doći kasnije po technology profileovima
- `v0` dokument još ne zaključava konačnu listu svih podržanih ključeva

---

## 9. Validation pravila

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

---

## 10. Binding model

Binding ide po ovom pravilu:

- jedan `999` comment pripada sljedećem DXF entityju

U `v0` jedan entity može imati:

- `0` instructions
- `1` instruction
- više instruction zapisa ako postoji više uzastopnih `999` komentara

Ali preporučeni working model za `v0` je:

- jedan semantic instruction record po entityju

Više zapisa po entityju ostavljamo kao dopuštenu, ali kasnije dodatno specificiranu mogućnost.

---

## 11. Relationship prema relevant-object modelu

`InstructionSet` se ne veže direktno na cijeli dokument kao nejasni string pool.

Veže se na:

- relevant semantic objects
- odnosno na njihove `entity_id` identitete

To je važno jer:

- child planning mora znati kojem objektu instruction pripada
- instruction ne smije ostati “lebdeći komentar”

---

## 12. Relationship prema technology profileovima

Generic `InstructionSet` parser radi:

- format parsing
- basic validation
- binding

Technology profile radi:

- profile-specific meaning
- profile-specific allow-list
- profile-specific operation mapping

Primjer:

- `OPS_S4P4` može tumačiti `op=combine` kao validnu operation
- drugi future profile možda to neće podržavati

Time se zadržava:

- jedan generic parser
- više profile-specific interpretacija

---

## 13. Relationship prema `Combiner` operationi

Za prvi `OPS_S4P4` derivative:

- `Combiner` je važna operation family

Zato `InstructionSet v0` mora ostaviti mjesto za operation hintove poput:

- `op=combine`
- `op=decombine`
- `group=...`
- `part=...`

Ali `InstructionSet v0` još ne zaključava punu semantics tih operationa.

To dolazi u:

- technology profile pravilima
- i kasnije u `ChildPlan` / operation execution layeru

---

## 14. Što `InstructionSet v0` još nije

`InstructionSet v0` još nije:

- finalna registry specifikacija svih operationa
- finalna allow-list svih ključeva
- puni production execution spec
- policy engine
- macro language

To je namjerno.

`v0` služi da:

- stabilizira format
- stabilizira binding
- stabilizira validation razinu
- omogući prve smoke implementacije

---

## 15. Preporučeni prvi smoke use caseovi

Za prve smoke implementacije preporučuju se samo jednostavni slučajevi:

1. feature on/off flag
2. jedna jednostavna profile-specific operation oznaka
3. jedan `combine` hint bez pune batch semantike

To je dovoljno da se potvrdi:

- parser
- binding
- validation
- downstream prijenos u `ChildPlan`

---

## 16. Sljedeći korak nakon ovog dokumenta

Nakon `InstructionSet v0` dokumenta prirodni sljedeći korak je:

- `ChildPlan v0`

Jer tek kombinacija:

- semantic model
- `InstructionSet`

može dati smislen i stabilan child planning layer.
