# Heartbeat Monitoring - Control Side (192.168.100.18)

Lokacija:
- `_poc/heartbeat_monitoring/control`

## Sadrzaj
- `heartbeat_collector.js` - aktivni collector (interval heartbeat, NDJSON log, state)
- `timeline_generator.js` - generira OK/NOK timeline s hysteresis pravilima
- `aggregate_kpi.js` - racuna KPI metrike iz raw NDJSON
- `config/settings.json` - konfiguracija endpointa i pragova
- `state/run_state.json` - runtime state (`seq_no`, `test_run_id`)

## Pokretanje collectora
```powershell
cd _poc/heartbeat_monitoring/control
node heartbeat_collector.js
```
ili `start_heartbeat_collector.cmd`

## Pokretanje timeline/KPI
```powershell
node timeline_generator.js logs/raw/heartbeat_YYYY_MM_DD.ndjson
node aggregate_kpi.js logs/raw/heartbeat_YYYY_MM_DD.ndjson
```

## Napomena
- Raw log: `logs/raw/heartbeat_YYYY_MM_DD.ndjson`
- Timeline: `logs/timeline/*_timeline.ndjson`
- KPI: `logs/aggregate/*_kpi.json`
