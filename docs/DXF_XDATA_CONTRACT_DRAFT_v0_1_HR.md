# DXF XDATA Contract Draft v0.1

Status: radni draft  
Datum: 2026-05-07  
Scope: hitne implementacijske smjernice za Mother DXF variant-aware authoring i DBR production-like batch execution

## 1. Svrha

Ovaj dokument definira pragmatičan XDATA-based metadata contract za trenutni delivery window.

Cilj nije sada izgraditi savršen finalni semantic system. Cilj je:

1. razlikovati namjerne variant overlapove od stvarnih raw DXF defekata
2. omogućiti da upstream CAD priprema nosi dovoljno variant identity signala
3. omogućiti da se `mother_dxf_v1` ponaša sigurno tijekom selection, TOPO, SEM i layer rada
4. omogućiti da `DBR` kasnije konzumira već pripremljene Mother DXF artefakte i proizvodi child batcheve

Ovaj draft je namjerno uzak i favorizira delivery speed ispred teorijske potpunosti.

## 2. Hitni inženjerski kontekst

Trebamo podržati near-term test run za S4PP4 liniju na production-like podacima:

- 20 vrata dnevno
- 12 partova po vratima
- više partova koji traže fixed-envelope TOPO ponašanje

Trenutni `mother_dxf_v1` je dovoljno jak za koristan authoring, ali sustav sada dolazi do arhitekturnog limita:

- neki geometry overlapovi su stvarni defekti
- neki geometry overlapovi su namjerne variant alternative
- bez variant metadata, sanitize i downstream authoring ne mogu razlikovati jedno od drugoga

Odabrana kratkoročna strategija je:

1. poboljšati upstream CAD pripremu
2. anotirati variant familije u DXF XDATA
3. učiniti `mother_dxf_v1` variant-aware
4. zadržati `DBR` fokusiran na headless execution nad već kuriranim Mother DXF inputima

## 3. Minimalni XDATA contract

### 3.1 Application Name

Koristiti jedno registrirano XDATA application ime:

- `MOTHERDXF`

To drži namespace stabilnim i poravnanim s trenutačnom Mother DXF implementacijom.

### 3.2 Minimalni obavezni ključevi

Za variant-bearing geometriju koristiti točno dva obavezna ključa:

- `FEATURE_FAMILY`
- `VARIANT_KEY`

Primjer:

- `FEATURE_FAMILY=FRIZURA`
- `VARIANT_KEY=ECO`

Alternativa u istoj zoni:

- `FEATURE_FAMILY=FRIZURA`
- `VARIANT_KEY=EU_PPV`

### 3.3 Pravilo interpretacije

Ako se dvije geometrije overlapaju i dijele:

- isti `FEATURE_FAMILY`
- različit `VARIANT_KEY`

tada se taj overlap tretira kao:

- `expected_variant_overlap`

a ne kao:

- `raw_geometry_conflict`

### 3.4 Opcionalni budući ključevi

Nisu potrebni za v0.1, ali su kasnije dopušteni:

- `PRODUCT_SCOPE`
- `ROLE`
- `EXCLUDE_IF`
- `TOPO_GROUP_HINT`

Ovi ključevi su eksplicitno izvan scopea trenutnog hitnog deliveryja osim ako kasniji korak ne pokaže da su nužni.

## 4. AutoCAD priprema

## 4.1 Cilj pripreme

Upstream CAD operater treba isporučiti:

1. čišću raw DXF geometriju
2. variant-bearing geometriju anotiranu XDATA-om
3. što manje ambiguoznih overlapova bez variant identity signala

Ovaj posao je upstream priprema, ne downstream Mother DXF cleanup.

## 4.2 Što mora biti anotirano

Anotirati:

- variant blockove
- variant-only cutout elemente
- variant-only finishing featuree
- svaki alternativni geometry set koji zauzima istu funkcionalnu zonu

Ne trošiti vrijeme na anotiranje svake trivijalne linije u partu osim ako je feature stvarno variant-driven.

## 4.3 Preporučeni AutoCAD resource model

Za v0.1 koristiti jedan zajednički APPID:

- `MOTHERDXF`

Svaki anotirani objekt ili block instance treba nositi XDATA vrijednosti poput:

- `FEATURE_FAMILY=FRIZURA`
- `VARIANT_KEY=ECO`

ili:

- `FEATURE_FAMILY=FRIZURA`
- `VARIANT_KEY=EU_PPV`

## 4.4 Preporučena granularnost anotacije

Poželjno:

- anotirati top-level block instance ako je cijeli block jedan variant feature

Prihvatljiv fallback:

- anotirati child entitete ako je block već explodean ili samo dio njegove djece pripada varijanti

