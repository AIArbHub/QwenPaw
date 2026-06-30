@echo off
setlocal EnableDelayedExpansion

REM AI Arb Installer for Windows (cmd.exe / batch)
REM Usage: install.bat [-Version X.Y.Z] [-FromSource] [-SourceDir DIR]
REM                         [-Extras "dev,whisper"] [-UvPath PATH] [-Help]
REM
REM Installs AI Arb into %USERPROFILE%\.aiarb with a uv-managed Python environment.
REM Users do NOT need Python pre-installed -- uv handles everything.
REM
REM uv is obtained automatically (no action required from the user):
REM   1. Found on PATH or in common locations
REM   2. Downloaded via https://astral.sh/uv/install.ps1
REM   3. Downloaded via GitHub Releases if astral.sh is unreachable (e.g. in China)

REM ── Defaults ──────────────────────────────────────────────────────────────────
if defined AIARB_HOME (
    set "AIARB_HOME=%AIARB_HOME%"
) else if defined QWENPAW_HOME (
    set "AIARB_HOME=%QWENPAW_HOME%"
) else (
    set "AIARB_HOME=%USERPROFILE%\.aiarb"
)
set "AIARB_VENV=%AIARB_HOME%\venv"
set "AIARB_BIN=%AIARB_HOME%\bin"
set "PYTHON_VERSION=3.12"
set "AIARB_REPO=https://github.com/agentscope-ai/QwenPaw.git"

REM ──── Argument defaults ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
set "ARG_VERSION="
set "ARG_FROM_SOURCE=0"
set "ARG_SOURCE_DIR="
set "ARG_EXTRAS="
set "ARG_UV_PATH="
set "ARG_PRERELEASE=0"
set "CONSOLE_COPIED=0"
set "CONSOLE_AVAILABLE=0"

REM ──── Parse arguments ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
:parse_args
if "%~1"=="" goto :done_args
if /i "%~1"=="-Version"    goto :arg_version
if /i "%~1"=="-FromSource" goto :arg_fromsource
if /i "%~1"=="-SourceDir"  goto :arg_sourcedir
if /i "%~1"=="-Extras"     goto :arg_extras
if /i "%~1"=="-Prerelease" goto :arg_prerelease
if /i "%~1"=="-UvPath"     goto :arg_uvpath
if /i "%~1"=="-Help"       goto :show_help
shift
goto :parse_args

:arg_version
set "ARG_VERSION=%~2"
shift & shift
goto :parse_args

:arg_fromsource
set "ARG_FROM_SOURCE=1"
shift
goto :parse_args

:arg_sourcedir
set "ARG_SOURCE_DIR=%~2"
shift & shift
goto :parse_args

:arg_extras
set "ARG_EXTRAS=%~2"
shift & shift
goto :parse_args

:arg_prerelease
set "ARG_PRERELEASE=1"
shift
goto :parse_args

:arg_uvpath
set "ARG_UV_PATH=%~2"
shift & shift
goto :parse_args

:done_args
goto :main

REM ──── Help ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
:show_help
echo AI Arb Installer for Windows
echo.
echo Usage: install.bat [OPTIONS]
echo.
echo Options:
echo   -Version ^<VER^>        Install a specific version (e.g. 0.0.2)
echo   -FromSource           Install from source (requires git, or use -SourceDir)
echo   -SourceDir ^<DIR^>      Local source directory (used with -FromSource)
echo   -Extras ^<EXTRAS^>      Comma-separated optional extras to install
echo                          (e.g. dev, whisper)
echo   -Prerelease           Install the latest PyPI release, including pre-releases
echo   -UvPath ^<PATH^>        Path to a pre-installed uv.exe (skips all auto-install)
echo   -Help                 Show this help
echo.
echo Environment:
echo   AIARB_HOME              Installation directory (default: %%USERPROFILE%%\.aiarb)
echo   QWENPAW_HOME            (legacy) Alias for AIARB_HOME
exit /b 0

