# -*- coding: utf-8 -*-
"""Integration adapter between the SOP state machine and the moot orchestrator.

This module provides a lightweight bridge that allows the SOP SkillCard
state machine to guide arbitration workflows in the moot module.

The integration is **optional** — if a SkillCard is associated with a
moot case, the SOP runtime guides the process; otherwise, the existing
moot stage management is used as-is.

Key mappings:
- Moot ``CaseStage`` → SOP ``SkillGraphNode`` (via stage-to-node mapping)
- Moot case events → SOP runtime context
- Moot message history → SOP StepAgent history
- Stage transitions → SOP ``advance`` decisions

Usage:
    adapter = MootSOPAdapter()
    await adapter.bind_skill_to_case(case_id, "arb_cross_examination")
    decision = await adapter.get_next_step(case_id, user_message)
"""

from __future__ import annotations

import logging
from typing import Any

from ..moot.models import CaseStage, MootCase, CASE_STAGE_LABELS, TRIAL_STAGE_FLOW
from .schema import (
    SkillCard,
    SkillGraphNode,
    SkillGraphNode_Type,
    StepDecision,
    StepAction,
    SkillRuntimeState,
)
from .store import load_skill
from .runtime import SkillRuntime
from .step_agent import StepAgent

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Stage ↔ Node mapping
# ---------------------------------------------------------------------------

# Map moot trial stages to SOP node IDs (for the built-in arbitration skills)
TRIAL_STAGE_TO_NODE: dict[CaseStage, str] = {
    CaseStage.OPENING: "start",
    CaseStage.PLEADING: "collect_info",  # Maps to "collect facts" node
    CaseStage.EVIDENCE: "review_evidence",  # Maps to "review evidence" node
    CaseStage.DEBATE: "ask_party",  # Maps to "ask party" node
    CaseStage.CLOSING: "record_conclusion",  # Maps to "record conclusion" node
    CaseStage.DELIBERATION: "decide_admissibility",  # Maps to "decision" node
    CaseStage.CLOSED: "terminal",
}

# Reverse mapping: SOP node type → moot stage
NODE_TYPE_TO_STAGE: dict[SkillGraphNode_Type, CaseStage] = {
    SkillGraphNode_Type.START: CaseStage.OPENING,
    SkillGraphNode_Type.ACTION: CaseStage.PLEADING,
    SkillGraphNode_Type.DECISION: CaseStage.DELIBERATION,
    SkillGraphNode_Type.TOOL_CALL: CaseStage.EVIDENCE,
    SkillGraphNode_Type.KNOWLEDGE_QUERY: CaseStage.EVIDENCE,
    SkillGraphNode_Type.REPLY: CaseStage.CLOSING,
    SkillGraphNode_Type.HANDOFF: CaseStage.PLEADING,
    SkillGraphNode_Type.TERMINAL: CaseStage.CLOSED,
}


