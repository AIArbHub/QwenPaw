# -*- coding: utf-8 -*-
# flake8: noqa: E501
# pylint: disable=line-too-long
"""research_ima 统一工具 — 读目录 → 自动选库 → 全文问答。

将 IMA 云知识库的两级检索封装为一次工具调用。模型漏调用时
运行时自动补发（由 prompt contributor 层触发）。
"""

from __future__ import annotations

import logging

from agentscope.tool import ToolChunk

from ...runtime.tool_registry import tool_descriptor

logger = logging.getLogger(__name__)


@tool_descriptor(
    name="research_ima",
    requires_sandbox=(),
    async_execution=True,
    tool_type="internal",
    policy_name="ResearchIMA",
    default_policy="allow",
    policy_reason="IMA cloud knowledge base research (read-only)",
    ui_description="Search the Tencent IMA cloud knowledge base with two-level RAG",
    ui_icon="🔍",
)
async def research_ima(
    query: str,
    top_k: int = 3,
) -> ToolChunk:
    """Search the Tencent IMA cloud knowledge base.

    This tool performs a two-level RAG search:
    1. Reads IMA knowledge base directory metadata and selects the most
       relevant bases using lightweight semantic matching (no full-text
       download, no secondary index).
    2. Sends the query to IMA's ask endpoint for full-text retrieval and
       generation on the selected bases.

    If IMA is unavailable (not authenticated, API error, or no matching
    knowledge base), the tool automatically falls back to the local
    knowledge base, then to external legal MCP services (Yuandian,
    Pkulaw).

    Args:
        query (`str`): The research question or search terms.
        top_k (`int`, optional): Maximum number of knowledge bases to
            select from the IMA directory. Defaults to 3.
    """
    if not query or not query.strip():
        return _make_response(
            "Error: No search `query` provided.",
        )

    from ...ima.fallback import research_with_fallback

    try:
        result = await research_with_fallback(
            query.strip(),
            top_k=top_k,
        )
    except Exception as exc:
        logger.warning("research_ima failed: %s", exc)
        return _make_response(
            f"Error: research_ima failed — {exc}",
        )

    source = result.get("source", "unknown")
    answer = result.get("answer", "")
    sources = result.get("sources", [])
    error = result.get("error")
    message = result.get("message", "")
    fallback_reason = result.get("fallback_reason", "")

    if error and not answer:
        return _make_response(
            f"IMA research failed (source={source}): {message or error}",
        )

    # 格式化输出
    lines: list[str] = []
    lines.append(f"[Source: {source}]")
    if fallback_reason:
        lines.append(f"[Fallback reason: {fallback_reason}]")

    selected_bases = result.get("selected_bases", [])
    if selected_bases:
        lines.append(
            f"[Selected IMA bases: {', '.join(selected_bases)}]",
        )

    lines.append("")
    lines.append(answer)

    if sources:
        lines.append("")
        lines.append("--- Sources ---")
        for src in sources:
            src_type = src.get("type", "unknown")
            src_title = src.get("title", src.get("name", ""))
            src_url = src.get("url", "")
            if src_url:
                lines.append(f"- [{src_type}] {src_title}: {src_url}")
            elif src_title:
                lines.append(f"- [{src_type}] {src_title}")

    return _make_response("\n".join(lines))


def _make_response(text: str) -> ToolChunk:
    """构造工具返回值。"""
    from agentscope.message import TextBlock, ToolResultState

    return ToolChunk(
        is_last=True,
        state=ToolResultState.SUCCESS,
        content=[TextBlock(type="text", text=text)],
    )
