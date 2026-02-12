@echo off
setlocal

REM --- Instance config ---
set BI_DEFAULT_VIEW_GROUP=ADM
set BI_CAN_PUBLISH_FINAL=1

REM --- Auto shutdown after 10 min idle ---
set IDLE_SHUTDOWN_MINUTES=10

REM --- Start server ---
cd /d "C:\Users\Marin\bi-backend"
node src\api\server.js

echo.
echo --- Server exited (see error above) ---
pause
