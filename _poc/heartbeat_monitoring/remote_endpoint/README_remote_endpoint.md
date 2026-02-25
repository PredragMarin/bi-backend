# Remote Heartbeat Endpoint (POC)

Lokacija:
- `_poc/heartbeat_monitoring/remote_endpoint/heartbeat_remote_server.js`

Pokretanje na 192.168.100.93:
1. Kopiraj folder `remote_endpoint` na remote host.
2. U CMD/PowerShell:
   - `cd remote_endpoint`
   - `node heartbeat_remote_server.js`
3. Ili dvoklik: `start_heartbeat_remote.cmd`

Default:
- host: `0.0.0.0`
- port: `8080`
- endpoint: `GET/POST /heartbeat`
- health: `GET /healthz`
- allowlist sender: `192.168.100.18`

Opcionalni env varijable:
- `HB_HOST`
- `HB_PORT`
- `HB_ALLOWED_SENDER`
- `HB_AUTH_TOKEN`
- `HB_HOST_ID`
- `HB_ENDPOINT_VERSION`

Brzi test s Control hosta (192.168.100.18):
```powershell
Invoke-RestMethod -Uri "http://192.168.100.93:8080/heartbeat" -Method Post -ContentType "application/json" -Body '{"request_id":"11111111-1111-1111-1111-111111111111","seq_no":1,"sender_ip":"192.168.100.18","sent_ts":"2026-02-25T00:00:00.000Z","timeout_ms":1500,"interval_ms":5000}'
```
