# -*- coding: utf-8 -*-
"""API router for the SOP (SkillCard state machine) module.

Endpoints:
- ``GET    /sop/skills``             — List all skills
- ``GET    /sop/skills/{skill_id}``  — Get a specific skill
- ``POST   /sop/skills``             — Create or update a skill
- ``DELETE /sop/skills/{skill_id}``  — Delete a skill
- ``POST   /sop/skills/{skill_id}/validate`` — Validate graph
- ``POST   /sop/distill``            — Distill a skill from document
- ``GET    /sop/builtin``            — Ensure built-in skills exist
- ``POST   /sop/runtime/start``      — Start a skill in a session
- ``POST   /sop/runtime/step``       — Execute one step
- ``POST   /sop/runtime/suspend``    — Suspend current skill
- ``POST   /sop/runtime/restore``    — Restore suspended skill
- ``GET    /sop/runtime/state``      — Get runtime state
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Body, HTTPException
from pydantic import BaseModel, Field

from ...sop.schema import (
    SkillCard,
    StepDecision,
    SkillRuntimeState,
    validate_graph,
)
from ...sop.store import (
    list_skills,
    load_skill,
    save_skill,
    delete_skill,
    ensure_builtin_skills,
)
from ...sop.step_agent import StepAgent
from ...sop.runtime import SkillRuntime
from ...sop.distiller import SkillDistiller
from ...sop.reflection import get_reflection_engine

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/sop", tags=["sop"])


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class SkillListResponse(BaseModel):
    skills: list[SkillCard]
    total: int


class SkillSaveRequest(BaseModel):
    skill: SkillCard


class ValidateResponse(BaseModel):
    valid: bool
    issues: list[str]


class DistillRequest(BaseModel):
    doc_content: str = Field(..., description="Document text to distill")
    skill_id: str = Field(..., description="Unique skill ID")
    skill_name: str = Field(default="", description="Human-readable name")
    persona_content: str = Field(default="", description="SOUL.md persona content")
    knowledge_scope: str = Field(default="", description="Knowledge filter")
    tags: list[str] = Field(default_factory=list, description="Search tags")
    soul_md_ref: str = Field(default="", description="Builtins persona reference")
    agent_id: str = Field(default="", description="Agent ID for LLM config")


class RuntimeStartRequest(BaseModel):
    session_id: str = Field(..., description="Session ID")
    skill_id: str = Field(..., description="SkillCard ID to start")
    initial_context: dict[str, Any] = Field(default_factory=dict)
    state: SkillRuntimeState = Field(default_factory=SkillRuntimeState)


class RuntimeStepRequest(BaseModel):
    session_id: str = Field(..., description="Session ID")
    user_message: str = Field(..., description="User input for this turn")
    state: SkillRuntimeState = Field(..., description="Current runtime state")
    history: list[dict[str, str]] = Field(default_factory=list)
    agent_id: str = Field(default="", description="Agent ID for LLM config")


class RuntimeStepResponse(BaseModel):
    decision: StepDecision
    state: SkillRuntimeState
    status: str
    reply_text: str


class RuntimeStateRequest(BaseModel):
    state: SkillRuntimeState = Field(..., description="Current runtime state")


class RuntimeStateResponse(BaseModel):
    state: SkillRuntimeState


class BuiltinResponse(BaseModel):
    created: bool
    message: str


# ---------------------------------------------------------------------------
# In-memory session state cache (simple — persisted by caller via state field)
# ---------------------------------------------------------------------------

# The runtime is stateless — state is passed in each request.
# This cache is only for convenience during development.
_session_states: dict[str, SkillRuntimeState] = {}


def _get_state(session_id: str, fallback: SkillRuntimeState | None = None) -> SkillRuntimeState:
    if fallback and fallback.active_skill_id:
        return fallback
    if session_id in _session_states:
        return _session_states[session_id]
    state = SkillRuntimeState()
    _session_states[session_id] = state
    return state


def _save_state(session_id: str, state: SkillRuntimeState) -> None:
    _session_states[session_id] = state


# ---------------------------------------------------------------------------
# Skill CRUD endpoints
# ---------------------------------------------------------------------------

@router.get("/skills", response_model=SkillListResponse)
async def api_list_skills(
    status: str | None = None,
    tag: str | None = None,
):
    """List all SkillCards, optionally filtered."""
    cards = list_skills(status=status, tag=tag)
    return SkillListResponse(skills=cards, total=len(cards))


@router.get("/skills/{skill_id}", response_model=SkillCard)
async def api_get_skill(skill_id: str):
    """Get a specific SkillCard by ID."""
    card = load_skill(skill_id)
    if card is None:
        raise HTTPException(status_code=404, detail=f"Skill '{skill_id}' not found")
    return card


@router.post("/skills", response_model=SkillCard)
async def api_save_skill(req: SkillSaveRequest):
    """Create or update a SkillCard."""
    card = save_skill(req.skill)
    return card


@router.delete("/skills/{skill_id}")
async def api_delete_skill(skill_id: str):
    """Delete a SkillCard by ID."""
    if not delete_skill(skill_id):
        raise HTTPException(status_code=404, detail=f"Skill '{skill_id}' not found")
    return {"deleted": True, "skill_id": skill_id}


@router.post("/skills/{skill_id}/validate", response_model=ValidateResponse)
async def api_validate_skill(skill_id: str):
    """Validate a SkillCard's graph structure."""
    card = load_skill(skill_id)
    if card is None:
        raise HTTPException(status_code=404, detail=f"Skill '{skill_id}' not found")
    issues = validate_graph(card)
    return ValidateResponse(valid=len(issues) == 0, issues=issues)


