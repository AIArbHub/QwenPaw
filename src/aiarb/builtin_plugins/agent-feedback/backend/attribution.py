# -*- coding: utf-8 -*-
"""LLM 反馈归因 — 借鉴 StaffDeck feedback/service.py。

7 类归因分类：
1. model_issue          — 模型问题
2. skill_issue          — 技能问题
3. tool_or_system_issue — 工具/系统问题
4. user_random_or_unclear — 用户随意或上下文不足
5. positive_or_resolved  — 正向反馈
6. needs_model_analysis  — 待模型分析
7. unknown              — 未知

归因流程：
1. 收集反馈上下文：目标消息 + 附近 8 条消息 + 最近 30 条 AgentEvent
2. 调用 LLM 生成 JSON 分析（bucket, confidence, reason, summary）
3. 最多重试 3 次，退避延迟递增（2^attempt 秒）
4. 无模型时标记 needs_model_analysis
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any

logger = logging.getLogger(__name__)

MAX_RETRY = 3


# ── 归因分类常量 ─────────────────────────────────────────────────────────

BUCKET_MODEL_ISSUE = "model_issue"
BUCKET_SKILL_ISSUE = "skill_issue"
BUCKET_TOOL_OR_SYSTEM = "tool_or_system_issue"
BUCKET_USER_RANDOM = "user_random_or_unclear"
BUCKET_POSITIVE = "positive_or_resolved"
BUCKET_NEEDS_MODEL = "needs_model_analysis"
BUCKET_UNKNOWN = "unknown"

ALL_BUCKETS = {
    BUCKET_MODEL_ISSUE,
    BUCKET_SKILL_ISSUE,
    BUCKET_TOOL_OR_SYSTEM,
    BUCKET_USER_RANDOM,
    BUCKET_POSITIVE,
    BUCKET_NEEDS_MODEL,
    BUCKET_UNKNOWN,
}

BUCKET_LABELS: dict[str, str] = {
    BUCKET_MODEL_ISSUE: "模型问题",
    BUCKET_SKILL_ISSUE: "技能问题",
    BUCKET_TOOL_OR_SYSTEM: "工具/系统问题",
    BUCKET_USER_RANDOM: "用户随意或上下文不足",
    BUCKET_POSITIVE: "正向反馈",
    BUCKET_NEEDS_MODEL: "待模型分析",
    BUCKET_UNKNOWN: "未知",
}


# ── 归因 prompt ──────────────────────────────────────────────────────────

ATTRIBUTION_PROMPT_TEMPLATE = """\
You are a Feedback Analyst. Analyze the user's feedback (rating + comment) \
and determine the root cause.

## Feedback Details
- Rating: {rating}/5
- Comment: {comment}

## Target Message
{target_message}

## Nearby Messages (context)
{nearby_messages}

## Recent Agent Events
{recent_events}

## Attribution Categories

Choose exactly ONE bucket:

1. **model_issue** — The model misunderstood, reasoned incorrectly, or \
   produced a poor response.
2. **skill_issue** — The SOP/skill definition, steps, or slots are flawed.
3. **tool_or_system_issue** — A tool was not configured, failed, or the \
   system had an error.
4. **user_random_or_unclear** — The user gave random feedback or the \
   context was insufficient.
5. **positive_or_resolved** — Positive feedback (rating >= 4).
6. **needs_model_analysis** — Cannot determine without more analysis.
7. **unknown** — None of the above.

## Output Format

Respond with a JSON object (and nothing else):

