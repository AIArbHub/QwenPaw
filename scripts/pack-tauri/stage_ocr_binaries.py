#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Stage Tesseract OCR + Poppler binaries for the Tauri desktop bundle.

Downloads and assembles a self-contained ``ocr-tools/`` directory containing:
  - Tesseract OCR engine + Chinese/English trained data
  - Poppler utilities (pdftoppm, pdftocairo, etc.) for PDF rasterization

Platform behaviour:
  - **Windows**: Downloads portable Tesseract (UB-Mannheim NSIS installer,
    extracted with 7z) and Poppler (oschwartz10612 zip release).
  - **macOS**: Uses Homebrew to install tesseract + poppler, then bundles
    the binaries with ``dylibbundler`` to create a self-contained directory.

Usage:
  python stage_ocr_binaries.py --dest <binaries/ocr-tools>

The resulting directory layout:
  ocr-tools/
    tesseract/
      tesseract[.exe]
      tessdata/
        eng.traineddata
        chi_sim.traineddata
      [*.dll / *.dylib]
    poppler/
      bin/
        pdftoppm[.exe]
        pdftocairo[.exe]
        ...
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

# ── Constants ──────────────────────────────────────────────────────────────

# Tesseract: UB-Mannheim Windows installer (latest release fetched dynamically)
_TESSERACT_GITHUB_REPO = "UB-Mannheim/tesseract"
_TESSERACT_ASSET_PATTERN = r"^tesseract-ocr-w64-setup-.+\.exe$"

# Poppler: oschwartz10612 Windows portable build (latest release fetched dynamically)
_POPPLER_GITHUB_REPO = "oschwartz10612/poppler-windows"
_POPPLER_ASSET_PATTERN = r"^Release-.+\.zip$"

# Trained data: tessdata_fast (smaller than full tessdata)
_TESSDATA_FAST_BASE = (
    "https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/"
)
_TRAINDEDATA_FILES = ["eng.traineddata", "chi_sim.traineddata"]


# ── Helpers ────────────────────────────────────────────────────────────────

def _get_latest_release_url(repo: str, asset_pattern: str) -> str:
    """Fetch the latest release asset download URL from the GitHub API.

    Args:
        repo: GitHub repo in ``owner/name`` format.
        asset_pattern: Regex to match the desired asset filename.

    Returns:
        The ``browser_download_url`` of the first matching asset.
    """
    api_url = f"https://api.github.com/repos/{repo}/releases/latest"
    for attempt in range(3):
        try:
            req = urllib.request.Request(
                api_url, headers={"User-Agent": "AIArb-Build/1.0"}
            )
            token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
            if token:
                req.add_header("Authorization", f"Bearer {token}")
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            pattern = re.compile(asset_pattern)
            for asset in data.get("assets", []):
                if pattern.match(asset.get("name", "")):
                    url = asset["browser_download_url"]
                    print(f"  Latest {repo} release: {data.get('tag_name', '?')} → {asset['name']}")
                    return url
            raise SystemExit(
                f"No asset matching '{asset_pattern}' in latest release of {repo}"
            )
        except urllib.error.HTTPError as exc:
            if exc.code == 403 and attempt < 2:
                print(f"  GitHub API rate limited, retrying in 10s...")
                import time
                time.sleep(10)
                continue
            raise