class MootSOPAdapter:
    """Adapter that connects the SOP state machine with the moot orchestrator.

    This adapter maintains an in-memory mapping of case_id → SkillRuntimeState.
    For persistence, the caller should serialize the state to the case's
    metadata or session JSON.
    """

    def __init__(self, agent_id: str | None = None):
        self._agent_id = agent_id
        self._case_states: dict[str, SkillRuntimeState] = {}
        self._case_skills: dict[str, str] = {}  # case_id → skill_id
        self._runtime = SkillRuntime()

    async def bind_skill_to_case(
        self,
        case_id: str,
        skill_id: str,
        initial_context: dict[str, Any] | None = None,
    ) -> SkillCard | None:
        """Associate a SkillCard with a moot case and start the SOP runtime.

        Args:
            case_id: The moot case ID.
            skill_id: The SkillCard ID to bind.
            initial_context: Optional initial context (e.g., case info).

        Returns:
            The loaded SkillCard, or None if not found.
        """
        card = load_skill(skill_id)
        if card is None:
            logger.error("Cannot bind skill '%s' to case '%s': skill not found", skill_id, case_id)
            return None

        state = SkillRuntimeState()
        started_card = self._runtime.start_skill(state, skill_id, initial_context)
        if started_card is None:
            return None

        self._case_states[case_id] = state
        self._case_skills[case_id] = skill_id

        logger.info("Bound skill '%s' to case '%s'", skill_id, case_id)
        return started_card

    def unbind_skill(self, case_id: str) -> None:
        """Remove the SOP binding from a case."""
        self._case_states.pop(case_id, None)
        self._case_skills.pop(case_id, None)
        logger.info("Unbound SOP from case '%s'", case_id)

    def is_bound(self, case_id: str) -> bool:
        """Check if a case has an associated SkillCard."""
        return case_id in self._case_skills

    def get_state(self, case_id: str) -> SkillRuntimeState | None:
        """Get the runtime state for a case."""
        return self._case_states.get(case_id)

    def get_skill_id(self, case_id: str) -> str | None:
        """Get the SkillCard ID bound to a case."""
        return self._case_skills.get(case_id)

    async def get_next_step(
        self,
        case_id: str,
        user_message: str,
        case: MootCase | None = None,
        history: list[dict[str, str]] | None = None,
    ) -> StepDecision | None:
        """Get the next arbitration step using the StepAgent.

        Args:
            case_id: The moot case ID.
            user_message: The user's input for this turn.
            case: Optional MootCase for additional context.
            history: Optional conversation history.

        Returns:
            A StepDecision, or None if the case has no SOP binding.
        """
        state = self._case_states.get(case_id)
        if state is None or not state.active_skill_id:
            return None

        card = load_skill(state.active_skill_id)
        if card is None:
            logger.error("Bound skill '%s' not found for case '%s'", state.active_skill_id, case_id)
            return None

        current_node = self._runtime.get_current_node(card, state)
        if current_node is None:
            logger.error("Current node '%s' not found in skill '%s'", state.active_node_id, state.active_skill_id)
            return None

        # Build context from case info
        context = state.active_context.copy()
        if case:
            context["case_name"] = case.case_name
            context["current_stage"] = case.current_stage.value
            context["participants"] = [p.display_name for p in case.participants]
            context["case_description"] = case.case_description

        # Run the StepAgent
        agent = StepAgent(agent_id=self._agent_id)
        decision = await agent.run(
            card=card,
            current_node=current_node,
            user_message=user_message,
            context=context,
            history=history,
        )

        # Apply the decision to the runtime
        self._runtime.apply_decision(state, decision, card)

        return decision

    def sync_stage_to_node(
        self,
        case_id: str,
        stage: CaseStage,
    ) -> bool:
        """Sync the moot case stage to the SOP runtime.

        When the moot orchestrator advances the stage, this method updates
        the SOP runtime to the corresponding node.

        Args:
            case_id: The moot case ID.
            stage: The new moot case stage.

        Returns:
            True if the SOP state was updated, False if no binding exists.
        """
        state = self._case_states.get(case_id)
        if state is None:
            return False

        card = load_skill(state.active_skill_id) if state.active_skill_id else None
        if card is None:
            return False

        # Map the stage to a node ID
        target_node_id = TRIAL_STAGE_TO_NODE.get(stage)
        if target_node_id and any(n.id == target_node_id for n in card.nodes):
            state.active_node_id = target_node_id
            logger.info(
                "Synced case '%s' stage '%s' to node '%s'",
                case_id,
                stage.value,
                target_node_id,
            )
            return True

        # If no direct mapping, try to find a node by type
        node_type = NODE_TYPE_TO_STAGE.get.__self__  # Not used — placeholder
        for node_type, mapped_stage in NODE_TYPE_TO_STAGE.items():
            if mapped_stage == stage:
                matching_nodes = [n for n in card.nodes if n.type == node_type]
                if matching_nodes:
                    state.active_node_id = matching_nodes[0].id
                    logger.info(
                        "Synced case '%s' stage '%s' to node '%s' (by type)",
                        case_id,
                        stage.value,
                        matching_nodes[0].id,
                    )
                    return True

        return False

    def sync_node_to_stage(
        self,
        case_id: str,
    ) -> CaseStage | None:
        """Determine the moot case stage from the current SOP node.

        Args:
            case_id: The moot case ID.

        Returns:
            The corresponding CaseStage, or None if no binding exists.
        """
        state = self._case_states.get(case_id)
        if state is None or not state.active_skill_id:
            return None

        card = load_skill(state.active_skill_id)
        if card is None:
            return None

        current_node = self._runtime.get_current_node(card, state)
        if current_node is None:
            return None

        return NODE_TYPE_TO_STAGE.get(current_node.type)

    def suspend_for_interruption(
        self,
        case_id: str,
        reason: str = "interruption",
    ) -> bool:
        """Suspend the current SOP skill when an interruption occurs.

        This is used when a party raises a new issue mid-hearing — the
        current arbitration flow is suspended, the new issue is handled,
        and then the flow is restored.

        Args:
            case_id: The moot case ID.
            reason: Why the interruption occurred.

        Returns:
            True if suspended, False if no active skill.
        """
        state = self._case_states.get(case_id)
        if state is None:
            return False

        frame = self._runtime.suspend_current(state, reason=reason)
        return frame is not None

    def restore_after_interruption(
        self,
        case_id: str,
    ) -> bool:
        """Restore the suspended SOP skill after an interruption is handled.

        Args:
            case_id: The moot case ID.

        Returns:
            True if restored, False if no suspended skill.
        """
        state = self._case_states.get(case_id)
        if state is None:
            return False

        frame = self._runtime.restore_task_frame(state)
        return frame is not None

    def get_current_node_info(
        self,
        case_id: str,
    ) -> dict[str, Any] | None:
        """Get information about the current SOP node for a case.

        Returns a dict with node_id, title, description, and type,
        or None if no binding exists.
        """
        state = self._case_states.get(case_id)
        if state is None or not state.active_skill_id:
            return None

        card = load_skill(state.active_skill_id)
        if card is None:
            return None

        node = self._runtime.get_current_node(card, state)
        if node is None:
            return None

        return {
            "node_id": node.id,
            "title": node.title,
            "description": node.description,
            "type": node.type.value,
            "skill_id": state.active_skill_id,
            "skill_name": card.name,
            "awaiting_input": state.awaiting_input,
            "stack_depth": len(state.skill_stack),
            "pending_count": len(state.pending_tasks),
        }

    def serialize_state(self, case_id: str) -> dict[str, Any] | None:
        """Serialize the case's SOP state for persistence.

        Returns a dict that can be stored in the case's metadata.
        """
        state = self._case_states.get(case_id)
        if state is None:
            return None
        return {
            "skill_id": self._case_skills.get(case_id, ""),
            "runtime_state": self._runtime.to_dict(state),
        }

    def deserialize_state(self, case_id: str, data: dict[str, Any]) -> None:
        """Restore the case's SOP state from persisted data."""
        skill_id = data.get("skill_id", "")
        runtime_data = data.get("runtime_state", {})
        if skill_id:
            self._case_skills[case_id] = skill_id
            self._case_states[case_id] = self._runtime.from_dict(runtime_data)
            logger.info("Restored SOP state for case '%s' (skill: '%s')", case_id, skill_id)
