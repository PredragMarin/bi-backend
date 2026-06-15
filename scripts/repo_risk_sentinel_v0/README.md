# Repo Risk Sentinel v0

Mali, zatvoreni on-demand health/risk checker za ovaj repo.

## Scope v0

Sentinel prati samo nekoliko rizičnih zona:

- `src/core_shell`
- `src/modules/mother_dxf_v1`
- `src/modules/dbr_v1`
- `src/modules/gosoft_request_module_v1`
- ključne DXF/DBR/GRM contract dokumente

## Što provjerava

- JS syntax u promatranim zonama
- JSON contract parse za nekoliko ključnih contract fileova
- veliki / gusti fileovi po području
- line-count drift po području u odnosu na prethodni run
- DXF payload canonical key drift za:
  - `KONF_ID`
  - `MODEL_VRATA`
  - `TIP_VRATA`
  - `VISINA_VRATA`
  - `SKRACENJE`
  - `VISINA_EFF`

## Pokretanje

```bash
node scripts/repo_risk_sentinel_v0/run.js
```

## Reporti

Upisuje u:

- `out/repo_health/repo_risk_sentinel_v0/latest.json`
- `out/repo_health/repo_risk_sentinel_v0/latest.txt`
- timestamped history snapshotove u istom folderu

## Namjena

Ovo nije auto-fix alat.

Ovo je mali risk sentinel koji hvata:

- critical syntax/contract lomove
- volume drift
- signal da neki modul buja ili da contract ključevi driftaju

Tek nakon severity summaryja ide ljudska procjena i eventualna pomoć.
