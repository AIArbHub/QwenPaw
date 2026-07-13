# -*- coding: utf-8 -*-
"""
ParserRouter — central dispatcher for document parsing.

Routing priority (3-tier OCR architecture):

  Tier 1 — MinerU (cloud/local, highest accuracy):
    If MinerU is configured and available, it handles PDF/images/Office docs.
    On failure, falls back to Tier 2/3.

  Tier 2 — Tesseract (lightweight local OCR, no model download):
    For scanned PDFs and images when MinerU is unavailable.
    Requires Tesseract binary + Poppler binary (bundled or system-installed).

  Tier 3 — Native extractors (no OCR, text-layer only):
    PyMuPDF detects PDF text layer → MarkItDown extracts text.
    Works for digital PDFs and Office docs with embedded text.

All engine imports are lazy so the router loads even when some libraries
are missing — unavailable engines silently degrade.
"""
from __future__ import annotations

import logging
from pathlib import Path

from .markitdown_parser import parse_with_markitdown
from .mineru_parser import MinerUParser
from .tesseract_parser import TesseractParser

logger = logging.getLogger(__name__)

_MINERU_EXTENSIONS = {
    ".pdf", ".jpg", ".jpeg", ".png", ".tiff", ".tif", ".bmp", ".webp",
    ".docx", ".xlsx", ".pptx",
}
_NATIVE_EXTENSIONS = {
    ".docx", ".xlsx", ".pptx", ".html", ".htm", ".md", ".txt", ".csv",
}
_SCAN_EXTENSIONS = {".jpg", ".jpeg", ".png", ".tiff", ".tif", ".bmp", ".webp"}
_PDF_EXTENSION = {".pdf"}
_TESSERACT_EXTENSIONS = _SCAN_EXTENSIONS | _PDF_EXTENSION

_FALLBACK_MIN_CHARS = 50


