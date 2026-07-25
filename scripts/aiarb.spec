# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec file for AIArb standalone CLI.

Builds a onedir bundle that includes the FastAPI backend + web console.
Usage: pyinstaller scripts/aiarb.spec
"""

import os
import sys
from pathlib import Path

from PyInstaller.utils.hooks import (
    collect_data_files,
    collect_submodules,
    copy_metadata,
)

REPO_ROOT = Path(SPECPATH).parent
SRC = REPO_ROOT / "src" / "aiarb"

if sys.platform == "darwin":
    codesign_identity = os.environ.get("PYINSTALLER_CODESIGN_IDENTITY") or os.environ.get("APPLE_SIGNING_IDENTITY")
    if not codesign_identity:
        codesign_identity = None
else:
    codesign_identity = None


def collect_tree(source_dir, target_dir):
    return [
        (str(path), str(Path(target_dir) / path.relative_to(source_dir).parent))
        for path in source_dir.rglob("*")
        if path.is_file()
    ]


# Verify console dist exists
CONSOLE_DIST = REPO_ROOT / "console" / "dist"
if not (CONSOLE_DIST / "index.html").is_file():
    raise SystemExit(
        f"console dist not found at {CONSOLE_DIST}; "
        "run 'npm run build' in console/ before PyInstaller"
    )

# --- Data files ---
_data_dirs = [
    ("agents/skills", "aiarb/agents/skills"),
    ("agents/md_files", "aiarb/agents/md_files"),
    ("tokenizer", "aiarb/tokenizer"),
    ("security/tool_guard/rules", "aiarb/security/tool_guard/rules"),
    ("security/skill_scanner/rules", "aiarb/security/skill_scanner/rules"),
    ("security/skill_scanner/data", "aiarb/security/skill_scanner/data"),
]
datas = [
    (str(SRC / src), dst) for src, dst in _data_dirs if (SRC / src).is_dir()
]
datas += collect_tree(CONSOLE_DIST, "aiarb/console")

# Include reme package data files
datas += collect_data_files("reme")

# Collect package metadata for packages that use importlib.metadata at runtime
_metadata_pkgs = [
    "aiarb",
    "fastmcp",
    "mcp",
    "httpx",
    "httpcore",
    "anyio",
    "sniffio",
    "starlette",
    "pydantic",
    "pydantic-core",
    "pydantic-settings",
    "uvicorn",
    "openai",
    "anthropic",
    "tiktoken",
    "the framework",
    "the framework-runtime",
    "huggingface_hub",
    "modelscope",
]
for _pkg in _metadata_pkgs:
    try:
        datas += copy_metadata(_pkg)
    except Exception:
        pass

# --- Hidden imports ---
hiddenimports = [
    # uvicorn internals
    "uvicorn.logging",
    "uvicorn.loops",
    "uvicorn.loops.auto",
    "uvicorn.protocols",
    "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan",
    "uvicorn.lifespan.on",
    # All CLI sub-commands
    *collect_submodules("aiarb.cli"),
    # All channel adapters
    *collect_submodules("aiarb.app.channels"),
    # ASGI app entry points
    "aiarb.app._app",
    "aiarb.app.api",
    "aiarb.app.middleware",
    "aiarb.app.multi_agent_manager",
    "aiarb.app.runner",
    # Backup modules
    *collect_submodules("aiarb.backup"),
    # Third-party dynamic imports
    *collect_submodules("dotenv"),
    "dotenv",
    "a2a",
    "a2a.types",
    *collect_submodules("acp"),
    "acp",
    "the framework_runtime",
    "psutil",
    "multipart",
    "websockets",
    "modelscope",
    "modelscope.hub.api",
    "modelscope.hub.snapshot_download",
    *collect_submodules("chromadb"),
    # wecom channel
    "aibot",
    # onnxruntime
    "onnxruntime",
    # transformers / tokenizers
    "transformers",
    "tokenizers",
    "safetensors",
    # reme-ai
    "reme",
    *collect_submodules("reme"),
]

# --- Analysis ---
cli = Analysis(
    [str(SRC / "__main__.py")],
    pathex=[str(REPO_ROOT), str(REPO_ROOT / "src")],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "tkinter",
        "matplotlib",
        "scipy",
        "IPython",
        "jupyter",
        "notebook",
    ],
    noarchive=False,
)

cli_pyz = PYZ(cli.pure)

cli_exe = EXE(
    cli_pyz,
    cli.scripts,
    [],
    name="aiarb",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=codesign_identity,
    exclude_binaries=True,
)

coll = COLLECT(
    cli_exe,
    cli.binaries,
    cli.datas,
    strip=False,
    upx=False,
    name="aiarb-backend",
)
