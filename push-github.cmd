@echo off
setlocal EnableExtensions

cd /d "%~dp0"

set "CONSOLE_LAUNCHER=%~dp0GitHub推送控制台\一键打开GitHub推送控制台.cmd"

if not exist "%CONSOLE_LAUNCHER%" (
  echo [ERROR] GitHub Push Console launcher was not found:
  echo %CONSOLE_LAUNCHER%
  pause
  exit /b 1
)

call "%CONSOLE_LAUNCHER%" %*
exit /b %ERRORLEVEL%