Izbjegavati miješanu praksu unutar jednog featurea osim ako je stvarno nužno.

## 4.5 Naming convention

Koristiti uppercase ASCII ključeve.

Imena ključeva:

- `FEATURE_FAMILY`
- `VARIANT_KEY`

Preporuke za naming vrijednosti:

- kratko
- stabilno
- product-facing
- bez razmaka ako je moguće

Dobri primjeri:

- `FRIZURA`
- `ECO`
- `EU_PPV`
- `EUROPA`
- `EUROMAX`

Izbjegavati:

- ad hoc slobodni tekst
- mixed casing
- duge opisne rečenice

## 4.6 AutoCAD operator notes

CAD operater treba usvojiti samo malu, ponovljivu naviku:

1. identificirati variant-bearing geometriju
2. attachati XDATA pod `MOTHERDXF`
3. postaviti `FEATURE_FAMILY`
4. postaviti `VARIANT_KEY`
5. spremiti DXF
6. pokrenuti sanitize check
7. ispraviti flagged raw defekte u CAD-u
8. ponavljati dok stanje ne bude prihvatljivo

## 4.7 Upstream sanitize workflow

Upstream inženjer treba koristiti sanitize diagnostics loop ovako:

1. pripremiti raw DXF u CAD-u
2. attachati variant XDATA
3. učitati u sanitize-oriented Mother DXF workflow
4. pregledati:
   - degenerate lines
   - micro lines
   - overlap cluster-e
   - expected variant overlapove
5. vratiti se u CAD
6. korigirati geometriju
7. ponavljati

To je preferirani operativni model. Downstream Mother DXF authoring ne bi smio biti mjesto gdje se raw CAD defekti prvi put otkrivaju.

## 5. Sanitizer classification rules

## 5.1 Trenutne i ciljane klase

Sanitize layer treba klasificirati geometry nalaze u:

1. `real_defect`
2. `expected_variant_overlap`
3. `unknown_overlap`

## 5.2 Draft klasifikacije

### A. Real Defect

Primjeri:

- degenerate line
- micro line
- accidental duplicate
- broken contour
- neobjašnjen overlap bez variant identityja

### B. Expected Variant Overlap

Uvjet:

- isti `FEATURE_FAMILY`
- različit `VARIANT_KEY`
- ista ili overlapana prostorna zona

Značenje:

- dopušteno do trenutka variant resolutiona
- ne smije blokirati downstream rad
- treba ostati vidljivo kao kontekst, ali ne kao hard error

### C. Unknown Overlap

Uvjet:

- overlap detektiran
- XDATA identity nedostaje ili je nepotpun

Značenje:

- sumnjivo
- traži CAD-side razjašnjenje

## 6. Mother DXF refactor plan za XDATA

## 6.1 Cilj

`mother_dxf_v1` mora postati variant-aware bez pokušaja da u ovom delivery windowu postane potpuno generički semantic engine.

Kratkoročna uloga XDATA-a u Mother DXF-u je:

- variant filtering
- variant-safe selection
- variant-safe TOPO authoring
- variant-safe SEM authoring

## 6.2 Ciljano V1 ponašanje

Dodati `Active Variant Key` koncept na razini sessiona/UI-a.

Kad je aktivna varijanta:

- `VARIANT_KEY=EU_PPV`

tada:

- entiteti/blockovi s `VARIANT_KEY=EU_PPV` su visible i selectable
- entiteti/blockovi s `VARIANT_KEY=ECO` su dimmed ili hidden
- TOPO, SEM, Force Assign Layer i Force XDATA Add rade samo nad aktivnom varijantom

## 6.3 Potrebne promjene u Mother DXF-u

### A. XDATA read path

Proširiti postojeći XDATA parsing tako da izlaže:

- `FEATURE_FAMILY`
- `VARIANT_KEY`

po objektu i po block-bearing objektu gdje je primjenjivo.

### B. Session state

Dodati session/UI state:

- `active_variant_key`

Moguće vrijednosti:

- prazno / none
- `ECO`
- `EU_PPV`
- itd.

### C. Viewer filtering

Implementirati:

- visible + selectable ako objekt odgovara aktivnoj varijanti
- dimmed ili hidden ako objekt pripada drugoj varijanti unutar iste familije

### D. Selection gating

Selection mora ignorirati neaktivne variant objekte tijekom:

- click selecta
- drag selecta
- helper alata
- overlap resolutiona

### E. Sanitize awareness

Sanitize mora reinterpretirati overlapove pomoću XDATA:

- ista familija + različita varijanta -> `expected_variant_overlap`
- bez XDATA -> `unknown_overlap`

### F. Authoring safety

Kad je variant mode aktivan:

