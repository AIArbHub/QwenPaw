# -*- coding: utf-8 -*-
"""LLM prompts for StepAgent and Distiller.

These prompts are adapted from StaffDeck's ``step_agent_prompt.md`` and
related rule files. They are designed to work with QwenPaw's
``model_factory.create_model_and_formatter()`` interface.
"""

from __future__ import annotations

from .schema import SkillCard, SkillGraphNode, SkillGraphEdge, StepAction


# ---------------------------------------------------------------------------
# StepAgent system prompt
# ---------------------------------------------------------------------------

STEP_AGENT_SYSTEM_PROMPT = """\
You are a StepAgent operating inside a SkillCard state machine.
Your job is to decide the next action for ONE conversation turn.

## Current Context

- **Active Skill**: {skill_name} — {skill_description}
- **Current Node**: {node_id} — {node_title}
  - Type: {node_type}
  - Description: {node_description}
  - Prompt hint: {node_prompt_hint}
- **Available next steps** (sorted by priority):
{next_steps_text}

## Available Actions

You MUST choose exactly ONE of the following actions:

1. **ask_user** — Ask the user a question to collect required information.
   Use when the current node needs input that hasn't been provided.
2. **clarify** — Ask for clarification because the user's input is ambiguous.
3. **reply** — Provide a direct response to the user. The current node
   remains active (is_step_completed=false) unless you also advance.
4. **advance** — Move to the next node. Set next_step_id to one of the
   available next steps. Set is_step_completed=true for the current node.
5. **call_tool** — Invoke a tool. Set tool_name and tool_args.
6. **query_knowledge** — Search the knowledge base. Set knowledge_query.
7. **handoff** — Transfer to a different skill or agent. Set next_step_id.

## Rules

1. If the current node type is `tool_call`, prefer `call_tool`.
2. If the current node type is `knowledge_query`, prefer `query_knowledge`.
3. If the current node type is `terminal`, use `reply` to conclude.
4. Only `advance` when the current node's purpose is fulfilled.
5. When advancing, choose the next_step_id whose condition best matches
   the current context.
6. Keep responses concise and professional — match the persona's style.
7. If the user's message is unrelated to the current skill, use `clarify`
   to confirm whether they want to switch topics.

## Output Format

Respond with a JSON object (and nothing else):

```json
{{
  "action": "ask_user|clarify|reply|advance|call_tool|query_knowledge|handoff",
  "content": "Text to send to the user (for ask_user/clarify/reply)",
  "next_step_id": "Target node ID (for advance/handoff)",
  "tool_name": "Tool name (for call_tool)",
  "tool_args": {{}},
  "knowledge_query": "Search query (for query_knowledge)",
  "is_step_completed": false,
  "reasoning": "Brief internal reasoning"
}}
```
"""


def build_step_agent_prompt(
    card: SkillCard,
    current_node: SkillGraphNode,
    context: dict | None = None,
) -> str:
    """Build the system prompt for the StepAgent.

    Args:
        card: The active SkillCard.
        current_node: The currently active node.
        context: Optional execution context (collected info, tool results).

    Returns:
        Formatted system prompt string.
    """
    # Find edges leaving the current node, sorted by priority
    outgoing_edges = sorted(
        [e for e in card.edges if e.from_node == current_node.id],
        key=lambda e: e.priority,
    )

    # Build next steps text
    node_map = {n.id: n for n in card.nodes}
    next_steps_lines = []
    for i, edge in enumerate(outgoing_edges):
        target = node_map.get(edge.to_node)
        target_title = target.title if target else "Unknown"
        target_type = target.type.value if target else "unknown"
        cond = f" (condition: {edge.condition})" if edge.condition else ""
        next_steps_lines.append(
            f"  {i}. → {edge.to_node} [{target_type}] {target_title}{cond} "
            f"(priority: {edge.priority})"
        )

    if not next_steps_lines:
        next_steps_text = "  (No outgoing edges — this is a terminal node)"
    else:
        next_steps_text = "\n".join(next_steps_lines)

    # Add context if available
    context_text = ""
    if context:
        # 提取知识检索结果并格式化
        knowledge_results = context.get("_knowledge_results", [])
        # 过滤掉内部使用的 key
        public_context = {
            k: v for k, v in context.items()
            if not k.startswith("_")
        }

        context_items = [f"  - {k}: {v}" for k, v in public_context.items()]

        # 注入知识检索结果
        if knowledge_results:
            kb_lines = ["\n## Knowledge Base Results"]
            for kr in knowledge_results[-3:]:  # 最近的 3 次检索
                query = kr.get("query", "")
                results = kr.get("results", [])
                concepts = kr.get("concepts", [])
                citations = kr.get("citations", [])
                kb_lines.append(f"\n### Query: {query}")
                if not results and not concepts:
                    kb_lines.append("  (无结果)")
                for r in results:
                    kb_lines.append(
                        f"  - [{r.get('document_title', '')}] "
                        f"(score: {r.get('score', 0):.2f}): "
                        f"{r.get('chunk_content', '')}"
                    )
                # 注入概念搜索结果
                if concepts:
                    kb_lines.append("\n  Concepts:")
                    for c_info in concepts:
                        c = c_info.get("concept", c_info)
                        kb_lines.append(
                            f"  - [{c.get('concept_id', '')}] "
                            f"{c.get('title', '')} "
                            f"(score: {c_info.get('score', 0):.2f}): "
                            f"{c.get('description', '')}"
                        )
                # 注入引用来源
                if citations:
                    kb_lines.append("\n  Citations:")
                    for cite in citations:
                        kb_lines.append(
                            f"  - {cite.get('label', '')} "
                            f"[{cite.get('kind', '')}] "
                            f"{cite.get('title', '')}"
                        )
            kb_lines.append("\n")
            context_text = (
                f"\n## Execution Context\n" + "\n".join(context_items)
                if context_items
                else ""
            )
            context_text += "\n".join(kb_lines)
        else:
            context_text = (
                f"\n## Execution Context\n" + "\n".join(context_items)
                if context_items
                else ""
            )

    return STEP_AGENT_SYSTEM_PROMPT.format(
        skill_name=card.name,
        skill_description=card.description,
        node_id=current_node.id,
        node_title=current_node.title,
        node_type=current_node.type.value,
        node_description=current_node.description,
        node_prompt_hint=current_node.prompt_hint or "(none)",
        next_steps_text=next_steps_text,
    ) + context_text


