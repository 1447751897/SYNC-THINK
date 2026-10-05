@echo off
setlocal EnableExtensions DisableDelayedExpansion
rem This wrapper only changes the installer process environment. It does not
rem change user/system TEMP, request a silent install, or stop application jobs.
set "INSTALLER="
set "INSTALLER_COUNT=0"
for %%F in ("%~dp0SYNC-THINK-Setup-*-x64.exe") do if exist "%%~fF" (
  set /a INSTALLER_COUNT+=1 >nul
  set "INSTALLER=%%~fF"
)
if not "%INSTALLER_COUNT%"=="1" (
  echo Keep exactly one SYNC-THINK-Setup-*-x64.exe beside this launcher.
  pause
  exit /b 2
)
set "TEMP=%~dp0.installer-temp"
set "TMP=%TEMP%"
if not exist "%TEMP%\." mkdir "%TEMP%" >nul 2>&1
if not exist "%TEMP%\." (
  echo Could not create "%TEMP%". Move this folder to a writable drive.
  pause
  exit /b 3
)
echo Starting the interactive installer with temporary files in:
echo "%TEMP%"
start "" /wait "%INSTALLER%"
set "INSTALLER_EXIT=%ERRORLEVEL%"
if not "%INSTALLER_EXIT%"=="0" (
  echo Installer exited with code %INSTALLER_EXIT%.
  pause
)
exit /b %INSTALLER_EXIT%