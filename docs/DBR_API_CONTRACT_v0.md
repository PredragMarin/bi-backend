# DBR API Contract v0

Draft HTTP contract for the first DBR production batch API.

Base path:

```text
/api/dbr/v1
```

All route handlers call `src/modules/dbr_v1/module_runtime.js`. Routes do not
write SQL directly.

## Response Envelope

Every response uses:

```json
{
  "ok": true,
  "data": {},
  "error": null,
  "meta": {
    "requestId": "dbr_...",
    "timestamp": "2026-05-04T00:00:00.000Z",
    "version": "v1"
  }
}
```

Failures use the same envelope with `ok=false`, `data=null`, and an error
object `{ code, message, details? }`.

## Endpoints

### POST `/api/dbr/v1/orders`

Creates a BI-side DBR production order from a supplied frozen payload. This is
not ERP import. If `gosoftDnId` is omitted, the API generates a temporary DBR
key and freezes the whole request body as `parameterSnapshot`.

This endpoint is a manual skeleton entry point:

```text
1 order -> 1 kit batch -> 12 part jobs
```

It is not the final daily production import flow. Daily import from pasted
SIFRADN/RN lists will be defined separately as:

```text
POST /api/dbr/v1/import/sifradn-list
```

That endpoint creates `N` DBR orders, `N` kit batches, and `N*12` part jobs.
A dry-run preview gate remains a likely next hardening step.

```bash
curl -sS -X POST http://localhost:3000/api/dbr/v1/orders \
  -H 'Content-Type: application/json' \
  -d '{
    "kit_code": "OPS_S4P4",
    "quantity": 1
  }'
```

### POST `/api/dbr/v1/import/sifradn-list`

Bulk import endpoint for daily DBR lifecycle. In real mode it accepts pasted
free-text RN/SIFRADN values from the production manager, fetches each token
through the ERP allowlist query `V_DN_BY_SIFRADN`, freezes the ERP/config
snapshot, and then expands DBR jobs. The target shape is:

```text
20 SIFRADN records -> 20 frozen DBR orders -> 20 kit batches -> 240 queued part jobs
```

Stub smoke:

```bash
curl -sS -X POST http://localhost:3100/api/dbr/v1/import/sifradn-list \
  -H 'Content-Type: application/json' \
  -d '{
    "use_stub": true
  }'
```

Expected high-level response:

```json
{
  "ok": true,
  "data": {
    "importMode": "stub",
    "imported": 20,
    "totalJobs": 240
  }
}
```

Real payload shape:

```json
{
  "sifradn_paste": "RN\n12345\n12346\n12347"
}
```

Aliases `rn_paste` and `paste` are accepted. Users never supply DNID. The
current DB schema requires numeric `gosoft_dn_id`, so real imports use only the
DNID returned by the ERP row. If ERP does not return a valid DNID, the endpoint
fails with `ok:false`; it does not invent a production DNID. Synthetic IDs are
allowed only in `use_stub` smoke/dev mode and are marked in the frozen snapshot
with `syntheticGosoftDnId:true`.

### POST `/api/dbr/v1/orders/:orderId/batches`

Atomically creates one kit batch and expanded part jobs for the requested
product/profile. For `PPV/OPS_S4P4`, this creates 12 part jobs.

```bash
curl -sS -X POST http://localhost:3000/api/dbr/v1/orders/1/batches \
  -H 'Content-Type: application/json' \
  -d '{
    "productCode": "PPV",
    "technologyProfile": "OPS_S4P4",
    "parameterSnapshot": {
      "productCode": "PPV",
      "technologyProfile": "OPS_S4P4",
      "parameters": {}
    }
  }'
```

### GET `/api/dbr/v1/batches/:batchId/report`

Returns a read-only batch report and all part jobs.

```bash
curl -sS http://localhost:3000/api/dbr/v1/batches/1/report
```

### POST `/api/dbr/v1/batches/:batchId/run`

Execution boundary. In v0 this returns `status=not_implemented` and does not run
resolver internals.

```bash
curl -sS -X POST http://localhost:3000/api/dbr/v1/batches/1/run
```

### GET `/api/dbr/v1/jobs/:jobId`

Returns one part job.

```bash
curl -sS http://localhost:3000/api/dbr/v1/jobs/1
```

### POST `/api/dbr/v1/artifacts`

Registers an approved Mother DXF artifact in `dcm.mother_artifact_registry`.

```bash
curl -sS -X POST http://localhost:3000/api/dbr/v1/artifacts \
  -H 'Content-Type: application/json' \
  -d '{
    "productCode": "PPV",
    "partCode": "KSKR",
    "technologyProfile": "OPS_S4P4",
    "motherSessionId": "example-session-id",
    "artifactPath": "out/mother_dxf/example/KSKR.dxf",
    "artifactHash": "sha256:example",
    "approvalStatus": "approved",
    "approvedBy": "smoke"
  }'
```

## Boundary Impact

- API layer exposes stable `/api/dbr/v1/*` routes.
- Module layer owns DBR lifecycle orchestration through `module_runtime.js`.
- Core Shell DB services own SQL and PostgreSQL persistence.
- Bulk SIFRADN import validates and maps records in the DBR module, then writes
  orders, batches, and part jobs through one Core Shell DB transaction.
- Resolver internals, ERP import, and Mother DXF file-based session storage are
  not changed.
- `dxf_ops_host_v1` and the older Zoran/DXF OPS flow are references only, not
  long-term DBR dependencies.
- Configurator parameter keys in snapshots should remain canonical long-form
  keys such as `MODEL_VRATA`, `TIP_VRATA` (legacy alias), `KONF_ID`, `VISINA_VRATA`, `VISINA_EFF`, and `SIRINA_VRATA`; abbreviation aliases require
  a later catalog policy/migration.

## Rollback

Remove:

- `src/api/routes/dbr_v1.js`
- the DBR route registration in `src/api/server.js`
- `src/modules/dbr_v1/contracts/dbr_api_contract_v0.json`
- `src/modules/dbr_v1/contracts/dbr_sifradn_import_contract_v0.json`
- this document

Then remove DBR runtime/service helper functions added only for this contract if
the API contract is being fully backed out.