REM ──── Helper functions ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
:write_info
echo [ai-arb] %~1
exit /b 0

:write_warn
echo [ai-arb] WARNING: %~1
exit /b 0

:write_err
echo [ai-arb] ERROR: %~1
exit /b 0

:stop_with_error
echo [ai-arb] ERROR: %~1
exit /b 1

REM ──── Download uv from GitHub Releases ────────────────────────────────────────────────────────────────────────────────────
REM Subroutine: called when astral.sh is unreachable (e.g. in China).
REM On success: uv.exe is in %LOCALAPPDATA%\uv and that dir is prepended to PATH.
:download_uv_github
if /i "%PROCESSOR_ARCHITECTURE%"=="ARM64" (
    set "_DL_ARCH=aarch64"
) else (
    set "_DL_ARCH=x86_64"
)
set "_DL_URL=https://github.com/astral-sh/uv/releases/latest/download/uv-!_DL_ARCH!-pc-windows-msvc.zip"
set "_DL_DEST=%LOCALAPPDATA%\uv"
set "_DL_ZIP=%TEMP%\uv-gh-%RANDOM%.zip"

echo [ai-arb] Downloading uv ^(!_DL_ARCH!^) from GitHub Releases...

REM Try curl.exe (built into Windows 10+), then fall back to PowerShell
where curl >nul 2>&1
if not errorlevel 1 (
    curl -L --progress-bar -o "!_DL_ZIP!" "!_DL_URL!"
    if not errorlevel 1 goto :download_uv_extract
    echo [ai-arb] curl failed, retrying with PowerShell...
    del "!_DL_ZIP!" >nul 2>&1
)

powershell -NoProfile -Command "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri '!_DL_URL!' -OutFile '!_DL_ZIP!' -UseBasicParsing"
if errorlevel 1 (
    echo [ai-arb] ERROR: GitHub download also failed.
    echo [ai-arb] Download uv manually from: https://github.com/astral-sh/uv/releases/latest
    del "!_DL_ZIP!" >nul 2>&1
    exit /b 1
)

:download_uv_extract
if not exist "!_DL_DEST!" mkdir "!_DL_DEST!"
echo [ai-arb] Extracting uv...
powershell -NoProfile -Command "Expand-Archive -Force -Path '!_DL_ZIP!' -DestinationPath '!_DL_DEST!'"
set "_DL_ERR=%errorlevel%"
del "!_DL_ZIP!" >nul 2>&1
if %_DL_ERR% neq 0 (
    echo [ai-arb] ERROR: Extraction failed.
    exit /b 1
)
if not exist "!_DL_DEST!\uv.exe" (
    echo [ai-arb] ERROR: uv.exe not found after extraction.
    exit /b 1
)
set "PATH=!_DL_DEST!;!PATH!"
echo [ai-arb] uv installed: !_DL_DEST!\uv.exe
exit /b 0

REM ──── Ensure uv ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
:ensure_uv
REM 0. User-supplied path (-UvPath)
if defined ARG_UV_PATH (
    if not exist "%ARG_UV_PATH%" (
        echo [ai-arb] ERROR: Specified uv not found: %ARG_UV_PATH%
        exit /b 1
    )
    for %%I in ("%ARG_UV_PATH%") do set "PATH=%%~dpI;!PATH!"
    echo [ai-arb] uv found: %ARG_UV_PATH%
    goto :ensure_uv_done
)

REM 1. Already on PATH
where uv >nul 2>&1
if %errorlevel%==0 (
    for /f "delims=" %%p in ('where uv 2^>nul') do (
        echo [ai-arb] uv found: %%p
        goto :ensure_uv_done
    )
)

REM 2. Common install locations not yet on PATH
for %%c in ("%USERPROFILE%\.local\bin\uv.exe" "%USERPROFILE%\.cargo\bin\uv.exe" "%LOCALAPPDATA%\uv\uv.exe") do (
    if exist %%c (
        set "_UV_DIR=%%~dpc"
        set "PATH=!_UV_DIR!;!PATH!"
        echo [ai-arb] uv found: %%~c
        goto :ensure_uv_done
    )
)

