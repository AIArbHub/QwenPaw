# -*- coding: utf-8 -*-
"""
Tesseract OCR parser — lightweight local OCR for scanned PDFs and images.

This module provides a self-contained OCR engine that does NOT require MinerU.
It uses Tesseract (via pytesseract) for text recognition and Poppler (via
pdf2image) to rasterize PDF pages into images for OCR.

Binary detection strategy (cross-platform):
  1. Bundled binaries — check for a ``bin/tesseract/`` directory relative to
     the package root (Windows portable distribution).
  2. System PATH — fall back to ``tesseract`` / ``pdftoppm`` in PATH.

All imports are lazy (inside methods) so the module loads even when
pytesseract/pdf2image are not installed.
"""
from __future__ import annotations

import logging
import os
import shutil
import subprocess
import sys
from pathlib import Path

logger = logging.getLogger(__name__)

# Supported image extensions for direct OCR
_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".tiff", ".tif", ".bmp", ".webp", ".gif"}

# Languages to try for OCR (order matters: chi_sim first for Chinese docs)
_DEFAULT_LANGS = "chi_sim+eng"


class TesseractParser:
    """Lightweight local OCR using Tesseract + Poppler.

    Unlike MinerU, this parser has zero model-download requirements and works
    fully offline once the binaries are in place.
    """

    def __init__(self, langs: str = ""):
        self._langs = langs or _DEFAULT_LANGS
        self._tesseract_cmd: str | None = None
        self._poppler_path: str | None = None
        self._available: bool | None = None

    @property
    def available(self) -> bool:
        """Check whether Tesseract is usable (binary found and importable)."""
        if self._available is not None:
            return self._available
        self._available = self._check_available()
        return self._available

    @property
    def tesseract_cmd(self) -> str:
        """Resolved path to the Tesseract binary."""
        if self._tesseract_cmd is None:
            self._tesseract_cmd = self._find_tesseract()
        return self._tesseract_cmd

    @property
    def poppler_path(self) -> str | None:
        """Resolved path to Poppler's bin directory (or None if using system PATH)."""
        if self._poppler_path is None:
            self._poppler_path = self._find_poppler()
        return self._poppler_path

    def _check_available(self) -> bool:
        """Verify that pytesseract is importable and Tesseract binary is found."""
        try:
            import pytesseract  # noqa: F401
        except ImportError:
            logger.debug("pytesseract not installed, Tesseract OCR unavailable")
            return False

        cmd = self._find_tesseract()
        if not cmd:
            logger.debug("Tesseract binary not found")
            return False

        # Verify the binary actually runs
        try:
            result = subprocess.run(
                [cmd, "--version"],
                capture_output=True, text=True, timeout=10,
            )
            if result.returncode != 0:
                logger.warning("Tesseract binary found but --version failed: %s", result.stderr)
                return False
            version_line = (result.stdout or "").splitlines()[0] if result.stdout else ""
            logger.info("Tesseract OCR available: %s (%s)", cmd, version_line)
        except Exception as exc:
            logger.warning("Tesseract binary check failed: %s", exc)
            return False

        return True

    @staticmethod
    def _find_tesseract() -> str:
        """Locate the Tesseract binary.

        Search order:
        1. Bundled in Tauri desktop app (QWENPAW_DESKTOP_OCR_TOOLS env var)
        2. Bundled in PyInstaller frozen app (sys._MEIPASS or exe dir)
        3. Bundled directory (bin/tesseract/) relative to package root
        4. TESSERACT_CMD environment variable
        5. System PATH
        """
        # 1. Tauri desktop app: QWENPAW_DESKTOP_OCR_TOOLS points to ocr-tools/
        ocr_tools = os.environ.get("QWENPAW_DESKTOP_OCR_TOOLS", "")
        if ocr_tools:
            tess_path = Path(ocr_tools) / "tesseract"
            candidate = tess_path / ("tesseract.exe" if os.name == "nt" else "tesseract")
            if candidate.is_file():
                # Also set TESSDATA_PREFIX so Tesseract finds trained data
                tessdata = tess_path / "tessdata"
                if tessdata.is_dir():
                    os.environ["TESSDATA_PREFIX"] = str(tess_path)
                return str(candidate)

        # 2. PyInstaller frozen app
        if getattr(sys, "frozen", False):
            base = Path(sys.executable).parent
            for candidate in [
                base / "tesseract" / "tesseract.exe",
                base / "tesseract" / "tesseract",
                base / "ocr-tools" / "tesseract" / "tesseract.exe",
                base / "ocr-tools" / "tesseract" / "tesseract",
            ]:
                if candidate.is_file():
                    tessdata = candidate.parent / "tessdata"
                    if tessdata.is_dir():
                        os.environ["TESSDATA_PREFIX"] = str(candidate.parent)
                    return str(candidate)

        # 3. Bundled binary relative to package root (dev mode)
        pkg_root = Path(__file__).resolve().parent.parent.parent
        repo_root = pkg_root.parent
        for candidate in [
            pkg_root / "bin" / "tesseract" / "tesseract.exe",
            pkg_root / "bin" / "tesseract" / "tesseract",
            repo_root / "console" / "src-tauri" / "binaries" / "ocr-tools" / "tesseract" / "tesseract.exe",
            repo_root / "console" / "src-tauri" / "binaries" / "ocr-tools" / "tesseract" / "tesseract",
            Path(os.environ.get("APPDATA", "")) / "qwenpaw" / "bin" / "tesseract" / "tesseract.exe",
        ]:
            if candidate.is_file():
                tessdata = candidate.parent / "tessdata"
                if tessdata.is_dir():
                    os.environ["TESSDATA_PREFIX"] = str(candidate.parent)
                return str(candidate)

        # 4. Environment variable
        env_cmd = os.environ.get("TESSERACT_CMD", "")
        if env_cmd and Path(env_cmd).is_file():
            return env_cmd

        # 5. System PATH
        which = shutil.which("tesseract")
        if which:
            return which

        return ""

    @staticmethod
    def _find_poppler() -> str | None:
        """Locate Poppler's bin directory.

        Search order:
        1. Bundled in Tauri desktop app (QWENPAW_DESKTOP_OCR_TOOLS env var)
        2. Bundled in PyInstaller frozen app
        3. Bundled directory (bin/poppler/bin/)
        4. POPPLER_PATH environment variable
        5. System PATH (return None, let pdf2image find it)
        """
        # 1. Tauri desktop app
        ocr_tools = os.environ.get("QWENPAW_DESKTOP_OCR_TOOLS", "")
        if ocr_tools:
            poppler_bin = Path(ocr_tools) / "poppler" / "bin"
            if poppler_bin.is_dir():
                pdftoppm = poppler_bin / ("pdftoppm.exe" if os.name == "nt" else "pdftoppm")
                if pdftoppm.is_file():
                    return str(poppler_bin)

        # 2. PyInstaller frozen app
        if getattr(sys, "frozen", False):
            base = Path(sys.executable).parent
            for candidate in [
                base / "poppler" / "bin",
                base / "ocr-tools" / "poppler" / "bin",
            ]:
                pdftoppm = candidate / ("pdftoppm.exe" if os.name == "nt" else "pdftoppm")
                if pdftoppm.is_file():
                    return str(candidate)

        # 3. Bundled directory relative to package root
        pkg_root = Path(__file__).resolve().parent.parent.parent
        repo_root = pkg_root.parent
        for candidate in [
            pkg_root / "bin" / "poppler" / "bin",
            pkg_root / "bin" / "poppler" / "Library" / "bin",
            repo_root / "console" / "src-tauri" / "binaries" / "ocr-tools" / "poppler" / "bin",
            Path(os.environ.get("APPDATA", "")) / "qwenpaw" / "bin" / "poppler" / "bin",
        ]:
            if candidate.is_dir():
                pdftoppm = candidate / ("pdftoppm.exe" if os.name == "nt" else "pdftoppm")
                if pdftoppm.is_file():
                    return str(candidate)

        # 4. Environment variable
        env_path = os.environ.get("POPPLER_PATH", "")
        if env_path and Path(env_path).is_dir():
            return env_path

        # 5. Check if pdftoppm is in system PATH
        if shutil.which("pdftoppm"):
            return None  # Let pdf2image use system PATH

        return None

    async def parse(self, file_path: Path) -> str:
        """OCR a PDF or image file, returning extracted text.

        For PDFs: rasterize each page to an image via Poppler, then OCR each page.
        For images: OCR directly.
        """
        if not self.available:
            return ""

        ext = file_path.suffix.lower()

        try:
            if ext == ".pdf":
                return await self._ocr_pdf(file_path)
            elif ext in _IMAGE_EXTENSIONS:
                return await self._ocr_image(file_path)
            else:
                logger.warning("Tesseract: unsupported file type %s", ext)
                return ""
        except Exception as exc:
            logger.error("Tesseract OCR failed for %s: %s", file_path.name, exc)
            return ""

    async def _ocr_pdf(self, file_path: Path) -> str:
        """Rasterize PDF pages and OCR each one."""
        import asyncio

        try:
            from pdf2image import convert_from_path
        except ImportError:
            logger.warning("pdf2image not installed, cannot OCR PDF pages")
            return ""

        # Configure pytesseract with the resolved binary path
        self._configure_pytesseract()

        # Convert PDF pages to images (200 DPI is a good balance of speed/quality)
        kwargs = {"dpi": 200}
        if self.poppler_path:
            kwargs["poppler_path"] = self.poppler_path

        images = await asyncio.get_running_loop().run_in_executor(
            None,
            lambda: convert_from_path(str(file_path), **kwargs),
        )

        if not images:
            return ""

        # OCR each page
        import pytesseract

        texts: list[str] = []
        for i, img in enumerate(images):
            try:
                page_text = await asyncio.get_running_loop().run_in_executor(
                    None,
                    lambda img=img: pytesseract.image_to_string(img, lang=self._langs),
                )
                if page_text.strip():
                    texts.append(page_text.strip())
            except Exception as exc:
                logger.warning("Tesseract OCR failed on page %d: %s", i + 1, exc)

        return "\n\n".join(texts)

    async def _ocr_image(self, file_path: Path) -> str:
        """OCR a single image file."""
        import asyncio

        try:
            import pytesseract
            from PIL import Image
        except ImportError:
            return ""

        self._configure_pytesseract()

        img = await asyncio.get_running_loop().run_in_executor(
            None, lambda: Image.open(str(file_path)),
        )

        text = await asyncio.get_running_loop().run_in_executor(
            None, lambda: pytesseract.image_to_string(img, lang=self._langs),
        )
        return text.strip()

    def _configure_pytesseract(self):
        """Set pytesseract's binary path to our resolved location."""
        try:
            import pytesseract
            if self.tesseract_cmd:
                pytesseract.pytesseract.tesseract_cmd = self.tesseract_cmd
        except ImportError:
            pass

    def get_diagnostics(self) -> dict:
        """Return diagnostic info for the OCR status endpoint."""
        return {
            "available": self.available,
            "tesseract_cmd": self.tesseract_cmd or "not found",
            "poppler_path": self.poppler_path or "system PATH",
            "langs": self._langs,
        }