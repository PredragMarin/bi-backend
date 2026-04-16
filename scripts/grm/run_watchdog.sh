#!/usr/bin/env bash
set -euo pipefail

cd /home/marin/app

source /opt/sqlanywhere17/bin64/sa_config.sh >/dev/null 2>&1
export ODBCSYSINI=/etc
export ODBCINI=/etc/odbc.ini
export ODBCINSTINI=odbcinst.ini
export LD_LIBRARY_PATH=/usr/lib/x86_64-linux-gnu:/lib/x86_64-linux-gnu:/opt/sqlanywhere17/lib64:/opt/sqlanywhere17/lib32
export ERP_SECRET_FILE=/home/marin/.secrets/bi-backend/erp_secret.json
export GRM_POLL_INTERVAL_MS="${GRM_POLL_INTERVAL_MS:-5000}"

exec node scripts/grm/watchdog.js