REM 3. Try astral.sh (standard installer, fast outside China)
echo [ai-arb] Installing uv via astral.sh...
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://astral.sh/uv/install.ps1 -TimeoutSec 15 | iex"
if not errorlevel 1 goto :ensure_uv_refresh

REM 4. astral.sh failed -- fall back to GitHub Releases (works in China)
echo [ai-arb] astral.sh unreachable, falling back to GitHub Releases...
call :download_uv_github
if errorlevel 1 (
    echo [ai-arb] ERROR: Failed to install uv automatically.
    echo [ai-arb] Please install uv manually: https://docs.astral.sh/uv/
    exit /b 1
)
goto :ensure_uv_done

:ensure_uv_refresh
REM Refresh PATH after astral.sh install
for %%p in ("%USERPROFILE%\.local\bin" "%USERPROFILE%\.cargo\bin" "%LOCALAPPDATA%\uv") do (
    if exist %%p (
        echo "!PATH!" | findstr /i /c:"%%~p" >nul 2>&1
        if errorlevel 1 set "PATH=%%~p;!PATH!"
    )
)
where uv >nul 2>&1
if errorlevel 1 (
    echo [ai-arb] ERROR: Failed to install uv. Please install it manually: https://docs.astral.sh/uv/
    exit /b 1
)
echo [ai-arb] uv installed via astral.sh

:ensure_uv_done
exit /b 0

REM ──── Prepare console frontend ────────────────────────────────────────────────────────────────────────────────────────────────────
:prepare_console
REM %~1 = RepoDir
set "_REPO_DIR=%~1"
set "_CONSOLE_SRC=%_REPO_DIR%\console\dist"
set "_CONSOLE_DEST=%_REPO_DIR%\src\qwenpaw\console"

REM Already populated
if exist "%_CONSOLE_DEST%\index.html" (
    set "CONSOLE_AVAILABLE=1"
    exit /b 0
)

REM Copy pre-built assets if available
if exist "%_CONSOLE_SRC%\index.html" (
    echo [ai-arb] Copying console frontend assets...
    if not exist "%_CONSOLE_DEST%" mkdir "%_CONSOLE_DEST%"
    xcopy /s /e /y /q "%_CONSOLE_SRC%\*" "%_CONSOLE_DEST%\" >nul
    set "CONSOLE_COPIED=1"
    set "CONSOLE_AVAILABLE=1"
    exit /b 0
)

REM Try to build if npm is available
if not exist "%_REPO_DIR%\console\package.json" (
    echo [ai-arb] WARNING: Console source not found - the web UI won't be available.
    exit /b 0
)

where npm >nul 2>&1
if errorlevel 1 (
    echo [ai-arb] WARNING: npm not found - skipping console frontend build.
    echo [ai-arb] WARNING: Install Node.js from https://nodejs.org/ then re-run this installer,
    echo [ai-arb] WARNING: or run 'cd console ^&^& npm ci ^&^& npm run build' manually.
    exit /b 0
)

echo [ai-arb] Building console frontend (npm ci ^&^& npm run build)...
pushd "%_REPO_DIR%\console"
npm ci
if errorlevel 1 (
    popd
    echo [ai-arb] WARNING: npm ci failed - the web UI won't be available.
    exit /b 0
)
npm run build
if errorlevel 1 (
    popd
    echo [ai-arb] WARNING: npm run build failed - the web UI won't be available.
    exit /b 0
)
popd

if exist "%_CONSOLE_SRC%\index.html" (
    if not exist "%_CONSOLE_DEST%" mkdir "%_CONSOLE_DEST%"
    xcopy /s /e /y /q "%_CONSOLE_SRC%\*" "%_CONSOLE_DEST%\" >nul
    set "CONSOLE_COPIED=1"
    set "CONSOLE_AVAILABLE=1"
    echo [ai-arb] Console frontend built successfully
    exit /b 0
)

