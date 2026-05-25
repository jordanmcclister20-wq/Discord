@echo off
setlocal enabledelayedexpansion
title Discord Overlay — Build

echo.
echo  ========================================
echo    Discord Overlay ^— Build ^& Package
echo  ========================================
echo.

:: ── 1. Dependencies ───────────────────────────────────────────────────────────
echo [1/3] Installing npm dependencies...
call npm install --prefer-offline
if !errorlevel! neq 0 ( echo ERROR: npm install failed & pause & exit /b 1 )

:: ── 2. Electron-builder ───────────────────────────────────────────────────────
echo.
echo [2/3] Building Electron app...
call npm run dist
if !errorlevel! neq 0 ( echo ERROR: electron-builder failed & pause & exit /b 1 )

:: ── 3. Inno Setup 6 ───────────────────────────────────────────────────────────
echo.
echo [3/3] Compiling Inno Setup installer...

:: Search registry first (most reliable regardless of install drive/path)
set "ISCC="
for /f "tokens=2*" %%A in (
  'reg query "HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Inno Setup 6_is1" /v "InstallLocation" 2^>nul'
) do set "ISCC=%%B\ISCC.exe"

:: Fallback: common filesystem locations (%%~P strips quotes so path is clean)
if not defined ISCC (
  for %%P in (
    "%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe"
    "%ProgramFiles%\Inno Setup 6\ISCC.exe"
    "C:\InnoSetup6\ISCC.exe"
    "C:\Tools\InnoSetup6\ISCC.exe"
  ) do (
    if not defined ISCC (
      if exist %%P set "ISCC=%%~P"
    )
  )
)

if not defined ISCC (
  echo.
  echo ERROR: Inno Setup 6 not found.
  echo Download from https://jrsoftware.org/isdl.php then re-run build.bat.
  pause & exit /b 1
)

echo Found Inno Setup at: !ISCC!
"!ISCC!" installer.iss
if !errorlevel! neq 0 ( echo ERROR: Inno Setup compilation failed & pause & exit /b 1 )

echo.
echo  ========================================
echo    Done!  Installer ^→ dist\installer\
echo  ========================================
echo.
start "" "dist\installer"
pause
