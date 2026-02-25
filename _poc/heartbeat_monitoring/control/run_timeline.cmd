@echo off
setlocal
cd /d "%~dp0"
if "%~1"=="" (
  echo Usage: run_timeline.cmd logs\raw\heartbeat_YYYY_MM_DD.ndjson
  exit /b 1
)
node timeline_generator.js "%~1"
endlocal