echo [ai-arb] WARNING: Console build completed but index.html not found - the web UI won't be available.
exit /b 0

REM ──── Cleanup console frontend ────────────────────────────────────────────────────────────────────────────────────────────────────
:cleanup_console
REM %~1 = RepoDir
if "%CONSOLE_COPIED%"=="1" (
    set "_CLEANUP_DEST=%~1\src\qwenpaw\console"
    if exist "!_CLEANUP_DEST!" rd /s /q "!_CLEANUP_DEST!" 2>nul
)
exit /b 0

REM ══════════════════════════════ MAIN ═════════════════════════════════════════
:main
echo [ai-arb] Installing AI Arb into %AIARB_HOME%

REM ──── Step 1: Ensure uv ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
call :ensure_uv
if errorlevel 1 exit /b 1

REM ──── Step 2: Create / update virtual environment ──────────────────────────────────────────────────────────────
if exist "%AIARB_VENV%" (
    echo [ai-arb] Existing environment found, upgrading...
) else (
    echo [ai-arb] Creating Python %PYTHON_VERSION% environment...
)

uv venv "%AIARB_VENV%" --python %PYTHON_VERSION% --quiet --clear
if errorlevel 1 (
    echo [ai-arb] ERROR: Failed to create virtual environment
    exit /b 1
)

set "VENV_PYTHON=%AIARB_VENV%\Scripts\python.exe"
if not exist "!VENV_PYTHON!" (
    echo [ai-arb] ERROR: Failed to create virtual environment
    exit /b 1
)

for /f "usebackq delims=" %%v in (`"!VENV_PYTHON!" --version 2^>^&1`) do set "PY_VERSION=%%v"
echo [ai-arb] Python environment ready (!PY_VERSION!)

REM ──── Step 3: Install AI Arb ──────────────────────────────────────────────────────────────────────────────────────────────────
set "EXTRAS_SUFFIX="
if defined ARG_EXTRAS set "EXTRAS_SUFFIX=[%ARG_EXTRAS%]"

set "VENV_AIARB=%AIARB_VENV%\Scripts\qwenpaw.exe"

if "%ARG_FROM_SOURCE%"=="1" (
    if defined ARG_SOURCE_DIR (
        set "ARG_SOURCE_DIR=%~f2"
        echo [ai-arb] Installing AI Arb from local source: %ARG_SOURCE_DIR%
        call :prepare_console "%ARG_SOURCE_DIR%"
        echo [ai-arb] Installing package from source...
        uv pip install "%ARG_SOURCE_DIR%%EXTRAS_SUFFIX%" --python "!VENV_PYTHON!"
        if errorlevel 1 (
            echo [ai-arb] ERROR: Installation from source failed
            exit /b 1
        )
        call :cleanup_console "%ARG_SOURCE_DIR%"
    ) else (
        where git >nul 2>&1
        if errorlevel 1 (
            echo [ai-arb] ERROR: git is required for -FromSource without a local directory.
            echo [ai-arb] Please install Git from https://git-scm.com/ or pass a local path: install.bat -FromSource -SourceDir C:\path\to\QwenPaw
            exit /b 1
        )
        echo [ai-arb] Installing AI Arb from source (GitHub)...
        set "CLONE_DIR=%TEMP%\qwenpaw-install-!RANDOM!"
        git clone --depth 1 %AIARB_REPO% "!CLONE_DIR!"
        if errorlevel 1 (
            echo [ai-arb] ERROR: Failed to clone repository
            exit /b 1
        )
        call :prepare_console "!CLONE_DIR!"
        echo [ai-arb] Installing package from source...
        uv pip install "!CLONE_DIR!%EXTRAS_SUFFIX%" --python "!VENV_PYTHON!"
        if errorlevel 1 (
            echo [ai-arb] ERROR: Installation from source failed
            exit /b 1
        )
        if exist "!CLONE_DIR!" rd /s /q "!CLONE_DIR!" 2>nul
    )
) else (
    set "PACKAGE=qwenpaw"
    if defined ARG_VERSION set "PACKAGE=qwenpaw==%ARG_VERSION%"

    set "PRERELEASE_ARGS="
    if "%ARG_PRERELEASE%"=="1" set "PRERELEASE_ARGS=--prerelease=allow"

    echo [ai-arb] Installing !PACKAGE!!EXTRAS_SUFFIX! from PyPI...
    uv pip install "!PACKAGE!!EXTRAS_SUFFIX!" --python "!VENV_PYTHON!" --quiet --refresh-package qwenpaw !PRERELEASE_ARGS!
    if errorlevel 1 (
        echo [ai-arb] ERROR: Installation failed
        exit /b 1
    )
)

