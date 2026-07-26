# -*- coding: utf-8 -*-
"""知识自发现引擎 — 借鉴 StaffDeck knowledge/discovery.py。

入库后自动分析文档，生成 SOP 建议和工具建议。
用户在前端确认后，可一键蒸馏为 SkillCard 或注册为工具。
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)

# ── 建议类型 ─────────────────────────────────────────────────────────────

SUGGESTION_TYPE_SOP = "sop"
SUGGESTION_TYPE_TOOL = "tool"
SUGGESTION_TYPE_KNOWLEDGE_GAP = "knowledge_gap"

SUGGESTION_TYPES = {SUGGESTION_TYPE_SOP, SUGGESTION_TYPE_TOOL, SUGGESTION_TYPE_KNOWLEDGE_GAP}

SUGGESTION_STATUS_PENDING = "pending"
SUGGESTION_STATUS_ACCEPTED = "accepted"
SUGGESTION_STATUS_REJECTED = "rejected"


@dataclass
class DiscoverySuggestion:
    """发现建议。"""

    suggestion_id: str
    suggestion_type: str  # sop / tool / knowledge_gap
    title: str
    description: str
    content: str = ""
    confidence: float = 0.0
    status: str = SUGGESTION_STATUS_PENDING
    document_id: str = ""
    created_at: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "suggestion_id": self.suggestion_id,
            "suggestion_type": self.suggestion_type,
            "title": self.title,
            "description": self.description,
            "content": self.content,
            "confidence": self.confidence,
            "status": self.status,
            "document_id": self.document_id,
            "created_at": self.created_at,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "DiscoverySuggestion":
        return cls(
            suggestion_id=data.get("suggestion_id", ""),
            suggestion_type=data.get("suggestion_type", ""),
            title=data.get("title", ""),
            description=data.get("description", ""),
            content=data.get("content", ""),
            confidence=data.get("confidence", 0.0),
            status=data.get("status", SUGGESTION_STATUS_PENDING),
            document_id=data.get("document_id", ""),
            created_at=data.get("created_at", ""),
        )


# ── 规则引擎发现 ─────────────────────────────────────────────────────────


def _detect_sop_keywords(text: str) -> list[dict[str, str]]:
    """检测 SOP 关键词。"""
    sop_keywords = [
        ("流程", "process"),
        ("步骤", "steps"),
        ("程序", "procedure"),
        ("规范", "standard"),
        ("指南", "guide"),
        ("手册", "manual"),
        ("操作", "operation"),
        ("审批", "approval"),
        ("审核", "review"),
        ("仲裁", "arbitration"),
        ("质证", "cross_examination"),
        ("裁决", "award"),
    ]

    text_lower = text.lower()
    found: list[dict[str, str]] = []
    for keyword, _ in sop_keywords:
        if keyword in text_lower:
            found.append({"keyword": keyword, "type": "sop_trigger"})
    return found


def _detect_tool_keywords(text: str) -> list[dict[str, str]]:
    """检测工具关键词。"""
    tool_keywords = [
        ("查询", "query"),
        ("检索", "search"),
        ("计算", "calculate"),
        ("验证", "verify"),
        ("发送", "send"),
        ("通知", "notify"),
        ("导出", "export"),
        ("导入", "import"),
        ("解析", "parse"),
        ("转换", "convert"),
    ]

    text_lower = text.lower()
    found: list[dict[str, str]] = []
    for keyword, _ in tool_keywords:
        if keyword in text_lower:
            found.append({"keyword": keyword, "type": "tool_trigger"})
    return found


def _extract_sop_outline(text: str) -> list[str]:
    """从文档中提取 SOP 大纲。"""
    outline: list[str] = []
    for line in text.split("\n"):
        stripped = line.strip()
        if not stripped:
            continue
        # Markdown 标题
        if stripped.startswith("#"):
            outline.append(stripped.lstrip("#").strip())
        # 数字编号
        elif re.match(r"^\d+[\.\、]", stripped):
            outline.append(stripped)
        # 第 X 章/节
        elif stripped.startswith("第") and ("章" in stripped or "节" in stripped):
            outline.append(stripped)
    return outline


def _generate_sop_suggestion(
    doc_id: str,
    title: str,
    text: str,
    outline: list[str],
) -> DiscoverySuggestion:
    """生成 SOP 建议。"""
    # 从大纲构建简要 SOP 描述
    if outline:
        steps_text = "\n".join(f"  {i+1}. {step}" for i, step in enumerate(outline[:10]))
        description = f"从文档「{title}」中检测到 {len(outline)} 个流程步骤"
        content = f"# {title} - SOP 草案\n\n## 检测到的步骤\n{steps_text}"
    else:
        description = f"文档「{title}」包含流程相关内容，可蒸馏为 SOP"
        content = f"# {title} - SOP 草案\n\n{text[:500]}"

    confidence = min(1.0, len(outline) * 0.15) if outline else 0.3

    return DiscoverySuggestion(
        suggestion_id=f"sop_{doc_id[:8]}",
        suggestion_type=SUGGESTION_TYPE_SOP,
        title=f"SOP 建议：{title}",
        description=description,
        content=content,
        confidence=confidence,
        document_id=doc_id,
    )


def _generate_tool_suggestion(
    doc_id: str,
    title: str,
    tool_keywords: list[dict[str, str]],
) -> DiscoverySuggestion:
    """生成工具建议。"""
    keywords_str = ", ".join(k["keyword"] for k in tool_keywords[:5])
    description = f"文档「{title}」中检测到工具相关操作：{keywords_str}"
    content = f"建议为以下操作注册工具：\n" + "\n".join(
        f"  - {k['keyword']}" for k in tool_keywords
    )

    confidence = min(0.8, len(tool_keywords) * 0.1)

    return DiscoverySuggestion(
        suggestion_id=f"tool_{doc_id[:8]}",
        suggestion_type=SUGGESTION_TYPE_TOOL,
        title=f"工具建议：{title}",
        description=description,
        content=content,
        confidence=confidence,
        document_id=doc_id,
    )


def discover_suggestions(
    doc_id: str,
    title: str,
    text: str,
) -> list[DiscoverySuggestion]:
    """从文档内容生成发现建议。

    Args:
        doc_id: 文档 ID。
        title: 文档标题。
        text: 文档全文。

    Returns:
        发现建议列表。
    """
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()

    suggestions: list[DiscoverySuggestion] = []

    # 检测 SOP 关键词
    sop_keywords = _detect_sop_keywords(text)
    if sop_keywords:
        outline = _extract_sop_outline(text)
        sop_suggestion = _generate_sop_suggestion(doc_id, title, text, outline)
        sop_suggestion.created_at = now
        suggestions.append(sop_suggestion)

    # 检测工具关键词
    tool_keywords = _detect_tool_keywords(text)
    if tool_keywords:
        tool_suggestion = _generate_tool_suggestion(doc_id, title, tool_keywords)
        tool_suggestion.created_at = now
        suggestions.append(tool_suggestion)

    return suggestions


# ── 发现建议管理器 ───────────────────────────────────────────────────────


class DiscoveryManager:
    """发现建议管理器。

    存储建议到 JSON 文件，支持列出、确认、拒绝。
    """

    _instance: "DiscoveryManager | None" = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self):
        if not hasattr(self, "_initialized"):
            self._suggestions: list[DiscoverySuggestion] = []
            self._storage_dir = None
            self._suggestions_file = None
            self._initialized = False

    async def initialize(self) -> None:
        """初始化。"""
        if self._initialized:
            return
        try:
            from pathlib import Path
            from aiarb.constant import WORKING_DIR

            self._storage_dir = WORKING_DIR / "knowledge_base"
        except Exception:
            from pathlib import Path

            self._storage_dir = Path.home() / ".aiarb" / "knowledge_base"

        self._storage_dir.mkdir(parents=True, exist_ok=True)
        self._suggestions_file = self._storage_dir / "discovery_suggestions.json"

        # 加载已有建议
        await self._load_suggestions()
        self._initialized = True
        logger.info("发现建议管理器初始化完成")

    async def _load_suggestions(self) -> None:
        """从文件加载建议。"""
        if not self._suggestions_file or not self._suggestions_file.exists():
            self._suggestions = []
            return
        try:
            import aiofiles
            import orjson

            async with aiofiles.open(self._suggestions_file, "rb") as f:
                data = orjson.loads(await f.read())
            self._suggestions = [
                DiscoverySuggestion.from_dict(s) for s in data.get("suggestions", [])
            ]
        except Exception as e:
            logger.error("加载发现建议失败: %s", e)
            self._suggestions = []

    async def _save_suggestions(self) -> None:
        """保存建议到文件。"""
        if not self._suggestions_file:
            return
        try:
            import aiofiles
            import orjson

            data = {
                "suggestions": [s.to_dict() for s in self._suggestions],
            }
            async with aiofiles.open(self._suggestions_file, "wb") as f:
                await f.write(orjson.dumps(data))
        except Exception as e:
            logger.error("保存发现建议失败: %s", e)

    async def add_suggestions(
        self,
        suggestions: list[DiscoverySuggestion],
    ) -> None:
        """添加发现建议。"""
        await self.initialize()
        # 去重：相同 document_id + suggestion_type 的建议只保留最新的
        existing_keys = {
            (s.document_id, s.suggestion_type)
            for s in self._suggestions
            if s.status == SUGGESTION_STATUS_PENDING
        }
        for suggestion in suggestions:
            key = (suggestion.document_id, suggestion.suggestion_type)
            if key not in existing_keys:
                self._suggestions.append(suggestion)
                existing_keys.add(key)
        await self._save_suggestions()

    async def list_suggestions(
        self,
        status: str | None = None,
        doc_id: str | None = None,
    ) -> list[dict[str, Any]]:
        """列出发现建议。"""
        await self.initialize()
        result = self._suggestions
        if status:
            result = [s for s in result if s.status == status]
        if doc_id:
            result = [s for s in result if s.document_id == doc_id]
        return [s.to_dict() for s in result]

    async def update_suggestion_status(
        self,
        suggestion_id: str,
        status: str,
    ) -> bool:
        """更新建议状态。"""
        await self.initialize()
        for suggestion in self._suggestions:
            if suggestion.suggestion_id == suggestion_id:
                suggestion.status = status
                await self._save_suggestions()
                return True
        return False

    async def delete_suggestion(self, suggestion_id: str) -> bool:
        """删除建议。"""
        await self.initialize()
        original_len = len(self._suggestions)
        self._suggestions = [
            s for s in self._suggestions if s.suggestion_id != suggestion_id
        ]
        if len(self._suggestions) < original_len:
            await self._save_suggestions()
            return True
        return False
