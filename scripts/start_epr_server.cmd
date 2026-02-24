@echo off
setlocal

REM --- Instance config ---
set BI_DEFAULT_VIEW_GROUP=ADM
set BI_CAN_PUBLISH_FINAL=1

REM --- Disable idle shutdown (server stays up) ---
set IDLE_SHUTDOWN_MINUTES=0

REM --- Start server ---
cd /d "C:\Users\Marin\bi-backend"
set ERP_DSN=ERP_POC_RO
set ERP_SECRET_FILE=C:\Users\Marin\.secrets\erp_secret.json
node src\api\server.js

echo.
echo --- Server exited (see error above) ---
pause










