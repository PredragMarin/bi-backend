# SMS Layer Framework v0

Status: Draft v0
Namjena: Operativna pravila rada SMS sloja u BI Core Shellu.

## 1. Ownership model
- Core team je vlasnik publish i contract sloja.
- Modul team je vlasnik business sadržaja i preview generatora.
- Operativa je vlasnik approval procesa.

## 2. Idempotency i dedup
- `tx_key` je globalni dedup kljuè.
- Nema ponovnog slanja istog `tx_key` bez eksplicitnog override procesa.
- Ledger èuva zadnje stanje po `tx_key`.

## 3. Validacija prije publish
- Obavezna polja contracta.
- `phone_e164` regex + normalizacija.
- `direction` mora biti `outbound`.
- `approved` status mora biti pozitivan.

## 4. Publish pravila
- Batch po periodu i namespace/use_case.
- Atomièni file drop u outbox share.
- Ime filea s timestampom i batch ID-om.
- Line-level skip na grešku + audit event.

## 5. Ledger eventi (minimalni set)
- `OUTBOX_PUBLISH_REQUESTED`
- `OUTBOX_LINE_VALIDATED`
- `OUTBOX_LINE_SKIPPED`
- `OUTBOX_FILE_DROPPED`
- `OUTBOX_PUBLISH_FAILED`
- `SENT_OK | SENT_FAIL | INBOUND_RECEIVED` (iz gateway feeda)

## 6. Operativne kontrole
- Retry policy za transient greške.
- Dnevni reconciliation (`approved` vs `dropped` vs `sent`).
- Retention i mjeseèna rotacija logova.
- Promjene contracta kroz verzioniranje (`schema_version`).
