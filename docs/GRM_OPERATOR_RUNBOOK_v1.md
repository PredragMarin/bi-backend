# GRM_OPERATOR_RUNBOOK_v1.md

## Purpose

This short runbook explains how to operate the `GRM` watchdog in the current POC phase.

## Process name

- `grm-watchdog`

## Main paths

Linux / server:
- request inbox:
  - `/mnt/nas/004_Konstrukcija/010_BI_File_Drop/REQUEST`
- Aldo responses:
  - `/mnt/nas/004_Konstrukcija/010_BI_File_Drop/ALDO_POC/responses`

Windows / user view:
- request inbox:
  - `Z:\004_Konstrukcija\010_BI_File_Drop\REQUEST`
- Aldo responses:
  - `Z:\004_Konstrukcija\010_BI_File_Drop\ALDO_POC\responses`

## Start manually

```bash
cd /home/marin/app
chmod +x scripts/grm/run_watchdog.sh
./scripts/grm/run_watchdog.sh
```

## Start with PM2

```bash
cd /home/marin/app
chmod +x scripts/grm/run_watchdog.sh
pm2 start scripts/grm/run_watchdog.sh --name grm-watchdog
pm2 save
```

## Basic PM2 operations

```bash
pm2 list
pm2 logs grm-watchdog --lines 100
pm2 restart grm-watchdog
pm2 stop grm-watchdog
pm2 delete grm-watchdog
pm2 save
```

## Polling model

- watchdog checks `REQUEST` every `5` seconds
- downstream modules may poll every `5` seconds
- expected normal response time for `date_window` requests:
  - `15` to `60` seconds

## Response readiness rule

Treat response package as ready only when:
- response directory for the correct `request_id` exists
- and `manifest.json` exists

`manifest.json` is the completion signal.

## Response file write order

`GRM` writes:

1. `v_dn.csv`
2. `potreba.csv`
3. `manifest.json`

## Current wrapper

Runtime wrapper script:
- `/home/marin/app/scripts/grm/run_watchdog.sh`

Watchdog node script:
- `/home/marin/app/scripts/grm/watchdog.js`
