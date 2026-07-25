# -*- coding: utf-8 -*-
"""Distiller — generate SkillCards from documents and SOUL.md persona files.

The distiller uses a three-level degradation strategy for robustness:

1. **Direct generation**: Send the full document to the LLM with the
   distiller prompt. Parse the JSON response into a SkillCard.
2. **Repair retry** (up to 2 times): If validation fails, send the issues
   back to the LLM with the repair prompt. Re-validate the fixed output.
3. **Segmented generation**: If repair fails, split into three stages:
   outline → expand → review. Generate an outline first, then expand
   each section, then review the final result.
4. **Minimum viable draft**: If all else fails, return a minimal SkillCard
   with just start and terminal nodes, plus a note for manual editing.

After generation, a seven-dimension rubric reflection is applied to
evaluate quality. The SkillCard is saved with status ``draft`` until
the user approves it.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from ..agents.model_factory import create_model_and_formatter
from ..framework.message import Msg, TextBlock
from ..utils.model_response import consume_model_response
from .schema import (
    SkillCard,
    SkillGraphNode,
    SkillGraphNode_Type,
    SkillGraphEdge,
)
from .prompts import (
    DISTILLER_SYSTEM_PROMPT,
    DISTILLER_REPAIR_PROMPT,
    RUBRIC_REFLECTION_PROMPT,
)
from .store import save_skill
from .schema import validate_graph

logger = logging.getLogger(__name__)

MAX_REPAIR_RETRIES = 2
MAX_RUBRIC_ROUNDS = 3


class SkillDistiller:
    """Generate SkillCards from documents using LLM.

    Usage:
        distiller = SkillDistiller(agent_id="arbitrator")
        card = await distiller.distill_from_document(
            doc_content="...",
            skill_id="my_skill",
            skill_name="My Skill",
            persona_content=arbitrator_soul_md,
        )
    """

    def __init__(
        self,
        agent_id: str | None = None,
        model_slot_override: Any = None,
    ):
        self._agent_id = agent_id
        self._model_slot_override = model_slot_override
        self._model = None
        self._formatter = None

    async def _ensure_model(self) -> None:
        if self._model is not None:
            return
        self._model, self._formatter = create_model_and_formatter(
            agent_id=self._agent_id,
            model_slot_override=self._model_slot_override,
        )

    async def distill_from_document(
        self,
        doc_content: str,
        skill_id: str,
        skill_name: str = "",
        persona_content: str = "",
        knowledge_scope: str = "",
        tags: list[str] | None = None,
        soul_md_ref: str = "",
    ) -> SkillCard:
        """Generate a SkillCard from document content.

        Uses the three-level degradation strategy.

        Args:
            doc_content: The document text to distill into a skill.
            skill_id: Unique ID for the generated SkillCard.
            skill_name: Human-readable name (auto-generated if empty).
            persona_content: Optional SOUL.md content for persona context.
            knowledge_scope: Optional knowledge filter for the skill.
            tags: Optional tags for search/filtering.
            soul_md_ref: Optional builtins persona reference (e.g., "arbitrator").

        Returns:
            A validated SkillCard (saved to disk with status "draft").
        """
        await self._ensure_model()

        # Truncate document if too long (keep first ~8000 chars for prompt)
        truncated_doc = doc_content[:8000]
        if len(doc_content) > 8000:
            truncated_doc += "\n\n[... document truncated for processing ...]"

        # Level 1: Direct generation
        card = await self._direct_generation(
            truncated_doc,
            skill_id,
            skill_name,
            persona_content,
        )

        if card is not None:
            # Validate and repair if needed
            issues = validate_graph(card)
            if not issues:
                logger.info("Direct generation succeeded for skill '%s'", skill_id)
            else:
                # Level 2: Repair retry
                card = await self._repair_retry(card, issues, truncated_doc, persona_content)

        if card is None:
            # Level 3: Segmented generation
            logger.info("Falling back to segmented generation for '%s'", skill_id)
            card = await self._segmented_generation(
                truncated_doc,
                skill_id,
                skill_name,
                persona_content,
            )

        if card is None:
            # Level 4: Minimum viable draft
            logger.warning("All generation attempts failed, creating minimum viable draft")
            card = self._minimum_viable_draft(skill_id, skill_name or skill_id)

        # Apply metadata
        if knowledge_scope:
            card.knowledge_scope = knowledge_scope
        if tags:
            card.tags = tags
        if soul_md_ref:
            card.soul_md_ref = soul_md_ref

        # Run rubric reflection
        rubric_result = await self._rubric_reflection(card)
        if rubric_result:
            card.metadata = rubric_result  # Store as metadata for reference

        # Save with draft status
        card.status = "draft"
        save_skill(card)

        return card

    async def _direct_generation(
        self,
        doc_content: str,
        skill_id: str,
        skill_name: str,
        persona_content: str,
    ) -> SkillCard | None:
        """Level 1: Direct generation from document."""
        prompt = DISTILLER_SYSTEM_PROMPT.format(
            document_content=doc_content,
            persona_content=persona_content or "(none)",
        )

        # Inject skill_id and name hint
        prompt += f"\n\n## Additional Requirements\n- skill_id: {skill_id}\n"
        if skill_name:
            prompt += f"- name: {skill_name}\n"

        try:
            raw = await self._call_llm(prompt)
            return self._parse_skill_card(raw, skill_id, skill_name)
        except Exception as e:
            logger.error("Direct generation failed: %s", e)
            return None

    async def _repair_retry(
        self,
        card: SkillCard,
        issues: list[str],
        doc_content: str,
        persona_content: str,
    ) -> SkillCard | None:
        """Level 2: Repair retry — send issues back to LLM for fixing."""
        for attempt in range(MAX_REPAIR_RETRIES):
            logger.info(
                "Repair attempt %d/%d for skill '%s'",
                attempt + 1,
                MAX_REPAIR_RETRIES,
                card.id,
            )

            issues_text = "\n".join(f"  {i+1}. {issue}" for i, issue in enumerate(issues))
            prompt = DISTILLER_REPAIR_PROMPT.format(issues=issues_text)
            prompt += f"\n\n## Original SkillCard\n```json\n{card.model_dump_json(indent=2)}\n```"
            prompt += f"\n\n## Source Document\n{doc_content[:4000]}"
            if persona_content:
                prompt += f"\n\n## Persona Context\n{persona_content[:2000]}"

            try:
                raw = await self._call_llm(prompt)
                fixed_card = self._parse_skill_card(raw, card.id, card.name)
                if fixed_card:
                    new_issues = validate_graph(fixed_card)
                    if not new_issues:
                        logger.info("Repair succeeded on attempt %d", attempt + 1)
                        return fixed_card
                    issues = new_issues
                    card = fixed_card
            except Exception as e:
                logger.error("Repair attempt %d failed: %s", attempt + 1, e)

        return None

    async def _segmented_generation(
        self,
        doc_content: str,
        skill_id: str,
        skill_name: str,
        persona_content: str,
    ) -> SkillCard | None:
        """Level 3: Segmented generation — outline → expand → review."""
        try:
            # Stage 1: Generate outline
            outline_prompt = (
                "Read the following document and generate a high-level outline "
                "of the workflow it describes. List the main steps as a JSON array "
                "of strings.\n\n"
                f"Document:\n{doc_content[:4000]}\n\n"
                "Output only a JSON array of step descriptions."
            )
            outline_raw = await self._call_llm(outline_prompt)
            outline = self._parse_json_array(outline_raw)

            if not outline:
                return None

            logger.info("Segmented generation: outline has %d steps", len(outline))

            # Stage 2: Expand outline into full SkillCard
            steps_text = "\n".join(f"  {i+1}. {step}" for i, step in enumerate(outline))
            expand_prompt = (
                "Convert the following workflow outline into a SkillCard state machine JSON.\n"
                "Follow the same JSON schema as before. Each outline step becomes one or more nodes.\n"
                "Ensure start node, terminal node, and proper edges.\n\n"
                f"Outline:\n{steps_text}\n\n"
                f"skill_id: {skill_id}\n"
            )
            if skill_name:
                expand_prompt += f"name: {skill_name}\n"
            if persona_content:
                expand_prompt += f"\nPersona context:\n{persona_content[:2000]}\n"

            expand_raw = await self._call_llm(expand_prompt)
            card = self._parse_skill_card(expand_raw, skill_id, skill_name)

            if card:
                # Stage 3: Review and fix
                issues = validate_graph(card)
                if issues:
                    card = await self._repair_retry(card, issues, doc_content, persona_content)

                return card

        except Exception as e:
            logger.error("Segmented generation failed: %s", e)

        return None

    def _minimum_viable_draft(self, skill_id: str, skill_name: str) -> SkillCard:
        """Level 4: Create a minimal SkillCard for manual editing."""
        return SkillCard(
            id=skill_id,
            name=skill_name,
            description="Auto-generated draft — please edit manually",
            status="draft",
            nodes=[
                SkillGraphNode(
                    id="start",
                    type=SkillGraphNode_Type.START,
                    title="开始",
                    description="流程入口",
                ),
                SkillGraphNode(
                    id="terminal",
                    type=SkillGraphNode_Type.TERMINAL,
                    title="完结",
                    description="流程结束",
                ),
            ],
            edges=[
                SkillGraphEdge(from_node="start", to_node="terminal", priority=0),
            ],
            start_node_id="start",
        )

    async def _rubric_reflection(self, card: SkillCard) -> dict[str, Any] | None:
        """Run seven-dimension rubric reflection on the generated SkillCard.

        Returns the reflection result as a dict, or None if it fails.
        """
        for round_num in range(MAX_RUBRIC_ROUNDS):
            try:
                prompt = RUBRIC_REFLECTION_PROMPT.format(
                    skill_json=card.model_dump_json(indent=2),
                )

                raw = await self._call_llm(prompt)
                result = self._parse_json_object(raw)

                if result and result.get("overall") == "PASS":
                    logger.info(
                        "Rubric reflection passed on round %d for '%s'",
                        round_num + 1,
                        card.id,
                    )
                    return result

                # If failed, try to fix based on suggestions
                if result and round_num < MAX_RUBRIC_ROUNDS - 1:
                    suggestions = result.get("fix_suggestions", [])
                    if suggestions:
                        logger.info(
                            "Rubric round %d: applying %d fix suggestions",
                            round_num + 1,
                            len(suggestions),
                        )
                        # Try to apply fixes via repair
                        issues = [
                            d["reason"]
                            for d in result.get("dimensions", [])
                            if d.get("status") == "FAIL"
                        ]
                        fixed = await self._repair_retry(
                            card, issues, card.description, ""
                        )
                        if fixed:
                            card = fixed
                            continue

                return result

            except Exception as e:
                logger.error("Rubric reflection failed: %s", e)
                return None

        return None

    async def _call_llm(self, prompt: str) -> str:
        """Call the LLM with a single prompt and return the text response."""
        await self._ensure_model()
        messages = [
            Msg(
                name="system",
                role="system",
                content=[TextBlock(type="text", text="You are a helpful assistant that generates JSON output.")],
            ),
            Msg(
                name="user",
                role="user",
                content=[TextBlock(type="text", text=prompt)],
            ),
        ]
        return await consume_model_response(self._model, messages)

    def _parse_skill_card(
        self,
        raw: str,
        fallback_id: str,
        fallback_name: str,
    ) -> SkillCard | None:
        """Parse LLM output into a SkillCard."""
        json_str = self._extract_json(raw)
        if not json_str:
            logger.warning("No JSON found in distiller output")
            return None

        try:
            data = json.loads(json_str)
        except json.JSONDecodeError as e:
            logger.error("Failed to parse SkillCard JSON: %s", e)
            return None

        try:
            # Ensure required fields
            if not data.get("id"):
                data["id"] = fallback_id
            if not data.get("name"):
                data["name"] = fallback_name

            # Convert node type strings to enum values
            for node in data.get("nodes", []):
                if "type" in node and isinstance(node["type"], str):
                    # Handle various type string formats
                    type_str = node["type"].lower().strip()
                    type_map = {
                        "start": "start",
                        "action": "action",
                        "decision": "decision",
                        "tool_call": "tool_call",
                        "tool": "tool_call",
                        "knowledge_query": "knowledge_query",
                        "knowledge": "knowledge_query",
                        "query": "knowledge_query",
                        "reply": "reply",
                        "response": "reply",
                        "handoff": "handoff",
                        "terminal": "terminal",
                        "end": "terminal",
                    }
                    node["type"] = type_map.get(type_str, "action")

            return SkillCard.model_validate(data)
        except Exception as e:
            logger.error("Failed to create SkillCard from parsed JSON: %s", e)
            return None

    def _extract_json(self, text: str) -> str | None:
        """Extract JSON object from text that may contain markdown."""
        # Try code block first
        code_block_pattern = r"```(?:json)?\s*\n?(.*?)\n?\s*```"
        match = re.search(code_block_pattern, text, re.DOTALL)
        if match:
            return match.group(1).strip()

        # Try raw JSON object
        first_brace = text.find("{")
        last_brace = text.rfind("}")
        if first_brace != -1 and last_brace != -1 and last_brace > first_brace:
            return text[first_brace : last_brace + 1]

        return None

    def _parse_json_array(self, text: str) -> list[str]:
        """Parse a JSON array of strings from text."""
        # Try code block
        code_block_pattern = r"```(?:json)?\s*\n?(.*?)\n?\s*```"
        match = re.search(code_block_pattern, text, re.DOTALL)
        json_str = match.group(1).strip() if match else text.strip()

        # Try to find array
        first_bracket = json_str.find("[")
        last_bracket = json_str.rfind("]")
        if first_bracket != -1 and last_bracket != -1:
            json_str = json_str[first_bracket : last_bracket + 1]

        try:
            result = json.loads(json_str)
            if isinstance(result, list):
                return [str(item) for item in result]
        except json.JSONDecodeError:
            pass

        # Fallback: split by newlines and clean
        lines = [line.strip().strip('"').strip("'").strip() for line in text.split("\n")]
        lines = [l for l in lines if l and not l.startswith(("[", "]", "```"))]
        return lines

    def _parse_json_object(self, text: str) -> dict[str, Any] | None:
        """Parse a JSON object from text."""
        json_str = self._extract_json(text)
        if not json_str:
            return None
        try:
            result = json.loads(json_str)
            return result if isinstance(result, dict) else None
        except json.JSONDecodeError:
            return None