- TOPO mover assignment ne smije slučajno uključiti neaktivnu variant geometriju
- `Force Assign Layer` ne smije pogađati neaktivnu variant geometriju
- `Metadata Authoring` mora biti scoped na aktivnu variant geometriju

## 6.4 Scope koji eksplicitno izbjegavamo

Nemojte sada pokušavati:

- multi-group variant logiku
- kompleksnu compatibility matricu između više variant familija
- dynamic rule-catalog driven variant activation
- potpuno generički variant engine

Delivery target je variant-safe authoring, ne ultimativna semantička potpunost.

## 6.5 Preporučeni Mother DXF delivery redoslijed

1. XDATA parse exposure za `FEATURE_FAMILY` i `VARIANT_KEY`
2. `Active Variant Key` UI control
3. viewer gating
4. selection gating
5. sanitize reinterpretation
6. TOPO/SEM/Layer authoring gating

## 7. DBR completion plan za production-like batch runove

## 7.1 Misija DBR-a u ovom delivery windowu

`DBR` ne bi smio rješavati upstream CAD ambiguities.

`DBR` treba ingestati:

- ERP radne naloge
- frozen parameter snapshot
- approved Mother DXF fileove

i proizvoditi:

- child DXF batcheve

u file-drop execution modu.

## 7.2 Potrebni inputi

Po production orderu / po vratima:

- ERP work order row(s)
- frozen parameter snapshot
- Mother DXF reference za svih 12 partova
- designated drop folder target

## 7.3 Production-like execution shape

Ciljani dnevni run:

- 2 vrata
- 12 partova po vratima
- ukupno 24 child DXF outputa dnevno

DBR treba raditi kao:

1. ingest batcha
2. mapiranje order -> kit -> part jobs
3. resolve svakog parta nad frozen parameter snapshotom
4. generiranje child DXF-a
5. drop fileova u designated output folder
6. emit execution summaryja

## 7.4 Minimalni DBR boundary za test run

Za test run DBR smije nastaviti koristiti trenutni Mother DXF child-generation path kao kontrolirani black-box dependency ako je potrebno.

To je prihvatljivo samo kao privremeni execution bridge.

DBR ne smije dugoročno postati wrapper oko Mother DXF internalsa.

## 7.5 Preporučeni DBR V0.1 delivery scope

### A. Inputi

DBR mora prihvatiti:

- ERP order identity
- frozen parameter snapshot
- part -> Mother DXF mapping
- drop-folder target

### B. Execution

Za svaki part job:

1. loadati ispravan Mother DXF artefakt
2. proslijediti frozen parametre
3. zatražiti child DXF generation
4. zapisati output file u drop folder
5. persistirati per-part execution status

### C. Output naming

Koristiti deterministički file naming convention:

- `<order>__<door>__<part>__<variant>.dxf`

Točan naming se kasnije može doraditi, ali v0.1 mora biti:

- deterministički
- grep-friendly
- human-readable

### D. Result summary

Za svaki batch run proizvesti:

- generated count
- failed count
- failed part list
- output folder path

## 7.6 Preporučeni DBR delivery koraci

1. završiti ingest path za ERP radne naloge
2. frozen parameter snapshot po jobu
3. resolve Mother DXF reference po partu
4. implementirati file-drop writer
5. implementirati batch summary
6. napraviti daily smoke s 2 x 12 partova

## 7.7 Što DBR sada ne smije pokušavati raditi

Nemojte u hitni DBR scope stavljati:

- CAD sanitaciju
- variant authoring
- raw defect repair
- ručno semantic editiranje

To pripada upstream pripremi ili Mother DXF authoringu.

DBR treba izvršavati approved inpute, a ne izmišljati nedostajuću namjeru.

## 8. Immediate team guidance

## 8.1 CAD tim

Početi anotirati variant-bearing geometriju s:

- `FEATURE_FAMILY`
- `VARIANT_KEY`

pod XDATA app nameom:

- `MOTHERDXF`

## 8.2 Mother DXF tim

Implementirati variant-aware V1 ponašanje:

- čitati XDATA
- izložiti active variant
- filtrirati selection i visibility
- reinterpretirati sanitize overlapove

## 8.3 DBR tim

Ostati uzak:

- ingest ERP-a
- frozen parameter snapshot
- mapping Mother DXF-a
- generiranje child fileova
- drop u designated folder

## 9. Preporučena kratkoročna delivery odluka

Za cilj idućeg tjedna, najvrjedniji put je:

1. upstream CAD cleanup + XDATA anotacija
2. Mother DXF variant-aware V1
3. DBR file-drop batch runner nad već kuriranim Mother DXF inputima

To je najbrži put do production-like test runa bez pretvaranja da je dugoročna finalna arhitektura već završena.

