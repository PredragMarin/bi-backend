@echo off
setlocal

REM Optional overrides:
REM set HB_PORT=8080
REM set HB_ALLOWED_SENDER=192.168.100.18
REM set HB_AUTH_TOKEN=change_me

node "%~dp0heartbeat_remote_server.js"

endlocal