class ParserRouter:
    def __init__(
        self,
        mineru_api_key: str = "",
        mineru_base_url: str = "https://mineru.net/api/v4",
        mineru_backend: str = "pipeline",
        mineru_effort: str = "medium",
        tesseract_langs: str = "",
    ):
        self._mineru = MinerUParser(
            api_key=mineru_api_key,
            base_url=mineru_base_url,
            backend=mineru_backend,
            effort=mineru_effort,
        )
        self._tesseract = TesseractParser(langs=tesseract_langs)

    @property
    def mineru(self) -> MinerUParser:
        return self._mineru

    @property
    def tesseract(self) -> TesseractParser:
        return self._tesseract

    @property
    def has_ocr(self) -> bool:
        """Whether any OCR engine is available (MinerU or Tesseract)."""
        return self._mineru.available or self._tesseract.available

    @property
    def ocr_engine_name(self) -> str:
        """Name of the best available OCR engine."""
        if self._mineru.available:
            return "local_mineru" if self._mineru.is_local else "cloud_mineru"
        if self._tesseract.available:
            return "tesseract"
        return "none"

    @staticmethod
    def detect_type(file_path: Path) -> str:
        return file_path.suffix.lower().lstrip(".")

    async def parse(
        self,
        file_path: Path,
        parse_mode: str = "auto",
    ) -> str:
        ext = f".{self.detect_type(file_path)}"

        # ── cloud_ocr: force cloud MinerU only ─────────────────────────
        if parse_mode == "cloud_ocr":
            if self._mineru.available and not self._mineru.is_local and ext in _MINERU_EXTENSIONS:
                result = await self._mineru.parse(file_path)
                if result and not result.startswith("[MinerU:"):
                    return result
                # Cloud MinerU failed — no fallback in cloud_ocr mode
                return result or f"[Cannot parse: {file_path.name} — cloud OCR failed]"

            # For non-OCR file types, use native extraction
            if ext not in _MINERU_EXTENSIONS:
                return await self._native_pipeline(file_path)

            # Cloud MinerU not available
            return f"[Cannot parse: {file_path.name} — cloud OCR engine not configured. Switch to auto or local_only mode.]"

        # ── local_only: local engines only (no cloud MinerU) ──────────
        if parse_mode == "local_only":
            # PDF: text-layer detection → Tesseract OCR fallback
            if ext in _PDF_EXTENSION:
                return await self._pdf_pipeline(file_path, allow_cloud_mineru=False)

            # Images: Tesseract OCR only
            if ext in _SCAN_EXTENSIONS:
                return await self._image_pipeline(file_path, allow_cloud_mineru=False)

            # Office/text: native extraction
            return await self._native_pipeline(file_path)

        # ── auto: current behavior (3-tier: MinerU → Tesseract → native) ─
        # Tier 1: MinerU (if available, cloud or local)
        if self._mineru.available and ext in _MINERU_EXTENSIONS:
            return await self._mineru_first_pipeline(file_path)

        # PDF: check text layer, then OCR if needed
        if ext in _PDF_EXTENSION:
            return await self._pdf_pipeline(file_path)

        # Images: OCR if available, else fail gracefully
        if ext in _SCAN_EXTENSIONS:
            return await self._image_pipeline(file_path)

        # Office/text: native extraction only
        return await self._native_pipeline(file_path)

    async def _mineru_first_pipeline(self, file_path: Path) -> str:
        """Tier 1: try MinerU, fall back to Tesseract or native on failure."""
        result = await self._mineru.parse(file_path)
        if result and not result.startswith("[MinerU:"):
            return result

        logger.warning(
            "MinerU failed for %s, falling back to Tesseract/native",
            file_path.name,
        )
        # Try Tesseract OCR for PDFs and images
        ext = file_path.suffix.lower()
        if ext in _TESSERACT_EXTENSIONS and self._tesseract.available:
            tess_result = await self._tesseract.parse(file_path)
            if tess_result and len(tess_result.strip()) >= _FALLBACK_MIN_CHARS:
                return tess_result

        return await self._native_pipeline(file_path)

    async def _pdf_pipeline(self, file_path: Path, allow_cloud_mineru: bool = True) -> str:
        """PDF parsing: text-layer detection → native extraction → OCR fallback."""
        has_text = await self._check_pdf_text_layer(file_path)
        if has_text:
            # Tier 3: extract text from digital PDF
            result = await parse_with_markitdown(file_path)
            if result and len(result.strip()) >= _FALLBACK_MIN_CHARS:
                return result
            # Text layer existed but extraction yielded too little —
            # fall through to OCR (the "text" may be garbage/garbled)

        # No text layer or extraction failed → try OCR
        # Tier 1: Local MinerU (if available and allowed)
        if allow_cloud_mineru and self._mineru.available and self._mineru.is_local:
            result = await self._mineru.parse(file_path)
            if result and not result.startswith("[MinerU:"):
                return result

        # Tier 2: Tesseract OCR for scanned PDFs
        if self._tesseract.available:
            logger.info("PDF has no text layer (or extraction failed), trying Tesseract OCR: %s", file_path.name)
            tess_result = await self._tesseract.parse(file_path)
            if tess_result and len(tess_result.strip()) >= _FALLBACK_MIN_CHARS:
                return tess_result

        # Last resort: native pipeline (will likely fail for scanned PDFs)
        return await self._native_pipeline(file_path)

    async def _image_pipeline(self, file_path: Path, allow_cloud_mineru: bool = True) -> str:
        """Image parsing: OCR only (no text layer possible)."""
        # Tier 1: Local MinerU (if available and allowed)
        if allow_cloud_mineru and self._mineru.available and self._mineru.is_local:
            result = await self._mineru.parse(file_path)
            if result and len(result.strip()) >= 10:
                return result

        # Tier 2: Tesseract OCR
        if self._tesseract.available:
            result = await self._tesseract.parse(file_path)
            if result and len(result.strip()) >= 10:
                return result

        # No OCR engine available
        return f"[Cannot OCR: {file_path.name} — no OCR engine available. Configure MinerU API key or install Tesseract.]"

    async def _native_pipeline(self, file_path: Path) -> str:
        """Tier 3: MarkItDown → raw read."""
        result = await parse_with_markitdown(file_path)
        if result and len(result.strip()) >= _FALLBACK_MIN_CHARS:
            return result

        logger.info(
            "MarkItDown produced < %d chars for %s",
            _FALLBACK_MIN_CHARS,
            file_path.name,
        )

        return result or f"[Cannot parse: {file_path.name}]"

    @staticmethod
    async def _check_pdf_text_layer(file_path: Path) -> bool:
        """Detect whether a PDF has an extractable text layer using PyMuPDF."""
        try:
            import fitz

            doc = fitz.open(str(file_path))
            for page in doc:
                text = page.get_text().strip()
                if len(text) > 20:
                    doc.close()
                    return True
            doc.close()
        except ImportError:
            logger.debug("PyMuPDF (fitz) not installed, cannot check PDF text layer")
        except Exception:
            pass
        return False

    def get_diagnostics(self) -> dict:
        """Return status of all parser engines for the OCR status endpoint."""
        return {
            "mineru": {
                "available": self._mineru.available,
                "is_local": self._mineru.is_local if self._mineru.available else False,
            },
            "tesseract": self._tesseract.get_diagnostics(),
            "has_ocr": self.has_ocr,
            "ocr_engine": self.ocr_engine_name,
        }