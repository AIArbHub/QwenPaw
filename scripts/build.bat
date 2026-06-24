@echo off
REM QwenPaw Windows Build Script
REM Usage: scripts\build.bat

echo === Building QwenPaw ===

REM 1. Build frontend
echo [1/3] Building frontend...
cd /d "%~dp0..\console"
call npm ci --include=dev
if errorlevel 1 (
    echo ERROR: npm ci failed
    exit /b 1
)
call npm run build
if errorlevel 1 (
    echo ERROR: npm run build failed
    exit /b 1
)
cd /d "%~dp0.."

REM 2. Activate venv and install PyInstaller
echo [2/3] Installing PyInstaller...
call .venv\Scripts\activate.bat
pip install pyinstaller
if errorlevel 1 (
    echo ERROR: pip install pyinstaller failed
    exit /b 1
)

REM 3. Run PyInstaller
echo [3/3] Running PyInstaller...
pyinstaller scripts\qwenpaw.spec --distpath dist --workpath build\pyinstaller --clean
if errorlevel 1 (
    echo ERROR: PyInstaller build failed
    exit /b 1
)

echo.
echo === Build complete ===
echo Output: dist\QwenPaw\qwenpaw.exe
echo.
echo To run: dist\QwenPaw\qwenpaw.exe app --port 8088
