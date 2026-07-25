# -*- coding: utf-8 -*-
"""Pydantic schema definitions for the SOP SkillCard state machine.

A SkillCard defines a directed graph of workflow nodes connected by edges.
Each node represents a state in the state machine, and each edge represents
a transition with an optional condition and priority.

Graph validation ensures:
- A single ``start_node`` exists and is reachable
- All nodes are reachable from ``start_node``
- All nodes can reach at least one ``terminal`` node
- No orphan edges (edges referencing non-existent nodes)
"""

from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, field_validator, model_validator


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class SkillGraphNode_Type(str, Enum):
    """Types of nodes in the skill graph."""

    START = "start"
    ACTION = "action"
    DECISION = "decision"
    TOOL_CALL = "tool_call"
    KNOWLEDGE_QUERY = "knowledge_query"
    REPLY = "reply"
    HANDOFF = "handoff"
    TERMINAL = "terminal"


class StepAction(str, Enum):
    """The 7 action types that StepAgent can output."""

    ASK_USER = "ask_user"
    CLARIFY = "clarify"
    REPLY = "reply"
    ADVANCE = "advance"
    CALL_TOOL = "call_tool"
    QUERY_KNOWLEDGE = "query_knowledge"
    HANDOFF = "handoff"


# ---------------------------------------------------------------------------
# Graph structure
# ---------------------------------------------------------------------------

class SkillGraphEdge(BaseModel):
    """A directed edge in the skill graph.

    Attributes:
        from_node: Source node ID.
        to_node: Target node ID.
        condition: Natural-language condition for this transition
                   (e.g., "需要查库存", "直接答复").
        priority: Lower number = higher priority. Used when multiple
                  edges leave the same node — the StepAgent evaluates
                  them in priority order.
    """

    from_node: str = Field(..., description="Source node ID")
    to_node: str = Field(..., description="Target node ID")
    condition: str = Field(default="", description="Transition condition (natural language)")
    priority: int = Field(default=0, ge=0, description="Lower = higher priority")


class SkillGraphNode(BaseModel):
    """A node in the skill graph.

    Attributes:
        id: Unique node identifier within this SkillCard.
        type: Node type (start / action / decision / tool_call / ...).
        title: Human-readable title (e.g., "收集信息", "查库存").
        description: What this node does, in natural language.
        prompt_hint: Optional prompt fragment injected into the StepAgent
                     when this node is active.
        tool_name: Required when type is TOOL_CALL — the tool to invoke.
        knowledge_scope: Required when type is KNOWLEDGE_QUERY — filter
                         expression to narrow the knowledge search.
        metadata: Free-form extra data (e.g., expected_duration, required_role).
    """

    id: str = Field(..., description="Unique node ID within this SkillCard")
    type: SkillGraphNode_Type = Field(..., description="Node type")
    title: str = Field(default="", description="Human-readable title")
    description: str = Field(default="", description="What this node does")
    prompt_hint: str = Field(default="", description="Prompt fragment for StepAgent")
    tool_name: str = Field(default="", description="Tool name (for tool_call nodes)")
    knowledge_scope: str = Field(default="", description="Knowledge filter (for knowledge_query nodes)")
    metadata: dict[str, Any] = Field(default_factory=dict, description="Extra metadata")


# ---------------------------------------------------------------------------
# SkillCard
# ---------------------------------------------------------------------------

