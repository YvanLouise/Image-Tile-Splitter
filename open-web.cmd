@echo off
setlocal

cd /d "%~dp0"
set PORT=4173
set URL=http://127.0.0.1:%PORT%/

if not exist node_modules (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo.
    echo Dependency installation failed.
    pause
    exit /b 1
  )
)

echo Building app...
call npm run build
if errorlevel 1 (
  echo.
  echo Build failed.
  pause
  exit /b 1
)

echo Starting local server on %URL%
start "slice-server" /min cmd /k "cd /d "%~dp0" && node scripts\serve-dist.mjs --port %PORT%"

timeout /t 1 /nobreak >nul
start "" "%URL%"

echo.
echo Opened %URL%
echo Close the minimized slice-server window when you are done.
endlocal