# ---------------------------------------------------------------------------
# Distiller prompts
# ---------------------------------------------------------------------------

DISTILLER_SYSTEM_PROMPT = """\
You are a SkillCard Distiller. Your job is to read a document (or SOUL.md
persona file) and generate a SkillCard state machine that captures the
workflow described in the document.

## Output Requirements

Generate a JSON object with the following structure:

{{
  "id": "<unique_skill_id>",
  "name": "<human-readable name>",
  "description": "<what this skill does>",
  "soul_md_ref": "<persona reference if applicable>",
  "knowledge_scope": "<knowledge filter>",
  "tags": ["tag1", "tag2"],
  "nodes": [
    {{
      "id": "start",
      "type": "start",
      "title": "Start",
      "description": "...",
      "prompt_hint": "...",
      "tool_name": "",
      "knowledge_scope": ""
    }},
    {{
      "id": "<unique_node_id>",
      "type": "action|decision|tool_call|knowledge_query|reply|handoff|terminal",
      "title": "<title>",
      "description": "...",
      "prompt_hint": "...",
      "tool_name": "<tool name if type=tool_call>",
      "knowledge_scope": "<filter if type=knowledge_query>"
    }}
  ],
  "edges": [
    {{
      "from_node": "start",
      "to_node": "<node_id>",
      "condition": "<natural language condition>",
      "priority": 0
    }}
  ],
  "start_node_id": "start"
}}

## Rules

1. The graph MUST have exactly one node with type "start".
2. The graph MUST have at least one node with type "terminal".
3. All nodes must be reachable from the start node.
4. All nodes must be able to reach at least one terminal node.
5. Edge priorities: 0 = highest priority. Use for preferred paths.
6. Keep node descriptions concise but actionable.
7. Use "decision" nodes for branching points with multiple outgoing edges.
8. Use "tool_call" nodes when the document mentions specific tools or actions.
9. Use "knowledge_query" nodes when the document references looking up
   information from a knowledge base.
10. The skill_id should be lowercase with underscores (e.g., "arb_cross_exam").
11. Generate 5-15 nodes — enough to capture the workflow without over-engineering.

## Document Content

{document_content}

## Persona Context (if provided)

{persona_content}

Generate the SkillCard JSON now. Output ONLY the JSON, no explanation.
"""


DISTILLER_REPAIR_PROMPT = """\
The previous SkillCard generation had the following issues:

{issues}

Please fix these issues and regenerate the complete SkillCard JSON.
Output ONLY the fixed JSON, no explanation.
"""


# ---------------------------------------------------------------------------
# Seven-dimension rubric reflection prompt
# ---------------------------------------------------------------------------

RUBRIC_REFLECTION_PROMPT = """\
You are a SkillCard Reviewer. Evaluate the generated SkillCard against
the following 7 dimensions. For each dimension, output "PASS" or "FAIL"
with a brief reason.

## SkillCard to Review

{skill_json}

## 7 Evaluation Dimensions

1. **Source Consistency** (来源一致性): Do all nodes and edges trace back
   to content in the source document? Are there fabricated steps?
2. **Closure** (闭环): Does every path from start eventually reach a
   terminal node? Are there dead-end paths?
3. **Adaptability** (自适应): Does the skill handle common variations
   (e.g., user provides incomplete info, tool fails, knowledge not found)?
4. **Tool Justification** (工具依据): Are tool_call nodes justified by
   the document? Is the tool_name realistic?
5. **Format Compliance** (格式): Does the JSON conform to the schema?
   Are all required fields present?
6. **Side-effect Confirmation** (副作用确认): Are there nodes that
   perform irreversible actions without a confirmation step?
7. **Interruption Recovery** (中断恢复): Can the skill resume after
   being interrupted? Are context-critical nodes identified?

## Output Format

```json
{{
  "dimensions": [
    {{"name": "Source Consistency", "status": "PASS|FAIL", "reason": "..."}},
    {{"name": "Closure", "status": "PASS|FAIL", "reason": "..."}},
    {{"name": "Adaptability", "status": "PASS|FAIL", "reason": "..."}},
    {{"name": "Tool Justification", "status": "PASS|FAIL", "reason": "..."}},
    {{"name": "Format Compliance", "status": "PASS|FAIL", "reason": "..."}},
    {{"name": "Side-effect Confirmation", "status": "PASS|FAIL", "reason": "..."}},
    {{"name": "Interruption Recovery", "status": "PASS|FAIL", "reason": "..."}}
  ],
  "overall": "PASS|FAIL",
  "fix_suggestions": ["suggestion 1", "suggestion 2"]
}}
```
"""
