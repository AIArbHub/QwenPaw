# -*- coding: utf-8 -*-
"""Group-chat SSE event production.

Converts orchestration events into standard ``message`` events that the
existing ``_serialize_event_for_sse`` pipeline and the frontend can
consume without any new event types.

Contract (R1 mitigation):
    Member messages = standard ``message`` event + ``meta.group_member``
    marker.  The frontend uses ``meta.group_member`` to route member
    speech to independent ``MemberReplyRow`` bubbles.

M6 streaming:
    ``tag_event_as_member`` stamps any runtime event (Message, TextContent
    delta, AgentResponse) with the ``metadata.group_member`` marker so
    streaming deltas from member agents are routed to the correct
    ``MemberReplyRow`` bubble in the frontend.
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any, Optional
from uuid import uuid4

from ...schemas import (
    ContentType,
    Message,
    MessageType,
    Role,
    RunStatus,
)
from ...schemas import TextContent
from .models import Member

logger = logging.getLogger(__name__)


def make_host_message(
    text: str,
    *,
    status: RunStatus = RunStatus.InProgress,
    msg_id: Optional[str] = None,
) -> Message:
    """Build a host agent message (standard message, no meta marker)."""
    return Message(
        id=msg_id or uuid4().hex,
        type=MessageType.MESSAGE,
        role=Role.ASSISTANT,
        content=[
            TextContent(
                type=ContentType.TEXT,
                text=text,
                status=status,
            ),
        ],
        status=status,
    )


def make_member_message(
    member: Member,
    text: str,
    *,
    status: RunStatus = RunStatus.Completed,
    msg_id: Optional[str] = None,
    human_override: bool = False,
    human_pending: bool = False,
    human_pending_timeout: bool = False,
) -> Message:
    """Build a member speech message with ``meta.group_member`` marker.

    The marker lets the frontend distinguish member speech from host
    speech and route it to an independent bubble.

    Human-in-the-loop markers:
    - ``human_override=True``: this turn was produced by a human.
    - ``human_pending=True``: waiting for a human to speak (InProgress).
    - ``human_pending_timeout=True``: human wait timed out.
    """
    msg = Message(
        id=msg_id or uuid4().hex,
        type=MessageType.MESSAGE,
        role=Role.ASSISTANT,
        content=[
            TextContent(
                type=ContentType.TEXT,
                text=text,
                status=status,
            ),
        ],
        status=status,
    )
    # Attach the group_member marker via metadata so the frontend can
    # use isGroupMemberMessage() to route it to a MemberReplyRow.
    meta: dict[str, Any] = {
        "group_member": member.agent_id,
        "group_member_name": member.name or member.agent_id,
    }
    if human_override:
        meta["human_override"] = True
    if human_pending:
        meta["human_pending"] = True
    if human_pending_timeout:
        meta["human_pending_timeout"] = True
    msg.metadata = meta
    return msg


def make_member_running_message(
    member: Member,
    text: str = "",
    *,
    msg_id: Optional[str] = None,
) -> Message:
    """Build an in-progress member message (streaming delta placeholder).

    For the one-shot collection path (M2), the member's full reply
    arrives as a single completed message.  This running placeholder
    is emitted before collection starts so the frontend can show a
    "thinking" indicator for the member.
    """
    return make_member_message(
        member,
        text or "",
        status=RunStatus.InProgress,
        msg_id=msg_id,
    )


def make_response_completed(
    output: list[Message],
) -> dict[str, Any]:
    """Build a response.completed SSE payload.

    This mirrors the shape produced by ``_serialize_event_for_sse`` for
    a ``response`` object with ``Completed`` status, so downstream
    consumers (turn usage, frontend) handle it identically.
    """
    return {
        "object": "response",
        "status": RunStatus.Completed.value,
        "output": [m.model_dump() for m in output],
    }


def make_round_marker(round_no: int, summary: str = "") -> dict[str, Any]:
    """Build a hidden round-end marker (attached to summary message meta).

    The frontend can use this for log alignment and scroll restoration.
    """
    return {
        "group_round": round_no,
        "summary": summary,
    }


def make_member_awaiting_message(
    member: Member,
    msg_id: Optional[str] = None,
) -> Message:
    """Build an InProgress member message indicating the member is awaiting
    human input (controller=human).

    The frontend renders a "waiting for you to speak…" prompt.
    """
    return make_member_message(
        member,
        "",
        status=RunStatus.InProgress,
        msg_id=msg_id,
        human_pending=True,
    )


def make_member_approval_pending_message(
    member: Member,
    draft_text: str,
    msg_id: Optional[str] = None,
) -> Message:
    """Build an InProgress member message indicating the member's draft
    is awaiting human approval (control point 2, controller=assist+approval).

    The frontend renders a "waiting for approval…" prompt with the draft
    text visible for review/editing.
    """
    msg = make_member_message(
        member,
        draft_text,
        status=RunStatus.InProgress,
        msg_id=msg_id,
    )
    if msg.metadata is None:
        msg.metadata = {}
    msg.metadata["human_pending"] = True
    msg.metadata["approval_pending"] = True
    return msg


def make_group_control_meta(
    member_id: str,
    controller: str,
) -> dict[str, Any]:
    """Build a ``group_control`` metadata block for controller changes.

    The frontend reads this to update the member's badge (AI / human / assist).
    Attached to a standard message event's metadata.
    """
    return {
        "group_control": {
            "member_id": member_id,
            "controller": controller,
        },
    }


# ── M6: Streaming event tagging ─────────────────────────────────────────

# Attributes that may carry metadata on schema objects
_META_ATTRS = ("metadata", "meta")


def _get_meta_dict(obj: Any) -> dict | None:
    """Return the metadata dict from a schema object, or None."""
    for attr in _META_ATTRS:
        val = getattr(obj, attr, None)
        if isinstance(val, dict):
            return val
    return None


def _ensure_meta_dict(obj: Any) -> dict | None:
    """Ensure the object has a metadata dict and return it.

    Returns ``None`` if the object does not support metadata assignment.
    """
    # Try 'metadata' first (primary attr on Message/TextContent)
    meta = getattr(obj, "metadata", None)
    if isinstance(meta, dict):
        return meta
    # Try to create it
    try:
        obj.metadata = {}
        return obj.metadata
    except Exception:  # noqa: BLE001
        pass
    # Fallback: try 'meta' attr
    meta = getattr(obj, "meta", None)
    if isinstance(meta, dict):
        return meta
    try:
        obj.meta = {}
        return obj.meta
    except Exception:  # noqa: BLE001
        pass
    return None


def tag_event_as_member(event: Any, member: Member) -> Any:
    """Stamp a runtime event with the ``group_member`` marker.

    Works on:
    - ``Message`` objects (``object == "message"``)
    - ``TextContent`` / delta chunks (``object == "content"``)
    - ``AgentResponse`` objects (``object == "response"``) — tagged so
      the frontend can associate the response lifecycle with a member.

    The function mutates the event in-place (when possible) and returns
    it.  If the event does not support metadata, it is returned unchanged.
    """
    try:
        meta = _ensure_meta_dict(event)
        if meta is None:
            return event
        # Don't overwrite if already tagged (idempotent)
        if meta.get("group_member") == member.agent_id:
            return event
        meta["group_member"] = member.agent_id
        meta["group_member_name"] = member.name or member.agent_id
        return event
    except Exception:  # noqa: BLE001
        logger.debug(
            "Failed to tag event as member %s",
            member.agent_id,
            exc_info=True,
        )
        return event
