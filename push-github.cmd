@echo off
setlocal

cd /d "%~dp0"

set REMOTE_URL=https://github.com/YvanLouise/Image-Tile-Splitter.git
set BRANCH=main
set DEFAULT_MESSAGE=Update image tile splitter app

if "%~1"=="" (
  set COMMIT_MESSAGE=%DEFAULT_MESSAGE%
) else (
  set COMMIT_MESSAGE=%~1
)

echo.
echo === Image Tile Splitter: one-click GitHub push ===
echo Repository: %REMOTE_URL%
echo Branch: %BRANCH%
echo.

git --version >nul 2>nul
if errorlevel 1 (
  echo Git is not installed or not available in PATH.
  pause
  exit /b 1
)

if not exist ".git" (
  echo Initializing git repository...
  git init
  if errorlevel 1 goto :fail
)

git branch -M %BRANCH%
if errorlevel 1 goto :fail

git remote get-url origin >nul 2>nul
if errorlevel 1 (
  echo Adding origin remote...
  git remote add origin %REMOTE_URL%
  if errorlevel 1 goto :fail
) else (
  for /f "delims=" %%u in ('git remote get-url origin') do set CURRENT_REMOTE=%%u
  if not "%CURRENT_REMOTE%"=="%REMOTE_URL%" (
    echo Updating origin remote...
    git remote set-url origin %REMOTE_URL%
    if errorlevel 1 goto :fail
  )
)

if not exist node_modules (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 goto :fail
)

echo Running build check...
call npm run build
if errorlevel 1 goto :fail

echo Staging files...
git add .
if errorlevel 1 goto :fail

git diff --cached --quiet
if errorlevel 1 (
  echo Creating commit: "%COMMIT_MESSAGE%"
  git commit -m "%COMMIT_MESSAGE%"
  if errorlevel 1 goto :fail
) else (
  echo No local file changes to commit.
)

echo Pushing to GitHub...
git push -u origin %BRANCH%
if errorlevel 1 (
  echo.
  echo Push failed. If this is an authentication issue, sign in through Git Credential Manager
  echo or use a GitHub Personal Access Token, then run this script again.
  pause
  exit /b 1
)

echo.
echo Push complete.
echo GitHub Pages will deploy from Actions after the push finishes.
echo https://yvanlouise.github.io/Image-Tile-Splitter/
pause
exit /b 0

:fail
echo.
echo Script stopped because the previous command failed.
pause
exit /b 1
