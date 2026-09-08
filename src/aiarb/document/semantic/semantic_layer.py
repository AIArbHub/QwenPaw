# -*- coding: utf-8 -*-
"""Semantic Layer — integrates chunker, clause_parser, entity_extractor.

Builds a complete semantic layer for a legal document, producing the full
content of the *.semantic.json artifact.

The semantic layer combines:
1. Semantic chunks (chunker) — document segmentation by clause/paragraph
2. Clause tree (clause_parser) — hierarchical structure of legal articles
3. Legal entities (entity_extractor) — parties, agents, amounts, dates, citations
4. Document type info (from doc_type.py) — passed through from intake

All functions are pure — no I/O, no side effects.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional

from .chunker import SemanticChunker, SemanticChunk
from .clause_parser import ClauseParser, ClauseNode, ClauseReference
from .entity_extractor import LegalEntityExtractor, LegalEntity


@dataclass
class SemanticLayerResult:
    """Complete result of semantic layer analysis.

    Contains all semantic data that goes into *.semantic.json:
    - doc_id: Document identifier
    - doc_type: Document type (from doc_type inference)
    - doc_type_confidence: Confidence of type detection
    - chunks: Semantic chunks
    - clause_tree: Hierarchical clause tree
    - entities: Legal entities
    - clause_references: Inline clause references found in text
    - conditions: Condition sentences extracted from text
    - statistics: Aggregate statistics
    """
    doc_id: str = ""
    doc_type: str = ""
    doc_type_confidence: float = 0.0
    chunks: list[SemanticChunk] = field(default_factory=list)
    clause_tree: list[ClauseNode] = field(default_factory=list)
    entities: list[LegalEntity] = field(default_factory=list)
    clause_references: list[ClauseReference] = field(default_factory=list)
    conditions: list[str] = field(default_factory=list)
    statistics: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Serialize to a JSON-compatible dict (the *.semantic.json content)."""
        return {
            "doc_id": self.doc_id,
            "doc_type": self.doc_type,
            "doc_type_confidence": self.doc_type_confidence,
            "chunk_count": len(self.chunks),
            "entity_count": len(self.entities),
            "clause_ref_count": len(self.clause_references),
            "chunks": [
                {
                    "chunk_id": c.chunk_id,
                    "page_number": c.page_number,
                    "block_range": list(c.block_range),
                    "text": c.text[:300] + "..." if len(c.text) > 300 else c.text,
                    "chunk_type": c.chunk_type,
                    "clause_ref": c.clause_ref,
                }
                for c in self.chunks
            ],
            "clause_tree": [n.to_dict() for n in self.clause_tree],
            "entities": [e.to_dict() for e in self.entities],
            "clause_references": [r.to_dict() for r in self.clause_references],
            "conditions": self.conditions,
            "statistics": self.statistics,
        }


def build_semantic_layer(
    ldir_doc: dict[str, Any],
    doc_id: str = "",
    doc_type: str = "",
    doc_type_confidence: float = 0.0,
    use_llm: bool = False,
    model_router: Optional[Any] = None,
) -> SemanticLayerResult:
    """Build a complete semantic layer for a legal document.

    This function integrates chunker, clause_parser, and entity_extractor
    to produce the full *.semantic.json content.

    Args:
        ldir_doc: LDIR document dict (with "pages" containing "blocks").
        doc_id: Document identifier.
        doc_type: Document type (from doc_type inference).
        doc_type_confidence: Confidence of type detection.
        use_llm: Whether to use LLM enhancement for entity extraction.
        model_router: Optional model router for LLM enhancement.

    Returns:
        SemanticLayerResult with all semantic data.

    Pure function — no I/O, no side effects.
    """
    pages = ldir_doc.get("pages", [])
    full_text = "\n\n".join(
        block.get("text", "")
        for page in pages
        for block in page.get("blocks", [])
    )

    # 1. Semantic chunking
    chunker = SemanticChunker()
    chunks = chunker.chunk(pages)

    # 2. Build clause tree from chunks
    clause_parser = ClauseParser()
    chunk_dicts = [
        {
            "text": c.text,
            "chunk_type": c.chunk_type,
            "page_number": c.page_number,
        }
        for c in chunks
    ]
    clause_tree = clause_parser.build_clause_tree(chunk_dicts)

    # 3. Extract legal entities
    extractor = LegalEntityExtractor(model_router=model_router)
    entities = extractor.extract(full_text, use_llm=use_llm)

    # 4. Extract inline clause references
    clause_refs = clause_parser.extract_references(full_text)

    # 5. Extract condition sentences
    conditions = clause_parser.extract_conditions(full_text)

    # 6. Build statistics
    # Entity type distribution
    entity_type_counts: dict[str, int] = {}
    for e in entities:
        entity_type_counts[e.type] = entity_type_counts.get(e.type, 0) + 1

    # Chunk type distribution
    chunk_type_counts: dict[str, int] = {}
    for c in chunks:
        chunk_type_counts[c.chunk_type] = chunk_type_counts.get(c.chunk_type, 0) + 1

    # Clause tree depth
    def tree_depth(nodes: list[ClauseNode]) -> int:
        if not nodes:
            return 0
        return 1 + max(
            (tree_depth(n.children) for n in nodes),
            default=0,
        )

    statistics = {
        "total_chunks": len(chunks),
        "total_entities": len(entities),
        "total_clause_refs": len(clause_refs),
        "total_conditions": len(conditions),
        "clause_tree_depth": tree_depth(clause_tree),
        "clause_tree_nodes": len(clause_tree),
        "entity_type_distribution": entity_type_counts,
        "chunk_type_distribution": chunk_type_counts,
        "has_article_structure": any(
            n.node_type == "article" for n in clause_tree
        ),
        "has_chapter_structure": any(
            n.node_type == "chapter" for n in clause_tree
        ),
    }

    return SemanticLayerResult(
        doc_id=doc_id,
        doc_type=doc_type,
        doc_type_confidence=doc_type_confidence,
        chunks=chunks,
        clause_tree=clause_tree,
        entities=entities,
        clause_references=clause_refs,
        conditions=conditions,
        statistics=statistics,
    )


__all__ = [
    "SemanticLayerResult",
    "build_semantic_layer",
]
