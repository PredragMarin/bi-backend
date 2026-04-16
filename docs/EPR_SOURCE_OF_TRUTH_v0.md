# EPR Izvori Istine v0

## 1. Svrha

Ovaj dokument definira početni model izvora istine za EPR redizajn.

Odgovara na četiri pitanja:
- koji izvor daje koju činjenicu
- koliko je svaki izvor pouzdan
- što se događa kad se izvori ne slažu
- koji minimalni smoke testovi moraju postojati prije nego krenemo dalje s policy redizajnom

## 2. Scope

Ovaj v0 pokriva izvore koji su već vidljivi u trenutnom toku modula:
- ERP raw attendance redove
- ERP calendar redove
- ERP employee master redove
- HZZO Excel ingest
- manualnu poslovnu interpretaciju preko notes/markera

Ovaj v0 još ne definira:
- finalnu canonical shemu
- finalna payroll pravila
- finalni override workflow

## 3. Klase Autoriteta

Svaki izvor mora biti klasificiran u jednu od ovih klasa:

- `AUTHORITATIVE`
  Primarni izvor činjenice za jasno definiranu domenu.
- `SUPPORTING`
  Koristan signal, ali sam po sebi ne može overrideati autoritativni izvor.
- `OVERRIDE`
  Eksplicitni poslovni correction path koji može zamijeniti default interpretaciju.
- `AUDIT_ONLY`
  Čuva se radi traceabilityja, ali ne smije direktno mijenjati compute ishod.

## 4. Registar Izvora v0

### 4.1 ERP raw attendance redovi

Trenutni code path:
- `src/modules/epr_attendance_v1/adapters/db_fetch_epr.js`

Uočeni payload primjeri:
- `osebid`
- `timevhod`
- `timeizhod`
- `tipvhod`
- `tipizhod`
- `opomba`
- `lokizhod`
- audit polja kao `usermod`, `timemod`

Prijedlog autoriteta:
- `AUTHORITATIVE` za raw attendance event capture

Što bi ovaj izvor trebao značiti:
- raw činjenicu da attendance interval ili attendance-coded zapis postoji u ERP-u
- timestamp izvor za dolazak/odlazak
- izvor eksplicitnih attendance coding polja koja se vode u ERP-u

Što ovaj izvor ne bi smio značiti sam po sebi:
- finalnu payroll interpretaciju
- finalnu legitimnost iznimke
- pouzdano objašnjenje poslovnog razloga, osim ako reason field nije eksplicitno uređen policyjem

Poznati rizici:
- duplicirani redovi
- konfliktni zapisi
- otvoreni intervali
- kasne ručne korekcije
- raspršeno poslovno značenje preko `tipizhod`, `tipvhod` i `opomba`

Početno pravilo:
- ERP raw attendance je primarni fact source za attendance evente.
- Svaka reinterpretacija tih redova mora biti dokumentirana kao normalizacija ili policy, a ne tretirana kao raw istina.

### 4.2 ERP calendar redovi

Trenutni code path:
- `src/modules/epr_attendance_v1/adapters/db_fetch_epr.js`

Uočeni payload primjeri:
- `datum`
- `dandelovni`
- `praznik`
- `tekst`

Prijedlog autoriteta:
- `AUTHORITATIVE` za enterprise workday/holiday calendar

Što bi ovaj izvor trebao značiti:
- calendar klasifikaciju datuma
- bazni okvir workday vs non-workday
- holiday marker

Što ovaj izvor ne bi smio značiti sam po sebi:
- dokaz attendancea
- dokaz prava na leave
- dokaz da je rad stvarno obavljen

Poznati rizici:
- business text labele mogu nositi skrivenu semantiku
- značenje collective leave dana trenutno može ovisiti o free-text interpretaciji

Početno pravilo:
- ERP calendar definira default date frame.
- Svako attendance ili payroll ponašanje izvedeno iz tekstualnih labela mora kasnije biti prevedeno u eksplicitni policy.

### 4.3 ERP employee master redovi

Trenutni code path:
- `src/modules/epr_attendance_v1/adapters/db_fetch_epr.js`

Uočeni payload primjeri:
- `osebid`
- `ime`
- `priimek`
- `tel_gsm`
- `e_mail`
- `alt_id`
- derived `group_code`
- derived `mode`

Prijedlog autoriteta:
- `AUTHORITATIVE` za employee identity linkage
- `SUPPORTING` za segmentacijska polja dobivena transformacijom

Što bi ovaj izvor trebao značiti:
- identity lookup
- postojanje zaposlenika
- employee-level linking ključeve

