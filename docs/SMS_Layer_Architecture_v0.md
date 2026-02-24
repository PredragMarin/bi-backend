# SMS Layer Architecture v0

Status: Draft v0
Namjena: Definira odgovornosti i tok podataka za company-wide SMS sloj u BI Core Shellu.

## 1. Svrha i opseg
- SMS slanje i praæenje je core capability, ne modul-specifièna funkcija.
- Moduli proizvode business sadržaj (`sms_preview`), a Core radi approval -> publish -> gateway handoff.
- Vanjski gateway je SMS Gateway Service v10.12 (file-drop + NDJSON events).

## 2. Logièke komponente
- Module Producers: proizvode `sms_preview` podatke (npr. `epr_attendance_v1`).
- Approvals UI/API: operativna potvrda poruka za slanje.
- Core SMS Publisher: join preview + approvals, validacija, mapiranje na gateway contract, outbox drop.
- Core SMS Ledger: audit trail i idempotency evidencija.
- Gateway Adapter Boundary: datoteèni handoff prema `\\192.168.100.95\\SMS_Gateway\\outbox`.
- Inbound Event Ingestor: èitanje gateway events i korelacija prema `tx_key`.

## 3. End-to-end flow
1. Modul objavi `sms_preview`.
2. Operater odradi approvals.
3. Core publisher uzme samo `approved`.
4. Core mapira na outbox NDJSON line contract.
5. Core atomièno dropa `.ndjson` u gateway outbox.
6. Gateway obraðuje i emitira evente.
7. Core ledger bilježi publish i lifecycle evente.

## 4. Nefunkcionalni zahtjevi
- Idempotentnost po `tx_key`.
- Atomièni write (`.tmp` -> rename).
- Full traceability (`sms_key` -> `tx_key` -> gateway event).
- Line-level izolacija greške (batch ne smije pasti zbog jedne poruke).
