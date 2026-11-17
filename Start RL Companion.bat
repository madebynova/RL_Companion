@echo off
setlocal
cd /d "%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-RLCompanion.ps1"
set "launcherExitCode=%errorlevel%"

echo.
echo Press any key to close this window.
pause >nul
exit /b %launcherExitCode%
