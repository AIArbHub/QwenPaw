# -*- coding: utf-8 -*-
"""Document intake pipeline: raw file → text → LDIR.

Produces 4 artifacts per document (matching LegalWork's convention):
  1. *.md              — human-readable text
  2. *.ldir.json       — machine-readable LDIR
  3. *.semantic.json   — semantic metadata (doc_type, parties, citations)
  4. *_intake_report.json — quality report (confidence, warnings, recommendations)

The intake pipeline detects file type, extracts text (with optional OCR
for scanned PDFs), builds LDIR structure with page/block positions, and
infers document type with arbitration-specific types.

Workspace layout:
    matter/
      raw/        — original files (never modified)
      working/    — intake artifacts (md, ldir.json, semantic.json, report)
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from .ldir import Block, LDIRDocument, Page, Span, compute_source_hash
from .doc_type import DocTypeResult, infer_doc_type, doc_type_label
from .semantic.semantic_layer import build_semantic_layer
from .ocr import OCREngine, load_default_ocr_config

logger = logging.getLogger(__name__)

# -- Supported file types ---------------------------------------------------

SUPPORTED_EXTENSIONS = frozenset({
    ".pdf", ".txt", ".md", ".markdown",
    ".docx", ".doc",
    ".html", ".htm",
})

# OCR confidence threshold for "human review recommended"
OCR_CONFIDENCE_THRESHOLD = 0.85


@dataclass
class IntakeReport:
    """Quality report for a single document intake.

    Carries confidence, warnings, and human-review recommendations,
    matching LegalWork's *_ocr_report.json convention.
    """
    file_name: str = ""
    file_type: str = ""
    source_hash: str = ""
    parser_engine: str = ""
    ocr_engine: str = ""
    ocr_confidence: float = 1.0
    page_count: int = 0
    block_count: int = 0
    char_count: int = 0
    doc_type: str = ""
    doc_type_confidence: float = 0.0
    human_review_recommended: bool = False
    warnings: list[str] = field(default_factory=list)
    recommendations: list[str] = field(default_factory=list)
    created_at: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "file_name": self.file_name,
            "file_type": self.file_type,
            "source_hash": self.source_hash,
            "parser_engine": self.parser_engine,
            "ocr_engine": self.ocr_engine,
            "ocr_confidence": self.ocr_confidence,
            "page_count": self.page_count,
            "block_count": self.block_count,
            "char_count": self.char_count,
            "doc_type": self.doc_type,
            "doc_type_label": doc_type_label(self.doc_type),
            "doc_type_confidence": self.doc_type_confidence,
            "human_review_recommended": self.human_review_recommended,
            "warnings": self.warnings,
            "recommendations": self.recommendations,
            "created_at": self.created_at or datetime.now().isoformat(),
        }

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=2)


@dataclass
class IntakeResult:
    """Complete result of an intake pipeline run."""
    ldir: LDIRDocument
    report: IntakeReport
    markdown: str
    semantic: dict[str, Any]
    working_dir: Path

    @property
    def ldir_path(self) -> Path:
        return self.working_dir / f"{self.ldir.doc_id}.ldir.json"

    @property
    def md_path(self) -> Path:
        return self.working_dir / f"{self.ldir.doc_id}.md"

    @property
    def semantic_path(self) -> Path:
        return self.working_dir / f"{self.ldir.doc_id}.semantic.json"

    @property
    def report_path(self) -> Path:
        return self.working_dir / f"{self.ldir.doc_id}_intake_report.json"

    def save_all(self) -> None:
        """Save all 4 artifacts to the working directory."""
        self.working_dir.mkdir(parents=True, exist_ok=True)
        # 1. Markdown (human-readable)
        self.md_path.write_text(self.markdown, encoding="utf-8")
        # 2. LDIR JSON (machine-readable)
        self.ldir.save(self.ldir_path)
        # 3. Semantic JSON
        Path(self.semantic_path).write_text(
            json.dumps(self.semantic, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        # 4. Intake report
        Path(self.report_path).write_text(
            self.report.to_json(),
            encoding="utf-8",
        )


# -- Text extractors --------------------------------------------------------

# Global OCR engine instance (lazy-initialized)
_ocr_engine: OCREngine | None = None


def _get_ocr_engine() -> OCREngine:
    """Get or create the global OCR engine instance."""
    global _ocr_engine
    if _ocr_engine is None:
        config = load_default_ocr_config()
        _ocr_engine = OCREngine(config)
        logger.info("OCR engine initialized: %s", ", ".join(_ocr_engine.available_engines()))
    return _ocr_engine


def _extract_pdf(
    file_path: Path,
    enable_ocr: bool = True,
) -> tuple[list[Page], float, str, bool]:
    """Extract text from PDF using PyMuPDF.

    Returns: (pages, avg_confidence, ocr_engine, used_ocr)
    """
    pages: list[Page] = []
    total_confidence = 0.0
    page_count = 0
    used_ocr = False
    ocr_engine_name = "none"  # Will be updated if OCR is performed

    try:
        import fitz  # PyMuPDF
    except ImportError:
        return ([], 0.0, "none", False)

    try:
        doc = fitz.open(str(file_path))
        page_count = len(doc)
        for page_idx in range(page_count):
            page = doc[page_idx]
            page_number = page_idx + 1
            blocks: list[Block] = []

            # Get text blocks with coordinates
            text_blocks = page.get_text("blocks")
            if not text_blocks:
                # Possibly a scanned page — try harder to extract any text
                raw_text = page.get_text("text").strip()
                images_on_page = page.get_images(full=True)

                if not raw_text and len(images_on_page) > 0:
                    # Confirmed scanned/image-only page — try OCR if enabled
                    if enable_ocr:
                        ocr_result = _try_ocr_for_page(
                            file_path, page_idx, page_number,
                        )
                        if ocr_result and ocr_result.text.strip():
                            # OCR succeeded — use extracted text
                            used_ocr = True
                            ocr_engine_name = ocr_result.engine or "ocr"
                            blocks.append(Block(
                                text=ocr_result.text,
                                bbox=None,
                                block_type="ocr_extracted",
                                page_number=page_number,
                                redacted=False,
                            ))
                            total_confidence += ocr_result.confidence
                            logger.info(
                                "Page %d: OCR succeeded (%s, conf=%.2f%%, %dms)",
                                page_number, ocr_result.engine,
                                ocr_result.confidence * 100,
                                ocr_result.elapsed_ms,
                            )
                        else:
                            # OCR failed — flag as needed
                            used_ocr = True
                            ocr_engine_name = "ocr-needed"
                            blocks.append(Block(
                                text="[此页为扫描件/图片页，OCR 提取失败，需手动处理]",
                                bbox=None,
                                block_type="ocr_needed",
                                page_number=page_number,
                                redacted=False,
                            ))
                    else:
                        # OCR disabled — just flag it
                        used_ocr = True
                        ocr_engine_name = "ocr-needed"
                        blocks.append(Block(
                            text="[此页为扫描件/图片页，需要 OCR 处理才能提取文字]",
                            bbox=None,
                            block_type="ocr_needed",
                            page_number=page_number,
                            redacted=False,
                        ))
                elif raw_text:
                    # Has some text but no structured blocks — use raw text
                    blocks.append(Block(
                        text=raw_text,
                        bbox=None,
                        block_type="paragraph",
                        page_number=page_number,
                        redacted=False,
                    ))
                    total_confidence += 0.5  # Lower confidence for unstructured extraction
                else:
                    # Completely empty page
                    used_ocr = True
                    blocks.append(Block(
                        text="[空页或无法识别的页面]",
                        bbox=None,
                        block_type="empty",
                        page_number=page_number,
                        redacted=False,
                    ))
                continue

            for tb in text_blocks:
                # PyMuPDF block format: (x0, y0, x1, y1, text, block_no, block_type)
                x0, y0, x1, y1, text = tb[0], tb[1], tb[2], tb[3], tb[4]
                clean_text = text.strip()
                if not clean_text:
                    continue
                blocks.append(Block(
                    text=clean_text,
                    bbox=[float(x0), float(y0), float(x1), float(y1)],
                    block_type="paragraph",
                    page_number=page_number,
                    redacted=False,
                ))

            pages.append(Page(
                page_number=page_number,
                width=float(page.rect.width),
                height=float(page.rect.height),
                blocks=blocks,
            ))
            total_confidence += 1.0  # Text-layer extraction = high confidence

        doc.close()
    except Exception as exc:
        logger.warning("PyMuPDF extraction failed for %s: %s", file_path, exc)
        return ([], 0.0, "none", False)

    avg_conf = total_confidence / max(page_count, 1)
    final_ocr_engine = "pymupdf-text-layer" if not used_ocr else ocr_engine_name
    return (pages, avg_conf, final_ocr_engine, used_ocr)


def _extract_docx(file_path: Path) -> tuple[list[Page], float, str]:
    """Extract text from DOCX using python-docx.

    Returns: (pages, confidence, ocr_engine)
    """
    try:
        import docx
    except ImportError:
        return ([], 0.0, "none")

    pages: list[Page] = []
    blocks: list[Block] = []
    para_idx = 0

    try:
        doc = docx.Document(str(file_path))
        for para in doc.paragraphs:
            text = para.text.strip()
            if not text:
                continue
            block_type = "heading" if para.style.name.startswith("Heading") else "paragraph"
            blocks.append(Block(
                text=text,
                bbox=None,
                block_type=block_type,
                page_number=1,
                redacted=False,
            ))
            para_idx += 1
    except Exception as exc:
        logger.warning("python-docx extraction failed for %s: %s", file_path, exc)
        return ([], 0.0, "none")

    pages.append(Page(page_number=1, width=None, height=None, blocks=blocks))
    return (pages, 1.0, "python-docx")


def _extract_plain(file_path: Path) -> tuple[list[Page], float, str]:
    """Extract text from plain text / markdown / HTML files.

    Returns: (pages, confidence, ocr_engine)
    """
    try:
        text = file_path.read_text(encoding="utf-8", errors="replace")
    except Exception as exc:
        logger.warning("Plain text read failed for %s: %s", file_path, exc)
        return ([], 0.0, "none")

    # Split by form feed (page separator) or treat as single page
    page_texts = text.split("\f") if "\f" in text else [text]
    pages: list[Page] = []

    for page_idx, page_text in enumerate(page_texts):
        page_number = page_idx + 1
        blocks: list[Block] = []
        # Split by double newline into paragraphs
        for para in page_text.split("\n\n"):
            clean = para.strip()
            if not clean:
                continue
            blocks.append(Block(
                text=clean,
                bbox=None,
                block_type="paragraph",
                page_number=page_number,
                redacted=False,
            ))
        pages.append(Page(page_number=page_number, blocks=blocks))

    return (pages, 1.0, "plain-text")


# -- Main intake function ---------------------------------------------------

def _try_ocr_for_page(
    pdf_path: Path,
    page_index: int,
    page_number: int,
) -> Any:
    """Attempt to OCR a specific PDF page using the configured OCR engine.

    Returns OCRResult on success, None on failure.
    """
    try:
        ocr = _get_ocr_engine()
        results = ocr.ocr_pdf(pdf_path, pages=[page_number])
        return results[0] if results else None
    except Exception as exc:
        logger.warning("OCR failed for page %d: %s", page_number, exc)
        return None


def intake_document(
    file_path: str | Path,
    working_dir: str | Path | None = None,
    enable_ocr: bool = True,
) -> IntakeResult:
    """Run the full intake pipeline on a single document.

    Args:
        file_path: Path to the source file.
        working_dir: Directory to save artifacts. Defaults to a
            ``working/`` subdirectory next to the source file.
        enable_ocr: Whether to automatically OCR scanned pages.

    Returns:
        IntakeResult with LDIR, report, markdown, and semantic data.
    """
    src = Path(file_path).resolve()
    if not src.exists():
        raise FileNotFoundError(f"Source file not found: {src}")

    ext = src.suffix.lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise ValueError(
            f"Unsupported file type: {ext}. "
            f"Supported: {sorted(SUPPORTED_EXTENSIONS)}",
        )

    # Determine working directory
    if working_dir:
        work_dir = Path(working_dir).resolve()
    else:
        work_dir = src.parent / "working"

    # Compute source hash
    source_hash = compute_source_hash(src)
    doc_id = src.stem

    # Extract text and pages
    warnings: list[str] = []
    recommendations: list[str] = []
    ocr_engine = "none"
    ocr_confidence = 1.0
    used_ocr = False

    if ext == ".pdf":
        pages, ocr_confidence, ocr_engine, used_ocr = _extract_pdf(src, enable_ocr=enable_ocr)
        if used_ocr:
            warnings.append("部分页面疑似扫描件，需要 OCR 处理")
            recommendations.append("建议对扫描页面执行 OCR 以提取文本内容")
        if not pages:
            warnings.append("PDF 文本提取失败，可能为纯图片 PDF")
            recommendations.append("建议使用 OCR 引擎处理")
    elif ext in (".docx", ".doc"):
        pages, ocr_confidence, ocr_engine = _extract_docx(src)
        if not pages:
            warnings.append("DOCX 文本提取失败")
            recommendations.append("检查文件是否损坏或受密码保护")
    else:
        pages, ocr_confidence, ocr_engine = _extract_plain(src)

    # Build full text for doc_type inference
    full_text = "\n\n".join(
        block.text for page in pages for block in page.blocks
    )

    # Infer document type
    type_result: DocTypeResult = infer_doc_type(full_text)

    # Build LDIR document
    ldir = LDIRDocument(
        doc_id=doc_id,
        source_file=str(src),
        source_hash=source_hash,
        parser={
            "engine": "aiarb-intake",
            "ocr_engine": ocr_engine,
            "version": "0.2-aiarb",
        },
        pages=pages,
        doc_type=type_result.doc_type,
        doc_type_confidence=type_result.confidence,
        created_at=datetime.now().isoformat(),
    )

    # Build markdown (human-readable)
    md_lines = [
        f"# {doc_id}",
        f"",
        f"> 来源文件: `{src.name}` | 类型: {doc_type_label(type_result.doc_type)} "
        f"| 置信度: {type_result.confidence:.0%} | 页数: {len(pages)}",
        f"> 来源哈希: `{source_hash[:16]}…`",
        "",
    ]
    for page in pages:
        md_lines.append(f"\n## 第 {page.page_number} 页\n")
        for block in page.blocks:
            if block.block_type == "heading":
                md_lines.append(f"### {block.text}")
            elif block.block_type == "ocr_needed":
                md_lines.append(f"> ⚠️ {block.text}")
            else:
                md_lines.append(block.text)
        md_lines.append("")
    markdown = "\n".join(md_lines)

    # Build semantic metadata (deep: chunks + entities + clause tree)
    semantic_result = build_semantic_layer(
        ldir_doc=ldir.to_dict(),
        doc_id=doc_id,
        doc_type=type_result.doc_type,
        doc_type_confidence=type_result.confidence,
    )
    semantic = semantic_result.to_dict()
    # Also keep the shallow fields for backward compatibility
    semantic.setdefault("matched_keywords", [
        {"keyword": kw, "doc_type": dt, "count": c}
        for kw, dt, c in type_result.matched_keywords
    ])
    semantic["page_count"] = len(pages)
    semantic["char_count"] = len(full_text)
    semantic["block_count"] = sum(len(p.blocks) for p in pages)
    semantic["ocr_engine"] = ocr_engine
    semantic["ocr_confidence"] = ocr_confidence

    # Build intake report
    human_review = (
        ocr_confidence < OCR_CONFIDENCE_THRESHOLD
        or type_result.confidence < 0.4
        or used_ocr
    )
    if type_result.confidence < 0.4 and type_result.doc_type != "other":
        recommendations.append(
            f"文档类型识别置信度较低 ({type_result.confidence:.0%})，"
            "建议人工复核"
        )
    if type_result.doc_type == "other":
        recommendations.append("未识别出文档类型，建议人工标注")

    report = IntakeReport(
        file_name=src.name,
        file_type=ext,
        source_hash=source_hash,
        parser_engine="aiarb-intake",
        ocr_engine=ocr_engine,
        ocr_confidence=ocr_confidence,
        page_count=len(pages),
        block_count=sum(len(p.blocks) for p in pages),
        char_count=len(full_text),
        doc_type=type_result.doc_type,
        doc_type_confidence=type_result.confidence,
        human_review_recommended=human_review,
        warnings=warnings,
        recommendations=recommendations,
    )

    result = IntakeResult(
        ldir=ldir,
        report=report,
        markdown=markdown,
        semantic=semantic,
        working_dir=work_dir,
    )

    return result


__all__ = [
    "IntakeReport",
    "IntakeResult",
    "SUPPORTED_EXTENSIONS",
    "OCR_CONFIDENCE_THRESHOLD",
    "intake_document",
    "_extract_pdf",
    "_try_ocr_for_page",
]
