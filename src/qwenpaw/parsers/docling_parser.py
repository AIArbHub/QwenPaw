# -*- coding: utf-8 -*-
from __future__ import annotations

import logging
from pathlib import Path

logger = logging.getLogger(__name__)


async def parse_with_docling(file_path: Path) -> str:
    try:
        from docling.document_converter import DocumentConverter

        converter = DocumentConverter()
        result = converter.convert(str(file_path))
        return result.document.export_to_markdown()
    except ImportError:
        logger.warning("docling not installed, cannot use as fallback parser")
        return ""
    except Exception as exc:
        logger.error("Docling parse failed for %s: %s", file_path, exc)
        return ""