@echo off
setlocal
title Saathi
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto :install_node
for /f "tokens=1 delims=." %%v in ('node -v') do set NODE_MAJOR=%%v
set NODE_MAJOR=%NODE_MAJOR:v=%
if %NODE_MAJOR% LSS 20 goto :install_node

if not exist "node_modules\.package-lock.json" (
  echo.
  echo  Getting Saathi ready. This happens once and takes about a minute...
  echo.
  call npm ci --no-audit --no-fund
  if errorlevel 1 goto :failed
)

if not exist ".env" (
  echo.
  echo  First time here: a few quick questions. Press Enter to skip any of them.
  call npm run setup
)

echo.
echo  Starting Saathi. Your browser will open by itself.
echo  Keep this window open while you use Saathi. Close it to stop.
echo.
set SAATHI_OPEN_BROWSER=1
call npm start
goto :eof

:install_node
echo.
echo  Saathi needs Node.js 20 or newer. Installing it now...
echo.
winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
if errorlevel 1 (
  echo.
  echo  Could not install Node.js automatically.
  echo  Please install the LTS version from https://nodejs.org and then double-click "Start Saathi" again.
  start "" https://nodejs.org
  pause
  goto :eof
)
echo.
echo  Node.js is installed. Close this window and double-click "Start Saathi" again.
pause
goto :eof

:failed
echo.
echo  Something went wrong while getting Saathi ready. Check your internet connection and try again.
pause
