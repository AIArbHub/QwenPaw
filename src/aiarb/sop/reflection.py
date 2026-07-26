# -*- coding: utf-8 -*-
"""7 维反思引擎 — 借鉴 StaffDeck skills/skill_reflection.py。

替换骨架实现，实现完整的 7 维度评分 + 最多 3 轮反思。

7 个评分维度：
1. source_alignment      — 来源一致性：回复是否基于知识库/文档
2. closed_loop           — 闭环能力：是否有明确的终止条件
3. adaptive_progression  — 自适应推进：能否根据用户输入调整流程
4. tool_grounding        — 工具依据：工具调用是否有充分理由
5. tool_call_format      — 工具调用格式：参数是否正确
6. side_effect_confirmation — 副作用确认：有副作用的操作是否确认
7. interruption_and_recovery — 中断恢复：中断后能否恢复
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any

logger = logging.getLogger(__name__)

MAX_REFLECTION_ROUNDS = 3
RUBRIC_SCORE_THRESHOLD = 0.6


# ── 7 维 RUBRIC 定义 ─────────────────────────────────────────────────────

RUBRIC_DIMENSIONS: dict[str, dict[str, str]] = {
    "source_alignment": {
        "label": "来源一致性",
        "description": "回复是否基于知识库/文档",
    },
    "closed_loop": {
        "label": "闭环能力",
        "description": "是否有明确的终止条件",
    },
    "adaptive_progression": {
        "label": "自适应推进",
        "description": "能否根据用户输入调整流程",
    },
    "tool_grounding": {
        "label": "工具依据",
        "description": "工具调用是否有充分理由",
    },
    "tool_call_format": {
        "label": "工具调用格式",
        "description": "参数是否正确",
    },
    "side_effect_confirmation": {
        "label": "副作用确认",
        "description": "有副作用的操作是否确认",
    },
    "interruption_and_recovery": {
        "label": "中断恢复",
        "description": "中断后能否恢复",
    },
}


@dataclass
class ReflectionResult:
    """反思结果。"""

    agent_id: str = ""
    skill_id: str = ""
    summary: str = ""
    strengths: list[str] = field(default_factory=list)
    weaknesses: list[str] = field(default_factory=list)
    suggestions: list[str] = field(default_factory=list)
    rubric_scores: dict[str, dict[str, Any]] = field(default_factory=dict)
    # rubric_scores 示例:
    # {"source_alignment": {"label": "来源一致性", "score": 0.8, "issues": [], "suggestion": ""}}
    metrics: dict[str, Any] = field(default_factory=dict)
    rounds: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "agent_id": self.agent_id,
            "skill_id": self.skill_id,
            "summary": self.summary,
            "strengths": self.strengths,
            "weaknesses": self.weaknesses,
            "suggestions": self.suggestions,
            "rubric_scores": self.rubric_scores,
            "metrics": self.metrics,
            "rounds": self.rounds,
        }


# ── 反思 prompt ──────────────────────────────────────────────────────────

RUBRIC_REFLECTION_PROMPT_TEMPLATE = """\
You are a SkillCard Reviewer. Evaluate the skill's performance against \
the following 7 dimensions. For each dimension, output a score (0.0-1.0), \
issues found, and a suggestion for improvement.

## Skill Information
- Skill ID: {skill_id}
- Skill Name: {skill_name}
- Skill Description: {skill_description}

## Execution Metrics
{metrics_text}

## Feedback Data
{feedback_text}

## 7 Evaluation Dimensions

1. **source_alignment** (来源一致性): Are replies based on knowledge base / \
   documents? Are there fabricated answers?
2. **closed_loop** (闭环能力): Does every path reach a terminal node? \
   Are there dead-end paths?
3. **adaptive_progression** (自适应推进): Can the skill adjust based on \
   user input (incomplete info, tool failure, knowledge not found)?
4. **tool_grounding** (工具依据): Are tool calls justified? Is the tool_name \
   realistic?
5. **tool_call_format** (工具调用格式): Are tool parameters correct?
6. **side_effect_confirmation** (副作用确认): Are irreversible actions \
   confirmed before execution?
7. **interruption_and_recovery** (中断恢复): Can the skill resume after \
   being interrupted?

## Output Format

Respond with a JSON object (and nothing else):

