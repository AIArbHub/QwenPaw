# -*- coding: utf-8 -*-
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ...wiki.engine import ingest, query, read_page, lint, future
from ...wiki.models import WikiPage

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/wiki", tags=["wiki"])


class IngestRequest(BaseModel):
    doc_ids: list[str] = Field(default_factory=list, description="Document IDs to ingest; empty = all")
    case_ids: list[str] = Field(default_factory=list, description="Case IDs to ingest; empty = none")
    page_type: str = Field(default="auto", description="auto / concept / case / comparison / synthesis")
    force: bool = Field(default=False, description="Force re-ingest already compiled pages")


class LintRequest(BaseModel):
    fix: bool = Field(default=False, description="Automatically fix issues")


class FutureRequest(BaseModel):
    doc_ids: list[str] = Field(default_factory=list, description="Document IDs to generate QA for")
    page_paths: list[str] = Field(default_factory=list, description="Wiki page paths to generate QA for")


@router.post("/ingest")
async def wiki_ingest(body: IngestRequest = None):
    body = body or IngestRequest()
    result = await ingest(
        doc_ids=body.doc_ids or None,
        case_ids=body.case_ids or None,
        page_type=body.page_type,
        force=body.force,
    )
    return result


@router.get("/pages")
async def wiki_list_pages(
    keyword: str = "",
    page_type: str = "",
    source_doc_id: str = "",
    source_case_id: str = "",
):
    pages = await query(
        keyword=keyword,
        page_type=page_type,
        source_doc_id=source_doc_id,
        source_case_id=source_case_id,
    )
    return {"pages": [p.model_dump() for p in pages], "total": len(pages)}


@router.get("/pages/{page_path:path}")
async def wiki_read_page(page_path: str):
    try:
        content = await read_page(page_path)
        return {"path": page_path, "content": content}
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Wiki page not found")


@router.post("/lint")
async def wiki_lint(body: LintRequest = None):
    body = body or LintRequest()
    result = await lint(fix=body.fix)
    return result


@router.post("/future")
async def wiki_future(body: FutureRequest = None):
    body = body or FutureRequest()
    result = await future(
        doc_ids=body.doc_ids or None,
        page_paths=body.page_paths or None,
    )
    return result