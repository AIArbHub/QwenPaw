# -*- coding: utf-8 -*-
"""评分反馈 REST API 路由。"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from .models import FeedbackCreate
from .service import FeedbackService


def create_feedback_router() -> APIRouter:
    """创建评分反馈 API 路由。"""
    router = APIRouter()
    _svc = FeedbackService()

    @router.post("/feedback")
    async def create_feedback(request: FeedbackCreate) -> dict:
        """创建评分反馈。"""
        result = await _svc.add_feedback(request)
        return result

    @router.get("/feedback")
    async def list_feedback(
        agent_id: str | None = Query(None),
        limit: int = Query(100, ge=1, le=500),
    ) -> dict:
        """列出评分反馈。"""
        data = await _svc.list_feedback(agent_id=agent_id, limit=limit)
        return {"feedbacks": data}

    @router.get("/feedback/summary/{agent_id}")
    async def get_summary(agent_id: str) -> dict:
        """获取 Agent 评分汇总。"""
        return await _svc.get_summary(agent_id)

    @router.delete("/feedback/{feedback_id}")
    async def delete_feedback(feedback_id: str) -> dict:
        """删除评分反馈。"""
        success = await _svc.delete_feedback(feedback_id)
        if not success:
            raise HTTPException(
                status_code=404,
                detail="反馈不存在或删除失败",
            )
        return {"success": True}

    return router