class SkillCard(BaseModel):
    """A complete skill definition as a directed graph.

    Attributes:
        id: Unique skill identifier (used as filename: <id>.json).
        name: Human-readable name (e.g., "仲裁庭审质证流程").
        description: What this skill does.
        version: Schema version for forward compatibility.
        nodes: All nodes in the graph.
        edges: All edges in the graph.
        start_node_id: ID of the entry node (must exist in nodes).
        knowledge_scope: Global knowledge filter applied to all
                         knowledge_query nodes in this skill.
        source_doc_ids: Documents used to distill this SkillCard.
        soul_md_ref: Optional reference to a builtins persona (e.g.,
                     "arbitrator") used as the persona layer.
        status: ``draft`` / ``active`` / ``archived``.
        created_at / updated_at: ISO 8601 timestamps.
        tags: Free-form tags for search and filtering.
    """

    id: str = Field(..., description="Unique skill ID")
    name: str = Field(default="", description="Human-readable name")
    description: str = Field(default="", description="Skill description")
    version: str = Field(default="1.0.0", description="Schema version")
    nodes: list[SkillGraphNode] = Field(default_factory=list, description="Graph nodes")
    edges: list[SkillGraphEdge] = Field(default_factory=list, description="Graph edges")
    start_node_id: str = Field(default="", description="Entry node ID")
    knowledge_scope: str = Field(default="", description="Global knowledge filter")
    source_doc_ids: list[str] = Field(default_factory=list, description="Source document IDs")
    soul_md_ref: str = Field(default="", description="Builtins persona reference (e.g., 'arbitrator')")
    status: str = Field(default="draft", description="draft / active / archived")
    created_at: str = Field(default="", description="ISO 8601 creation timestamp")
    updated_at: str = Field(default="", description="ISO 8601 update timestamp")
    tags: list[str] = Field(default_factory=list, description="Search tags")
    metadata: dict[str, Any] = Field(default_factory=dict, description="Extra metadata (e.g., rubric reflection results)")

    @field_validator("status")
    @classmethod
    def _validate_status(cls, v: str) -> str:
        allowed = {"draft", "active", "archived"}
        if v not in allowed:
            raise ValueError(f"status must be one of {allowed}, got '{v}'")
        return v

    @model_validator(mode="after")
    def _validate_graph_integrity(self) -> "SkillCard":
        """Validate the graph structure after all fields are set."""
        if not self.nodes:
            return self  # Empty graph is allowed during construction

        node_ids = {n.id for n in self.nodes}

        # start_node_id must reference an existing node
        if self.start_node_id and self.start_node_id not in node_ids:
            raise ValueError(
                f"start_node_id '{self.start_node_id}' not found in nodes"
            )

        # If no start_node_id is set, try to infer from a START-type node
        if not self.start_node_id:
            start_nodes = [n for n in self.nodes if n.type == SkillGraphNode_Type.START]
            if start_nodes:
                self.start_node_id = start_nodes[0].id

        # Validate edge references
        for edge in self.edges:
            if edge.from_node not in node_ids:
                raise ValueError(
                    f"Edge from_node '{edge.from_node}' not found in nodes"
                )
            if edge.to_node not in node_ids:
                raise ValueError(
                    f"Edge to_node '{edge.to_node}' not found in nodes"
                )

        return self


# ---------------------------------------------------------------------------
# StepAgent decision
# ---------------------------------------------------------------------------

class StepDecision(BaseModel):
    """Output of StepAgent.run() — the decision for one conversation turn.

    Attributes:
        action: One of the 7 StepAction values.
        content: Text to send to the user (for ask_user / clarify / reply).
        next_step_id: Target node ID when action is ADVANCE or HANDOFF.
        tool_name: Tool to call when action is CALL_TOOL.
        tool_args: Arguments dict for the tool call.
        knowledge_query: Search query when action is QUERY_KNOWLEDGE.
        is_step_completed: Whether the current node is considered complete.
        reasoning: StepAgent's internal reasoning (for logging/debugging).
    """

    action: StepAction = Field(..., description="Action type")
    content: str = Field(default="", description="Text content for user-facing actions")
    next_step_id: str = Field(default="", description="Target node for advance/handoff")
    tool_name: str = Field(default="", description="Tool name for call_tool")
    tool_args: dict[str, Any] = Field(default_factory=dict, description="Tool arguments")
    knowledge_query: str = Field(default="", description="Search query for query_knowledge")
    is_step_completed: bool = Field(default=False, description="Whether current node is complete")
    reasoning: str = Field(default="", description="Internal reasoning for debugging")


# ---------------------------------------------------------------------------
# Task frame (for suspend/restore)
# ---------------------------------------------------------------------------

class TaskFrame(BaseModel):
    """A snapshot of the current skill execution state.

    When a followup interrupts the main task, the current state is captured
    in a TaskFrame and pushed onto the ``skill_stack``. After the followup
    completes, the frame is popped and execution resumes.

    Attributes:
        skill_id: The SkillCard ID being executed.
        current_node_id: The node that was active when suspended.
        context: Arbitrary context accumulated during execution
                 (e.g., collected user answers, tool results).
        history: Mini conversation history for this skill instance.
        suspended_reason: Why this frame was suspended (e.g., "followup").
        created_at: When this frame was created.
    """

    skill_id: str = Field(..., description="SkillCard ID")
    current_node_id: str = Field(default="", description="Active node when suspended")
    context: dict[str, Any] = Field(default_factory=dict, description="Execution context")
    history: list[dict[str, str]] = Field(
        default_factory=list, description="Mini conversation history"
    )
    suspended_reason: str = Field(default="", description="Why this frame was suspended")
    created_at: str = Field(default="", description="ISO 8601 timestamp")


