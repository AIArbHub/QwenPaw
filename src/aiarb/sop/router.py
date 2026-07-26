# -*- coding: utf-8 -*-
"""Router 决策层 — 借鉴 StaffDeck core/router.py。

9 种决策类型：
1. continue_active   — 继续当前任务
2. switch_to_pending — 切换到待处理任务
3. create_pending    — 创建新待处理任务（当前任务挂起）
4. update_pending    — 更新待处理任务
5. complete_task     — 完成当前任务
6. start_new_task    — 开始新任务（需指定 target_skill_id）
7. answer_only       — 仅回答（无需技能）
8. handoff_human     — 转人工
9. clarify           — 需要澄清
"""

from __future__ import annotations

import json
import logging
import re
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field

from ..agents.model_factory import create_model_and_formatter
from ..framework.message import Msg, TextBlock
from ..utils.model_response import consume_model_response

logger = logging.getLogger(__name__)


class RouterDecisionValue(str, Enum):
    """9 种决策类型。"""

    CONTINUE_ACTIVE = "continue_active"
    SWITCH_TO_PENDING = "switch_to_pending"
    CREATE_PENDING = "create_pending"
    UPDATE_PENDING = "update_pending"
    COMPLETE_TASK = "complete_task"
    START_NEW_TASK = "start_new_task"
    ANSWER_ONLY = "answer_only"
    HANDOFF_HUMAN = "handoff_human"
    CLARIFY = "clarify"


class RouterDecision(BaseModel):
    """Router 决策结果。"""

    decision: RouterDecisionValue = RouterDecisionValue.ANSWER_ONLY
    target_skill_id: str = ""
    target_step_id: str = ""
    user_intent: str = ""
    general_intent: str = ""
    clarification_question: str = ""
    selected_task_id: str = ""
    slot_hints: dict[str, str] = Field(default_factory=dict)
    task_frames: list[dict[str, Any]] = Field(default_factory=list)
    pending_tasks: list[dict[str, Any]] = Field(default_factory=list)
    created_tasks: list[dict[str, Any]] = Field(default_factory=list)


# ── Router Prompt ─────────────────────────────────────────────────────────

ROUTER_SYSTEM_PROMPT = """\
You are a Router that decides how to handle the user's input in the context \
of an ongoing conversation with one or more active skills (SOP state machines).

## Available Skills
{available_skills}

## Pending Tasks
{pending_tasks}

## Current Session State
- Active skill: {active_skill_id}
- Active node: {active_node_id}
- Skill stack depth: {skill_stack_depth}

## User Input
{user_input}

## Decision Types

Choose exactly ONE of the following decisions:

1. **continue_active** — The user's input is related to the active skill. \
   Continue executing the current skill.
2. **switch_to_pending** — The user wants to switch to a pending task. \
   Set selected_task_id to the target task ID.
3. **create_pending** — The user's input suggests a new task that should be \
   queued. The current task stays active; the new task is added to pending.
4. **update_pending** — Update an existing pending task's information.
5. **complete_task** — The current task is complete. Mark it as done.
6. **start_new_task** — Start a new skill immediately. Set target_skill_id.
7. **answer_only** — The user's question can be answered directly without \
   any skill.
8. **handoff_human** — The request requires human intervention.
9. **clarify** — The user's intent is ambiguous. Set clarification_question.

## Output Format

Respond with a JSON object (and nothing else):

```json
{{
  "decision": "continue_active|switch_to_pending|create_pending|update_pending|complete_task|start_new_task|answer_only|handoff_human|clarify",
  "target_skill_id": "",
  "target_step_id": "",
  "user_intent": "Brief description of user's intent",
  "general_intent": "High-level category (e.g., question, request, complaint)",
  "clarification_question": "If clarify, what to ask",
  "selected_task_id": "If switch_to_pending, target task ID",
  "slot_hints": {{}}
}}
```
"""


# ── Router 类 ─────────────────────────────────────────────────────────────


