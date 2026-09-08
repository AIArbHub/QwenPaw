# -*- coding: utf-8 -*-
"""IMA 不可用时的自动降级链。

降级顺序：
1. IMA 云知识库（首选）
2. 本地知识库 (search_knowledge 工具)
3. 外部法源（元典 MCP / 北大法宝 MCP，如果已配置且可用）

降级触发条件：
- IMA 未登录 / token 过期
- IMA API 调用失败（网络错误、超时、HTTP 非 2xx）
- IMA 返回空结果（无匹配知识库）
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


async def research_with_fallback(
    query: str,
    *,
    top_k: int = 3,
) -> dict[str, Any]:
    """执行 IMA 检索，不可用时自动降级。

    Returns:
        ``{
            "source": "ima" | "local_kb" | "external_mcp" | "none",
            "answer": str,
            "sources": list[dict],
            "error"?: str,
            "fallback_reason"?: str,
        }``
    """
    # 尝试 IMA
    try:
        from .auth_manager import get_auth_manager
        from .client import get_client

        auth = get_auth_manager()
        if not auth.is_authenticated():
            raise RuntimeError("IMA not authenticated")

        client = get_client()
        result = await client.research(query, top_k=top_k)

        if result.get("error") == "no_knowledge_base_selected":
            # IMA 目录无匹配，降级
            logger.info(
                "IMA returned no matching knowledge base for query: %s, "
                "falling back to local KB",
                query,
            )
        elif result.get("answer"):
            result["source"] = "ima"
            return result
        else:
            logger.info(
                "IMA returned empty answer for query: %s, falling back",
                query,
            )
    except Exception as exc:
        logger.info("IMA research failed, falling back: %s", exc)

    # 降级到本地知识库
    try:
        local_result = await _search_local_kb(query)
        if local_result.get("answer"):
            local_result["source"] = "local_kb"
            local_result["fallback_reason"] = "IMA unavailable"
            return local_result
    except Exception as exc:
        logger.warning("Local KB fallback failed: %s", exc)

    # 降级到外部 MCP（元典/北大法宝）
    try:
        mcp_result = await _search_external_mcp(query)
        if mcp_result.get("answer"):
            mcp_result["source"] = "external_mcp"
            mcp_result["fallback_reason"] = "IMA and local KB unavailable"
            return mcp_result
    except Exception as exc:
        logger.warning("External MCP fallback failed: %s", exc)

    return {
        "source": "none",
        "answer": "",
        "sources": [],
        "error": "all_sources_failed",
        "message": "IMA、本地知识库和外部 MCP 均不可用",
    }


async def _search_local_kb(query: str) -> dict[str, Any]:
    """在本地知识库中检索。"""
    import asyncio
    import re
    import threading

    from ..agents.tools.file_search import (
        _compile_search_pattern,
        _walk_and_grep,
    )
    from ..knowledge import get_knowledge_dirs

    roots = get_knowledge_dirs()
    if not roots:
        return {"answer": "", "sources": []}

    regex = _compile_search_pattern(query, False, re.IGNORECASE)
    cancel = threading.Event()
    all_matches: list[str] = []
    total_chars = 0
    max_chars = 50_000

    for root in roots:
        if cancel.is_set():
            break
        try:
            matches, _status = await asyncio.to_thread(
                _walk_and_grep,
                root,
                regex,
                0,
                cancel,
                None,
                True,  # show_file
            )
        except Exception:
            continue
        for line in matches:
            if total_chars + len(line) + 1 > max_chars:
                break
            all_matches.append(line)
            total_chars += len(line) + 1

    if not all_matches:
        return {"answer": "", "sources": []}

    return {
        "answer": "\n".join(all_matches[:200]),
        "sources": [{"type": "local_kb", "query": query}],
    }


async def _search_external_mcp(query: str) -> dict[str, Any]:
    """通过外部 MCP（元典/北大法宝）检索。

    检查已配置的 MCP 驱动是否可用，如果存在已启用的元典或
    北大法宝 MCP 客户端，则委托其执行检索。
    """
    # MCP 检索由驱动管理器在运行时处理，这里仅返回占位结果。
    # 实际运行时，agent 会自动通过 MCP 工具调用元典/北大法宝。
    return {"answer": "", "sources": []}
