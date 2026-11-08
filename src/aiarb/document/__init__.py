# -*- coding: utf-8 -*-
"""AIArb Document Pipeline — LDIR (Legal Document Intermediate Representation)

This package provides a lightweight document IR that carries:
- page / block / span structure with position info (bbox)
- confidence scores from OCR / parsing
- source hash for provenance tracking
- semantic metadata (doc_type with arbitration-specific types)

Modules:
    ldir.py       — LDIR data model (Block, Page, Span, LDIRDocument)
    doc_type.py   — Document type inference (with arbitration_award, etc.)
    intake.py     — Full intake pipeline (file → text → LDIR → 4 artifacts)

Workspace convention (matching LegalWork):
    matter/
      raw/        — original files (never modified)
      working/    — intake artifacts (*.md, *.ldir.json, *.semantic.json, *_intake_report.json)

Usage:
    from aiarb.document import intake_document

    result = intake_document("path/to/裁决书.pdf")
    result.save_all()  # saves all 4 artifacts to working/

    print(result.ldir.doc_type)           # "arbitration_award"
    print(result.report.human_review_recommended)  # True/False
    print(result.ldir.get_all_text())     # plain text with positions
"""

from .ldir import (
    Block,
    LDIRDocument,
    Page,
    Span,
    compute_source_hash,
)
from .doc_type import (
    ARBITRATION_AWARD,
    ARBITRATION_APPLICATION,
    ARBITRATION_COUNTERCLAIM,
    ARBITRATION_DEFENSE,
    ARBITRATION_INTERIM,
    ARBITRATION_RULING,
    CONTRACT,
    COURT_JUDGMENT,
    COURT_RULING,
    DocTypeResult,
    EVIDENCE,
    LEGAL_OPINION,
    OTHER,
    doc_type_label,
    infer_doc_type,
    is_arbitration_doc,
)
from .intake import (
    IntakeReport,
    IntakeResult,
    SUPPORTED_EXTENSIONS,
    intake_document,
)
from .semantic.semantic_layer import build_semantic_layer, SemanticLayerResult
from .semantic.chunker import SemanticChunker, SemanticChunk
from .semantic.clause_parser import ClauseParser, ClauseNode, ClauseReference
from .semantic.entity_extractor import LegalEntityExtractor, LegalEntity

__all__ = [
    # LDIR model
    "Block",
    "LDIRDocument",
    "Page",
    "Span",
    "compute_source_hash",
    # Doc types
    "ARBITRATION_AWARD",
    "ARBITRATION_APPLICATION",
    "ARBITRATION_COUNTERCLAIM",
    "ARBITRATION_DEFENSE",
    "ARBITRATION_INTERIM",
    "ARBITRATION_RULING",
    "CONTRACT",
    "COURT_JUDGMENT",
    "COURT_RULING",
    "DocTypeResult",
    "EVIDENCE",
    "LEGAL_OPINION",
    "OTHER",
    "doc_type_label",
    "infer_doc_type",
    "is_arbitration_doc",
    # Intake
    "IntakeReport",
    "IntakeResult",
    "SUPPORTED_EXTENSIONS",
    "intake_document",
    # Semantic layer
    "build_semantic_layer",
    "SemanticLayerResult",
    "SemanticChunker",
    "SemanticChunk",
    "ClauseParser",
    "ClauseNode",
    "ClauseReference",
    "LegalEntityExtractor",
    "LegalEntity",
]