Što ovaj izvor ne bi smio značiti sam po sebi:
- policy iznimku
- legitimnost attendancea
- payroll entitlement

Poznati rizici:
- transformirani tagovi mogu sadržavati fallback ponašanje
- segmentacija možda nije čisti source of truth

Početno pravilo:
- identity polja su autoritativna ako dolaze direktno iz ERP mastera.
- transformirana grupna polja moraju kasnije biti posebno deklarirana ili kao canonical policy input ili kao implementacijska pomoć.

### 4.4 HZZO Excel ingest

Trenutni code path:
- `src/modules/epr_attendance_v1/adapters/hzzo_ingest.js`

Uočena uloga u trenutnom modulu:
- vanjski supporting input za absence slučajeve
- mapira evidence prema sintetiziranim redovima ili absence interpretaciji

Radna odluka v0:
- HZZO je jači izvor za medicinski potvrđene absence slučajeve koji moraju biti usklađeni s payroll i JOPPD evidencijom.
- HZZO nije samostalni correction path u smislu tihog prepisivanja ERP rada bez traga.
- Kad HZZO potvrđuje absence, njegov kod i pripadni dani moraju biti preneseni u payroll evidenciju.

Što bi ovaj izvor trebao značiti:
- vanjsku potvrdu da postoji medical/leave-related događaj
- jači absence signal za payroll i JOPPD usklađenje
- supporting evidence za absence periode

Što ovaj izvor u v0 ne bi smio značiti sam po sebi:
- tihu zamjenu konfliktnog ERP rada bez review traga
- skriveni correction bez obavijesti voditelju

Poznati rizici:
- varijabilna Excel struktura
- mapping nejasnoće
- OIB linkage pogreške
- vremenski mismatch između HZZO evidencije i ERP unosa
- krhkost external file discovery/path mehanizma

Početna pravila:
- Ako HZZO potvrđuje absence dane, a ERP za te dane nema attendance evidenciju, HZZO dan treba prenijeti u payroll kao odgovarajuću absence šifru i 8 sati za taj datum.
- U tom slučaju review nije potreban samo zato što ERP nema evidenciju, jer za taj dan evidencija rada nije bila obavezna u ERP-u.
- Ipak mora postojati pisani trag, odnosno absence evidence iz HZZO/doznaka.
- Ako HZZO potvrđuje absence, a ERP za isti dan sadrži regularan radni interval, HZZO je jači signal za absence klasifikaciju, ali slučaj mora otvoriti review voditelju.
- Taj review služi za poslovnu akciju i razjašnjenje, a ne za tihi correction bez traga.

### 4.5 Notes, tekstualni markeri i location markeri

Trenutni primjeri:
- `opomba`
- WFH notes
- `lokizhod`
- RFID/IP signali

Prijedlog autoriteta:
- `SUPPORTING` ili `AUDIT_ONLY`, ovisno o polju

Što bi ti signali trebali značiti:
- kontekstualni hint
- pomoćni review signal
- marker za policy interpretaciju, ali samo ako je to eksplicitno odobreno

Što ti signali ne bi smjeli značiti po defaultu:
- samostalnu payroll klasifikaciju
- tihu zamjenu jačih coded polja

Poznati rizici:
- free-text krhkost
- nekonzistentna upotreba
- skrivene lokalne konvencije

Početno pravilo:
- free-text i marker polja nisu autoritativna dok neko specifično policy pravilo izričito ne kaže suprotno.

## 5. Početna Hijerarhija Povjerenja v0

Ovo nije finalni policy.
Ovo je početna hijerarhija za daljnji redizajn.

1. ERP calendar za klasifikaciju datuma
2. ERP raw attendance za postojanje attendance događaja
3. ERP employee master za identity resolution
4. HZZO kao jači absence signal uz obvezni review kod konflikta s ERP radom
5. notes/location markeri kao supporting ili audit-only signal

## 6. Tipovi Konflikata Koje Treba Kasnije Definirati

Redizajn će morati razriješiti barem ove klase konflikata:

- ERP attendance postoji, a HZZO absence također postoji
- ERP coded leave postoji, a raw interval rada također postoji
- calendar kaže workday, a external leave evidence kaže excused absence
- note kaže WFH, ali location signal sugerira on-site
- više ERP redova se međusobno ne slaže za isti dan

## 7. Smoke Test Matrica v0

Ovi smoke testovi nisu potpuni business testovi.
Oni su minimum za provjeru integriteta izvora.

