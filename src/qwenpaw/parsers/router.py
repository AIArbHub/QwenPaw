# -*- coding: utf-8 -*-
from __future__ import annotations

import logging
from pathlib import Path

from .markitdown_parser import parse_with_markitdown
from .docling_parser import parse_with_docling
from .mineru_parser import MinerUParser

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

_FALLBACK_MIN_CHARS = 50


class ParserRouter:
    def __init__(
        self,
        mineru_api_key: str = "",
        mineru_base_url: str = "https://mineru.net/api/v4",
        mineru_backend: str = "pipeline",
        mineru_effort: str = "medium",
    ):
        self._mineru = MinerUParser(
            api_key=mineru_api_key,
            base_url=mineru_base_url,
            backend=mineru_backend,
            effort=mineru_effort,
        )

    @property
    def mineru(self) -> MinerUParser:
        return self._mineru

    @staticmethod
    def detect_type(file_path: Path) -> str:
        return file_path.suffix.lower().lstrip(".")

    async def parse(
        self,
        file_path: Path,
        parse_mode: str = "auto",
    ) -> str:
        ext = f".{self.detect_type(file_path)}"

        if self._mineru.available and ext in _MINERU_EXTENSIONS:
            return await self._mineru_first_pipeline(file_path)

        if ext in _PDF_EXTENSION:
            return await self._pdf_pipeline(file_path)

        if ext in _SCAN_EXTENSIONS:
            return await self._native_pipeline(file_path)

        return await self._native_pipeline(file_path)

    async def _mineru_first_pipeline(self, file_path: Path) -> str:
        result = await self._mineru.parse(file_path)
        if result and not result.startswith("[MinerU:"):
            return result

        logger.warning(
            "MinerU failed for %s, falling back to native pipeline",
            file_path.name,
        )
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