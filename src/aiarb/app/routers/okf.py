# -*- coding: utf-8 -*-
"""API router for the OKF (Open Knowledge Format) knowledge base.

Endpoints:
- ``GET    /okf/documents``           — List all OKF documents
- ``GET    /okf/documents/{doc_id}``  — Get document with sections/buckets
- ``POST   /okf/documents``           — Ingest document content into OKF
- ``DELETE /okf/documents/{doc_id}``  — Delete an OKF document
- ``POST   /okf/search``              — Dual-route search
- ``POST   /okf/buckets/generate``    — Generate buckets via LLM
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Body, HTTPException
from pydantic import BaseModel, Field

from ...knowledge.okf import (
    SourceDocument,
    SourceSection,
    Bucket,
    create_source_document,
    save_okf_document,
    load_okf_document,
    list_okf_documents,
    delete_okf_document,
    dual_route_search,
    search_by_concept,
    search_by_bucket,
    generate_buckets,
    format_citations,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/okf", tags=["okf"])


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class DocumentListResponse(BaseModel):
    documents: list[dict[str, Any]]
    total: int


class DocumentResponse(BaseModel):
    document: dict[str, Any]
    sections: list[dict[str, Any]]
    buckets: list[dict[str, Any]]


class IngestRequest(BaseModel):
    content: str = Field(..., description="Document text content")
    title: str = Field(default="", description="Document title")
    source: str = Field(default="", description="File path or URL")
    file_type: str = Field(default="", description="File type (pdf/docx/md/...)")
    page_count: int = Field(default=0, description="Number of pages")
    metadata: dict[str, Any] = Field(default_factory=dict)
    generate_buckets_flag: bool = Field(default=False, description="Generate buckets via LLM")
    agent_id: str = Field(default="", description="Agent ID for LLM config")


class IngestResponse(BaseModel):
    doc_id: str
    section_count: int
    bucket_count: int
    message: str


class SearchRequest(BaseModel):
    query: str = Field(..., description="Search query")
    doc_id: str = Field(default="", description="Restrict to specific document")
    top_k: int = Field(default=5, ge=1, le=20, description="Max results")
    route: str = Field(default="dual", description="dual / concept / bucket")


class SearchResult(BaseModel):
    section_id: str
    doc_id: str
    title: str
    content: str
    score: float
    route: str


class SearchResponse(BaseModel):
    results: list[SearchResult]
    citations: list[dict[str, str]]
    total: int


class GenerateBucketsRequest(BaseModel):
    doc_id: str = Field(..., description="Document ID")
    agent_id: str = Field(default="", description="Agent ID for LLM config")


class GenerateBucketsResponse(BaseModel):
    bucket_count: int
    message: str


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/documents", response_model=DocumentListResponse)
async def api_list_documents():
    """List all OKF documents."""
    docs = list_okf_documents()
    return DocumentListResponse(
        documents=[d.to_dict() for d in docs],
        total=len(docs),
    )


@router.get("/documents/{doc_id}", response_model=DocumentResponse)
async def api_get_document(doc_id: str):
    """Get a document with its sections and buckets."""
    loaded = load_okf_document(doc_id)
    if loaded is None:
        raise HTTPException(status_code=404, detail=f"Document '{doc_id}' not found")
    doc, sections, buckets = loaded
    return DocumentResponse(
        document=doc.to_dict(),
        sections=[s.to_dict() for s in sections],
        buckets=[b.to_dict() for b in buckets],
    )


@router.post("/documents", response_model=IngestResponse)
async def api_ingest_document(req: IngestRequest):
    """Ingest document content into the OKF knowledge base."""
    if not req.content.strip():
        raise HTTPException(status_code=400, detail="Content cannot be empty")

    # Create document and sections
    doc, sections = create_source_document(
        content=req.content,
        title=req.title,
        source=req.source,
        file_type=req.file_type,
        page_count=req.page_count,
        metadata=req.metadata,
    )

    # Generate buckets if requested
    buckets: list[Bucket] = []
    if req.generate_buckets_flag:
        try:
            buckets = await generate_buckets(doc, sections, agent_id=req.agent_id or None)
        except Exception as e:
            logger.warning("Bucket generation failed (non-fatal): %s", e)

    # Save to disk
    save_okf_document(doc, sections, buckets)

    return IngestResponse(
        doc_id=doc.doc_id,
        section_count=len(sections),
        bucket_count=len(buckets),
        message="Document ingested successfully",
    )


@router.delete("/documents/{doc_id}")
async def api_delete_document(doc_id: str):
    """Delete an OKF document and all its data."""
    if not delete_okf_document(doc_id):
        raise HTTPException(status_code=404, detail=f"Document '{doc_id}' not found")
    return {"deleted": True, "doc_id": doc_id}


@router.post("/search", response_model=SearchResponse)
async def api_search(req: SearchRequest):
    """Search the OKF knowledge base using dual-route retrieval."""
    doc_id = req.doc_id or None

    if req.route == "concept":
        raw_results = search_by_concept(req.query, doc_id, req.top_k)
        results = [
            SearchResult(
                section_id=s.section_id,
                doc_id=s.doc_id,
                title=s.title,
                content=s.content[:500],
                score=score,
                route="concept",
            )
            for s, score in raw_results
        ]
    elif req.route == "bucket":
        raw_results = search_by_bucket(req.query, doc_id, req.top_k)
        results = [
            SearchResult(
                section_id=s.section_id,
                doc_id=s.doc_id,
                title=s.title,
                content=s.content[:500],
                score=score,
                route="bucket",
            )
            for s, score in raw_results
        ]
    else:
        # Dual route (default)
        raw_results = dual_route_search(req.query, doc_id, req.top_k)
        results = [SearchResult(**r) for r in raw_results]

    citations = format_citations([r.model_dump() for r in results])

    return SearchResponse(
        results=results,
        citations=citations,
        total=len(results),
    )


@router.post("/buckets/generate", response_model=GenerateBucketsResponse)
async def api_generate_buckets(req: GenerateBucketsRequest):
    """Generate or regenerate buckets for a document using LLM."""
    loaded = load_okf_document(req.doc_id)
    if loaded is None:
        raise HTTPException(status_code=404, detail=f"Document '{req.doc_id}' not found")
    doc, sections, _ = loaded

    try:
        buckets = await generate_buckets(doc, sections, agent_id=req.agent_id or None)
        save_okf_document(doc, sections, buckets)
        return GenerateBucketsResponse(
            bucket_count=len(buckets),
            message=f"Generated {len(buckets)} buckets",
        )
    except Exception as e:
        logger.error("Bucket generation failed: %s", e)
        raise HTTPException(status_code=500, detail=f"Bucket generation failed: {e}")
