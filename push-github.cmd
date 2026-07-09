@echo off
setlocal EnableExtensions

cd /d "%~dp0"

echo.
echo === Image Tile Splitter: GitHub push web console ===
echo.

node --version >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed or not available in PATH.
  echo.
  echo Script stopped. This window will stay open; close it manually when you are done.
  cmd /k
  exit /b 1
)

echo Starting local push console...
echo Close this window to stop the local push server.
echo.

node scripts\push-web\server.mjs --open

echo.
echo Script stopped. This window will stay open; close it manually when you are done.
cmd /k
exit /b %ERRORLEVEL%
