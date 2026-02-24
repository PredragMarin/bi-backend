# ERP Gateway POC Framework v0

## 1. Cilj (prije produkcijskog dogovora)
Potvrditi koncept bez Knexa:
- backend otvara ERP konekciju samo na zahtjev,
- izvodi jedan allowlisted SELECT,
- snima rezultat u CSV,
- zatvara konekciju odmah nakon izvrsenja.

## 2. Scope ovog mini POC-a
- `erp_smoke_select_min.js` (jedan smoke runner)
- output u `out/erp_smoke/YYYY_MM_DD/`
- `smoke_result.csv` + `smoke_manifest.json`

## 3. Sigurnosna pravila
- Nema trajnog UID/PWD u ODBC DSN GUI-u.
- Connection string dolazi runtime iz env varijable `ERP_CONN_STR`.
- Upit ide samo kroz allowlist (`QUERY_ID -> SQL`).
- Konekcija se uvijek zatvara u `finally`.
- U log/manifest ne spremati credentialse ni connection string.

## 4. Predlozeni protokol (za kasnije)
Input:
- `module_id`
- `query_id`
- `params`
- `request_id`

Kontrole:
- query allowlist
- timeout
- max rows
- audit metadata (trajanje, row_count, status)

Output:
- rows (ili CSV)
- metadata (`duration_ms`, `row_count`, `status`, `error_code`)

## 5. Minimalna allowlist ideja
- `SMOKE_HEALTH`: `SELECT 1 AS smoke_ok`
- `SMOKE_OSEBE_TOP10`: `SELECT TOP 10 osebid, ime, priimek FROM osebe WHERE aktiven = 2 ORDER BY osebid`

## 6. Run checklist
1. Postaviti `ERP_CONN_STR` u runtime env.
2. Potvrditi da DB user ima samo SELECT prava.
3. Pokrenuti smoke script.
4. Provjeriti CSV i manifest.
5. Potvrditi da se konekcija zatvara nakon runa.

## 7. Kriterij uspjeha
- Bez rucnog SQL Central login-a.
- Script napravi CSV i manifest.
- Konekcija se zatvori nakon izvrsenja.
