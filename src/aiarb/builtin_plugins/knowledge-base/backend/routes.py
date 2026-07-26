# -*- coding: utf-8 -*-
"""知识库 REST API 路由。"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from .models import (
    IngestRequest,
    IngestTextRequest,
    SearchRequest,
    SearchResult,
)
from .service import KnowledgeBaseService


def create_kb_router() -> APIRouter:
    """创建知识库 API 路由。"""
    router = APIRouter()
    _svc = KnowledgeBaseService()

    @router.post("/ingest")
    async def ingest_document(request: IngestRequest) -> dict:
        """文档入库（通过文件路径）。"""
        result = await _svc.ingest_document(request)
        if not result.get("success"):
            raise HTTPException(
                status_code=400,
                detail=result.get("error", "入库失败"),
            )
        return result

    @router.post("/ingest-text")
    async def ingest_text(request: IngestTextRequest) -> dict:
        """直接文本入库。"""
        result = await _svc.ingest_text(request)
        if not result.get("success"):
            raise HTTPException(
                status_code=400,
                detail=result.get("error", "入库失败"),
            )
        return result

    @router.post("/search")
    async def search(
        request: SearchRequest,
    ) -> dict:
        """知识库检索，返回 chunks + concepts + citations。"""
        result = await _svc.search(
            query=request.query,
            top_k=request.top_k,
            knowledge_scope=request.knowledge_scope,
            filter_tags=request.filter_tags,
        )
        return result

    @router.get("/documents")
    async def list_documents() -> dict:
        """列出所有文档。"""
        docs = await _svc.list_documents()
        return {"documents": docs}

    @router.get("/documents/{doc_id}")
    async def get_document(doc_id: str) -> dict:
        """获取文档详情（含 OKF 概念）。"""
        doc = await _svc.get_document(doc_id)
        if doc is None:
            raise HTTPException(
                status_code=404,
                detail="文档不存在",
            )
        return doc

    @router.delete("/documents/{doc_id}")
    async def delete_document(doc_id: str) -> dict:
        """删除文档。"""
        success = await _svc.delete_document(doc_id)
        if not success:
            raise HTTPException(
                status_code=404,
                detail="文档不存在或删除失败",
            )
        return {"success": True}

    @router.get("/okf/concepts")
    async def list_okf_concepts(doc_id: str | None = None) -> dict:
        """列出 OKF 概念。"""
        concepts = await _svc.list_okf_concepts(doc_id)
        return {"concepts": concepts}

    @router.get("/okf/lint")
    async def lint_okf(doc_id: str | None = None) -> dict:
        """OKF 概念健康检查。"""
        issues = await _svc.lint_okf(doc_id)
        return {"issues": issues}

    # ── 知识自发现 ──

    @router.get("/discovery/suggestions")
    async def list_suggestions(
        status: str | None = None,
        doc_id: str | None = None,
    ) -> dict:
        """列出发现建议。"""
        suggestions = await _svc.list_discovery_suggestions(
            status=status,
            doc_id=doc_id,
        )
        return {"suggestions": suggestions}

    @router.post("/discovery/suggestions/{suggestion_id}/accept")
    async def accept_suggestion(suggestion_id: str) -> dict:
        """接受发现建议。"""
        success = await _svc.update_suggestion_status(
            suggestion_id,
            "accepted",
        )
        if not success:
            raise HTTPException(
                status_code=404,
                detail="建议不存在",
            )
        return {"success": True, "status": "accepted"}

    @router.post("/discovery/suggestions/{suggestion_id}/reject")
    async def reject_suggestion(suggestion_id: str) -> dict:
        """拒绝发现建议。"""
        success = await _svc.update_suggestion_status(
            suggestion_id,
            "rejected",
        )
        if not success:
            raise HTTPException(
                status_code=404,
                detail="建议不存在",
            )
        return {"success": True, "status": "rejected"}

    return router