# ---------------------------------------------------------------------------
# Distiller endpoint
# ---------------------------------------------------------------------------

@router.post("/distill", response_model=SkillCard)
async def api_distill_skill(req: DistillRequest):
    """Distill a SkillCard from document content using LLM."""
    distiller = SkillDistiller(
        agent_id=req.agent_id or None,
    )
    try:
        card = await distiller.distill_from_document(
            doc_content=req.doc_content,
            skill_id=req.skill_id,
            skill_name=req.skill_name,
            persona_content=req.persona_content,
            knowledge_scope=req.knowledge_scope,
            tags=req.tags,
            soul_md_ref=req.soul_md_ref,
        )
        return card
    except Exception as e:
        logger.error("Distill failed: %s", e)
        raise HTTPException(status_code=500, detail=f"Distill failed: {e}")


# ---------------------------------------------------------------------------
# Built-in skills endpoint
# ---------------------------------------------------------------------------

@router.post("/builtin", response_model=BuiltinResponse)
async def api_ensure_builtins():
    """Ensure built-in SkillCard templates exist."""
    try:
        ensure_builtin_skills()
        return BuiltinResponse(created=True, message="Built-in skills ensured")
    except Exception as e:
        logger.error("Failed to create built-in skills: %s", e)
        return BuiltinResponse(created=False, message=f"Failed: {e}")


# ---------------------------------------------------------------------------
# Runtime endpoints
# ---------------------------------------------------------------------------

@router.post("/runtime/start", response_model=RuntimeStateResponse)
async def api_runtime_start(req: RuntimeStartRequest):
    """Start executing a skill in a session."""
    state = _get_state(req.session_id, req.state)
    runtime = SkillRuntime()
    card = runtime.start_skill(state, req.skill_id, req.initial_context)
    if card is None:
        raise HTTPException(
            status_code=404,
            detail=f"Skill '{req.skill_id}' not found",
        )
    _save_state(req.session_id, state)
    return RuntimeStateResponse(state=state)


