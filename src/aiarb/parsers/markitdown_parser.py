# -*- coding: utf-8 -*-
from __future__ import annotations

import logging
from pathlib import Path

logger = logging.getLogger(__name__)


async def parse_with_markitdown(file_path: Path) -> str:
    try:
        from markitdown import MarkItDown

        md = MarkItDown()
        result = md.convert(str(file_path))
        return result.text_content or ""
    except ImportError:
        logger.warning("markitdown not installed, falling back to raw read")
        return _raw_read(file_path)
    except Exception as exc:
        logger.error("MarkItDown parse failed for %s: %s", file_path, exc)
        return _raw_read(file_path)


def _raw_read(file_path: Path) -> str:
    try:
        if file_path.suffix.lower() in (".md", ".txt", ".csv"):
            return file_path.read_text(encoding="utf-8", errors="replace")
    except Exception:
        pass
    return f"[Cannot parse: {file_path.name}]"