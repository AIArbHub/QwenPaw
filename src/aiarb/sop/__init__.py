# -*- coding: utf-8 -*-
"""SOP (Standard Operating Procedure) state machine module.

This module implements a graph-based SkillCard state machine inspired by
StaffDeck's design. It provides:

- **Schema**: Pydantic models for SkillCard, SkillGraphNode, SkillGraphEdge
- **Store**: JSON file persistence for SkillCards
- **StepAgent**: Single-step execution engine driven by LLM
- **Runtime**: Skill runtime with task frame suspend/restore
- **Distiller**: Generate SkillCards from documents and SOUL.md

The SkillCard state machine acts as a **process orchestration layer** on top
of the existing AgentScope ReAct Agent — it does NOT replace it. The Router
decides which SkillCard to follow, and the StepAgent can invoke the ReAct
Agent for tool reasoning within a single node.

Storage:
- SkillCard definitions: ``~/.aiarb/sop/<skill_id>.json``
- Runtime state (skill_stack / pending_tasks): session JSON extension fields
"""

from .schema import (
    SkillCard,
    SkillGraphNode,
    SkillGraphEdge,
    SkillGraphNode_Type,
    StepAction,
    StepDecision,
    TaskFrame,
    SkillRuntimeState,
    validate_graph,
)
from .reflection import ReflectionEngine, ReflectionResult, get_reflection_engine
from .router import Router, RouterDecision, RouterDecisionValue, get_router

__all__ = [
    "SkillCard",
    "SkillGraphNode",
    "SkillGraphEdge",
    "SkillGraphNode_Type",
    "StepAction",
    "StepDecision",
    "TaskFrame",
    "SkillRuntimeState",
    "validate_graph",
    "ReflectionEngine",
    "ReflectionResult",
    "get_reflection_engine",
    "Router",
    "RouterDecision",
    "RouterDecisionValue",
    "get_router",
]