### 7.1 ERP raw attendance smoke testovi

- Može se fetchati redove za zatvoreni date range bez gateway greške.
- Vraćeni row count je veći od nule za poznati aktivni period.
- Obvezna polja postoje: `osebid`, `timevhod`, `tipizhod`.
- Opcionalna polja su eksplicitno prisutna ili odsutna, a ne tiho preimenovana.
- `timevhod` se parsira deterministički.
- Ako `timeizhod` postoji, i on se parsira deterministički.
- `tipvhod` i `tipizhod` su numerički.
- Duplicirani raw signatureovi mogu se izbrojati.
- Redovi s nedostajućim ili nevažećim time poljima mogu se otkriti i auditirati.

### 7.2 ERP calendar smoke testovi

- Calendar fetch vraća red za svaki datum u traženom periodu.
- `datum` se parsira deterministički.
- `dandelovni` i `praznik` ostaju unutar dopuštenog skupa vrijednosti.
- Holiday redovi mogu se izbrojati bez text parsiranja.
- Text-based collective leave redovi su prepoznatljivi i auditabilni.

### 7.3 ERP employee master smoke testovi

- Identity dataset fetch uspijeva u istom runtime batchu.
- `osebid` je jedinstven nakon normalizacije.
- Obvezni identity ključevi nisu prazni za aktivne zaposlenike.
- Join attendance redova na employee master može se izmjeriti.
- Out-of-scope filtering je eksplicitan i mjerljiv.

### 7.4 HZZO Excel smoke testovi

- Source path se rješava deterministički.
- Barem jedan workbook može se otkriti u known-good test folderu.
- Workbook redovi mogu se ekstrahirati bez tihog partial failurea.
- Očekivani stupci se mogu detektirati iz workbook sadržaja.
- Date polja se parsiraju deterministički.
- OIB se normalizira na 11 znamenki kad je valjan.
- Poznati absence code može se mapirati na catalog entry.
- Unmatched OIB count je mjerljiv.
- Broj sintetiziranih absence dana je mjerljiv.
- Hard parse failure proizvodi eksplicitnu ingest grešku, a ne tihi fallback.
- HZZO absence dan bez ERP attendance reda može se prenijeti kao payroll absence signal.
- HZZO absence dan s postojećim ERP radnim intervalom mora biti označen kao review slučaj.

### 7.5 Reconciliation smoke testovi

- Ista osoba i isti dan mogu se usporediti između ERP-a i HZZO-a.
- Konfliktni slučajevi mogu se izbrojati prije bilo kakvog business resolutiona.
- Svaki sintetizirani red može se pratiti do source filea i source row seta.
- HZZO absence bez ERP attendancea mora biti razlučiv od HZZO-vs-ERP konflikta.
- HZZO-vs-ERP konflikt mora otvoriti review signal za voditelja.
- Svaki budući override-capable path mora čuvati audit trag.

## 8. Otvorena Pitanja

- Koji točno HZZO kodovi mapiraju na koje payroll šifre i minute?
- Je li `tipizhod` uvijek jači signal od `opomba`, ili postoje odobrene iznimke?
- Smije li `lokizhod` ikad promijeniti klasifikaciju, ili samo otvara review?
- Smije li collective leave ostati text-derived, ili mora postati eksplicitni kod?
- Koji je izvor autoritativan kad ERP sadrži i stvarni radni interval i coded excused leave za isti dan?

## 9. Potvrđene Odluke Iz Rasprave

### 9.1 HZZO autoritet

- HZZO je izvor istine za medicinski potvrđene absence dane koji moraju biti usklađeni s payroll i JOPPD evidencijom.
- Ako HZZO potvrđuje absence dan, a ERP za taj dan nema evidenciju rada, absence se prenosi u payroll bez dodatnog reviewa.
- Ako HZZO potvrđuje absence dan, a ERP za isti dan ima regularan radni interval, slučaj ide na review voditelju.
- U tom konfliktu HZZO je jači absence signal, ali review ostaje obvezan radi poslovne akcije i razjašnjenja.
- HZZO support mora imati pisani trag, odnosno doznaku ili ekvivalentnu absence evidenciju.

## 10. Trenutna Radna Odluka

Prije redefiniranja attendance ili payroll logike, sljedeći odobreni korak trebao bi biti:

1. zamrznuti i pregledati registar izvora
2. potvrditi authority class za svaki izvor
3. potvrditi koji source konflikti otvaraju `review`, a koji dopuštaju `override`
4. na temelju toga definirati canonical input model
