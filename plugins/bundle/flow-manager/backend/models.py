# -*- coding: utf-8 -*-
"""FlowManager — Pydantic data models.

Only flow-related models. Group chat models live in the native
``aiarb.app.group_chats`` module.

    FlowNode         — one node in a flow graph (stage/decision/parallel/merge)
    FlowEdge         — a directed edge between nodes (with optional condition)
    FlowDefinition   — a reusable flow template (nodes + edges)
    FlowInstance     — a running instance of a flow, bound to a group chat
"""
from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional
from uuid import uuid4

from pydantic import BaseModel, Field


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _uuid() -> str:
    return str(uuid4())


# ── Enums ──────────────────────────────────────────────────────────


class FlowNodeType(str, Enum):
    STAGE = "stage"
    DECISION = "decision"
    PARALLEL = "parallel"
    MERGE = "merge"
    TERMINAL = "terminal"
    LOOP = "loop"


class FlowNodeStatus(str, Enum):
    PENDING = "pending"
    ACTIVE = "active"
    COMPLETED = "completed"
    SKIPPED = "skipped"


class FlowInstanceStatus(str, Enum):
    RUNNING = "running"
    PAUSED = "paused"
    COMPLETED = "completed"
    ERROR = "error"


# ── Flow Definition Models ──────────────────────────────────────────


class FlowNode(BaseModel):
    """One node in a flow graph."""

    id: str
    type: FlowNodeType = FlowNodeType.STAGE
    label: str
    speaker_agent_id: Optional[str] = None
    speaker_role: Optional[str] = None
    prompt_template: Optional[str] = None
    completion_criteria: Optional[str] = None
    max_turns: int = 3
    position: Dict[str, float] = Field(
        default_factory=lambda: {"x": 0, "y": 0},
    )
    decision_options: List[Dict[str, Any]] = Field(default_factory=list)
    loop_target: Optional[str] = None
    merge_required: bool = True


class FlowEdge(BaseModel):
    """A directed edge between two nodes."""

    source: str
    target: str
    condition: Optional[str] = None


class FlowDefinitionCreate(BaseModel):
    """Request body for creating a flow definition."""

    name: str = Field(..., min_length=1, max_length=120)
    nodes: List[FlowNode] = Field(..., min_length=1)
    edges: List[FlowEdge] = Field(default_factory=list)
    entry_node_id: str


class FlowDefinitionUpdate(BaseModel):
    """Request body for updating a flow definition."""

    name: Optional[str] = None
    nodes: Optional[List[dict]] = None
    edges: Optional[List[dict]] = None
    entry_node_id: Optional[str] = None


class FlowDefinition(BaseModel):
    """A reusable flow template."""

    id: str = Field(default_factory=_uuid)
    name: str
    nodes: List[FlowNode]
    edges: List[FlowEdge]
    entry_node_id: str
    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(default_factory=_now)
    meta: Dict[str, Any] = Field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "nodes": [n.model_dump() for n in self.nodes],
            "edges": [e.model_dump() for e in self.edges],
            "entry_node_id": self.entry_node_id,
            "node_count": len(self.nodes),
            "edge_count": len(self.edges),
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "meta": self.meta,
        }

    def get_node(self, node_id: str) -> Optional[FlowNode]:
        for n in self.nodes:
            if n.id == node_id:
                return n
        return None

    def get_next_nodes(self, node_id: str) -> List[str]:
        return [
            e.target for e in self.edges if e.source == node_id
        ]

    def get_edges_from(self, node_id: str) -> List["FlowEdge"]:
        return [e for e in self.edges if e.source == node_id]

    def get_incoming_nodes(self, node_id: str) -> List[str]:
        return [
            e.source for e in self.edges if e.target == node_id
        ]

    def is_terminal(self, node_id: str) -> bool:
        return not any(e.source == node_id for e in self.edges)


# ── Flow Instance (runtime) ───────────────────────────────────────


class FlowInstance(BaseModel):
    """A running instance of a flow, bound to a group chat or session."""

    id: str = Field(default_factory=_uuid)
    flow_id: str
    group_id: Optional[str] = None
    session_id: Optional[str] = None
    current_node_id: str
    node_states: Dict[str, str] = Field(default_factory=dict)
    turn_count: int = 0
    total_turns: int = 0
    history: List[Dict[str, Any]] = Field(default_factory=list)
    active_branches: Dict[str, bool] = Field(default_factory=dict)
    status: FlowInstanceStatus = FlowInstanceStatus.RUNNING
    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(default_factory=_now)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "flow_id": self.flow_id,
            "group_id": self.group_id,
            "session_id": self.session_id,
            "current_node_id": self.current_node_id,
            "node_states": self.node_states,
            "turn_count": self.turn_count,
            "total_turns": self.total_turns,
            "history": self.history,
            "active_branches": self.active_branches,
            "status": self.status.value,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }


__all__ = [
    "FlowDefinition",
    "FlowDefinitionCreate",
    "FlowDefinitionUpdate",
    "FlowEdge",
    "FlowInstance",
    "FlowInstanceStatus",
    "FlowNode",
    "FlowNodeStatus",
    "FlowNodeType",
]
