# -*- coding: utf-8 -*-
from __future__ import annotations

import logging
from pathlib import Path

from .markitdown_parser import parse_with_markitdown
from .docling_parser import parse_with_docling
from .mineru_parser import MinerUParser
from .paddleocr_parser import PaddleOCRParser

logger = logging.getLogger(__name__)

_NATIVE_EXTENSIONS = {
    ".docx", ".xlsx", ".pptx", ".html", ".htm", ".md", ".txt", ".csv",
}
_SCAN_EXTENSIONS = {".jpg", ".jpeg", ".png", ".tiff", ".tif", ".bmp", ".webp"}
_PDF_EXTENSION = {".pdf"}

_FALLBACK_MIN_CHARS = 50


class ParserRouter:
    def __init__(
        self,
        mineru_api_key: str = "",
        mineru_base_url: str = "https://mineru.net/api/v4",
        local_ocr_enabled: bool = True,
    ):
        self._mineru = MinerUParser(api_key=mineru_api_key, base_url=mineru_base_url)
        self._local_ocr = PaddleOCRParser() if local_ocr_enabled else None

    @staticmethod
    def detect_type(file_path: Path) -> str:
        return file_path.suffix.lower().lstrip(".")

    async def parse(
        self,
        file_path: Path,
        parse_mode: str = "auto",
    ) -> str:
        ext = f".{self.detect_type(file_path)}"

        if parse_mode == "cloud_ocr":
            return await self._via_mineru(file_path)

        if parse_mode == "local_only":
            return await self._local_only(file_path, ext)

        if ext in _NATIVE_EXTENSIONS:
            return await self._native_pipeline(file_path)

        if ext in _PDF_EXTENSION:
            return await self._pdf_pipeline(file_path)

        if ext in _SCAN_EXTENSIONS:
            return await self._via_mineru(file_path)

        return await self._native_pipeline(file_path)

    async def _native_pipeline(self, file_path: Path) -> str:
        result = await parse_with_markitdown(file_path)
        if result and len(result.strip()) >= _FALLBACK_MIN_CHARS:
            return result

        logger.info(
            "MarkItDown produced < %d chars for %s, trying Docling fallback",
            _FALLBACK_MIN_CHARS,
            file_path.name,
        )
        docling_result = await parse_with_docling(file_path)
        if docling_result and len(docling_result.strip()) >= _FALLBACK_MIN_CHARS:
            return docling_result

        return result or docling_result or f"[Cannot parse: {file_path.name}]"

    async def _pdf_pipeline(self, file_path: Path) -> str:
        has_text = await self._check_pdf_text_layer(file_path)
        if has_text:
            result = await parse_with_markitdown(file_path)
            if result and len(result.strip()) >= _FALLBACK_MIN_CHARS:
                return result
            docling_result = await parse_with_docling(file_path)
            if docling_result and len(docling_result.strip()) >= _FALLBACK_MIN_CHARS:
                return docling_result

        return await self._via_ocr(file_path)

    async def _via_ocr(self, file_path: Path) -> str:
        if self._mineru.available:
            result = await self._mineru.parse(file_path)
            if result and not result.startswith("[MinerU:"):
                return result
            logger.warning("MinerU failed for %s, trying local OCR", file_path.name)

        if self._local_ocr and self._local_ocr.available:
            logger.info("Using PaddleOCR for %s", file_path.name)
            result = await self._local_ocr.parse(file_path)
            if result and not result.startswith("[Image file:") and not result.startswith("[Cannot parse:") and len(result.strip()) >= _FALLBACK_MIN_CHARS:
                return result

        logger.warning("All OCR methods failed for %s, falling back to native", file_path.name)
        return await self._native_pipeline(file_path)

    async def _via_mineru(self, file_path: Path) -> str:
        return await self._via_ocr(file_path)

    async def _local_only(self, file_path: Path, ext: str) -> str:
        if ext in _SCAN_EXTENSIONS or ext in _PDF_EXTENSION:
            if not self._local_ocr:
                logger.warning(
                    "Local OCR disabled: PaddleOCRParser not initialized (local_ocr_enabled=False in config)"
                )
            elif not self._local_ocr.available:
                logger.warning(
                    "Local OCR unavailable: paddleocr module cannot be imported at runtime"
                )

            if self._local_ocr and self._local_ocr.available:
                logger.info("Using PaddleOCR (local_only) for %s", file_path.name)
                result = await self._local_ocr.parse(file_path)
                if result and len(result.strip()) >= _FALLBACK_MIN_CHARS:
                    return result
                logger.warning(
                    "PaddleOCR returned empty/short result (< %d chars) for %s",
                    _FALLBACK_MIN_CHARS,
                    file_path.name,
                )
            if ext in _SCAN_EXTENSIONS:
                reason = "disabled" if not self._local_ocr else (
                    "paddleocr not importable" if not self._local_ocr.available else "empty result"
                )
                return f"[Image file: local OCR not available ({reason})]"
            has_text = await self._check_pdf_text_layer(file_path)
            if has_text:
                return await self._native_pipeline(file_path)
            return "[Cannot parse: local OCR not available for scanned PDF]"
        return await self._native_pipeline(file_path)

    @staticmethod
    async def _check_pdf_text_layer(file_path: Path) -> bool:
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
            pass
        except Exception:
            pass
        return False