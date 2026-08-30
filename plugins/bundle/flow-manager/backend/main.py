# -*- coding: utf-8 -*-
# pylint: disable=too-many-branches,too-many-statements
"""FlowManager — PawApp backend.

A pure flow orchestration engine. Define visual flow graphs (stages,
decisions, parallel branches, loops) and bind them to group chats or
agent sessions.

This plugin does NOT manage group chats, messages, or agent calls.
Those are handled by the native ``aiarb.app.group_chats`` module.
FlowManager provides:

    - Flow definition CRUD (create / list / get / update / delete)
    - Flow instance lifecycle (start / advance / get progress / decision)
    - A clean REST API that the native group chat system can call
      via ``group.meta.flow_id``

Author: Sum
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from aiarb.pawapp import PawApp

from .flow_engine import (
    advance_flow,
    get_flow_progress,
)
from .models import (
    FlowDefinition,
    FlowDefinitionCreate,
    FlowDefinitionUpdate,
    FlowInstance,
    FlowInstanceStatus,
    FlowNode,
    FlowNodeStatus,
    FlowNodeType,
)
from .storage import storage

logger = logging.getLogger(__name__)

# ── Background persistence ─────────────────────────────────────────

_PERSIST_TASK: Optional[asyncio.Task] = None
_PERSIST_RUNNING = False


# ── Schemas ───────────────────────────────────────────────────────


class StartFlowRequest(BaseModel):
    """Request body for starting a flow instance."""

    flow_id: str
    group_id: Optional[str] = None
    session_id: Optional[str] = None


class AdvanceFlowRequest(BaseModel):
    """Request body for advancing a flow instance."""

    participants: List[Dict[str, Any]] = []
    decision_route: Optional[str] = None


class DecisionRequest(BaseModel):
    """Request body for submitting a decision route."""

    target_node_id: str
    reasoning: Optional[str] = None


# ── HTTP Router ────────────────────────────────────────────────────

router = APIRouter()


# ─── Flow Definitions ─────────────────────────────────────────────


@router.get("/flows")
async def list_flows() -> Dict[str, Any]:
    """List all flow definitions."""
    flows = await storage.list_flows()
    return {"flows": flows}


@router.post("/flows")
async def create_flow(body: FlowDefinitionCreate) -> Dict[str, Any]:
    """Create a new flow definition."""
    node_ids = {n.id for n in body.nodes}
    if body.entry_node_id not in node_ids:
        raise HTTPException(400, "entry_node_id must reference an existing node")

    for edge in body.edges:
        if edge.source not in node_ids:
            raise HTTPException(400, f"Edge source '{edge.source}' not found in nodes")
        if edge.target not in node_ids:
            raise HTTPException(400, f"Edge target '{edge.target}' not found in nodes")

    flow = FlowDefinition(
        name=body.name,
        nodes=body.nodes,
        edges=body.edges,
        entry_node_id=body.entry_node_id,
    )
    return await storage.save_flow(flow)


@router.get("/flows/{flow_id}")
async def get_flow(flow_id: str) -> Dict[str, Any]:
    """Get a flow definition."""
    data = await storage.get_flow(flow_id)
    if data is None:
        raise HTTPException(404, "Flow definition not found")
    return data


@router.put("/flows/{flow_id}")
async def update_flow(
    flow_id: str,
    body: FlowDefinitionUpdate,
) -> Dict[str, Any]:
    """Update a flow definition."""
    data = await storage.get_flow(flow_id)
    if data is None:
        raise HTTPException(404, "Flow definition not found")

    flow = FlowDefinition(**data)
    if body.name is not None:
        flow.name = body.name
    if body.nodes is not None:
        flow.nodes = [FlowNode(**n) for n in body.nodes]
    if body.edges is not None:
        from .models import FlowEdge
        flow.edges = [FlowEdge(**e) for e in body.edges]
    if body.entry_node_id is not None:
        if body.entry_node_id not in {n.id for n in flow.nodes}:
            raise HTTPException(400, "entry_node_id not found in nodes")
        flow.entry_node_id = body.entry_node_id

    flow.updated_at = datetime.now(timezone.utc)
    return await storage.save_flow(flow)


@router.delete("/flows/{flow_id}")
async def delete_flow(flow_id: str) -> Dict[str, Any]:
    """Delete a flow definition."""
    ok = await storage.delete_flow(flow_id)
    if not ok:
        raise HTTPException(404, "Flow definition not found")
    return {"ok": True, "flow_id": flow_id}


# ─── Flow Instances ────────────────────────────────────────────────


@router.post("/flow-instances")
async def start_flow_instance(body: StartFlowRequest) -> Dict[str, Any]:
    """Start a new flow instance bound to a group chat or session."""
    fd_data = await storage.get_flow(body.flow_id)
    if fd_data is None:
        raise HTTPException(404, "Flow definition not found")

    flow_def = FlowDefinition(**fd_data)

    # Delete any existing instance for the same group/session
    if body.group_id:
        await storage.delete_flow_instance_by_group(body.group_id)

    instance = FlowInstance(
        flow_id=body.flow_id,
        group_id=body.group_id,
        session_id=body.session_id,
        current_node_id=flow_def.entry_node_id,
    )
    for node in flow_def.nodes:
        instance.node_states[node.id] = (
            FlowNodeStatus.ACTIVE.value
            if node.id == flow_def.entry_node_id
            else FlowNodeStatus.PENDING.value
        )
    return await storage.save_flow_instance(instance)


@router.get("/flow-instances/{instance_id}")
async def get_flow_instance(instance_id: str) -> Dict[str, Any]:
    """Get a flow instance by ID."""
    data = await storage.get_flow_instance(instance_id)
    if data is None:
        raise HTTPException(404, "Flow instance not found")

    fd_data = await storage.get_flow(data.get("flow_id", ""))
    if fd_data:
        flow_def = FlowDefinition(**fd_data)
        instance = FlowInstance(**data)
        data["progress"] = get_flow_progress(flow_def, instance)

    return data


@router.get("/flow-instances/by-group/{group_id}")
async def get_flow_instance_by_group(group_id: str) -> Dict[str, Any]:
    """Get the flow instance for a group chat."""
    data = await storage.get_flow_instance_by_group(group_id)
    if data is None:
        return {"instance": None}

    fd_data = await storage.get_flow(data.get("flow_id", ""))
    if fd_data:
        flow_def = FlowDefinition(**fd_data)
        instance = FlowInstance(**data)
        data["progress"] = get_flow_progress(flow_def, instance)

    return {"instance": data}


@router.post("/flow-instances/{instance_id}/advance")
async def advance_flow_instance(
    instance_id: str,
    body: AdvanceFlowRequest,
) -> Dict[str, Any]:
    """Advance a flow instance to the next node.

    The caller provides the list of participants (agent_id, role)
    so the engine can resolve the next speaker.
    """
    fi_data = await storage.get_flow_instance(instance_id)
    if fi_data is None:
        raise HTTPException(404, "Flow instance not found")

    instance = FlowInstance(**fi_data)
    if instance.status == FlowInstanceStatus.COMPLETED:
        raise HTTPException(400, "Flow instance is already completed")
    if instance.status == FlowInstanceStatus.ERROR:
        raise HTTPException(400, "Flow instance is in error state")

    fd_data = await storage.get_flow(instance.flow_id)
    if fd_data is None:
        raise HTTPException(404, "Flow definition not found")

    flow_def = FlowDefinition(**fd_data)

    instance.turn_count += 1
    instance.total_turns += 1
    result = advance_flow(
        body.participants,
        flow_def,
        instance,
        decision_route=body.decision_route,
    )
    await storage.save_flow_instance(instance)

    return {
        "instance": instance.to_dict(),
        "node_changed": result.node_changed,
        "flow_completed": result.flow_completed,
        "system_message": result.system_message,
        "next_speaker_id": result.next_speaker_id,
    }


@router.post("/flow-instances/{instance_id}/decision")
async def submit_decision(
    instance_id: str,
    body: DecisionRequest,
) -> Dict[str, Any]:
    """Submit a decision route for the current decision node."""
    fi_data = await storage.get_flow_instance(instance_id)
    if fi_data is None:
        raise HTTPException(404, "Flow instance not found")

    instance = FlowInstance(**fi_data)
    fd_data = await storage.get_flow(instance.flow_id)
    if fd_data is None:
        raise HTTPException(404, "Flow definition not found")

    flow_def = FlowDefinition(**fd_data)
    node = flow_def.get_node(instance.current_node_id)
    if node is None or node.type != FlowNodeType.DECISION:
        raise HTTPException(400, "Current node is not a decision node")

    # Advance with the provided decision route
    instance.turn_count += 1
    instance.total_turns += 1
    result = advance_flow(
        [],
        flow_def,
        instance,
        decision_route=body.target_node_id,
    )
    await storage.save_flow_instance(instance)

    return {
        "instance": instance.to_dict(),
        "flow_completed": result.flow_completed,
        "system_message": result.system_message,
    }


@router.get("/flow-instances/{instance_id}/progress")
async def get_progress(instance_id: str) -> Dict[str, Any]:
    """Get flow progress for an instance."""
    fi_data = await storage.get_flow_instance(instance_id)
    if fi_data is None:
        raise HTTPException(404, "Flow instance not found")

    fd_data = await storage.get_flow(fi_data.get("flow_id", ""))
    if fd_data is None:
        raise HTTPException(404, "Flow definition not found")

    flow_def = FlowDefinition(**fd_data)
    instance = FlowInstance(**fi_data)
    progress = get_flow_progress(flow_def, instance)
    return {"progress": progress}


@router.delete("/flow-instances/by-group/{group_id}")
async def delete_flow_instance_by_group(group_id: str) -> Dict[str, Any]:
    """Delete the flow instance for a group chat."""
    ok = await storage.delete_flow_instance_by_group(group_id)
    return {"ok": ok, "group_id": group_id}


# ── Background persistence loop ────────────────────────────────────


async def _persist_loop() -> None:
    """Background loop: persist dirty caches to disk every 10 seconds."""
    global _PERSIST_RUNNING
    _PERSIST_RUNNING = True
    logger.info("[flow-manager] Persistence loop started")

    while _PERSIST_RUNNING:
        try:
            await asyncio.sleep(10)
            await storage.flush()
        except asyncio.CancelledError:
            break
        except Exception:
            logger.exception("[flow-manager] Persistence loop error")

    _PERSIST_RUNNING = False
    logger.info("[flow-manager] Persistence loop stopped")


# ── PawApp definition ──────────────────────────────────────────────

app = PawApp(name="FlowManager", app_id="flow-manager")
app.enable_standard_capabilities()
app.include_router(router)


@app.on_launch
async def init_flow_manager() -> None:
    """Initialize FlowManager on app launch."""
    global _PERSIST_TASK

    from .storage import _init_caches
    _init_caches()
    logger.info("[flow-manager] Data caches initialized")

    if _PERSIST_TASK is None or _PERSIST_TASK.done():
        _PERSIST_TASK = asyncio.create_task(_persist_loop())
        logger.info("[flow-manager] Persistence task started")


@app.on_terminate
async def shutdown_flow_manager() -> None:
    """Shutdown FlowManager on app terminate."""
    global _PERSIST_RUNNING, _PERSIST_TASK

    _PERSIST_RUNNING = False
    if _PERSIST_TASK and not _PERSIST_TASK.done():
        _PERSIST_TASK.cancel()
        try:
            await _PERSIST_TASK
        except asyncio.CancelledError:
            pass

    await storage.flush()
    logger.info("[flow-manager] Shutdown complete")


# The 'plugin' variable is what PluginLoader looks for.
plugin = app
