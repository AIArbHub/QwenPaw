# -*- coding: utf-8 -*-
"""StepAgent — single-step execution engine for the SkillCard state machine.

Each conversation turn is processed by ``StepAgent.run()``, which:
1. Builds a prompt from the current node + available next steps
2. Calls the LLM via ``model_factory.create_model_and_formatter()``
3. Parses the JSON response into a ``StepDecision``
4. Returns the decision for the runtime to apply

The StepAgent does NOT execute tools or advance the state machine — that
is the Runtime's job. The StepAgent only *decides* what to do next.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from ..agents.model_factory import create_model_and_formatter
from ..framework.message import Msg, TextBlock
from ..utils.model_response import consume_model_response
from .schema import SkillCard, SkillGraphNode, StepAction, StepDecision
from .prompts import build_step_agent_prompt

logger = logging.getLogger(__name__)


class StepAgent:
    """Single-step decision engine driven by LLM.

    Usage:
        agent = StepAgent(agent_id="arbitrator")
        decision = await agent.run(card, current_node, user_message, context)
    """

    def __init__(
        self,
        agent_id: str | None = None,
        model_slot_override: Any = None,
    ):
        """Initialize the StepAgent.

        Args:
            agent_id: Agent ID for model configuration. If None, uses
                      the current context's agent.
            model_slot_override: Optional model override.
        """
        self._agent_id = agent_id
        self._model_slot_override = model_slot_override
        self._model = None
        self._formatter = None

    async def _ensure_model(self) -> None:
        """Lazily create the model and formatter on first use."""
        if self._model is not None:
            return
        self._model, self._formatter = create_model_and_formatter(
            agent_id=self._agent_id,
            model_slot_override=self._model_slot_override,
        )

    async def run(
        self,
        card: SkillCard,
        current_node: SkillGraphNode,
        user_message: str,
        context: dict[str, Any] | None = None,
        history: list[dict[str, str]] | None = None,
    ) -> StepDecision:
        """Process one conversation turn and return a decision.

        Args:
            card: The active SkillCard.
            current_node: The currently active node.
            user_message: The user's input for this turn.
            context: Execution context (collected info, tool results).
            history: Mini conversation history for this skill instance.

        Returns:
            A StepDecision indicating what action to take.
        """
        await self._ensure_model()

        # Build the system prompt
        system_prompt = build_step_agent_prompt(card, current_node, context)

        # Build messages
        messages: list[Msg] = [
            Msg(
                name="system",
                role="system",
                content=[TextBlock(type="text", text=system_prompt)],
            ),
        ]

        # Add history messages (if any)
        if history:
            for msg in history[-10:]:  # Keep last 10 turns
                role = msg.get("role", "user")
                text = msg.get("text", "")
                if text:
                    messages.append(
                        Msg(
                            name=role,
                            role=role,
                            content=[TextBlock(type="text", text=text)],
                        ),
                    )

        # Add current user message
        messages.append(
            Msg(
                name="user",
                role="user",
                content=[TextBlock(type="text", text=user_message)],
            ),
        )

        # Call the model
        try:
            raw_response = await consume_model_response(self._model, messages)
        except Exception as e:
            logger.error("StepAgent LLM call failed: %s", e)
            # Fallback: ask the user for clarification
            return StepDecision(
                action=StepAction.ASK_USER,
                content="抱歉，我在处理时遇到了问题，能否请您重新说明一下需求？",
                reasoning=f"LLM call failed: {e}",
            )

        # Parse the JSON response
        decision = self._parse_decision(raw_response)

        # Validate the decision against the graph
        decision = self._validate_decision(decision, card, current_node)

        return decision

    def _parse_decision(self, raw_response: str) -> StepDecision:
        """Parse the LLM's JSON response into a StepDecision.

        Handles common LLM output issues:
        - JSON wrapped in markdown code blocks
        - Extra text before/after the JSON
        - Missing fields (filled with defaults)
        """
        # Try to extract JSON from the response
        json_str = self._extract_json(raw_response)

        if not json_str:
            # If no JSON found, treat the entire response as a reply
            logger.warning(
                "StepAgent: no JSON found in response, treating as reply: %s",
                raw_response[:200],
            )
            return StepDecision(
                action=StepAction.REPLY,
                content=raw_response.strip(),
                reasoning="No JSON structure detected; treating as plain reply",
            )

        try:
            data = json.loads(json_str)
        except json.JSONDecodeError as e:
            logger.warning("StepAgent: JSON parse failed: %s", e)
            return StepDecision(
                action=StepAction.REPLY,
                content=raw_response.strip(),
                reasoning=f"JSON parse error: {e}",
            )

        # Map action string to enum, with fallback
        action_str = data.get("action", "reply")
        try:
            action = StepAction(action_str)
        except ValueError:
            logger.warning("StepAgent: unknown action '%s', defaulting to reply", action_str)
            action = StepAction.REPLY

        return StepDecision(
            action=action,
            content=data.get("content", ""),
            next_step_id=data.get("next_step_id", ""),
            tool_name=data.get("tool_name", ""),
            tool_args=data.get("tool_args", {}),
            knowledge_query=data.get("knowledge_query", ""),
            is_step_completed=bool(data.get("is_step_completed", False)),
            reasoning=data.get("reasoning", ""),
        )

    def _extract_json(self, text: str) -> str | None:
        """Extract a JSON object from text that may contain markdown."""
        # Try to find JSON in a code block
        code_block_pattern = r"```(?:json)?\s*\n?(.*?)\n?\s*```"
        match = re.search(code_block_pattern, text, re.DOTALL)
        if match:
            return match.group(1).strip()

        # Try to find a raw JSON object
        # Find the first { and the last }
        first_brace = text.find("{")
        last_brace = text.rfind("}")
        if first_brace != -1 and last_brace != -1 and last_brace > first_brace:
            return text[first_brace : last_brace + 1]

        return None

    def _validate_decision(
        self,
        decision: StepDecision,
        card: SkillCard,
        current_node: SkillGraphNode,
    ) -> StepDecision:
        """Validate and sanitize the decision against the graph structure.

        Ensures:
        - next_step_id (for ADVANCE) references an existing node
        - Terminal nodes don't produce ADVANCE actions
        - tool_call nodes produce CALL_TOOL actions (advisory, not forced)
        """
        from .schema import SkillGraphNode_Type

        # If advancing, validate the target node
        if decision.action == StepAction.ADVANCE and decision.next_step_id:
            node_ids = {n.id for n in card.nodes}
            if decision.next_step_id not in node_ids:
                logger.warning(
                    "StepAgent: next_step_id '%s' not in graph, "
                    "falling back to reply",
                    decision.next_step_id,
                )
                decision.action = StepAction.REPLY
                decision.next_step_id = ""
                decision.is_step_completed = False

        # If current node is terminal, don't allow advance
        if current_node.type == SkillGraphNode_Type.TERMINAL:
            if decision.action == StepAction.ADVANCE:
                decision.action = StepAction.REPLY
                decision.is_step_completed = True

        # If advancing without a target, try to auto-select the first
        # available next step
        if decision.action == StepAction.ADVANCE and not decision.next_step_id:
            outgoing = sorted(
                [e for e in card.edges if e.from_node == current_node.id],
                key=lambda e: e.priority,
            )
            if outgoing:
                decision.next_step_id = outgoing[0].to_node
                logger.info(
                    "StepAgent: auto-selected next_step '%s' (priority %d)",
                    decision.next_step_id,
                    outgoing[0].priority,
                )
            else:
                # No outgoing edges — treat as terminal
                decision.action = StepAction.REPLY
                decision.is_step_completed = True

        return decision