```json
{{
  "dimensions": [
    {{
      "key": "source_alignment",
      "score": 0.8,
      "issues": ["issue 1"],
      "suggestion": "improvement suggestion"
    }},
    ...
  ],
  "strengths": ["strength 1", "strength 2"],
  "weaknesses": ["weakness 1"],
  "suggestions": ["suggestion 1"],
  "summary": "Overall summary"
}}
```
"""


# ── 反思引擎 ─────────────────────────────────────────────────────────────


class ReflectionEngine:
    """7 维反思引擎。

    从 Agent 的执行统计和用户评分中提取洞见，
    识别能力短板并生成改进建议。

    流程：
    1. 最多 3 轮反思（MAX_REFLECTION_ROUNDS = 3）
    2. 每轮 LLM 评估 7 个维度，返回 score(0-1) + issues + suggestion
    3. 提取 strengths / weaknesses / suggestions / summary
    4. 如果没有失败项（score < 0.6），提前结束
    5. 无 LLM 时用规则评分
    """

    def __init__(self):
        self._initialized = False
        self._model = None
        self._formatter = None

    async def initialize(self) -> None:
        """初始化。"""
        if self._initialized:
            return
        self._initialized = True
        logger.info("反思引擎初始化完成")

    async def _ensure_model(self, agent_id: str | None = None) -> bool:
        """延迟创建模型，返回是否成功。"""
        if self._model is not None:
            return True
        try:
            from ..agents.model_factory import create_model_and_formatter

            self._model, self._formatter = create_model_and_formatter(
                agent_id=agent_id,
            )
            return True
        except Exception as e:
            logger.warning("反思引擎无法创建 LLM 模型: %s", e)
            return False

    async def reflect(
        self,
        agent_id: str = "",
        skill_id: str = "",
        stats: dict[str, Any] | None = None,
        feedback: dict[str, Any] | None = None,
        skill_info: dict[str, Any] | None = None,
    ) -> ReflectionResult:
        """执行一次反思。

        Args:
            agent_id: Agent ID。
            skill_id: Skill ID（可选，用于技能级反思）。
            stats: Agent 统计数据（可选，如未提供则自动获取）。
            feedback: 评分反馈汇总（可选，含归因数据）。
            skill_info: 技能信息（name, description, nodes 等）。

        Returns:
            ReflectionResult 反思结果。
        """
        await self.initialize()

        # 如果未提供数据，尝试自动获取
        if stats is None:
            stats = await self._fetch_stats(agent_id)
        if feedback is None:
            feedback = await self._fetch_feedback(agent_id)

        # 尝试 LLM 评估
        has_model = await self._ensure_model(agent_id or None)

        if has_model and skill_info:
            result = await self._llm_reflect(
                agent_id, skill_id, stats, feedback, skill_info,
            )
        else:
            # 无 LLM 或无技能信息时用规则评分
            result = self._rule_based_reflect(
                agent_id, skill_id, stats, feedback,
            )

        # 接入反馈归因数据
        result = self._integrate_feedback_attribution(result, feedback)

        # 生成汇总
        result.summary = self._build_summary(result)
        return result

    async def _llm_reflect(
        self,
        agent_id: str,
        skill_id: str,
        stats: dict[str, Any],
        feedback: dict[str, Any],
        skill_info: dict[str, Any],
    ) -> ReflectionResult:
        """LLM 驱动的 7 维反思（最多 3 轮）。"""
        from ..framework.message import Msg, TextBlock
        from ..utils.model_response import consume_model_response

        result = ReflectionResult(agent_id=agent_id, skill_id=skill_id)

        metrics_text = self._format_metrics(stats)
        feedback_text = self._format_feedback(feedback)

        prompt = RUBRIC_REFLECTION_PROMPT_TEMPLATE.format(
            skill_id=skill_id or skill_info.get("id", ""),
            skill_name=skill_info.get("name", ""),
            skill_description=skill_info.get("description", ""),
            metrics_text=metrics_text,
            feedback_text=feedback_text,
        )

        for round_num in range(1, MAX_REFLECTION_ROUNDS + 1):
            result.rounds = round_num

            messages: list[Msg] = [
                Msg(
                    name="system",
                    role="system",
                    content=[TextBlock(type="text", text=prompt)],
                ),
            ]

            try:
                raw_response = await consume_model_response(
                    self._model, messages,
                )
            except Exception as e:
                logger.warning("反思引擎 LLM 调用失败 (轮 %d): %s", round_num, e)
                break

            parsed = self._parse_rubric_response(raw_response)
            if not parsed:
                break

            # 更新评分
            result.rubric_scores = parsed.get("rubric_scores", {})
            result.strengths = parsed.get("strengths", [])
            result.weaknesses = parsed.get("weaknesses", [])
            result.suggestions = parsed.get("suggestions", [])
            result.metrics = {
                "total_messages": stats.get("total_messages", 0),
                "total_tool_calls": stats.get("total_tool_calls", 0),
                "total_sessions": stats.get("total_active_sessions", 0),
                "avg_rating": feedback.get("avg_rating", 0),
                "total_feedback": feedback.get("total_feedback", 0),
            }

            # 检查是否有失败项
            failed_dims = [
                key for key, val in result.rubric_scores.items()
                if isinstance(val, dict)
                and val.get("score", 1.0) < RUBRIC_SCORE_THRESHOLD
            ]

            if not failed_dims:
                logger.info(
                    "反思轮 %d 完成，无失败项，提前结束",
                    round_num,
                )
                break

            logger.info(
                "反思轮 %d 完成，%d 个维度未达标: %s",
                round_num,
                len(failed_dims),
                failed_dims,
            )

        return result

    def _rule_based_reflect(
        self,
        agent_id: str,
        skill_id: str,
        stats: dict[str, Any],
        feedback: dict[str, Any],
    ) -> ReflectionResult:
        """规则评分（无 LLM 时使用）。"""
        result = ReflectionResult(agent_id=agent_id, skill_id=skill_id)

        total_messages = stats.get("total_messages", 0)
        total_tool_calls = stats.get("total_tool_calls", 0)
        total_sessions = stats.get("total_active_sessions", 0)
        avg_rating = feedback.get("avg_rating", 0)
        total_feedback = feedback.get("total_feedback", 0)
        dist = feedback.get("rating_distribution", {})

        # 闭环能力 = completed_sessions / total_sessions
        completed_sessions = stats.get("completed_sessions", total_sessions)
        closed_loop_score = (
            completed_sessions / total_sessions if total_sessions > 0 else 0.5
        )

        # 工具调用格式 = 1 - tool_errors / tool_calls
        tool_errors = stats.get("tool_errors", 0)
        tool_format_score = (
            1 - tool_errors / total_tool_calls
            if total_tool_calls > 0
            else 0.8
        )

        # 来源一致性 = positive / (positive + negative)
        positive = dist.get("4", 0) + dist.get("5", 0)
        negative = dist.get("1", 0) + dist.get("2", 0)
        source_score = (
            positive / (positive + negative)
            if (positive + negative) > 0
            else 0.5
        )

        # 构建评分
        result.rubric_scores = {
            "source_alignment": {
                "label": "来源一致性",
                "score": round(source_score, 2),
                "issues": [],
                "suggestion": "" if source_score >= RUBRIC_SCORE_THRESHOLD else "检查回复是否基于知识库",
            },
            "closed_loop": {
                "label": "闭环能力",
                "score": round(closed_loop_score, 2),
                "issues": [],
                "suggestion": "",
            },
            "adaptive_progression": {
                "label": "自适应推进",
                "score": 0.7 if total_messages > 50 else 0.5,
                "issues": [],
                "suggestion": "",
            },
            "tool_grounding": {
                "label": "工具依据",
                "score": 0.8 if total_tool_calls > 0 else 0.5,
                "issues": [],
                "suggestion": "",
            },
            "tool_call_format": {
                "label": "工具调用格式",
                "score": round(tool_format_score, 2),
                "issues": [],
                "suggestion": "",
            },
            "side_effect_confirmation": {
                "label": "副作用确认",
                "score": 0.8,
                "issues": [],
                "suggestion": "",
            },
            "interruption_and_recovery": {
                "label": "中断恢复",
                "score": 0.7,
                "issues": [],
                "suggestion": "",
            },
        }

        # 识别优势
        if total_messages > 100:
            result.strengths.append(
                f"处理了 {total_messages} 条消息，对话处理能力稳定",
            )
        if total_tool_calls > 50:
            result.strengths.append(
                f"工具调用 {total_tool_calls} 次，自动化执行能力强",
            )
        if avg_rating >= 4.0:
            result.strengths.append(
                f"用户评分 {avg_rating:.1f}/5.0，满意度良好",
            )

        # 识别短板
        if total_messages < 10:
            result.weaknesses.append("消息处理量较低，可能需要扩大服务范围")
        if total_tool_calls == 0 and total_messages > 20:
            result.weaknesses.append("未使用工具调用，自动化程度不足")
        if avg_rating > 0 and avg_rating < 3.0:
            result.weaknesses.append(
                f"用户评分 {avg_rating:.1f}/5.0，满意度较低",
            )

        # 差评占比分析
        if total_feedback > 0:
            low_ratings = dist.get("1", 0) + dist.get("2", 0)
            low_ratio = low_ratings / total_feedback
            if low_ratio > 0.3:
                result.weaknesses.append(
                    f"差评占比 {low_ratio:.0%}，需要重点关注",
                )
                result.suggestions.append(
                    "分析差评评论中的共性问题，针对性地改进 Agent 的回复策略",
                )

        result.metrics = {
            "total_messages": total_messages,
            "total_tool_calls": total_tool_calls,
            "total_sessions": total_sessions,
            "avg_rating": avg_rating,
            "total_feedback": total_feedback,
            "completed_sessions": completed_sessions,
            "tool_errors": tool_errors,
        }

        # 生成改进建议
        if not result.suggestions:
            if total_messages > 0 and avg_rating >= 4.0:
                result.suggestions.append(
                    "整体表现良好，可考虑扩展到更多场景或增加技能",
                )
            elif total_messages == 0:
                result.suggestions.append(
                    "尚无执行记录，建议先通过对话或定时任务积累使用数据",
                )

        result.rounds = 1
        return result

    def _integrate_feedback_attribution(
        self,
        result: ReflectionResult,
        feedback: dict[str, Any],
    ) -> ReflectionResult:
        """接入反馈归因数据，调整评分。

        归因分类影响维度：
        - skill_issue -> 影响 source_alignment 和 adaptive_progression
        - tool_or_system_issue -> 影响 tool_grounding 和 tool_call_format
        - model_issue -> 影响 source_alignment
        """
        buckets = feedback.get("buckets", {})
        if not buckets:
            return result

        skill_issues = buckets.get("skill_issue", 0)
        tool_issues = buckets.get("tool_or_system_issue", 0)
        model_issues = buckets.get("model_issue", 0)

        # 调整评分
        if skill_issues > 0 and "source_alignment" in result.rubric_scores:
            current = result.rubric_scores["source_alignment"].get("score", 1.0)
            penalty = min(0.2, skill_issues * 0.05)
            result.rubric_scores["source_alignment"]["score"] = max(
                0.0, current - penalty,
            )
            result.rubric_scores["source_alignment"]["issues"] = (
                result.rubric_scores["source_alignment"].get("issues", [])
                + [f"反馈归因识别 {skill_issues} 个技能问题"]
            )

        if tool_issues > 0:
            if "tool_grounding" in result.rubric_scores:
                current = result.rubric_scores["tool_grounding"].get("score", 1.0)
                penalty = min(0.2, tool_issues * 0.05)
                result.rubric_scores["tool_grounding"]["score"] = max(
                    0.0, current - penalty,
                )
            if "tool_call_format" in result.rubric_scores:
                current = result.rubric_scores["tool_call_format"].get("score", 1.0)
                penalty = min(0.15, tool_issues * 0.03)
                result.rubric_scores["tool_call_format"]["score"] = max(
                    0.0, current - penalty,
                )

        if model_issues > 0 and "source_alignment" in result.rubric_scores:
            current = result.rubric_scores["source_alignment"].get("score", 1.0)
            penalty = min(0.1, model_issues * 0.03)
            result.rubric_scores["source_alignment"]["score"] = max(
                0.0, current - penalty,
            )

        # 添加归因相关建议
        if skill_issues > 0:
            result.suggestions.append(
                f"有 {skill_issues} 条反馈指向技能问题，建议检查 SOP 定义和步骤设计",
            )
        if tool_issues > 0:
            result.suggestions.append(
                f"有 {tool_issues} 条反馈指向工具/系统问题，建议检查工具配置和调用链路",
            )

        return result

    def _parse_rubric_response(
        self,
        raw_response: str,
    ) -> dict[str, Any] | None:
        """解析 LLM 的 RUBRIC 评分响应。"""
        json_str = self._extract_json(raw_response)
        if not json_str:
            logger.warning("反思引擎: 未找到 JSON 响应")
            return None

        try:
            data = json.loads(json_str)
        except json.JSONDecodeError as e:
            logger.warning("反思引擎: JSON 解析失败: %s", e)
            return None

        # 转换为 rubric_scores 格式
        rubric_scores: dict[str, dict[str, Any]] = {}
        for dim in data.get("dimensions", []):
            key = dim.get("key", "")
            if key in RUBRIC_DIMENSIONS:
                rubric_scores[key] = {
                    "label": RUBRIC_DIMENSIONS[key]["label"],
                    "score": float(dim.get("score", 0.5)),
                    "issues": dim.get("issues", []),
                    "suggestion": dim.get("suggestion", ""),
                }

        return {
            "rubric_scores": rubric_scores,
            "strengths": data.get("strengths", []),
            "weaknesses": data.get("weaknesses", []),
            "suggestions": data.get("suggestions", []),
            "summary": data.get("summary", ""),
        }

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

    def _format_metrics(self, stats: dict[str, Any]) -> str:
        """格式化统计数据为文本。"""
        if not stats:
            return "  (无统计数据)"
        lines = []
        for key, value in stats.items():
            lines.append(f"  - {key}: {value}")
        return "\n".join(lines)

    def _format_feedback(self, feedback: dict[str, Any]) -> str:
        """格式化反馈数据为文本。"""
        if not feedback:
            return "  (无反馈数据)"
        lines = [
            f"  - 总反馈数: {feedback.get('total_feedback', 0)}",
            f"  - 平均评分: {feedback.get('avg_rating', 0):.1f}",
            f"  - 评分分布: {feedback.get('rating_distribution', {})}",
        ]
        buckets = feedback.get("buckets", {})
        if buckets:
            lines.append(f"  - 归因分类: {buckets}")
        top_down = feedback.get("top_down_summaries", [])
        if top_down:
            lines.append("  - 点踩摘要:")
            for item in top_down[:3]:
                lines.append(f"    - [{item.get('bucket', '')}] {item.get('summary', '')}")
        return "\n".join(lines)

    def _build_summary(self, result: ReflectionResult) -> str:
        """构建汇总文本。"""
        parts: list[str] = []
        if result.skill_id:
            parts.append(f"技能 {result.skill_id} 反思报告：")
        else:
            parts.append(f"Agent {result.agent_id} 反思报告：")

        if result.rounds > 0:
            parts.append(f"反思轮数: {result.rounds}")

        if result.rubric_scores:
            avg_score = sum(
                v.get("score", 0) for v in result.rubric_scores.values()
                if isinstance(v, dict)
            ) / len(result.rubric_scores)
            parts.append(f"7 维平均分: {avg_score:.2f}")

        if result.strengths:
            parts.append(
                "\n优势：\n" + "\n".join(f"  - {s}" for s in result.strengths),
            )
        if result.weaknesses:
            parts.append(
                "\n短板：\n" + "\n".join(f"  - {w}" for w in result.weaknesses),
            )
        if result.suggestions:
            parts.append(
                "\n建议：\n" + "\n".join(f"  - {s}" for s in result.suggestions),
            )
        return "\n".join(parts)

    async def _fetch_stats(self, agent_id: str) -> dict[str, Any]:
        """获取 Agent 统计数据。"""
        try:
            from ..agent_stats import get_agent_stats_service
            from ..constant import WORKING_DIR

            svc = get_agent_stats_service()
            end = date.today()
            start = end - timedelta(days=30)
            summary = await svc.get_summary(WORKING_DIR, start, end)
            return summary.model_dump()
        except Exception as e:
            logger.warning("获取统计失败: %s", e)
            return {}

    async def _fetch_feedback(self, agent_id: str) -> dict[str, Any]:
        """获取评分反馈汇总。"""
        try:
            from ..builtin_plugins.agent_feedback.backend.service import (
                FeedbackService,
            )

            svc = FeedbackService()
            await svc.initialize()
            return await svc.get_summary(agent_id)
        except Exception as e:
            logger.warning("获取评分反馈失败: %s", e)
            return {}


# 单例
_reflection_engine: ReflectionEngine | None = None


def get_reflection_engine() -> ReflectionEngine:
    """获取反思引擎单例。"""
    global _reflection_engine
    if _reflection_engine is None:
        _reflection_engine = ReflectionEngine()
    return _reflection_engine
