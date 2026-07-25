@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

if not defined AIARB_LOG_LEVEL set "AIARB_LOG_LEVEL=debug"
set "AIARB_DESKTOP_DEBUG=1"
set "RUST_BACKTRACE=1"
if not defined WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS set "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222"

set "AIARB_DEBUG_DIR=%AIARB_WORKING_DIR%"
if not defined AIARB_DEBUG_DIR if defined COPAW_WORKING_DIR set "AIARB_DEBUG_DIR=%COPAW_WORKING_DIR%"
if not defined AIARB_DEBUG_DIR if exist "%USERPROFILE%\.copaw" set "AIARB_DEBUG_DIR=%USERPROFILE%\.copaw"
if not defined AIARB_DEBUG_DIR set "AIARB_DEBUG_DIR=%USERPROFILE%\.aiarb"
set "AIARB_BACKEND_LOGS=%AIARB_DEBUG_DIR%\desktop.log;%AIARB_DEBUG_DIR%\aiarb.log"
set "AIARB_SHELL_LOGS=%LOCALAPPDATA%\io.aiarb.desktop\logs\aiarb-desktop.log;%LOCALAPPDATA%\com.aiarb.desktop\logs\aiarb-desktop.log"

echo ====================================
echo AIArb Desktop - Debug Mode
echo ====================================
echo Log level: %AIARB_LOG_LEVEL%
echo Working directory: %AIARB_DEBUG_DIR%
echo Press Ctrl+C to stop watching logs.
echo.

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0aiarb-desktop-debug.ps1"