REM Verify the CLI entry point exists
if not exist "!VENV_AIARB!" (
    echo [ai-arb] ERROR: Installation failed: qwenpaw CLI not found in venv
    exit /b 1
)

echo [ai-arb] AI Arb installed successfully

REM Check console availability (for PyPI installs, check the installed package)
if "%CONSOLE_AVAILABLE%"=="0" (
    for /f "usebackq delims=" %%r in (`"!VENV_PYTHON!" -c "import importlib.resources, qwenpaw; p=importlib.resources.files('qwenpaw')/'console'/'index.html'; print('yes' if p.is_file() else 'no')"`) do (
        if "%%r"=="yes" set "CONSOLE_AVAILABLE=1"
    )
)

REM ──── Step 4: Create wrapper scripts ──────────────────────────────────────────────────────────────────────────
if not exist "%AIARB_BIN%" mkdir "%AIARB_BIN%"

set "WRAPPER_PS1=%AIARB_BIN%\aiarb.ps1"
set "WRAPPER_CMD=%AIARB_BIN%\aiarb.cmd"

REM Generate PS1 wrapper
if exist "%WRAPPER_PS1%" del "%WRAPPER_PS1%"
echo # AI Arb CLI wrapper -- delegates to the uv-managed environment. > "%WRAPPER_PS1%"
echo. >> "%WRAPPER_PS1%"
echo $ErrorActionPreference = "Stop" >> "%WRAPPER_PS1%"
echo. >> "%WRAPPER_PS1%"
echo $AiarbHome = if ($env:AIARB_HOME) { $env:AIARB_HOME } elseif ($env:QWENPAW_HOME) { $env:QWENPAW_HOME } else { Join-Path $HOME ".aiarb" } >> "%WRAPPER_PS1%"
echo $RealBin   = Join-Path $AiarbHome "venv\Scripts\qwenpaw.exe" >> "%WRAPPER_PS1%"
echo. >> "%WRAPPER_PS1%"
echo if (-not (Test-Path $RealBin)) { >> "%WRAPPER_PS1%"
echo     Write-Error "AI Arb environment not found at $AiarbHome\venv" >> "%WRAPPER_PS1%"
echo     Write-Error "Please reinstall: irm ^<install-url^> ^| iex" >> "%WRAPPER_PS1%"
echo     exit 1 >> "%WRAPPER_PS1%"
echo } >> "%WRAPPER_PS1%"
echo. >> "%WRAPPER_PS1%"
echo ^& $RealBin @args >> "%WRAPPER_PS1%"
echo [ai-arb] Wrapper created at !WRAPPER_PS1!