```json
{{
  "bucket": "model_issue|skill_issue|tool_or_system_issue|user_random_or_unclear|positive_or_resolved|needs_model_analysis|unknown",
  "confidence": 0.85,
  "reason": "Brief explanation of why this bucket was chosen",
  "summary": "One-sentence summary of the feedback root cause"
}}
```
"""


class AttributionResult:
    """归因结果。"""

    def __init__(
        self,
        status: str = "pending",
        bucket: str = "",
        reason: str = "",
        summary: str = "",
        confidence: float = 0.0,
    ):
        self.status = status  # pending / analyzed / needs_model_analysis / failed
        self.bucket = bucket
        self.reason = reason
        self.summary = summary
        self.confidence = confidence

    def to_dict(self) -> dict[str, Any]:
        return {
            "analysis_status": self.status,
            "analysis_bucket": self.bucket,
            "analysis_reason": self.reason,
            "analysis_summary": self.summary,
            "analysis_confidence": self.confidence,
        }


class FeedbackAttributor:
    """LLM 反馈归因器。

    异步触发，不阻塞反馈入库响应。
    归因失败不影响主流程。
    """

    def __init__(self, agent_id: str | None = None):
        self._agent_id = agent_id
        self._model = None
        self._formatter = None

    async def _ensure_model(self) -> bool:
        """延迟创建模型，返回是否成功。"""
        if self._model is not None:
            return True
        try:
            from ...agents.model_factory import create_model_and_formatter

            self._model, self._formatter = create_model_and_formatter(
                agent_id=self._agent_id,
            )
            return True
        except Exception as e:
            logger.warning("归因器无法创建 LLM 模型: %s", e)
            return False

    async def attribute(
        self,
        feedback: dict[str, Any],
        context_messages: list[dict[str, str]] | None = None,
        recent_events: list[dict[str, Any]] | None = None,
    ) -> AttributionResult:
        """执行反馈归因。

        Args:
            feedback: 反馈数据（rating, comment, message_id 等）。
            context_messages: 附近消息（最多 8 条）。
            recent_events: 最近 AgentEvent（最多 30 条）。

        Returns:
            AttributionResult 归因结果。
        """
        rating = feedback.get("rating", 0)
        comment = feedback.get("comment", "")
        target_message = feedback.get("message_content", "")

        # 正向反馈直接归类
        if rating >= 4:
            return AttributionResult(
                status="analyzed",
                bucket=BUCKET_POSITIVE,
                reason=f"Rating {rating}/5 is positive",
                summary="用户对回复满意",
                confidence=0.95,
            )

        # 尝试创建模型
        has_model = await self._ensure_model()
        if not has_model:
            return AttributionResult(
                status="needs_model_analysis",
                bucket=BUCKET_NEEDS_MODEL,
                reason="No LLM model available",
                summary="无可用模型，待后续分析",
                confidence=0.0,
            )

        # 构建上下文
        nearby_text = self._format_messages(context_messages or [])
        events_text = self._format_events(recent_events or [])

        prompt = ATTRIBUTION_PROMPT_TEMPLATE.format(
            rating=rating,
            comment=comment or "(无评论)",
            target_message=target_message or "(无目标消息)",
            nearby_messages=nearby_text,
            recent_events=events_text,
        )

        # 调用 LLM（最多重试 3 次）
        for attempt in range(MAX_RETRY):
            try:
                from ...framework.message import Msg, TextBlock
                from ...utils.model_response import consume_model_response

                messages: list[Msg] = [
                    Msg(
                        name="system",
                        role="system",
                        content=[TextBlock(type="text", text=prompt)],
                    ),
                ]

                raw_response = await consume_model_response(
                    self._model, messages,
                )
                result = self._parse_response(raw_response)
                if result:
                    return result

            except Exception as e:
                logger.warning(
                    "归因 LLM 调用失败 (尝试 %d/%d): %s",
                    attempt + 1,
                    MAX_RETRY,
                    e,
                )
                if attempt < MAX_RETRY - 1:
                    # 指数退避
                    delay = 2 ** (attempt + 1)
                    await asyncio.sleep(delay)

        # 所有重试失败
        return AttributionResult(
            status="failed",
            bucket=BUCKET_UNKNOWN,
            reason="LLM attribution failed after retries",
            summary="归因失败",
            confidence=0.0,
        )

    def _parse_response(self, raw_response: str) -> AttributionResult | None:
        """解析 LLM 的 JSON 响应。"""
        json_str = self._extract_json(raw_response)
        if not json_str:
            logger.warning("归因: 未找到 JSON")
            return None

        try:
            data = json.loads(json_str)
        except json.JSONDecodeError as e:
            logger.warning("归因: JSON 解析失败: %s", e)
            return None

        bucket = data.get("bucket", BUCKET_UNKNOWN)
        if bucket not in ALL_BUCKETS:
            logger.warning("归因: 未知 bucket '%s'，降级为 unknown", bucket)
            bucket = BUCKET_UNKNOWN

        return AttributionResult(
            status="analyzed",
            bucket=bucket,
            reason=data.get("reason", ""),
            summary=data.get("summary", ""),
            confidence=float(data.get("confidence", 0.0)),
        )

    def _extract_json(self, text: str) -> str | None:
        """从可能包含 markdown 的文本中提取 JSON。"""
        code_block_pattern = r"```(?:json)?\s*\n?(.*?)\n?\s*```"
        match = re.search(code_block_pattern, text, re.DOTALL)
        if match:
            return match.group(1).strip()

        first_brace = text.find("{")
        last_brace = text.rfind("}")
        if first_brace != -1 and last_brace != -1 and last_brace > first_brace:
            return text[first_brace : last_brace + 1]

        return None

    def _format_messages(self, messages: list[dict[str, str]]) -> str:
        """格式化消息列表。"""
        if not messages:
            return "  (无上下文消息)"
        lines = []
        for msg in messages[-8:]:  # 最近 8 条
            role = msg.get("role", "unknown")
            text = msg.get("text", msg.get("content", ""))
            lines.append(f"  [{role}]: {text[:200]}")
        return "\n".join(lines)

    def _format_events(self, events: list[dict[str, Any]]) -> str:
        """格式化 AgentEvent 列表。"""
        if not events:
            return "  (无最近事件)"
        lines = []
        for event in events[-30:]:  # 最近 30 条
            event_type = event.get("type", event.get("event_type", "unknown"))
            detail = event.get("detail", event.get("summary", ""))
            lines.append(f"  [{event_type}]: {str(detail)[:150]}")
        return "\n".join(lines)


async def trigger_attribution(
    feedback_id: str,
    feedback: dict[str, Any],
    agent_id: str = "",
    context_messages: list[dict[str, str]] | None = None,
    recent_events: list[dict[str, Any]] | None = None,
) -> AttributionResult:
    """异步触发归因（不阻塞主流程）。

    Args:
        feedback_id: 反馈 ID。
        feedback: 反馈数据。
        agent_id: Agent ID。
        context_messages: 附近消息。
        recent_events: 最近事件。

    Returns:
        AttributionResult 归因结果。
    """
    attributor = FeedbackAttributor(agent_id=agent_id or None)
    try:
        result = await attributor.attribute(
            feedback=feedback,
            context_messages=context_messages,
            recent_events=recent_events,
        )
        logger.info(
            "反馈 %s 归因完成: bucket=%s confidence=%.2f",
            feedback_id,
            result.bucket,
            result.confidence,
        )
        return result
    except Exception as e:
        logger.error("反馈 %s 归因异常: %s", feedback_id, e)
        return AttributionResult(
            status="failed",
            bucket=BUCKET_UNKNOWN,
            reason=str(e),
            summary="归因异常",
        )
