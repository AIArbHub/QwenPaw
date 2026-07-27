# -*- coding: utf-8 -*-
"""SOP 编排器 - 借鉴 StaffDeck agent_loop.py 的编排模式。

核心职责：把 StepAgent + Runtime + 知识检索 + 工具执行编排成闭环。
解决"三处断裂"：QUERY_KNOWLEDGE 不闭环、CALL_TOOL 不执行、Router 死代码。
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from .schema import SkillCard, SkillGraphNode, StepAction, StepDecision
from .runtime import SkillRuntime
from .step_agent import StepAgent

logger = logging.getLogger(__name__)

MAX_TURN_ITERATIONS = 5  # 单轮最多循环 5 次（检索->工具->检索->工具->回复)


async def run_turn(
    *,
    state: Any,
    card: SkillCard,
    user_message: str,
    history: list[dict[str, Any]] | None = None,
    agent_id: str | None = None,
    enable_router: bool = True,
) -> dict[str, Any]:
    """执行一轮对话，自动闭环知识检索和工具执行。

    流程（借鉴 StaffDeck agent_loop._prepare_turn）：
    1. [可选] Router 决策场景路由
    2. StepAgent 生成 decision
    3. Runtime.apply_decision 应用决策
    4. 若 action == query_knowledge -> 检索 -> 注入 context -> 回到步骤 2
    5. 若 action == call_tool -> 执行工具 -> 注入 context -> 回到步骤 2
    6. 若 action == reply/ask_user/clarify/advance/handoff -> 返回最终回复

    Returns:
        {
            "reply_text": str,
            "decision": StepDecision,
            "state": SkillRuntimeState,
            "status": str,
            "iterations": int,
            "knowledge_used": bool,
            "tools_used": list[str],
        }
    """
    runtime = SkillRuntime()
    step_agent = StepAgent(agent_id=agent_id)
    tools_used: list[str] = []
    knowledge_used = False

    # ---- Router 场景路由（可选，仅在没有活跃 skill 时）----
    if enable_router and not state.active_skill_id:
        router_result = await _try_router_decision(
            user_message=user_message,
            state=state,
            history=history,
            agent_id=agent_id,
        )
        if router_result and router_result.get("skill_id"):
            from .store import load_skill

            new_card = load_skill(router_result["skill_id"])
            if new_card:
                card = new_card
                runtime.start_skill(state, router_result["skill_id"])
                logger.info("Router started skill '%s'", router_result["skill_id"])

    # ---- 主循环 ----
    for iteration in range(1, MAX_TURN_ITERATIONS + 1):
        current_node = runtime.get_current_node(card, state)
        if current_node is None:
            return _result(
                reply_text="当前无活跃节点",
                decision=None, state=state, status="no_node",
                iterations=iteration, knowledge_used=knowledge_used, tools_used=tools_used,
            )

        # StepAgent 决策
        decision = await step_agent.run(
            card=card,
            current_node=current_node,
            user_message=user_message if iteration == 1 else "",
            context=state.active_context,
            history=history if iteration == 1 else None,
        )

        # 校验 allowed_actions
        decision = _validate_against_node_actions(decision, current_node)

        # Runtime 应用决策
        status = await runtime.apply_decision(state, decision, card, agent_id=agent_id)

        action = decision.action.value

        # ---- 闭环：QUERY_KNOWLEDGE ----
        if action == "query_knowledge":
            knowledge_used = True
            # 检索结果已由 runtime 存入 context["_knowledge_results"]
            # 关键：不返回，而是继续循环，让 StepAgent 基于知识结果生成回复
            logger.info(
                "Turn iteration %d: knowledge queried '%s', re-invoking StepAgent",
                iteration, decision.knowledge_query,
            )
            continue

        # ---- 闭环：CALL_TOOL ----
        if action == "call_tool":
            tool_name = decision.tool_name or "unknown"
            tools_used.append(tool_name)
            # 执行工具
            tool_result = await _execute_tool(decision, state, card)
            # 把工具结果注入 context
            if "_tool_results" not in state.active_context:
                state.active_context["_tool_results"] = []
            state.active_context["_tool_results"].append({
                "tool_name": tool_name,
                "tool_args": decision.tool_args,
                "result": tool_result,
                "timestamp": _now_iso(),
            })
            logger.info(
                "Turn iteration %d: tool '%s' executed, re-invoking StepAgent",
                iteration, tool_name,
            )
            continue

        # ---- 终态动作：返回回复 ----
        reply_text = _build_reply_text(decision, status, runtime, card, state)
        return _result(
            reply_text=reply_text,
            decision=decision, state=state, status=status,
            iterations=iteration, knowledge_used=knowledge_used, tools_used=tools_used,
        )

    # 超过最大循环次数，强制返回
    logger.warning("Turn exceeded %d iterations, forcing reply", MAX_TURN_ITERATIONS)
    return _result(
        reply_text="处理超时，请重试或换一种问法。",
        decision=None, state=state, status="max_iterations",
        iterations=MAX_TURN_ITERATIONS, knowledge_used=knowledge_used, tools_used=tools_used,
    )


async def _try_router_decision(
    *,
    user_message: str,
    state: Any,
    history: list[dict] | None,
    agent_id: str | None = None,
) -> dict | None:
    """调用 Router 进行场景路由。

    借鉴 StaffDeck agent_loop._prepare_turn 中的 router.decide 调用。
    """
    try:
        from .router import get_router
        from .store import list_skills

        router = get_router(agent_id=agent_id)

        skills = list_skills(status="active")
        if not skills:
            return None

        # 将 SkillRuntimeState 转为 dict 给 Router
        session_state_dict = {
            "active_skill_id": state.active_skill_id,
            "active_node_id": state.active_node_id,
            "skill_stack": state.skill_stack,
        }

        # 将 pending_tasks (TaskFrame list) 转为 dict list
        pending_tasks_dict = [
            {
                "task_id": t.skill_id,
                "user_intent": "",
                "skill_id": t.skill_id,
            }
            for t in (state.pending_tasks or [])
        ]

        decision = await router.decide(
            user_input=user_message,
            session_state=session_state_dict,
            available_skills=[
                {"id": s.id, "name": s.name, "description": s.description,
                 "trigger_intents": s.trigger_intents or []}
                for s in skills
            ],
            pending_tasks=pending_tasks_dict,
        )

        if decision and decision.decision.value == "start_new_task" and decision.target_skill_id:
            return {"skill_id": decision.target_skill_id}

        return None
    except Exception as e:
        logger.warning("Router decision failed: %s, continuing without router", e)
        return None


def _validate_against_node_actions(
    decision: StepDecision,
    node: SkillGraphNode,
) -> StepDecision:
    """校验 decision 是否在节点 allowed_actions 范围内。

    借鉴 StaffDeck step_agent._available_tools_for_step。
    若节点定义了 allowed_actions 且 decision.action 不在其中，降级为 reply。
    """
    allowed = node.allowed_actions or []
    if not allowed:
        return decision

    action_str = decision.action.value
    simple_allowed = set()
    for a in allowed:
        if isinstance(a, str) and ":" in a:
            simple_allowed.add(a.split(":")[0])
        elif isinstance(a, str):
            simple_allowed.add(a)

    if action_str in simple_allowed:
        return decision

    logger.warning(
        "Action '%s' not in node '%s' allowed_actions %s, downgrading to reply",
        action_str, node.id, allowed,
    )
    decision.action = StepAction.REPLY
    if not decision.content:
        decision.content = "当前步骤不支持此操作。"
    return decision


def _build_reply_text(
    decision: StepDecision,
    status: str,
    runtime: SkillRuntime,
    card: SkillCard,
    state: Any,
) -> str:
    """构建用户可见回复。"""
    if decision.content:
        return decision.content

    if status == "completed":
        return "流程已完成。"

    if decision.action.value == "advance":
        next_node = runtime.get_current_node(card, state)
        if next_node:
            return f"已进入：{next_node.title}"
        return "已推进到下一步"

    if decision.action.value == "ask_user":
        return decision.content or "请提供更多信息。"

    if decision.action.value == "clarify":
        return decision.content or "让我确认一下您的需求。"

    return decision.content or ""


async def _execute_tool(
    decision: StepDecision,
    state: Any,
    card: SkillCard,
) -> str:
    """执行工具调用。

    借鉴 StaffDeck agent_loop._execute_tool_action_cycle。
    通过 QwenPaw 的工具系统查找并执行工具。
    """
    tool_name = decision.tool_name or ""
    tool_args = decision.tool_args or {}

    # 尝试通过 Toolkit 执行工具
    try:
        from ..agents.tools.run_tool_batch import _call_tool, _extract_text

        result = await _call_tool(tool_name, tool_args)
        # ToolChunk 结果提取文本
        text = _extract_text(result)
        if text:
            return text
        # 回退：尝试其他属性
        if hasattr(result, "output"):
            return str(result.output)
        return str(result)
    except Exception as e:
        logger.error("Tool execution failed: %s(%s) -> %s", tool_name, tool_args, e)
        return f"工具执行失败: {e}"


def _result(
    reply_text: str,
    decision: StepDecision | None,
    state: Any,
    status: str,
    iterations: int,
    knowledge_used: bool,
    tools_used: list[str],
) -> dict[str, Any]:
    return {
        "reply_text": reply_text,
        "decision": decision,
        "state": state,
        "status": status,
        "iterations": iterations,
        "knowledge_used": knowledge_used,
        "tools_used": tools_used,
    }


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
