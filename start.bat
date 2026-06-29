@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul

echo.
echo Starting Generic 3D Coordinate Collector ...
echo.

REM Detect a working Python; skip Microsoft Store py.exe stubs via --version test
set "PY_CMD="
for %%C in (python py python3) do (
  if not defined PY_CMD (
    %%C --version >nul 2>nul
    if not errorlevel 1 (
      set "PY_CMD=%%C"
    )
  )
)

if not defined PY_CMD (
  echo.
  echo [ERROR] No usable Python found.
  echo Please install Python 3.8+ from https://www.python.org/downloads/
  echo Remember to check "Add Python to PATH" during installation.
  echo Or use the packaged exe version ^(no Python required^).
  echo.
  pause
  exit /b 1
)

echo Using Python: %PY_CMD%
echo.
"%PY_CMD%" scripts\start.py %*

endlocal
