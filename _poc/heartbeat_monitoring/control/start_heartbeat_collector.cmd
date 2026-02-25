@echo off
setlocal
cd /d "%~dp0"
node heartbeat_collector.js
endlocal