def _download(url: str, dest: Path) -> Path:
    """Download a file with progress indication."""
    print(f"  Downloading: {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "AIArb-Build/1.0"})
    with urllib.request.urlopen(req, timeout=120) as resp, open(dest, "wb") as f:
        total = int(resp.headers.get("Content-Length", 0))
        downloaded = 0
        chunk = 64 * 1024
        while True:
            data = resp.read(chunk)
            if not data:
                break
            f.write(data)
            downloaded += len(data)
            if total:
                pct = downloaded * 100 // total
                sys.stdout.write(f"\r  {downloaded // 1024}KB / {total // 1024}KB ({pct}%)")
                sys.stdout.flush()
        print()
    return dest


def _extract_7z(archive: Path, dest: Path) -> None:
    """Extract a 7z-compatible archive (including NSIS self-extracting exe)."""
    # Try 7z first (most reliable for NSIS installers)
    sevenzip = shutil.which("7z") or shutil.which("7za")
    if sevenzip:
        subprocess.run(
            [sevenzip, "x", str(archive), f"-o{dest}", "-y"],
            check=True, capture_output=True,
        )
        return

    # Fallback: py7zr
    try:
        import py7zr
        with py7zr.SevenZipFile(archive, mode="r") as z:
            z.extractall(dest)
        return
    except ImportError:
        pass

    raise SystemExit(
        "Cannot extract NSIS installer: install 7-Zip or py7zr (pip install py7zr)"
    )


def _extract_zip(archive: Path, dest: Path) -> None:
    """Extract a zip archive."""
    with zipfile.ZipFile(archive, "r") as z:
        z.extractall(dest)


def _extract_tar(archive: Path, dest: Path) -> None:
    """Extract a tar.gz archive."""
    with tarfile.open(archive, "r:*") as t:
        t.extractall(dest)


# ── Windows staging ────────────────────────────────────────────────────────

def _stage_windows(dest: Path) -> None:
    """Stage Tesseract + Poppler for Windows."""
    print("Staging OCR binaries for Windows...")

    with tempfile.TemporaryDirectory(prefix="ocr-stage-") as tmpdir:
        tmpdir = Path(tmpdir)

        # ── 1. Tesseract ───────────────────────────────────────────────
        print("\n[1/3] Tesseract OCR engine")
        tess_url = _get_latest_release_url(_TESSERACT_GITHUB_REPO, _TESSERACT_ASSET_PATTERN)
        tess_installer = tmpdir / "tesseract-setup.exe"
        _download(tess_url, tess_installer)

        tess_extract = tmpdir / "tesseract-extracted"
        tess_extract.mkdir()
        # NSIS installer can be extracted with 7z
        _extract_7z(tess_installer, tess_extract)

        # Find the actual Tesseract directory inside the extracted NSIS payload
        tess_src = _find_tesseract_win(tess_extract)
        if not tess_src:
            raise SystemExit(
                f"Cannot locate Tesseract binary inside extracted installer at {tess_extract}"
            )
        print(f"  Found Tesseract at: {tess_src}")

        # Copy Tesseract to dest
        tess_dest = dest / "tesseract"
        tess_dest.mkdir(parents=True, exist_ok=True)
        shutil.copytree(tess_src, tess_dest, dirs_exist_ok=True)

        # ── 2. Trained data ────────────────────────────────────────────
        print("\n[2/3] Tesseract language data (chi_sim + eng)")
        tessdata_dir = tess_dest / "tessdata"
        tessdata_dir.mkdir(exist_ok=True)

        for fname in _TRAINDEDATA_FILES:
            # Check if already bundled with the installer
            bundled = tessdata_dir / fname
            if bundled.is_file() and bundled.stat().st_size > 1_000_000:
                print(f"  {fname}: already present ({bundled.stat().st_size // 1024}KB)")
                continue

            url = _TESSDATA_FAST_BASE + fname
            target = tessdata_dir / fname
            _download(url, target)
            print(f"  {fname}: downloaded ({target.stat().st_size // 1024}KB)")

        # Set TESSDATA_PREFIX environment hint (the tesseract_parser.py handles this)
        # Clean up unnecessary files to minimize bundle size
        _cleanup_tesseract_win(tess_dest)

        # ── 3. Poppler ─────────────────────────────────────────────────
        print("\n[3/3] Poppler utilities")
        poppler_url = _get_latest_release_url(_POPPLER_GITHUB_REPO, _POPPLER_ASSET_PATTERN)
        poppler_zip = tmpdir / "poppler.zip"
        _download(poppler_url, poppler_zip)

        poppler_extract = tmpdir / "poppler-extracted"
        poppler_extract.mkdir()
        _extract_zip(poppler_zip, poppler_extract)

        # Find the poppler directory (usually has a subdirectory like "poppler-24.08.0")
        poppler_src = _find_poppler_win(poppler_extract)
        if not poppler_src:
            raise SystemExit(
                f"Cannot locate Poppler bin inside extracted zip at {poppler_extract}"
            )
        print(f"  Found Poppler at: {poppler_src}")

        poppler_dest = dest / "poppler"
        poppler_dest.mkdir(parents=True, exist_ok=True)
        shutil.copytree(poppler_src, poppler_dest, dirs_exist_ok=True)
        _cleanup_poppler_win(poppler_dest)

    # Write a version marker (extract version from tesseract binary)
    tess_ver = "unknown"
    try:
        result = subprocess.run(
            [str(dest / "tesseract" / "tesseract.exe"), "--version"],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode == 0 and result.stdout:
            first_line = result.stdout.splitlines()[0]
            tess_ver = first_line.split()[-1] if first_line else "unknown"
    except Exception:
        pass

    (dest / ".ocr-tools-version").write_text(
        f"tesseract={tess_ver}\npoppler=latest\nlangs=chi_sim,eng\n",
        encoding="utf-8",
    )
    print(f"\nOCR binaries staged to: {dest}")


def _find_tesseract_win(root: Path) -> Path | None:
    """Find the Tesseract binary directory inside extracted NSIS payload."""
    # NSIS extracts to a directory structure; find tesseract.exe
    for exe in root.rglob("tesseract.exe"):
        return exe.parent
    return None


def _find_poppler_win(root: Path) -> Path | None:
    """Find the Poppler directory inside extracted zip."""
    # Poppler zip usually has a top-level directory like "poppler-24.08.0/Library/bin"
    for exe in root.rglob("pdftoppm.exe"):
        # Return the parent of bin/ (so poppler_dest/bin/pdftoppm.exe works)
        return exe.parent.parent
    return None


# Tesseract training/auxiliary executables that are not needed for OCR
_TESSERACT_STRIP_EXES = {
    "ambiguous_words.exe", "classifier_tester.exe", "cntraining.exe",
    "combine_lang_model.exe", "combine_tessdata.exe", "dawg2wordlist.exe",
    "lstmeval.exe", "lstmtraining.exe", "merge_unicharsets.exe",
    "mftraining.exe", "set_unicharset_properties.exe", "shapeclustering.exe",
    "text2image.exe", "unicharset_extractor.exe", "wordlist2dawg.exe",
    "winpath.exe", "tesseract-uninstall.exe",
}


def _cleanup_tesseract_win(tess_dir: Path) -> None:
    """Remove training tools, docs, and other unnecessary files from Tesseract."""
    removed_size = 0

    # 1. Remove training/auxiliary executables
    for name in _TESSERACT_STRIP_EXES:
        f = tess_dir / name
        if f.is_file():
            removed_size += f.stat().st_size
            f.unlink()

    # 2. Remove HTML documentation
    for f in tess_dir.glob("*.1.html"):
        removed_size += f.stat().st_size
        f.unlink()

    # 3. Remove NSIS installer artifacts
    pluginsdir = tess_dir / "$PLUGINSDIR"
    if pluginsdir.is_dir():
        removed_size += sum(f.stat().st_size for f in pluginsdir.rglob("*") if f.is_file())
        shutil.rmtree(pluginsdir)

    # 4. Remove URL shortcuts
    for f in tess_dir.glob("*.url"):
        f.unlink()

    # 5. Remove Java JAR files from tessdata (used only by ScrollView training UI)
    tessdata = tess_dir / "tessdata"
    if tessdata.is_dir():
        for f in tessdata.glob("*.jar"):
            removed_size += f.stat().st_size
            f.unlink()
        # Remove osd.traineddata (10 MB, orientation/script detection — not needed for basic OCR)
        osd = tessdata / "osd.traineddata"
        if osd.is_file():
            removed_size += osd.stat().st_size
            osd.unlink()
        # Remove user patterns/words (empty placeholder files)
        for pattern in ["*.user-patterns", "*.user-words"]:
            for f in tessdata.glob(pattern):
                f.unlink()
        # Remove config directories (not needed for basic OCR)
        for cfg_dir in ["configs", "tessconfigs"]:
            d = tessdata / cfg_dir
            if d.is_dir():
                shutil.rmtree(d)
        # Remove pdf.ttf (font for PDF output, not needed for text extraction)
        pdf_ttf = tessdata / "pdf.ttf"
        if pdf_ttf.is_file():
            pdf_ttf.unlink()

    # 6. Try to strip debug symbols from large DLLs (if strip is available)
    _try_strip_debug(tess_dir)

    print(f"  Cleanup: removed {removed_size // (1024 * 1024)} MB of unnecessary files")


def _cleanup_poppler_win(poppler_dir: Path) -> None:
    """Remove include headers, lib files, and man pages from Poppler."""
    removed_size = 0

    for subdir in ["include", "lib", "share"]:
        d = poppler_dir / subdir
        if d.is_dir():
            removed_size += sum(f.stat().st_size for f in d.rglob("*") if f.is_file())
            shutil.rmtree(d)

    print(f"  Cleanup: removed {removed_size // (1024 * 1024)} MB of unnecessary files")


def _try_strip_debug(dll_dir: Path) -> None:
    """Attempt to strip debug symbols from DLLs using strip (MinGW) if available."""
    strip = shutil.which("strip")
    if not strip:
        return

    for dll in dll_dir.glob("*.dll"):
        try:
            before = dll.stat().st_size
            subprocess.run(
                [strip, "--strip-debug", str(dll)],
                capture_output=True, timeout=30,
            )
            after = dll.stat().st_size
            if before > after:
                saved = (before - after) // (1024 * 1024)
                if saved > 0:
                    print(f"  Stripped {dll.name}: saved {saved} MB")
        except Exception:
            pass


# ── macOS staging ──────────────────────────────────────────────────────────

def _stage_macos(dest: Path) -> None:
    """Stage Tesseract + Poppler for macOS using Homebrew."""
    print("Staging OCR binaries for macOS...")

    # Ensure Homebrew packages are installed
    _ensure_brew_package("tesseract")
    _ensure_brew_package("poppler")

    brew_prefix = _get_brew_prefix()
    print(f"  Homebrew prefix: {brew_prefix}")

    with tempfile.TemporaryDirectory(prefix="ocr-stage-") as tmpdir:
        tmpdir = Path(tmpdir)

        # ── 1. Tesseract ───────────────────────────────────────────────
        print("\n[1/3] Tesseract OCR engine")
        tess_dest = dest / "tesseract"
        tess_dest.mkdir(parents=True, exist_ok=True)

        # Copy tesseract binary
        tess_bin = brew_prefix / "bin" / "tesseract"
        if not tess_bin.is_file():
            raise SystemExit(f"Tesseract not found at {tess_bin}")
        shutil.copy2(tess_bin, tess_dest / "tesseract")
        os.chmod(tess_dest / "tesseract", 0o755)

        # Copy tessdata
        tessdata_src = _find_tessdata_macos(brew_prefix)
        tessdata_dest = tess_dest / "tessdata"
        tessdata_dest.mkdir(exist_ok=True)
        if tessdata_src:
            for f in tessdata_src.glob("*.traineddata"):
                shutil.copy2(f, tessdata_dest / f.name)
            print(f"  Copied {len(list(tessdata_dest.glob('*.traineddata')))} trained data files")

        # Ensure we have chi_sim and eng
        for fname in _TRAINDEDATA_FILES:
            target = tessdata_dest / fname
            if not target.is_file():
                url = _TESSDATA_FAST_BASE + fname
                _download(url, target)
                print(f"  Downloaded {fname} ({target.stat().st_size // 1024}KB)")

        # Bundle Tesseract dylibs
        _bundle_dylibs(tess_dest / "tesseract", tess_dest)

        # ── 2. Poppler ─────────────────────────────────────────────────
        print("\n[2/3] Poppler utilities")
        poppler_dest = dest / "poppler" / "bin"
        poppler_dest.mkdir(parents=True, exist_ok=True)

        for util in ["pdftoppm", "pdftocairo", "pdfinfo", "pdftotext"]:
            util_src = brew_prefix / "bin" / util
            if util_src.is_file():
                shutil.copy2(util_src, poppler_dest / util)
                os.chmod(poppler_dest / util, 0o755)
                # Bundle dylibs for each utility
                _bundle_dylibs(poppler_dest / util, poppler_dest.parent)
                print(f"  Copied {util}")

        # ── 3. Verify ──────────────────────────────────────────────────
        print("\n[3/3] Verification")

    (dest / ".ocr-tools-version").write_text(
        f"tesseract={_get_brew_version('tesseract')}\n"
        f"poppler={_get_brew_version('poppler')}\n"
        f"langs=chi_sim,eng\n",
        encoding="utf-8",
    )
    print(f"\nOCR binaries staged to: {dest}")


def _ensure_brew_package(name: str) -> None:
    """Ensure a Homebrew package is installed."""
    result = subprocess.run(
        ["brew", "list", name],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        print(f"  Installing {name} via Homebrew...")
        subprocess.run(["brew", "install", name], check=True)
    else:
        print(f"  {name} already installed via Homebrew")


def _get_brew_prefix() -> Path:
    """Get the Homebrew prefix path."""
    result = subprocess.run(
        ["brew", "--prefix"], capture_output=True, text=True, check=True,
    )
    return Path(result.stdout.strip())


def _get_brew_version(name: str) -> str:
    """Get the installed version of a Homebrew package."""
    result = subprocess.run(
        ["brew", "list", "--versions", name],
        capture_output=True, text=True,
    )
    if result.returncode == 0:
        parts = result.stdout.strip().split()
        if len(parts) >= 2:
            return parts[1]
    return "unknown"


def _find_tessdata_macos(brew_prefix: Path) -> Path | None:
    """Find the tessdata directory in Homebrew's Tesseract installation."""
    # Homebrew Cellar path
    cellar = brew_prefix.parent / "Cellar" / "tesseract"
    if cellar.is_dir():
        for version_dir in cellar.iterdir():
            td = version_dir / "share" / "tessdata"
            if td.is_dir():
                return td

    # Also check opt symlink
    opt = brew_prefix / "opt" / "tesseract" / "share" / "tessdata"
    if opt.is_dir():
        return opt

    return None


def _bundle_dylibs(binary: Path, dest_dir: Path) -> None:
    """Bundle dynamic library dependencies using dylibbundler."""
    dylibbundler = shutil.which("dylibbundler")
    if not dylibbundler:
        print(f"  WARNING: dylibbundler not found, skipping dylib bundling for {binary.name}")
        print("  Install with: brew install dylibbundler")
        return

    lib_dir = dest_dir / "lib"
    lib_dir.mkdir(exist_ok=True)

    subprocess.run(
        [
            dylibbundler,
            "-x", str(binary),
            "-b",
            "-d", str(lib_dir),
            "-p", "@executable_path/../lib",
            "-of",
        ],
        capture_output=True, text=True,
        check=False,  # Don't fail if some libs are already bundled
    )


# ── Main ───────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Stage Tesseract OCR + Poppler binaries for Tauri bundle"
    )
    parser.add_argument(
        "--dest", required=True, type=Path,
        help="Destination directory (e.g., binaries/ocr-tools)",
    )
    args = parser.parse_args()

    dest: Path = args.dest
    dest.mkdir(parents=True, exist_ok=True)

    system = platform.system()
    if system == "Windows":
        _stage_windows(dest)
    elif system == "Darwin":
        _stage_macos(dest)
    else:
        print(f"WARNING: Unsupported platform for OCR staging: {system}")
        print("OCR binaries will need to be installed system-wide on this platform.")
        sys.exit(0)

    # Print summary
    print("\n" + "=" * 50)
    print("OCR binaries staging complete!")
    print("=" * 50)
    print(f"Location: {dest}")

    # List contents
    for item in sorted(dest.rglob("*")):
        if item.is_file():
            rel = item.relative_to(dest)
            size = item.stat().st_size
            print(f"  {rel} ({size // 1024}KB)")


if __name__ == "__main__":
    main()
