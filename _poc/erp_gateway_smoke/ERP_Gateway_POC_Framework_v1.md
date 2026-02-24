# ERP Gateway POC Framework v1 (hardened mini)

## Sta je dodano u odnosu na v0
- Secret retrieval sloj (`secret_provider.js`) umjesto direktnog oslanjanja samo na `ERP_CONN_STR`.
- Query governance (`query_allowlist.js`) s `timeoutMs`, `maxRows`, i zabranom raw SQL.
- Gateway contract (`erp_gateway_runner.js`) sa `module_id`, `query_id`, `request_id`, audit izlazom.
- Smoke runner (`erp_smoke_select_min.js`) sada ide kroz gateway sloj.

## Struktura POC foldera
- `erp_smoke_select_min.js`: entry smoke script
- `erp_gateway_runner.js`: connect/query/close + timeout + audit
- `query_allowlist.js`: jedina dozvoljena lista upita
- `secret_provider.js`: secret retrieval fallback redoslijed
- `ERP_Gateway_POC_Framework_v1.md`: ovaj dokument

## Secret retrieval redoslijed
1. `ERP_CONN_STR`
2. `ERP_DSN` + `ERP_UID` + `ERP_PWD`
3. `ERP_SECRET_FILE` (JSON)

`ERP_SECRET_FILE` format:
```json
{ "erp_conn_str": "DSN=ERP_POC_RO;Authentication=Database;UID=...;PWD=...;" }
```
ili:
```json
{ "erp_dsn": "ERP_POC_RO", "erp_uid": "...", "erp_pwd": "..." }
```

## Run primjeri
Health check:
```powershell
$env:ERP_DSN="ERP_POC_RO"
$env:ERP_UID="adminm"
$env:ERP_PWD="xxxxx"
$env:ERP_SMOKE_QUERY_ID="SMOKE_HEALTH"
node _poc/erp_gateway_smoke/erp_smoke_select_min.js
```

Real data sample:
```powershell
$env:ERP_DSN="ERP_POC_RO"
$env:ERP_UID="adminm"
$env:ERP_PWD="xxxxx"
$env:ERP_SMOKE_QUERY_ID="SMOKE_OSEBE_TOP10"
$env:ERP_MODULE_ID="epr_attendance_v1"
node _poc/erp_gateway_smoke/erp_smoke_select_min.js
```

## Ocekivani output
`out/erp_smoke/YYYY_MM_DD/`:
- `smoke_result.csv`
- `smoke_manifest.json`

Manifest ukljucuje:
- `module_id`, `request_id`, `query_id`
- `row_count`, `duration_ms`, `status`
- kod greske kad query padne

## Napomena
Ovo je i dalje POC. Za produkciju dodati centralni vault, API authz, rate-limit middleware i strukturirani centralni logging.
