# -*- coding: utf-8 -*-
"""Skill runtime — state machine execution engine with task frame suspend/restore.

The runtime is responsible for:
1. Starting and stopping skills
2. Applying StepDecisions (advancing nodes, updating context)
3. Suspending the current skill when a followup interrupts (push to stack)
4. Restoring a suspended skill after the followup completes (pop from stack)
5. Managing pending tasks queue

Runtime state is persisted in the session JSON via ``SkillRuntimeState``.
The runtime itself is stateless between calls — all state is carried in
the ``SkillRuntimeState`` object passed by the caller.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from .schema import (
    SkillCard,
    SkillGraphNode,
    SkillGraphNode_Type,
    StepAction,
    StepDecision,
    TaskFrame,
    SkillRuntimeState,
)
from .store import load_skill

logger = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class SkillRuntime:
    """Stateless runtime that operates on a ``SkillRuntimeState``.

    Usage:
        runtime = SkillRuntime()
        state = SkillRuntimeState()

        # Start a skill
        runtime.start_skill(state, "arb_cross_examination")

        # Each turn: StepAgent decides, runtime applies
        decision = await step_agent.run(card, node, user_msg, state.active_context)
        runtime.apply_decision(state, decision, card)

        # Suspend for a followup
        runtime.suspend_current(state, reason="followup")

        # ... handle followup ...

        # Restore
        runtime.restore_task_frame(state)
    """

    def start_skill(
        self,
        state: SkillRuntimeState,
        skill_id: str,
        initial_context: dict[str, Any] | None = None,
    ) -> SkillCard | None:
        """Start executing a new skill.

        If a skill is already active, it is suspended first (pushed to stack).

        Args:
            state: The runtime state to modify.
            skill_id: The SkillCard ID to start.
            initial_context: Optional initial context for the skill.

        Returns:
            The loaded SkillCard, or None if not found.
        """
        card = load_skill(skill_id)
        if card is None:
            logger.error("Cannot start skill '%s': not found", skill_id)
            return None

        # Suspend current skill if one is active
        if state.active_skill_id:
            self.suspend_current(state, reason=f"switching to {skill_id}")

        state.active_skill_id = skill_id
        state.active_node_id = card.start_node_id
        state.active_context = initial_context or {}
        state.awaiting_input = False

        logger.info(
            "Started skill '%s' at node '%s'",
            skill_id,
            card.start_node_id,
        )
        return card

    async def apply_decision(
        self,
        state: SkillRuntimeState,
        decision: StepDecision,
        card: SkillCard,
    ) -> str:
        """Apply a StepDecision to the runtime state.

        Args:
            state: The runtime state to modify.
            decision: The StepAgent's decision for this turn.
            card: The active SkillCard.

        Returns:
            A status string: "replied" / "advanced" / "tool_called" /
            "knowledge_queried" / "asked_user" / "clarified" /
            "handoff" / "completed" / "no_action"
        """
        # Record the decision in context
        state.active_context.setdefault("_decisions", []).append(
            {
                "action": decision.action.value,
                "node": state.active_node_id,
                "reasoning": decision.reasoning,
                "timestamp": _now_iso(),
            }
        )

        if decision.action == StepAction.ADVANCE:
            return self._advance(state, decision, card)

        elif decision.action == StepAction.HANDOFF:
            return self._handoff(state, decision, card)

        elif decision.action == StepAction.CALL_TOOL:
            # Record the tool call in context — actual execution is the
            # caller's responsibility (the runtime doesn't execute tools)
            state.active_context.setdefault("_pending_tool_calls", []).append(
                {
                    "tool_name": decision.tool_name,
                    "tool_args": decision.tool_args,
                    "node": state.active_node_id,
                }
            )
            state.awaiting_input = False
            return "tool_called"

        elif decision.action == StepAction.QUERY_KNOWLEDGE:
            # 获取当前节点的 knowledge_scope 或 SkillCard 的全局 scope
            current_node = self._get_node(card, state.active_node_id)
            scope = ""
            if current_node and current_node.knowledge_scope:
                scope = current_node.knowledge_scope
            elif card.knowledge_scope:
                scope = card.knowledge_scope

            # 延迟导入知识库服务，避免循环依赖
            try:
                from aiarb.builtin_plugins.knowledge_base.backend.service import (
                    KnowledgeBaseService,
                )

                kb_svc = KnowledgeBaseService()
                await kb_svc.initialize()
                search_result = await kb_svc.search(
                    query=decision.knowledge_query,
                    top_k=5,
                    knowledge_scope=scope,
                )
                # 兼容旧格式：提取 chunks 列表
                results = search_result.get("chunks", [])
                concepts = search_result.get("concepts", [])
                citations = search_result.get("citations", [])
            except Exception as e:
                logger.warning(
                    "知识库检索失败，回退为空结果: %s",
                    e,
                )
                results = []
                concepts = []
                citations = []

            # 将检索结果存入 active_context（含概念和引用）
            state.active_context.setdefault("_knowledge_results", []).append(
                {
                    "query": decision.knowledge_query,
                    "node": state.active_node_id,
                    "results": results,
                    "concepts": concepts,
                    "citations": citations,
                    "timestamp": _now_iso(),
                }
            )
            # 同时保留 _pending_queries 以兼容旧逻辑
            state.active_context.setdefault("_pending_queries", []).append(
                {
                    "query": decision.knowledge_query,
                    "node": state.active_node_id,
                }
            )
            state.awaiting_input = False
            return "knowledge_queried"

        elif decision.action in (StepAction.ASK_USER, StepAction.CLARIFY):
            state.awaiting_input = True
            return "asked_user" if decision.action == StepAction.ASK_USER else "clarified"

        elif decision.action == StepAction.REPLY:
            state.awaiting_input = False
            # If the step is marked completed, auto-advance if possible
            if decision.is_step_completed:
                self._auto_advance(state, card)
            return "replied"

        return "no_action"

    def _advance(
        self,
        state: SkillRuntimeState,
        decision: StepDecision,
        card: SkillCard,
    ) -> str:
        """Advance to the next node."""
        target = decision.next_step_id
        if not target:
            target = self._auto_advance(state, card)

        if target:
            state.active_node_id = target
            state.awaiting_input = False

            # Check if we reached a terminal node
            node = self._get_node(card, target)
            if node and node.type == SkillGraphNode_Type.TERMINAL:
                self._complete_skill(state)
                return "completed"

            logger.info("Advanced to node '%s' in skill '%s'", target, state.active_skill_id)
            return "advanced"

        logger.warning("Cannot advance: no target node available")
        return "no_action"

    def _handoff(
        self,
        state: SkillRuntimeState,
        decision: StepDecision,
        card: SkillCard,
    ) -> str:
        """Handle handoff — transfer to another skill or agent."""
        target = decision.next_step_id

        # If target is a node in the current card, treat as advance
        if target and self._get_node(card, target):
            return self._advance(state, decision, card)

        # If target looks like a skill ID, start that skill
        if target:
            new_card = load_skill(target)
            if new_card:
                self.suspend_current(state, reason=f"handoff to {target}")
                self.start_skill(state, target)
                return "handoff"

        logger.warning("Handoff target '%s' not found", target)
        return "no_action"

    def _auto_advance(self, state: SkillRuntimeState, card: SkillCard) -> str | None:
        """Auto-advance to the highest-priority next node.

        Returns the node ID advanced to, or None if no outgoing edges.
        """
        outgoing = sorted(
            [e for e in card.edges if e.from_node == state.active_node_id],
            key=lambda e: e.priority,
        )
        if outgoing:
            state.active_node_id = outgoing[0].to_node
            node = self._get_node(card, outgoing[0].to_node)
            if node and node.type == SkillGraphNode_Type.TERMINAL:
                self._complete_skill(state)
            return outgoing[0].to_node
        return None

    def _complete_skill(self, state: SkillRuntimeState) -> None:
        """Mark the current skill as complete and restore from stack if available."""
        completed_skill = state.active_skill_id
        logger.info("Skill '%s' completed", completed_skill)

        state.active_skill_id = ""
        state.active_node_id = ""
        state.active_context = {}
        state.awaiting_input = False

        # If there are suspended skills on the stack, restore the top one
        if state.skill_stack:
            self.restore_task_frame(state)

    def suspend_current(
        self,
        state: SkillRuntimeState,
        reason: str = "followup",
    ) -> TaskFrame | None:
        """Suspend the current skill and push it onto the skill stack.

        Args:
            state: The runtime state to modify.
            reason: Why the skill is being suspended.

        Returns:
            The created TaskFrame, or None if no active skill.
        """
        if not state.active_skill_id:
            return None

        frame = TaskFrame(
            skill_id=state.active_skill_id,
            current_node_id=state.active_node_id,
            context=state.active_context.copy(),
            history=[],  # History is managed by the caller
            suspended_reason=reason,
            created_at=_now_iso(),
        )

        state.skill_stack.append(frame)
        logger.info(
            "Suspended skill '%s' at node '%s' (reason: %s)",
            frame.skill_id,
            frame.current_node_id,
            reason,
        )

        # Clear active state
        state.active_skill_id = ""
        state.active_node_id = ""
        state.active_context = {}
        state.awaiting_input = False

        return frame

    def restore_task_frame(self, state: SkillRuntimeState) -> TaskFrame | None:
        """Restore the most recently suspended skill from the stack.

        Args:
            state: The runtime state to modify.

        Returns:
            The restored TaskFrame, or None if the stack is empty.
        """
        if not state.skill_stack:
            return None

        frame = state.skill_stack.pop()

        state.active_skill_id = frame.skill_id
        state.active_node_id = frame.current_node_id
        state.active_context = frame.context
        state.awaiting_input = False

        logger.info(
            "Restored skill '%s' at node '%s'",
            frame.skill_id,
            frame.current_node_id,
        )
        return frame

    def add_pending_task(
        self,
        state: SkillRuntimeState,
        skill_id: str,
        context: dict[str, Any] | None = None,
    ) -> None:
        """Add a task to the pending queue.

        Pending tasks are started when the current skill completes or
        is suspended.
        """
        frame = TaskFrame(
            skill_id=skill_id,
            current_node_id="",
            context=context or {},
            created_at=_now_iso(),
        )
        state.pending_tasks.append(frame)
        logger.info("Added pending task: %s", skill_id)

    def pop_pending_task(self, state: SkillRuntimeState) -> TaskFrame | None:
        """Pop the next pending task from the queue."""
        if not state.pending_tasks:
            return None
        return state.pending_tasks.pop(0)

    def get_current_node(self, card: SkillCard, state: SkillRuntimeState) -> SkillGraphNode | None:
        """Get the currently active node from the card."""
        return self._get_node(card, state.active_node_id)

    def is_active(self, state: SkillRuntimeState) -> bool:
        """Check if a skill is currently active."""
        return bool(state.active_skill_id)

    def is_terminal(self, card: SkillCard, state: SkillRuntimeState) -> bool:
        """Check if the current node is a terminal node."""
        node = self.get_current_node(card, state)
        return node is not None and node.type == SkillGraphNode_Type.TERMINAL

    def _get_node(self, card: SkillCard, node_id: str) -> SkillGraphNode | None:
        """Find a node by ID in the card."""
        for node in card.nodes:
            if node.id == node_id:
                return node
        return None

    def to_dict(self, state: SkillRuntimeState) -> dict[str, Any]:
        """Serialize the runtime state to a dict for session persistence."""
        return state.model_dump()

    def from_dict(self, data: dict[str, Any]) -> SkillRuntimeState:
        """Deserialize the runtime state from a dict."""
        return SkillRuntimeState.model_validate(data)