class SkillRuntimeState(BaseModel):
    """Runtime state persisted in the session JSON.

    This extends the chat session with SOP state machine fields.

    Attributes:
        skill_stack: Stack of suspended TaskFrames (LIFO).
        pending_tasks: Queue of tasks waiting to be started.
        awaiting_input: Whether the session is blocked waiting for user input.
        active_skill_id: Currently executing SkillCard ID.
        active_node_id: Currently active node ID.
        active_context: Context for the active skill instance.
    """

    skill_stack: list[TaskFrame] = Field(
        default_factory=list, description="Suspended task frames (LIFO stack)"
    )
    pending_tasks: list[TaskFrame] = Field(
        default_factory=list, description="Tasks waiting to start"
    )
    awaiting_input: bool = Field(default=False, description="Blocked on user input")
    active_skill_id: str = Field(default="", description="Currently executing skill ID")
    active_node_id: str = Field(default="", description="Currently active node ID")
    active_context: dict[str, Any] = Field(
        default_factory=dict, description="Active skill context"
    )


# ---------------------------------------------------------------------------
# Graph validation utility
# ---------------------------------------------------------------------------

def validate_graph(card: SkillCard) -> list[str]:
    """Validate a SkillCard's graph structure and return a list of issues.

    Checks performed:
    1. Exactly one START node exists.
    2. start_node_id is set and references a START node.
    3. All nodes are reachable from start_node (BFS).
    4. All nodes can reach at least one TERMINAL node (reverse BFS).
    5. No duplicate node IDs.

    Returns:
        List of human-readable issue strings. Empty list means valid.
    """
    issues: list[str] = []

    if not card.nodes:
        issues.append("Graph has no nodes")
        return issues

    # Check for duplicate node IDs
    node_ids = [n.id for n in card.nodes]
    seen: set[str] = set()
    for nid in node_ids:
        if nid in seen:
            issues.append(f"Duplicate node ID: '{nid}'")
        seen.add(nid)

    node_set = set(node_ids)

    # Check START node count
    start_nodes = [n for n in card.nodes if n.type == SkillGraphNode_Type.START]
    if len(start_nodes) == 0:
        issues.append("No START node found")
    elif len(start_nodes) > 1:
        issues.append(f"Multiple START nodes found: {[n.id for n in start_nodes]}")

    # Check start_node_id
    if not card.start_node_id:
        issues.append("start_node_id is not set")
    elif card.start_node_id not in node_set:
        issues.append(f"start_node_id '{card.start_node_id}' does not exist in nodes")
    elif start_nodes and card.start_node_id != start_nodes[0].id:
        issues.append(
            f"start_node_id '{card.start_node_id}' does not match the START node "
            f"'{start_nodes[0].id}'"
        )

    # Build adjacency list
    adj: dict[str, list[str]] = {nid: [] for nid in node_set}
    radj: dict[str, list[str]] = {nid: [] for nid in node_set}
    for edge in card.edges:
        if edge.from_node in node_set and edge.to_node in node_set:
            adj[edge.from_node].append(edge.to_node)
            radj[edge.to_node].append(edge.from_node)

    # BFS from start_node to check reachability
    start_id = card.start_node_id or (start_nodes[0].id if start_nodes else "")
    if start_id and start_id in node_set:
        visited: set[str] = set()
        queue = [start_id]
        while queue:
            current = queue.pop(0)
            if current in visited:
                continue
            visited.add(current)
            for nxt in adj.get(current, []):
                if nxt not in visited:
                    queue.append(nxt)

        unreachable = node_set - visited
        if unreachable:
            issues.append(f"Nodes unreachable from start: {sorted(unreachable)}")

    # Check TERMINAL nodes exist
    terminal_nodes = [n for n in card.nodes if n.type == SkillGraphNode_Type.TERMINAL]
    if not terminal_nodes:
        issues.append("No TERMINAL node found")

    # Reverse BFS from all TERMINAL nodes
    if terminal_nodes:
        terminal_ids = {n.id for n in terminal_nodes}
        visited_r: set[str] = set()
        queue = list(terminal_ids)
        while queue:
            current = queue.pop(0)
            if current in visited_r:
                continue
            visited_r.add(current)
            for prv in radj.get(current, []):
                if prv not in visited_r:
                    queue.append(prv)

        cannot_reach_terminal = node_set - visited_r
        if cannot_reach_terminal:
            issues.append(
                f"Nodes that cannot reach any TERMINAL: {sorted(cannot_reach_terminal)}"
            )

    return issues
