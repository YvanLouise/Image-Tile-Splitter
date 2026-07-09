@echo off
setlocal EnableExtensions EnableDelayedExpansion

cd /d "%~dp0"

set "DEFAULT_BRANCH=main"
set "DEFAULT_MESSAGE=Update image tile splitter app"

if "%~1"=="" (
  set "COMMIT_MESSAGE=%DEFAULT_MESSAGE%"
) else (
  set "COMMIT_MESSAGE=%~1"
)

echo.
echo === Image Tile Splitter: GitHub release push ===
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

for /f "delims=" %%b in ('git branch --show-current 2^>nul') do set "BRANCH=%%b"
if not defined BRANCH set "BRANCH=%DEFAULT_BRANCH%"

git checkout "%BRANCH%" >nul 2>nul
if errorlevel 1 (
  git checkout -B "%BRANCH%"
  if errorlevel 1 goto :fail
)

git remote get-url origin >nul 2>nul
if errorlevel 1 (
  echo No git remote named origin is configured.
  echo.
  echo Set your own GitHub repository first, for example:
  echo git remote add origin https://github.com/YOUR_NAME/YOUR_REPO.git
  echo.
  pause
  exit /b 1
)

for /f "delims=" %%u in ('git remote get-url origin') do set "CURRENT_REMOTE=%%u"
echo Repository: %CURRENT_REMOTE%
echo Branch: %BRANCH%
echo Commit message: %COMMIT_MESSAGE%
echo.

if not exist node_modules (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 goto :fail
)

echo Running tests...
call npm test -- --run --cache=false
if errorlevel 1 goto :fail

echo Running build check...
call npm run build
if errorlevel 1 goto :fail

echo.
echo Files that will be uploaded:
git status --short
if errorlevel 1 goto :fail

git diff --quiet
set "HAS_WORKTREE_CHANGES=%ERRORLEVEL%"
git diff --cached --quiet
set "HAS_STAGED_CHANGES=%ERRORLEVEL%"
set "HAS_UNTRACKED_CHANGES=0"
for /f "delims=" %%f in ('git ls-files --others --exclude-standard') do set "HAS_UNTRACKED_CHANGES=1"

if "%HAS_WORKTREE_CHANGES%"=="0" if "%HAS_STAGED_CHANGES%"=="0" if "%HAS_UNTRACKED_CHANGES%"=="0" (
  echo.
  echo No local file changes to commit.
) else (
  echo.
  set /p "CONFIRM=Stage all listed files and commit them? [y/N] "
  if /i not "!CONFIRM!"=="y" (
    echo Push canceled before staging files.
    pause
    exit /b 1
  )

  echo Staging files...
  git add --all -- .
  if errorlevel 1 goto :fail

  git diff --cached --quiet
  if errorlevel 1 (
    echo Creating commit: "%COMMIT_MESSAGE%"
    git commit -m "%COMMIT_MESSAGE%"
    if errorlevel 1 goto :fail
  ) else (
    echo No staged file changes to commit.
  )
)

echo.
echo Checking remote branch state...
git fetch origin "%BRANCH%" >nul 2>nul
if not errorlevel 1 (
  for /f "tokens=1,2" %%a in ('git rev-list --left-right --count "origin/%BRANCH%...HEAD"') do (
    set "REMOTE_ONLY=%%a"
    set "LOCAL_ONLY=%%b"
  )
  if defined REMOTE_ONLY if not "!REMOTE_ONLY!"=="0" (
    echo Remote branch has !REMOTE_ONLY! commit(s) not present locally.
    echo Run git pull --rebase origin %BRANCH% first, resolve conflicts, then rerun this script.
    pause
    exit /b 1
  )
) else (
  echo Remote branch origin/%BRANCH% does not exist yet; it will be created.
)

echo Pushing to GitHub...
git push -u origin "%BRANCH%"
if errorlevel 1 (
  echo.
  echo Push failed. If this is an authentication issue, sign in through Git Credential Manager
  echo or use a GitHub Personal Access Token, then run this script again.
  pause
  exit /b 1
)

echo.
echo Push complete.
echo GitHub Pages will deploy from Actions if this repository has Pages Actions configured.
pause
exit /b 0

:fail
echo.
echo Script stopped because the previous command failed.
pause
exit /b 1
