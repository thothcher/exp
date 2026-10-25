@echo off
rem Double-click to start Folio and open it in your browser.
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies for the first time...
  call npm install
)
start "" http://localhost:3100
node server/index.js
pause
