# -*- coding: utf-8 -*-
"""FlowManager — FlowEngine state machine.

Responsible for advancing flow instances through nodes:

    - STAGE:     single-agent or round-robin speaking, max_turns cap
    - DECISION:  rule-based routing to one outgoing edge
    - PARALLEL:  fan-out to multiple branches simultaneously
    - MERGE:     collect all incoming branches, then proceed
    - LOOP:      loop back to a target node (with optional iteration cap)
    - TERMINAL:  flow completion

The engine is pure: given (flow_def, instance, participants) it returns
the next instance state. I/O (storage, SSE) is left to the caller.

Author: Sum
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from .models import (
    FlowDefinition,
    FlowInstance,
    FlowInstanceStatus,
    FlowNode,
    FlowNodeStatus,
    FlowNodeType,
)

logger = logging.getLogger(__name__)


class FlowAdvanceResult:
    """Result of a flow advance operation."""

    def __init__(
        self,
        instance: FlowInstance,
        *,
        node_changed: bool = False,
        flow_completed: bool = False,
        system_message: Optional[str] = None,
        next_speaker_id: Optional[str] = None,
    ) -> None:
        self.instance = instance
        self.node_changed = node_changed
        self.flow_completed = flow_completed
        self.system_message = system_message
        self.next_speaker_id = next_speaker_id


def resolve_speaker_for_node(
    participants: List[Dict[str, Any]],
    node: FlowNode,
    instance: FlowInstance,
) -> Optional[str]:
    """Determine which participant speaks for a given flow node.

    Args:
        participants: List of dicts with at least ``agent_id`` and
            optional ``role`` keys.
        node: The current flow node.
        instance: The flow instance.

    Returns:
        agent_id of the selected speaker, or None.

    Priority:
    1. node.speaker_agent_id — explicit agent assignment
    2. node.speaker_role — match by participant role
    3. Round-robin among participants
    """
    if not participants:
        return None

    # Explicit agent
    if node.speaker_agent_id:
        for p in participants:
            if p.get("agent_id") == node.speaker_agent_id:
                return p["agent_id"]
        logger.warning(
            "Node %s speaker_agent_id=%s not found in participants",
            node.id, node.speaker_agent_id,
        )

    # Role-based
    if node.speaker_role:
        for p in participants:
            role = p.get("role", "")
            if isinstance(role, str) and role == node.speaker_role:
                return p["agent_id"]
            if hasattr(role, "value") and role.value == node.speaker_role:
                return p["agent_id"]

    # Round-robin fallback (skip observers)
    active = [
        p for p in participants
        if p.get("role", "member") != "observer"
    ]
    if not active:
        active = participants
    idx = instance.turn_count % len(active)
    return active[idx].get("agent_id")


def should_advance_node(
    node: FlowNode,
    instance: FlowInstance,
) -> bool:
    """Check if the current node should advance to the next one."""
    if node.type == FlowNodeType.TERMINAL:
        return False
    if node.type == FlowNodeType.LOOP:
        return instance.turn_count >= 1
    return instance.turn_count >= node.max_turns


def advance_flow(
    participants: List[Dict[str, Any]],
    flow_def: FlowDefinition,
    instance: FlowInstance,
    *,
    decision_route: Optional[str] = None,
) -> FlowAdvanceResult:
    """Advance the flow to the next node(s).

    Args:
        participants: List of participant dicts (agent_id, role, name).
        flow_def: The flow definition.
        instance: The current flow instance (mutated in-place).
        decision_route: For decision nodes, the selected target node ID.

    Returns:
        FlowAdvanceResult with updated instance and metadata.
    """
    node = flow_def.get_node(instance.current_node_id)
    if node is None:
        logger.error("Current node %s not found in flow", instance.current_node_id)
        instance.status = FlowInstanceStatus.ERROR
        return FlowAdvanceResult(instance, flow_completed=False)

    if not should_advance_node(node, instance):
        speaker = resolve_speaker_for_node(participants, node, instance)
        return FlowAdvanceResult(
            instance,
            node_changed=False,
            next_speaker_id=speaker,
        )

    instance.node_states[node.id] = FlowNodeStatus.COMPLETED.value
    instance.history.append({
        "node_id": node.id,
        "node_label": node.label,
        "turns": instance.turn_count,
        "action": "completed",
    })

    if node.type == FlowNodeType.TERMINAL:
        instance.status = FlowInstanceStatus.COMPLETED
        return FlowAdvanceResult(
            instance,
            node_changed=True,
            flow_completed=True,
            system_message=f"流程「{flow_def.name}」已完成。",
        )

    if node.type == FlowNodeType.LOOP:
        next_ids = flow_def.get_next_nodes(node.id)
        target_id = node.loop_target or (next_ids[0] if next_ids else None)
        if target_id is None:
            instance.status = FlowInstanceStatus.ERROR
            return FlowAdvanceResult(instance, flow_completed=False)
        target_node = flow_def.get_node(target_id)
        if target_node is None:
            instance.status = FlowInstanceStatus.ERROR
            return FlowAdvanceResult(instance, flow_completed=False)
        instance.current_node_id = target_id
        instance.turn_count = 0
        instance.node_states[target_id] = FlowNodeStatus.ACTIVE.value
        speaker = resolve_speaker_for_node(participants, target_node, instance)
        return FlowAdvanceResult(
            instance,
            node_changed=True,
            system_message=f"循环回到环节：「{target_node.label}」",
            next_speaker_id=speaker,
        )

    if node.type == FlowNodeType.DECISION:
        edges = flow_def.get_edges_from(node.id)
        if not edges:
            instance.status = FlowInstanceStatus.COMPLETED
            return FlowAdvanceResult(
                instance,
                node_changed=True,
                flow_completed=True,
                system_message=f"流程「{flow_def.name}」已完成。",
            )

        chosen_target = decision_route or edges[0].target
        target_node = flow_def.get_node(chosen_target)
        if target_node is None:
            chosen_target = edges[0].target
            target_node = flow_def.get_node(chosen_target)
        if target_node is None:
            instance.status = FlowInstanceStatus.ERROR
            return FlowAdvanceResult(instance, flow_completed=False)

        instance.current_node_id = chosen_target
        instance.turn_count = 0
        instance.node_states[chosen_target] = FlowNodeStatus.ACTIVE.value

        if target_node.type == FlowNodeType.TERMINAL:
            instance.status = FlowInstanceStatus.COMPLETED
            return FlowAdvanceResult(
                instance,
                node_changed=True,
                flow_completed=True,
                system_message=f"流程「{flow_def.name}」已完成。",
            )

        speaker = resolve_speaker_for_node(participants, target_node, instance)
        return FlowAdvanceResult(
            instance,
            node_changed=True,
            system_message=f"决策路由到：「{target_node.label}」",
            next_speaker_id=speaker,
        )

    if node.type == FlowNodeType.PARALLEL:
        edges = flow_def.get_edges_from(node.id)
        if not edges:
            instance.status = FlowInstanceStatus.COMPLETED
            return FlowAdvanceResult(
                instance,
                node_changed=True,
                flow_completed=True,
                system_message=f"流程「{flow_def.name}」已完成。",
            )

        first_target = None
        for edge in edges:
            target_node = flow_def.get_node(edge.target)
            if target_node:
                instance.node_states[edge.target] = FlowNodeStatus.ACTIVE.value
                instance.active_branches[edge.target] = True
                if first_target is None:
                    first_target = edge.target

        if first_target is None:
            instance.status = FlowInstanceStatus.ERROR
            return FlowAdvanceResult(instance, flow_completed=False)

        instance.current_node_id = first_target
        instance.turn_count = 0
        target_node = flow_def.get_node(first_target)
        speaker = (
            resolve_speaker_for_node(participants, target_node, instance)
            if target_node else None
        )
        return FlowAdvanceResult(
            instance,
            node_changed=True,
            system_message=f"并行分支启动：{len(edges)} 个分支已激活",
            next_speaker_id=speaker,
        )

    # STAGE and MERGE: follow first outgoing edge
    next_ids = flow_def.get_next_nodes(node.id)
    if not next_ids:
        instance.status = FlowInstanceStatus.COMPLETED
        return FlowAdvanceResult(
            instance,
            node_changed=True,
            flow_completed=True,
            system_message=f"流程「{flow_def.name}」已完成。",
        )

    for next_id in next_ids:
        next_node = flow_def.get_node(next_id)
        if next_node and next_node.type == FlowNodeType.MERGE:
            instance.active_branches[node.id] = False
            incoming = flow_def.get_incoming_nodes(next_id)
            all_done = all(
                instance.node_states.get(inc) == FlowNodeStatus.COMPLETED.value
                for inc in incoming
            )
            if not all_done:
                for bid, active in instance.active_branches.items():
                    if active and bid != node.id:
                        branch_node = flow_def.get_node(bid)
                        if branch_node:
                            instance.current_node_id = bid
                            instance.turn_count = 0
                            speaker = resolve_speaker_for_node(
                                participants, branch_node, instance,
                            )
                            return FlowAdvanceResult(
                                instance,
                                node_changed=True,
                                system_message=f"等待其他分支完成，切换到：「{branch_node.label}」",
                                next_speaker_id=speaker,
                            )
                logger.warning("No active branches but merge not satisfied")
                instance.status = FlowInstanceStatus.ERROR
                return FlowAdvanceResult(instance, flow_completed=False)
            else:
                instance.current_node_id = next_id
                instance.turn_count = 0
                instance.node_states[next_id] = FlowNodeStatus.ACTIVE.value
                speaker = resolve_speaker_for_node(
                    participants, next_node, instance,
                )
                return FlowAdvanceResult(
                    instance,
                    node_changed=True,
                    system_message=f"所有分支已合并，进入：「{next_node.label}」",
                    next_speaker_id=speaker,
                )

    next_id = next_ids[0]
    next_node = flow_def.get_node(next_id)
    if next_node is None:
        instance.status = FlowInstanceStatus.ERROR
        return FlowAdvanceResult(instance, flow_completed=False)

    if next_node.type == FlowNodeType.TERMINAL:
        instance.current_node_id = next_id
        instance.node_states[next_id] = FlowNodeStatus.COMPLETED.value
        instance.status = FlowInstanceStatus.COMPLETED
        return FlowAdvanceResult(
            instance,
            node_changed=True,
            flow_completed=True,
            system_message=f"流程「{flow_def.name}」已完成。",
        )

    instance.current_node_id = next_id
    instance.turn_count = 0
    instance.node_states[next_id] = FlowNodeStatus.ACTIVE.value

    speaker = resolve_speaker_for_node(participants, next_node, instance)
    return FlowAdvanceResult(
        instance,
        node_changed=True,
        system_message=f"进入环节：「{next_node.label}」",
        next_speaker_id=speaker,
    )


def get_flow_progress(
    flow_def: FlowDefinition,
    instance: FlowInstance,
) -> Dict[str, Any]:
    """Return a progress summary for the flow instance."""
    total_nodes = len(flow_def.nodes)
    completed = sum(
        1 for s in instance.node_states.values()
        if s == FlowNodeStatus.COMPLETED.value
    )
    active = sum(
        1 for s in instance.node_states.values()
        if s == FlowNodeStatus.ACTIVE.value
    )
    current = flow_def.get_node(instance.current_node_id)
    return {
        "total_nodes": total_nodes,
        "completed_nodes": completed,
        "active_nodes": active,
        "current_node_id": instance.current_node_id,
        "current_node_label": current.label if current else None,
        "total_turns": instance.total_turns,
        "status": instance.status.value,
        "progress_pct": round(completed / total_nodes * 100, 1) if total_nodes else 0,
        "node_states": instance.node_states,
        "history": instance.history,
    }


__all__ = [
    "FlowAdvanceResult",
    "advance_flow",
    "get_flow_progress",
    "resolve_speaker_for_node",
    "should_advance_node",
]
