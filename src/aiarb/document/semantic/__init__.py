# -*- coding: utf-8 -*-
"""AIArb Document Semantic Layer.

Provides deep semantic analysis on top of LDIR structure:
- chunker: semantic chunking (by clause / paragraph / natural boundary)
- clause_parser: legal article/clause/item numbering parser
- entity_extractor: legal entity extraction (parties, agents, amounts, dates, citations)
- semantic_layer: integrates the above three, produces *.semantic.json content

All functions in strategy modules are pure — no I/O, no side effects.
"""

from .chunker import SemanticChunker, SemanticChunk
from .clause_parser import ClauseParser, ClauseNode, ClauseReference
from .entity_extractor import LegalEntityExtractor, LegalEntity
from .semantic_layer import build_semantic_layer, SemanticLayerResult

__all__ = [
    "SemanticChunker",
    "SemanticChunk",
    "ClauseParser",
    "ClauseNode",
    "ClauseReference",
    "LegalEntityExtractor",
    "LegalEntity",
    "build_semantic_layer",
    "SemanticLayerResult",
]