class Router:
    """Router 决策层。

    决定用户输入应该走哪个流程：
    - 继续当前任务
    - 切换任务
    - 创建/更新待处理任务
    - 开始新任务
    - 直接回答
    - 转人工
    - 澄清
    """

    def __init__(self, agent_id: str | None = None):
        self._agent_id = agent_id
        self._model = None
        self._formatter = None

    async def _ensure_model(self) -> None:
        """延迟创建模型。"""
        if self._model is not None:
            return
        try:
            self._model, self._formatter = create_model_and_formatter(
                agent_id=self._agent_id,
            )
        except Exception as e:
            logger.warning("Router 无法创建 LLM 模型: %s", e)

    async def decide(
        self,
        user_input: str,
        session_state: dict[str, Any] | None = None,
        available_skills: list[dict[str, Any]] | None = None,
        pending_tasks: list[dict[str, Any]] | None = None,
    ) -> RouterDecision:
        """执行路由决策。

        Args:
            user_input: 用户输入文本。
            session_state: 当前会话状态（active_skill_id, active_node_id, skill_stack）。
            available_skills: 可用技能列表（id + name + description）。
            pending_tasks: 待处理任务列表（task_id + user_intent + skill_id）。

        Returns:
            RouterDecision 决策结果。
        """
        session_state = session_state or {}
        available_skills = available_skills or []
        pending_tasks = pending_tasks or []

        # 无模型时降级为 answer_only
        await self._ensure_model()
        if self._model is None:
            return RouterDecision(
                decision=RouterDecisionValue.ANSWER_ONLY,
                user_intent=user_input[:200],
                general_intent="no_model",
            )

        # 构建可用技能文本
        if available_skills:
            skills_text = "\n".join(
                f"  - {s.get('id', '')}: {s.get('name', '')} — {s.get('description', '')}"
                for s in available_skills
            )
        else:
            skills_text = "  (无可用技能)"

        # 构建待处理任务文本
        if pending_tasks:
            tasks_text = "\n".join(
                f"  - {t.get('task_id', '')}: {t.get('user_intent', '')} (skill: {t.get('skill_id', '')})"
                for t in pending_tasks
            )
        else:
            tasks_text = "  (无待处理任务)"

        # 构建系统 prompt
        prompt = ROUTER_SYSTEM_PROMPT.format(
            available_skills=skills_text,
            pending_tasks=tasks_text,
            active_skill_id=session_state.get("active_skill_id", ""),
            active_node_id=session_state.get("active_node_id", ""),
            skill_stack_depth=len(session_state.get("skill_stack", [])),
            user_input=user_input,
        )

        messages: list[Msg] = [
            Msg(
                name="system",
                role="system",
                content=[TextBlock(type="text", text=prompt)],
            ),
        ]

        # 调用 LLM
        try:
            raw_response = await consume_model_response(self._model, messages)
        except Exception as e:
            logger.error("Router LLM 调用失败: %s", e)
            return RouterDecision(
                decision=RouterDecisionValue.ANSWER_ONLY,
                user_intent=user_input[:200],
                general_intent="llm_error",
            )

        # 解析 JSON
        decision = self._parse_decision(raw_response)

        # 校正决策
        decision = self._normalize_decision(decision, available_skills, pending_tasks)

        return decision

    def _parse_decision(self, raw_response: str) -> RouterDecision:
        """解析 LLM 的 JSON 响应。"""
        json_str = self._extract_json(raw_response)
        if not json_str:
            logger.warning("Router: 未找到 JSON，降级为 answer_only")
            return RouterDecision(
                decision=RouterDecisionValue.ANSWER_ONLY,
                user_intent=raw_response[:200],
                reasoning="No JSON found; treating as answer_only",
            )

        try:
            data = json.loads(json_str)
        except json.JSONDecodeError as e:
            logger.warning("Router: JSON 解析失败: %s", e)
            return RouterDecision(
                decision=RouterDecisionValue.ANSWER_ONLY,
                user_intent=raw_response[:200],
            )

        # 映射决策字符串
        decision_str = data.get("decision", "answer_only")
        try:
            decision_value = RouterDecisionValue(decision_str)
        except ValueError:
            logger.warning("Router: 未知决策 '%s'，降级为 answer_only", decision_str)
            decision_value = RouterDecisionValue.ANSWER_ONLY

        return RouterDecision(
            decision=decision_value,
            target_skill_id=data.get("target_skill_id", ""),
            target_step_id=data.get("target_step_id", ""),
            user_intent=data.get("user_intent", ""),
            general_intent=data.get("general_intent", ""),
            clarification_question=data.get("clarification_question", ""),
            selected_task_id=data.get("selected_task_id", ""),
            slot_hints=data.get("slot_hints", {}),
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

    def _normalize_decision(
        self,
        decision: RouterDecision,
        available_skills: list[dict[str, Any]],
        pending_tasks: list[dict[str, Any]],
    ) -> RouterDecision:
        """校正 LLM 输出。

        - target_skill_id 不在可用技能中则清空
        - start_new_task 无有效 skill_id 则降级为 clarify
        - switch_to_pending 无有效 task_id 则降级为 clarify
        """
        skill_ids = {s.get("id", "") for s in available_skills}
        task_ids = {t.get("task_id", "") for t in pending_tasks}

        # 校正 target_skill_id
        if decision.target_skill_id and decision.target_skill_id not in skill_ids:
            logger.warning(
                "Router: target_skill_id '%s' 不在可用技能中，清空",
                decision.target_skill_id,
            )
            decision.target_skill_id = ""

        # start_new_task 无有效 skill_id 则降级
        if (
            decision.decision == RouterDecisionValue.START_NEW_TASK
            and not decision.target_skill_id
        ):
            logger.warning(
                "Router: start_new_task 无有效 skill_id，降级为 clarify",
            )
            decision.decision = RouterDecisionValue.CLARIFY
            if not decision.clarification_question:
                decision.clarification_question = "请问您需要哪方面的帮助？"

        # switch_to_pending 无有效 task_id 则降级
        if (
            decision.decision == RouterDecisionValue.SWITCH_TO_PENDING
            and decision.selected_task_id
            and decision.selected_task_id not in task_ids
        ):
            logger.warning(
                "Router: switch_to_pending 无有效 task_id，降级为 clarify",
            )
            decision.decision = RouterDecisionValue.CLARIFY
            if not decision.clarification_question:
                decision.clarification_question = "请问您想切换到哪个任务？"

        return decision


# 单例
_router: Router | None = None


def get_router(agent_id: str | None = None) -> Router:
    """获取 Router 单例。"""
    global _router
    if _router is None:
        _router = Router(agent_id=agent_id)
    return _router
