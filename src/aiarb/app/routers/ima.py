# -*- coding: utf-8 -*-
"""IMA 云知识库 API 路由。

提供扫码登录、登录态查询、知识库目录浏览和统一检索接口。
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Path
from pydantic import BaseModel, Field

from ...ima.auth_manager import get_auth_manager
from ...ima.client import get_client

router = APIRouter(prefix="/ima", tags=["ima"])


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------


class IMAAuthStatus(BaseModel):
    authenticated: bool = Field(..., description="是否已登录")
    has_token: bool = Field(..., description="是否有保存的 token")


class IMAQRCodeResponse(BaseModel):
    qrcode_url: str = Field(..., description="扫码登录二维码 URL")
    session_id: str = Field(..., description="扫码会话 ID（用于轮询状态）")


class IMALoginStatusResponse(BaseModel):
    status: str = Field(
        ...,
        description="登录状态: pending | scanned | confirmed | expired",
    )
    access_token: str = Field(default="", description="登录成功后的 token")
    message: str = Field(default="", description="附加说明")


class IMAKnowledgeBase(BaseModel):
    id: str = Field(..., description="知识库 ID")
    name: str = Field(..., description="知识库名称")
    description: str = Field(default="", description="知识库描述")
    doc_count: int = Field(default=0, description="文档数量")


class IMAResearchRequest(BaseModel):
    query: str = Field(..., description="检索查询")
    top_k: int = Field(default=3, description="选库数量上限")


class IMAResearchResponse(BaseModel):
    source: str = Field(..., description="结果来源: ima | local_kb | external_mcp | none")
    answer: str = Field(default="", description="检索结果")
    sources: List[Dict[str, Any]] = Field(
        default_factory=list,
        description="来源信息列表",
    )
    selected_bases: List[str] = Field(
        default_factory=list,
        description="选中的 IMA 知识库名称",
    )
    error: Optional[str] = Field(default=None, description="错误信息")
    message: Optional[str] = Field(default=None, description="附加说明")


# ---------------------------------------------------------------------------
# Auth endpoints
# ---------------------------------------------------------------------------


@router.get(
    "/auth/status",
    response_model=IMAAuthStatus,
    summary="Check IMA login status",
)
async def get_ima_auth_status() -> IMAAuthStatus:
    """检查 IMA 登录状态。"""
    mgr = get_auth_manager()
    return IMAAuthStatus(
        authenticated=mgr.is_authenticated(),
        has_token=mgr.has_token(),
    )


@router.post(
    "/auth/qrcode",
    response_model=IMAQRCodeResponse,
    summary="Start IMA QR code login",
)
async def start_ima_qr_login() -> IMAQRCodeResponse:
    """发起扫码登录，返回二维码 URL 和 session_id。"""
    mgr = get_auth_manager()
    result = await mgr.start_qr_login()
    return IMAQRCodeResponse(
        qrcode_url=result["qrcode_url"],
        session_id=result["session_id"],
    )


@router.get(
    "/auth/poll/{session_id}",
    response_model=IMALoginStatusResponse,
    summary="Poll IMA login status",
)
async def poll_ima_login(
    session_id: str = Path(...),
) -> IMALoginStatusResponse:
    """轮询扫码登录状态。"""
    mgr = get_auth_manager()
    result = await mgr.poll_login_status(session_id)
    return IMALoginStatusResponse(
        status=str(result.get("status", "pending")),
        access_token=str(result.get("access_token", "")),
        message=str(result.get("message", "")),
    )


@router.delete(
    "/auth",
    response_model=Dict[str, str],
    summary="Clear IMA login state",
)
async def clear_ima_auth() -> Dict[str, str]:
    """清除 IMA 登录态。"""
    mgr = get_auth_manager()
    mgr.clear_token()
    return {"message": "IMA auth cleared"}


# ---------------------------------------------------------------------------
# Knowledge base endpoints
# ---------------------------------------------------------------------------


@router.get(
    "/knowledge-bases",
    response_model=List[IMAKnowledgeBase],
    summary="List IMA knowledge bases",
)
async def list_ima_knowledge_bases() -> List[IMAKnowledgeBase]:
    """读取 IMA 知识库目录元数据。"""
    client = get_client()
    bases = await client.list_knowledge_bases()
    return [
        IMAKnowledgeBase(
            id=str(b.get("id", "")),
            name=str(b.get("name", "")),
            description=str(b.get("description", "")),
            doc_count=int(b.get("doc_count", 0) or 0),
        )
        for b in bases
    ]


@router.post(
    "/research",
    response_model=IMAResearchResponse,
    summary="IMA two-level RAG research",
)
async def ima_research(
    body: IMAResearchRequest = Body(...),
) -> IMAResearchResponse:
    """执行 IMA 两级检索（读目录 → 选库 → 全文问答）。

    如果 IMA 不可用，自动降级到本地知识库或外部 MCP。
    """
    from ...ima.fallback import research_with_fallback

    result = await research_with_fallback(
        body.query,
        top_k=body.top_k,
    )
    return IMAResearchResponse(
        source=str(result.get("source", "unknown")),
        answer=str(result.get("answer", "")),
        sources=result.get("sources", []) or [],
        selected_bases=result.get("selected_bases", []) or [],
        error=result.get("error"),
        message=result.get("message"),
    )
