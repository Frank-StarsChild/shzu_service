@echo off
title SHZU Agent - Quick Start

REM ============================================================
REM  SHZU Service Agent ("ShiDa ZhiDuoXing") quick launcher
REM  Step 1: start backend  FastAPI  (port 8300, wait ready)
REM  Step 2: start frontend Vite dev (port 5180)
REM  Step 3: open browser automatically
REM  Stop:   close the two console windows created below
REM ============================================================

setlocal
set "ROOT=E:\Project\OralVision\teleagent\shzu-service-agent"
set "PY=%ROOT%\.venv\Scripts\python.exe"
set "BACK_PORT=8300"
set "BACK_URL=http://127.0.0.1:8300"
set "DEV_PORT=5180"
set "DEV_URL=http://127.0.0.1:5180"
set "NODE_DIR=C:\Users\31978\.local\share\TeleAgent\runtimes\node"

cd /d "%ROOT%"

echo.
echo   ==============================================
echo     SHZU Agent - Campus Service Assistant
echo     Backend : %BACK_URL%
echo     Frontend: %DEV_URL%
echo   ==============================================
echo.

if not exist "%PY%" goto NO_VENV

REM ---------- 1. backend ----------
netstat -ano | findstr ":%BACK_PORT% " | findstr "LISTENING" >nul 2>&1
if errorlevel 1 goto START_BACK
echo   [!] Port %BACK_PORT% is already in use - backend may be running, reuse it.
goto WAIT_BACK

:START_BACK
echo   [1/3] Starting backend FastAPI on port %BACK_PORT% ...
start "SHZU Backend 8300" /D "%ROOT%" cmd /k %PY% -m uvicorn backend.app.main:app --host 127.0.0.1 --port %BACK_PORT%

:WAIT_BACK
set /a TRIES=0
:WAIT_BACK_LOOP
set /a TRIES+=1
if %TRIES% GTR 30 goto BACK_FAIL
powershell -NoProfile -Command "try{Invoke-WebRequest -Uri '%BACK_URL%/api/v1/health/live' -UseBasicParsing -TimeoutSec 2|Out-Null;exit 0}catch{exit 1}" >nul 2>&1
if errorlevel 1 goto BACK_RETRY
echo         Backend is ready.
goto FRONTEND

:BACK_RETRY
ping -n 2 127.0.0.1 >nul
goto WAIT_BACK_LOOP

:BACK_FAIL
echo   [X] Backend not ready after 30 tries. Check the "SHZU Backend 8300" window for errors.
echo       Common fix - recreate the virtual environment:
echo         cd /d %ROOT%
echo         python -m venv .venv
echo         .venv\Scripts\python.exe -m pip install -r backend\requirements.txt
pause
exit /b 1

REM ---------- 2. frontend ----------
:FRONTEND
where npm >nul 2>&1
if not errorlevel 1 goto NPM_OK
if exist "%NODE_DIR%\npm.cmd" set "PATH=%NODE_DIR%;%PATH%"
where npm >nul 2>&1
if not errorlevel 1 goto NPM_OK
echo   [!] npm/node not found - skip frontend dev server. Opening backend page instead
echo       (backend already serves the built frontend UI).
start "" "%BACK_URL%"
goto DONE

:NPM_OK
if exist "%ROOT%\frontend\node_modules" goto START_FRONT
echo   [!] Frontend dependencies missing - frontend\node_modules not found.
echo       To enable dev mode, run:  cd frontend ^&^& npm install
echo       Opening backend page instead.
start "" "%BACK_URL%"
goto DONE

:START_FRONT
echo   [2/3] Starting frontend Vite dev server on port %DEV_PORT% (API proxied to %BACK_PORT%) ...
start "SHZU Frontend 5180" /D "%ROOT%\frontend" cmd /k npm run dev

set /a FTRIES=0
:WAIT_FRONT_LOOP
set /a FTRIES+=1
if %FTRIES% GTR 30 goto FRONT_FAIL
powershell -NoProfile -Command "try{Invoke-WebRequest -Uri '%DEV_URL%' -UseBasicParsing -TimeoutSec 2|Out-Null;exit 0}catch{exit 1}" >nul 2>&1
if errorlevel 1 goto FRONT_RETRY
echo         Frontend is ready.
echo   [3/3] Opening browser: %DEV_URL%
start "" "%DEV_URL%"
goto DONE

:FRONT_RETRY
ping -n 2 127.0.0.1 >nul
goto WAIT_FRONT_LOOP

:FRONT_FAIL
echo   [!] Frontend not ready after 30 tries. Check the "SHZU Frontend 5180" window.
echo       If port %DEV_PORT% is taken by another app, change the port in frontend\vite.config.ts.
echo       Falling back to the backend page.
start "" "%BACK_URL%"
goto DONE

:NO_VENV
echo   [X] Python venv not found: %PY%
echo       Run these commands in the project folder first:
echo         python -m venv .venv
echo         .venv\Scripts\python.exe -m pip install -r backend\requirements.txt
pause
exit /b 1

:DONE
echo.
echo   Started successfully.
echo     Dev / daily use : %DEV_URL%   (hot reload for frontend code)
echo     Stable / demo   : %BACK_URL%  (built UI, frontend window not required)
echo   To stop: close the "SHZU Backend 8300" and "SHZU Frontend 5180" windows.
echo.
pause
