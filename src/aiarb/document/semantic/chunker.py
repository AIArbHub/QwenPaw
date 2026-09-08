# -*- coding: utf-8 -*-
"""Semantic Chunker — legal document semantic segmentation.

Splits LDIR pages/blocks into semantically meaningful chunks (by clause,
paragraph, or natural boundary), each carrying:
- chunk_id: stable identifier
- page_number: source page
- block_range: (start_block_idx, end_block_idx) in LDIR
- text: concatenated text
- chunk_type: clause / paragraph / heading / list_item / table_row / other

All functions are pure — no I/O, no side effects.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any


@dataclass
class SemanticChunk:
    """A semantically meaningful chunk of a legal document.

    Attributes:
        chunk_id: Stable identifier (e.g. "chunk_001").
        page_number: Source page number (1-indexed).
        block_range: (start_block_idx, end_block_idx) within the page's blocks list.
        text: Concatenated text of the chunk.
        chunk_type: clause / paragraph / heading / list_item / table_row / other.
        clause_ref: If this chunk is a legal clause, the parsed reference (e.g. "第十六条").
        metadata: Arbitrary extra metadata.
    """
    chunk_id: str = ""
    page_number: int = 1
    block_range: tuple[int, int] = (0, 0)
    text: str = ""
    chunk_type: str = "paragraph"
    clause_ref: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)


# -- Clause number patterns -------------------------------------------------

# 第X条 (Chinese legal article numbering)
_ARTICLE_PATTERN = re.compile(
    r"^[第\s]*([一二三四五六七八九十百千零\d]+)\s*[条章编节款项]"
)

# Heading patterns: 一、 二、 (一) 1. etc.
_HEADING_CN_PATTERN = re.compile(
    r"^[一二三四五六七八九十]{1,3}[、\.]"
)
_HEADING_NUM_PATTERN = re.compile(
    r"^[（(]?\d+[)）\.]"
)
_HEADING_ROMAN_PATTERN = re.compile(
    r"^[ivxlcdmIVXLCDM]+[、\.]"
)

# List item patterns
_LIST_ITEM_PATTERN = re.compile(
    r"^[（(]\s*\d+\s*[)）]"
)

# Table row indicator (simple heuristic: many | or \t)
_TABLE_ROW_PATTERN = re.compile(r"\|.*\|")


def _is_chinese_num(text: str) -> bool:
    """Check if text starts with a Chinese article reference."""
    return bool(_ARTICLE_PATTERN.match(text.strip()))


def _detect_chunk_type(text: str) -> str:
    """Detect the type of a text block.

    Pure function — no I/O, no side effects.
    """
    stripped = text.strip()
    if not stripped:
        return "other"
    if _is_chinese_num(stripped):
        return "clause"
    if _HEADING_CN_PATTERN.match(stripped):
        return "heading"
    if _HEADING_NUM_PATTERN.match(stripped):
        return "heading"
    if _HEADING_ROMAN_PATTERN.match(stripped):
        return "heading"
    if _LIST_ITEM_PATTERN.match(stripped):
        return "list_item"
    if _TABLE_ROW_PATTERN.search(stripped):
        return "table_row"
    return "paragraph"


def _extract_clause_ref(text: str) -> str:
    """Extract the clause reference from a clause-type chunk.

    Returns the matched clause reference string (e.g. "第十六条") or empty string.
    Pure function.
    """
    match = _ARTICLE_PATTERN.match(text.strip())
    if match:
        # Reconstruct the full reference from the match
        return text.strip()[:match.end()]
    return ""


class SemanticChunker:
    """Semantic chunker for legal documents.

    Splits LDIR pages/blocks into semantically meaningful chunks.
    Strategy:
    1. If a block starts with a legal article number (第X条), start a new clause chunk.
    2. If a block is a heading (一、二、 or 1. 2.), start a new heading chunk.
    3. Otherwise, merge into the current chunk (paragraph grouping).
    4. Each chunk carries page_number + block_range for provenance.
    """

    def chunk(self, pages: list[dict[str, Any]]) -> list[SemanticChunk]:
        """Chunk LDIR pages into semantic chunks.

        Args:
            pages: List of LDIR page dicts (with "page_number" and "blocks").

        Returns:
            List of SemanticChunk objects.

        Pure function — no I/O, no side effects.
        """
        chunks: list[SemanticChunk] = []
        chunk_idx = 0
        current_chunk: SemanticChunk | None = None

        for page in pages:
            page_number = page.get("page_number", 1)
            blocks = page.get("blocks", [])

            for block_idx, block in enumerate(blocks):
                text = block.get("text", "").strip()
                if not text:
                    continue

                chunk_type = _detect_chunk_type(text)
                clause_ref = _extract_clause_ref(text) if chunk_type == "clause" else ""

                # Start a new chunk if:
                # 1. This is a clause (legal article) — always start new
                # 2. This is a heading — always start new
                # 3. No current chunk yet
                should_start_new = (
                    chunk_type in ("clause", "heading")
                    or current_chunk is None
                )

                if should_start_new:
                    # Flush current chunk
                    if current_chunk is not None:
                        chunks.append(current_chunk)

                    # Start new chunk
                    chunk_idx += 1
                    current_chunk = SemanticChunk(
                        chunk_id=f"chunk_{chunk_idx:04d}",
                        page_number=page_number,
                        block_range=(block_idx, block_idx),
                        text=text,
                        chunk_type=chunk_type,
                        clause_ref=clause_ref,
                    )
                else:
                    # Merge into current chunk
                    if current_chunk is not None:
                        # Update block range
                        start_idx = current_chunk.block_range[0]
                        current_chunk.block_range = (start_idx, block_idx)
                        # Append text
                        if current_chunk.text:
                            current_chunk.text += "\n" + text
                        else:
                            current_chunk.text = text
                        # If page changed, note it in metadata
                        if current_chunk.page_number != page_number:
                            pages_set = current_chunk.metadata.setdefault("pages", set())
                            pages_set.add(current_chunk.page_number)
                            pages_set.add(page_number)
                    else:
                        chunk_idx += 1
                        current_chunk = SemanticChunk(
                            chunk_id=f"chunk_{chunk_idx:04d}",
                            page_number=page_number,
                            block_range=(block_idx, block_idx),
                            text=text,
                            chunk_type=chunk_type,
                            clause_ref=clause_ref,
                        )

        # Flush last chunk
        if current_chunk is not None:
            chunks.append(current_chunk)

        # Convert metadata pages sets to sorted lists for JSON serialization
        for chunk in chunks:
            if "pages" in chunk.metadata and isinstance(chunk.metadata["pages"], set):
                chunk.metadata["pages"] = sorted(chunk.metadata["pages"])

        return chunks

    def chunk_from_ldir(self, ldir_doc: dict[str, Any]) -> list[SemanticChunk]:
        """Convenience method to chunk from a full LDIR document dict.

        Pure function.
        """
        return self.chunk(ldir_doc.get("pages", []))


__all__ = [
    "SemanticChunk",
    "SemanticChunker",
]