REM Generate CMD wrapper
if exist "%WRAPPER_CMD%" del "%WRAPPER_CMD%"
echo @echo off > "%WRAPPER_CMD%"
echo REM AI Arb CLI wrapper -- delegates to the uv-managed environment. >> "%WRAPPER_CMD%"
echo. >> "%WRAPPER_CMD%"
echo set "AIARB_HOME=%%AIARB_HOME%%" >> "%WRAPPER_CMD%"
echo if "%%AIARB_HOME%%"=="" set "AIARB_HOME=%%USERPROFILE%%\.aiarb" >> "%WRAPPER_CMD%"
echo set "REAL_BIN=%%AIARB_HOME%%\venv\Scripts\qwenpaw.exe" >> "%WRAPPER_CMD%"
echo if not exist "%%REAL_BIN%%" ( >> "%WRAPPER_CMD%"
echo     echo Error: AI Arb environment not found at %%AIARB_HOME%%\venv ^>^&2 >> "%WRAPPER_CMD%"
echo     echo Please reinstall: irm ^<install-url^> ^| iex ^>^&2 >> "%WRAPPER_CMD%"
echo     exit /b 1 >> "%WRAPPER_CMD%"
echo ) >> "%WRAPPER_CMD%"
echo "%%REAL_BIN%%" %%* >> "%WRAPPER_CMD%"
echo [ai-arb] CMD wrapper created at !WRAPPER_CMD!

REM ──── Step 5: Update PATH via User Environment Variable ──────────────────────────────────────────────────────
set "TARGET_PATH=%AIARB_BIN%"
set "REG_PATH=HKCU\Environment"
set "REG_NAME=Path"

REM 1. 安全获取当前的 User PATH (直接从注册表读取，避免污染 Machine PATH)
for /f "skip=2 tokens=2*" %%a in ('reg query "%REG_PATH%" /v "%REG_NAME%" 2^>nul') do set "CURRENT_USER_PATH=%%b"
if not defined CURRENT_USER_PATH set "CURRENT_USER_PATH="

REM 2. 精确检查是否已存在
echo !CURRENT_USER_PATH! | findstr /i /c:"!TARGET_PATH!" >nul 2>&1
if errorlevel 1 (
    REM 构建新的 User PATH 字符串
    if defined CURRENT_USER_PATH (
        set "NEW_USER_PATH=!TARGET_PATH!;!CURRENT_USER_PATH!"
    ) else (
        set "NEW_USER_PATH=!TARGET_PATH!"
    )

    REM 3. 写入注册表
    reg add "%REG_PATH%" /v "%REG_NAME%" /t REG_EXPAND_SZ /d "!NEW_USER_PATH!" /f >nul 2>&1
    if not errorlevel 1 (
        set "PATH=!TARGET_PATH!;!PATH!"
        echo [ai-arb] Successfully added !TARGET_PATH! to User PATH
    ) else (
        echo.
        echo [CRITICAL WARNING] Automatic PATH update failed.
        echo    Context: Your system policy strictly blocks environment modifications.
        echo.
        echo ACTION REQUIRED: You must manually add the path to use AI Arb.
        echo    Target Path: !TARGET_PATH!
        echo.
        echo Manual Steps (User Variables):
        echo    1. Press Win+R, type 'sysdm.cpl' and press Enter
        echo    2. Go to [Advanced] ^> [Environment Variables...]
        echo    3. In the TOP section ('User variables'), select 'Path' ^> [Edit]
        echo    4. Click [New] and paste: !TARGET_PATH!
        echo    5. Click [OK] everywhere to save.
        echo    6. CLOSE and REOPEN your terminal.
        echo.
    )
) else (
    echo [ai-arb] !TARGET_PATH! is already in your User PATH
)

REM ──── Done ────────────────────────────────────────────────────────────────────────────────────────────────────
echo.
echo AI Arb installed successfully!
echo.
echo   Install location:   !AIARB_HOME!
echo   Python:             !PY_VERSION!
if "%CONSOLE_AVAILABLE%"=="1" (
    echo   Console (web UI):   available
) else (
    echo   Console (web UI):   not available
    echo                        Install Node.js and re-run to enable the web UI.
)
echo.
echo To get started, open a new terminal and run:
echo.
echo   aiarb init        # first-time setup
echo   aiarb app         # start AI Arb
echo.
echo To upgrade later, re-run this installer.
echo To uninstall, run: aiarb uninstall