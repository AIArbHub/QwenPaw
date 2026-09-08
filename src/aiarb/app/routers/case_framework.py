# -*- coding: utf-8 -*-
"""Case framework API — exposes 8 case analysis tools as REST endpoints.

Endpoints:
  POST /case-framework/identify          — identify case type from text
  GET  /case-framework/types             — list all case types
  POST /case-framework/checklist         — generate review checklist
  POST /case-framework/dual-perspective  — dual perspective analysis
  POST /case-framework/qa                — legal Q&A consultation
  POST /case-framework/analyze-award     — analyze award document
  POST /case-framework/extract-materials — extract key info from materials
  POST /case-framework/graph             — generate case graph (Mermaid)
  POST /case-framework/gaps-advice       — identify gaps & match advice
  GET  /case-framework/stats             — database statistics
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Optional

from fastapi import APIRouter, Body, HTTPException, Request
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/case-framework", tags=["case-framework"])


# ── Pydantic models ─────────────────────────────────────────────────────


class IdentifyRequest(BaseModel):
    query: str = Field(..., description="Case description or question text")
    top_k: int = Field(default=3, ge=1, le=10)


class ChecklistRequest(BaseModel):
    case_type: str = Field(..., description="Case type name (e.g. 民间借贷)")
    perspective: str = Field(
        default="neutral",
        description="applicant / respondent / neutral",
    )


class DualPerspectiveRequest(BaseModel):
    case_type: str = Field(...)
    materials_summary: str = Field(default="")


class QARequest(BaseModel):
    question: str = Field(...)
    context: Optional[str] = Field(default=None)


class AnalyzeAwardRequest(BaseModel):
    document_text: str = Field(...)
    case_type: Optional[str] = Field(default=None)


class ExtractMaterialsRequest(BaseModel):
    materials_text: str = Field(...)
    file_names: Optional[str] = Field(default=None)


class GraphRequest(BaseModel):
    case_type: str = Field(...)
    graph_type: str = Field(
        default="knowledge_graph",
        description="knowledge_graph / mindmap / flowchart",
    )


class GapsAdviceRequest(BaseModel):
    case_type: str = Field(...)
    existing_evidence: str = Field(
        ..., description='JSON array, e.g. [{"name":"借条"}]'
    )
    party: str = Field(default="applicant")


# ── Helper ───────────────────────────────────────────────────────────────


def _extract_text(chunk: Any) -> str:
    """Extract text from a ToolChunk result."""
    if hasattr(chunk, "content") and chunk.content:
        for block in chunk.content:
            if hasattr(block, "text"):
                return block.text
    return str(chunk)


async def _run_tool(tool_fn, *args, **kwargs) -> dict[str, Any]:
    """Run an async tool function and return its text output."""
    try:
        result = await tool_fn(*args, **kwargs)
        text = _extract_text(result)
        return {"success": True, "result": text}
    except Exception as exc:
        logger.error("Tool %s failed: %s", tool_fn.__name__, exc, exc_info=True)
        return {"success": False, "error": str(exc)}


# ── Endpoints ────────────────────────────────────────────────────────────


@router.get("/stats")
async def get_stats() -> dict[str, Any]:
    """Return case framework database statistics."""
    from aiarb.agents.tools.case_framework_db import get_case_framework_db

    db = get_case_framework_db()
    return db.get_statistics()


@router.get("/types")
async def list_case_types() -> list[dict[str, Any]]:
    """List all case types in the framework database."""
    from aiarb.agents.tools.case_framework_db import get_case_framework_db

    db = get_case_framework_db()
    return db.get_all_case_types()


@router.post("/identify")
async def identify_case_type(req: IdentifyRequest) -> dict[str, Any]:
    """Identify case type from user query text."""
    from aiarb.agents.tools.case_framework_tools import identify_case_type

    result = await identify_case_type(req.query, top_k=req.top_k)
    return {"success": True, "result": _extract_text(result)}


@router.post("/checklist")
async def generate_checklist(req: ChecklistRequest) -> dict[str, Any]:
    """Generate six-stage review checklist for a case type."""
    from aiarb.agents.tools.case_framework_tools import generate_review_checklist

    result = await generate_review_checklist(req.case_type, req.perspective)
    return {"success": True, "result": _extract_text(result)}


@router.post("/dual-perspective")
async def dual_perspective(req: DualPerspectiveRequest) -> dict[str, Any]:
    """Run dual perspective analysis (applicant vs respondent)."""
    from aiarb.agents.tools.case_framework_tools import dual_perspective_analysis

    result = await dual_perspective_analysis(
        req.case_type, req.materials_summary
    )
    return {"success": True, "result": _extract_text(result)}


@router.post("/qa")
async def legal_qa(req: QARequest) -> dict[str, Any]:
    """Legal Q&A consultation."""
    from aiarb.agents.tools.case_framework_tools import legal_qa_consultation

    result = await legal_qa_consultation(req.question, req.context)
    return {"success": True, "result": _extract_text(result)}


@router.post("/analyze-award")
async def analyze_award(req: AnalyzeAwardRequest) -> dict[str, Any]:
    """Analyze an arbitration award document."""
    from aiarb.agents.tools.case_analysis_tools import analyze_award_document

    result = await analyze_award_document(req.document_text, req.case_type)
    return {"success": True, "result": _extract_text(result)}


@router.post("/extract-materials")
async def extract_materials(req: ExtractMaterialsRequest) -> dict[str, Any]:
    """Extract key information from case materials text."""
    from aiarb.agents.tools.case_analysis_tools import extract_case_materials

    result = await extract_case_materials(req.materials_text, req.file_names)
    return {"success": True, "result": _extract_text(result)}


@router.post("/graph")
async def generate_graph(req: GraphRequest) -> dict[str, Any]:
    """Generate a Mermaid case graph."""
    from aiarb.agents.tools.case_analysis_tools import generate_case_graph

    result = await generate_case_graph(req.case_type, req.graph_type)
    return {"success": True, "result": _extract_text(result)}


@router.post("/gaps-advice")
async def gaps_and_advice(req: GapsAdviceRequest) -> dict[str, Any]:
    """Identify missing evidence and match reinforcement advice."""
    from aiarb.agents.tools.case_analysis_tools import identify_gaps_and_advice

    result = await identify_gaps_and_advice(
        req.case_type, req.existing_evidence, req.party
    )
    return {"success": True, "result": _extract_text(result)}
