# -*- coding: utf-8 -*-
"""知识库 REST API 路由。"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, UploadFile, File, Form

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
        """知识库检索，返回 chunks + concepts + citations + trace。"""
        result = await _svc.search(
            query=request.query,
            top_k=request.top_k,
            knowledge_scope=request.knowledge_scope,
            filter_tags=request.filter_tags,
            agent_id=request.agent_id or None,
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

    # ── v5.0: 文件上传 ──

    @router.post("/upload")
    async def upload_document(
        file: UploadFile = File(...),
        title: str = Form(""),
        tags: str = Form(""),
        agent_id: str = Form(""),
    ) -> dict:
        """文件上传入库（FormData 方式）。

        v5.0: 新增文件上传端点，前端用 antd Upload.Dragger 调用。
        保存文件到临时路径后调用 ingest_document。
        """
        import tempfile
        import os
        import pathlib

        # 保存上传文件到临时路径
        suffix = pathlib.Path(file.filename or "upload").suffix
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            content = await file.read()
            tmp.write(content)
            tmp_path = tmp.name

        final_path = tmp_path
        try:
            # 重命名为原始文件名
            if file.filename:
                final_path = os.path.join(
                    os.path.dirname(tmp_path),
                    file.filename,
                )
                os.rename(tmp_path, final_path)

            # 调用入库
            tag_list = (
                [t.strip() for t in tags.split(",") if t.strip()]
                if tags
                else []
            )
            request = IngestRequest(
                file_path=final_path,
                title=title or pathlib.Path(file.filename or "").stem,
                tags=tag_list,
                agent_id=agent_id,
            )
            result = await _svc.ingest_document(request)
            if not result.get("success"):
                raise HTTPException(
                    status_code=400,
                    detail=result.get("error", "入库失败"),
                )
            return result
        finally:
            # 清理临时文件
            if os.path.exists(final_path):
                try:
                    os.unlink(final_path)
                except Exception:
                    pass

    return router
