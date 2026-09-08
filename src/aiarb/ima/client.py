# -*- coding: utf-8 -*-
"""IMA 云知识库 API 客户端 — 目录读取、选库 RAG、全文检索。

两级检索架构：
1. **目录级 RAG**：读取 IMA 知识库目录元数据，用轻量语义匹配选出最
   相关的知识库（不下载全文、不建立第二套全文索引）。
2. **全文问答**：将选中知识库的 ID 传给 IMA 的问答接口，由 IMA 在
   云端执行全文检索与生成，返回结构化结果。
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from .auth_manager import get_auth_manager

logger = logging.getLogger(__name__)

_IMA_API_BASE = "https://web-api.imabot.qq.com"
_TIMEOUT = 30


class IMAClient:
    """IMA 云知识库 API 客户端。"""

    @property
    def _headers(self) -> dict[str, str]:
        """构造请求头，携带已认证的 access_token。"""
        token = get_auth_manager().get_access_token()
        headers = {
            "Content-Type": "application/json",
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36"
            ),
        }
        if token:
            headers["Authorization"] = f"Bearer {token}"
        return headers

    # -------------------------------------------------------- 目录读取

    async def list_knowledge_bases(self) -> list[dict[str, Any]]:
        """读取 IMA 知识库目录元数据。

        返回每个知识库的 ``id``、``name``、``description``、
        ``doc_count`` 等元数据，不下载任何全文。
        """
        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
                resp = await client.get(
                    f"{_IMA_API_BASE}/v1/knowledge/bases",
                    headers=self._headers,
                )
                resp.raise_for_status()
                data = resp.json()
        except httpx.HTTPStatusError as exc:
            logger.warning("IMA list_knowledge_bases HTTP error: %s", exc)
            raise
        except Exception as exc:
            logger.warning("IMA list_knowledge_bases failed: %s", exc)
            raise

        bases = data.get("bases") or data.get("data") or []
        if isinstance(bases, dict):
            bases = list(bases.values())
        return bases if isinstance(bases, list) else []

    # -------------------------------------------------- 目录级选库 RAG

    async def select_bases_by_query(
        self,
        query: str,
        top_k: int = 3,
    ) -> list[dict[str, Any]]:
        """轻量目录级 RAG：用查询语义匹配知识库元数据选库。

        不调用 IMA 的全文检索——仅对本地目录元数据做关键词匹配
        和简易语义打分，选出最相关的 N 个知识库。
        """
        bases = await self.list_knowledge_bases()
        if not bases:
            return []

        query_lower = query.lower().strip()
        query_terms = set(query_lower.split())

        scored: list[tuple[float, dict[str, Any]]] = []
        for base in bases:
            name = str(base.get("name", "")).lower()
            desc = str(base.get("description", "")).lower()
            tags = " ".join(base.get("tags", []) or []).lower()

            # 关键词匹配打分
            score = 0.0
            for term in query_terms:
                if term in name:
                    score += 3.0
                if term in desc:
                    score += 1.5
                if term in tags:
                    score += 2.0

            # 全查询子串匹配加分
            if query_lower in name:
                score += 5.0
            if query_lower in desc:
                score += 2.0

            # 无匹配但无其他候选时也保留（兜底）
            if score > 0 or len(bases) <= top_k:
                scored.append((score, base))

        # 按分数降序排列，取 top_k
        scored.sort(key=lambda x: x[0], reverse=True)
        return [base for _, base in scored[:top_k]]

    # -------------------------------------------------- 全文问答

    async def ask(
        self,
        query: str,
        base_ids: list[str] | None = None,
    ) -> dict[str, Any]:
        """对选中的知识库执行全文问答。

        Args:
            query: 用户问题
            base_ids: 选中的知识库 ID 列表。None 表示搜索全部。

        Returns:
            ``{"answer": str, "sources": list[dict], "usage": dict}``
        """
        payload: dict[str, Any] = {
            "query": query,
            "mode": "knowledge",
        }
        if base_ids:
            payload["knowledge_base_ids"] = base_ids

        try:
            async with httpx.AsyncClient(timeout=60) as client:
                resp = await client.post(
                    f"{_IMA_API_BASE}/v1/ask",
                    headers=self._headers,
                    json=payload,
                )
                resp.raise_for_status()
                data = resp.json()
        except httpx.HTTPStatusError as exc:
            logger.warning("IMA ask HTTP error: %s", exc)
            raise
        except Exception as exc:
            logger.warning("IMA ask failed: %s", exc)
            raise

        return {
            "answer": str(data.get("answer", "")),
            "sources": data.get("sources", []) or [],
            "usage": data.get("usage", {}) or {},
        }

    # -------------------------------------------------- 统一检索

    async def research(
        self,
        query: str,
        top_k: int = 3,
    ) -> dict[str, Any]:
        """统一入口：读目录 → 自动选库 → 全文问答。

        一次调用完成两级检索，返回答案与来源。
        """
        # 第一级：目录级 RAG 选库
        selected = await self.select_bases_by_query(query, top_k=top_k)
        selected_ids = [
            str(b.get("id", ""))
            for b in selected
            if b.get("id")
        ]
        selected_names = [
            str(b.get("name", ""))
            for b in selected
            if b.get("name")
        ]

        if not selected_ids:
            return {
                "answer": "",
                "sources": [],
                "error": "no_knowledge_base_selected",
                "message": "IMA 目录中没有匹配的知识库",
            }

        # 第二级：对选中库执行全文问答
        result = await self.ask(query, base_ids=selected_ids)
        result["selected_bases"] = selected_names
        return result


# 全局单例
_client: IMAClient | None = None


def get_client() -> IMAClient:
    """返回全局 IMA 客户端单例。"""
    global _client
    if _client is None:
        _client = IMAClient()
    return _client
