# -*- coding: utf-8 -*-
"""LDIR — Legal Document Intermediate Representation.

A lightweight IR for legal documents that carries:
- page / block / span structure with position info
- confidence scores from OCR / parsing
- source hash for provenance tracking
- semantic metadata (doc_type, parties, citations)

This is the AIArb-adapted version of LegalWork's LDIR v0.1, with
arbitration-specific document types added (arbitration_award, etc.).

Schema version: 0.2-aiarb
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Optional


@dataclass
class Span:
    """A contiguous text span within a block.

    Attributes:
        text: The actual text content.
        start: Character offset within the parent block text.
        end: Character offset (exclusive) within the parent block text.
        bbox: Optional bounding box [x0, y0, x1, y1] in PDF coordinates.
        confidence: OCR / parser confidence (0.0–1.0).
        entity_type: If this span was identified as a sensitive entity.
        redacted: Whether this span has been redacted.
    """
    text: str = ""
    start: int = 0
    end: int = 0
    bbox: Optional[list[float]] = None
    confidence: float = 1.0
    entity_type: str = ""
    redacted: bool = False


@dataclass
class Block:
    """A logical text block within a page.

    Attributes:
        text: Full text of the block.
        bbox: Bounding box [x0, y0, x1, y1] in PDF coordinates.
        spans: Sub-block spans for fine-grained positioning.
        block_type: Type hint (paragraph, heading, list, table, etc.).
        page_number: 1-indexed page number.
        redacted: Whether the entire block is redacted.
    """
    text: str = ""
    bbox: Optional[list[float]] = None
    spans: list[Span] = field(default_factory=list)
    block_type: str = "paragraph"
    page_number: int = 1
    redacted: bool = False


@dataclass
class Page:
    """A single page in the document.

    Attributes:
        page_number: 1-indexed page number.
        width: Page width in points (PDF coordinate system).
        height: Page height in points.
        blocks: Logical blocks on this page.
    """
    page_number: int = 1
    width: Optional[float] = None
    height: Optional[float] = None
    blocks: list[Block] = field(default_factory=list)


@dataclass
class LDIRDocument:
    """Root LDIR document object.

    This is the "machine-readable" companion to the human-readable
    Markdown text.  It carries position + confidence + provenance
    metadata so that citations can be traced to exact page/block/span.

    Attributes:
        doc_id: Unique document identifier (source filename or hash).
        source_file: Original file path.
        source_hash: SHA-256 of the original file content.
        parser: Parser metadata (engine, version, ocr_engine).
        pages: List of pages.
        doc_type: Detected document type (see doc_type.py).
        doc_type_confidence: Confidence of doc_type detection.
        parties: Extracted party names (for arbitration documents).
        citations: Extracted legal citations / references.
        metadata: Arbitrary extra metadata.
        created_at: Creation timestamp.
    """
    doc_id: str = ""
    source_file: str = ""
    source_hash: str = ""
    parser: dict[str, str] = field(default_factory=dict)
    pages: list[Page] = field(default_factory=list)
    doc_type: str = ""
    doc_type_confidence: float = 0.0
    parties: list[dict[str, str]] = field(default_factory=list)
    citations: list[dict[str, Any]] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)
    created_at: str = ""

    def to_dict(self) -> dict[str, Any]:
        """Serialize to a JSON-compatible dict (LDIR JSON format)."""
        return {
            "version": "0.2-aiarb",
            "doc_id": self.doc_id,
            "source_file": self.source_file,
            "source_hash": self.source_hash,
            "parser": self.parser,
            "doc_type": self.doc_type,
            "doc_type_confidence": self.doc_type_confidence,
            "parties": self.parties,
            "citations": self.citations,
            "metadata": self.metadata,
            "created_at": self.created_at or datetime.now().isoformat(),
            "pages": [
                {
                    "page_number": p.page_number,
                    "width": p.width,
                    "height": p.height,
                    "blocks": [
                        {
                            "text": b.text,
                            "bbox": b.bbox,
                            "block_type": b.block_type,
                            "page_number": b.page_number,
                            "redacted": b.redacted,
                            "spans": [
                                {
                                    "text": s.text,
                                    "start": s.start,
                                    "end": s.end,
                                    "bbox": s.bbox,
                                    "confidence": s.confidence,
                                    "entity_type": s.entity_type,
                                    "redacted": s.redacted,
                                }
                                for s in b.spans
                            ],
                        }
                        for b in p.blocks
                    ],
                }
                for p in self.pages
            ],
        }

    def to_json(self, indent: int = 2) -> str:
        """Serialize to a JSON string."""
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=indent)

    def save(self, path: str | Path) -> Path:
        """Save as .ldir.json file."""
        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(self.to_json(), encoding="utf-8")
        return p

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> LDIRDocument:
        """Deserialize from a dict (e.g., loaded from .ldir.json)."""
        pages = []
        for pd in data.get("pages", []):
            blocks = []
            for bd in pd.get("blocks", []):
                spans = [
                    Span(
                        text=s.get("text", ""),
                        start=s.get("start", 0),
                        end=s.get("end", 0),
                        bbox=s.get("bbox"),
                        confidence=s.get("confidence", 1.0),
                        entity_type=s.get("entity_type", ""),
                        redacted=s.get("redacted", False),
                    )
                    for s in bd.get("spans", [])
                ]
                blocks.append(Block(
                    text=bd.get("text", ""),
                    bbox=bd.get("bbox"),
                    spans=spans,
                    block_type=bd.get("block_type", "paragraph"),
                    page_number=bd.get("page_number", pd.get("page_number", 1)),
                    redacted=bd.get("redacted", False),
                ))
            pages.append(Page(
                page_number=pd.get("page_number", 1),
                width=pd.get("width"),
                height=pd.get("height"),
                blocks=blocks,
            ))
        return cls(
            doc_id=data.get("doc_id", ""),
            source_file=data.get("source_file", ""),
            source_hash=data.get("source_hash", ""),
            parser=data.get("parser", {}),
            pages=pages,
            doc_type=data.get("doc_type", ""),
            doc_type_confidence=data.get("doc_type_confidence", 0.0),
            parties=data.get("parties", []),
            citations=data.get("citations", []),
            metadata=data.get("metadata", {}),
            created_at=data.get("created_at", ""),
        )

    @classmethod
    def from_file(cls, path: str | Path) -> LDIRDocument:
        """Load from a .ldir.json file."""
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        return cls.from_dict(data)

    def get_all_text(self) -> str:
        """Concatenate all block texts, page by page."""
        parts = []
        for page in self.pages:
            for block in page.blocks:
                parts.append(block.text)
        return "\n\n".join(parts)

    def find_block_by_position(
        self,
        page_number: int,
        bbox: list[float],
    ) -> Optional[Block]:
        """Find the block that contains or overlaps a given bbox."""
        for page in self.pages:
            if page.page_number != page_number:
                continue
            for block in page.blocks:
                if block.bbox and self._bbox_contains(block.bbox, bbox):
                    return block
        return None

    @staticmethod
    def _bbox_contains(
        outer: list[float],
        inner: list[float],
    ) -> bool:
        """Check if outer bbox contains inner bbox."""
        return (
            outer[0] <= inner[0]
            and outer[1] <= inner[1]
            and outer[2] >= inner[2]
            and outer[3] >= inner[3]
        )

    def add_party(self, role: str, name: str) -> None:
        """Add a party to the document metadata."""
        self.parties.append({"role": role, "name": name})

    def add_citation(
        self,
        text: str,
        page_number: Optional[int] = None,
        block_index: Optional[int] = None,
    ) -> None:
        """Add a legal citation reference found in the document."""
        self.citations.append({
            "text": text,
            "page_number": page_number,
            "block_index": block_index,
        })


def compute_source_hash(file_path: str | Path) -> str:
    """Compute SHA-256 hash of a file's content."""
    h = hashlib.sha256()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


__all__ = [
    "Block",
    "LDIRDocument",
    "Page",
    "Span",
    "compute_source_hash",
]