@router.post("/runtime/step", response_model=RuntimeStepResponse)
async def api_runtime_step(req: RuntimeStepRequest):
    """Execute one conversation turn: StepAgent decides, Runtime applies."""
    state = req.state
    if not state.active_skill_id:
        raise HTTPException(
            status_code=400,
            detail="No active skill. Call /runtime/start first.",
        )

    card = load_skill(state.active_skill_id)
    if card is None:
        raise HTTPException(
            status_code=404,
            detail=f"Active skill '{state.active_skill_id}' not found",
        )

    runtime = SkillRuntime()
    current_node = runtime.get_current_node(card, state)
    if current_node is None:
        raise HTTPException(
            status_code=400,
            detail=f"Current node '{state.active_node_id}' not found in skill",
        )

    # StepAgent decides
    agent = StepAgent(agent_id=req.agent_id or None)
    decision = await agent.run(
        card=card,
        current_node=current_node,
        user_message=req.user_message,
        context=state.active_context,
        history=req.history,
    )

    # Runtime applies
    status = await runtime.apply_decision(state, decision, card)

    # Determine reply text
    reply_text = decision.content
    if decision.action.value == "call_tool":
        reply_text = f"[工具调用] {decision.tool_name}({decision.tool_args})"
    elif decision.action.value == "query_knowledge":
        reply_text = f"[知识检索] {decision.knowledge_query}"
    elif decision.action.value == "advance" and not reply_text:
        next_node = runtime.get_current_node(card, state)
        if next_node:
            reply_text = f"已进入：{next_node.title}"
        else:
            reply_text = "已推进到下一步"

    return RuntimeStepResponse(
        decision=decision,
        state=state,
        status=status,
        reply_text=reply_text,
    )


@router.post("/runtime/suspend", response_model=RuntimeStateResponse)
async def api_runtime_suspend(req: RuntimeStateRequest):
    """Suspend the current skill."""
    state = req.state
    runtime = SkillRuntime()
    frame = runtime.suspend_current(state, reason="manual")
    if frame is None:
        raise HTTPException(status_code=400, detail="No active skill to suspend")
    return RuntimeStateResponse(state=state)


@router.post("/runtime/restore", response_model=RuntimeStateResponse)
async def api_runtime_restore(req: RuntimeStateRequest):
    """Restore the most recently suspended skill."""
    state = req.state
    runtime = SkillRuntime()
    frame = runtime.restore_task_frame(state)
    if frame is None:
        raise HTTPException(status_code=400, detail="No suspended skills to restore")
    return RuntimeStateResponse(state=state)


@router.post("/runtime/state", response_model=RuntimeStateResponse)
async def api_runtime_get_state(req: RuntimeStateRequest):
    """Get the current runtime state (pass-through for verification)."""
    return RuntimeStateResponse(state=req.state)


# ---------------------------------------------------------------------------
# Reflection & Leaderboard
# ---------------------------------------------------------------------------

class ReflectRequest(BaseModel):
    """反思请求。"""
    agent_id: str = ""
    skill_id: str = ""


@router.post("/reflect")
async def api_reflect(req: ReflectRequest):
    """执行 7 维反思。"""
    engine = get_reflection_engine()

    # 获取技能信息
    skill_info: dict[str, Any] | None = None
    if req.skill_id:
        card = load_skill(req.skill_id)
        if card:
            skill_info = {
                "id": card.id,
                "name": card.name,
                "description": card.description,
                "nodes": len(card.nodes),
                "edges": len(card.edges),
            }

    result = await engine.reflect(
        agent_id=req.agent_id,
        skill_id=req.skill_id,
        skill_info=skill_info,
    )
    return result.to_dict()


@router.get("/leaderboard")
async def api_leaderboard():
    """获取技能排行榜。"""
    skills = list_skills()
    leaderboard = [
        {
            "id": s.id,
            "name": s.name,
            "call_count": s.call_count,
            "positive_feedback_count": s.positive_feedback_count,
            "negative_feedback_count": s.negative_feedback_count,
        }
        for s in skills
    ]
    # 按调用次数排序
    leaderboard.sort(
        key=lambda x: x["call_count"],
        reverse=True,
    )
    return {"skills": leaderboard}
