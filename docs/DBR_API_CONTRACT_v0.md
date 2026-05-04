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

```bash
curl -sS -X POST http://localhost:3000/api/dbr/v1/orders \
  -H 'Content-Type: application/json' \
  -d '{
    "kit_code": "OPS_S4P4",
    "quantity": 1
  }'
```

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
- Resolver internals, ERP import, and Mother DXF file-based session storage are
  not changed.

## Rollback

Remove:

- `src/api/routes/dbr_v1.js`
- the DBR route registration in `src/api/server.js`
- `src/modules/dbr_v1/contracts/dbr_api_contract_v0.json`
- this document

Then remove DBR runtime/service helper functions added only for this contract if
the API contract is being fully backed out.
