# -*- coding: utf-8 -*-
"""Pydantic data models for the group-chat runtime.

All models are JSON-serialisable so they can be persisted to disk and
replayed on reconnect.
"""

from __future__ import annotations

import time
from enum import Enum
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


class GroupMode(str, Enum):
    """Scheduling mode for member turns within a round."""

    ROUND_ROBIN = "round_robin"
    PARALLEL = "parallel"
    AUTONOMOUS = "autonomous"


class Member(BaseModel):
    """A participant agent in a group chat."""

    agent_id: str
    name: str = ""
    role: str = ""
    order: int = 0
    member_session_id: str = ""
    # ── 人机协同：角色操控（新增）──
    controller: Literal["auto", "human", "assist"] = "auto"  # 档位（持久）
    assist_hint: str = ""        # 档4：人给的方向/要点
    override_count: int = 0      # 人工干预计数（审计）

    def ensure_session_id(self, group_id: str) -> str:
        """Return the member's isolated session ID, creating if needed.

        Uses a short hash of ``group_id`` + ``agent_id`` to keep the
        session ID compact — the full colon-separated form would
        produce file names exceeding Windows MAX_PATH (260 chars)
        when sanitised and combined with the user_id prefix in
        ``session_filename``.

        Also migrates legacy (pre-hash) member_session_id values that
        used the full ``group:{...}:member:{agent_id}`` format.
        """
        # Detect stale long-format IDs (legacy ``group:…:member:…`` or
        # anything longer than 32 chars) and replace with compact hash.
        if (
            not self.member_session_id
            or self.member_session_id.startswith("group:")
            or len(self.member_session_id) > 32
        ):
            import hashlib

            digest = hashlib.md5(
                f"{group_id}:{self.agent_id}".encode(),
            ).hexdigest()[:12]
            self.member_session_id = f"gmc:{digest}"
        return self.member_session_id


class MemberTurn(BaseModel):
    """One member's response within a round."""

    member_id: str
    prompt: str = ""
    status: Literal[
        "pending", "running", "done", "error", "timeout",
        "awaiting_human",
    ] = "pending"
    result: str = ""
    started_at: float = 0
    finished_at: float = 0
    human_override: bool = False                    # 该发言由人产出


class RoundRecord(BaseModel):
    """A complete round of member turns plus host bookends."""

    round_no: int
    opener: str = ""
    turns: List[MemberTurn] = Field(default_factory=list)
    summary: str = ""
    # M3: Script phase name this round belongs to (e.g. "开庭陈述")
    phase: str = ""


class ScriptPhase(BaseModel):
    """One phase of a multi-round group-chat script (M3, 档1 剧本).

    A script is a sequence of phases declared in the host metadata:

        <!-- HOST:{"script":[{"name":"开庭陈述","mode":"round_robin"}, ...]} -->

    The runtime advances through phases one per round instead of using a
    fixed single-round schedule.
    """

    name: str = ""
    mode: str = "round_robin"  # round_robin | parallel
    member_filter: List[str] = Field(default_factory=list)  # restrict to these agent_ids
    host_opener_hint: str = ""  # hint for the host's opener prompt


class GroupSession(BaseModel):
    """Persistent state for one group-chat session.

    Stored at ``sessions/console/group_chats/{group_id}.json`` and
    decoupled from the host agent's own ``console:{sender_id}`` session.
    """

    group_id: str
    host_agent_id: str
    schedule_mode: GroupMode = GroupMode.ROUND_ROBIN
    members: List[Member] = Field(default_factory=list)
    round: int = 0
    rounds: List[RoundRecord] = Field(default_factory=list)
    version: str = "group_v1"
    created_at: float = Field(default_factory=lambda: time.time())
    updated_at: float = Field(default_factory=lambda: time.time())
    # M3: Script phases (empty = no script, use fixed schedule_mode)
    script: List[ScriptPhase] = Field(default_factory=list)
    # M3: Current phase index (0-based; -1 = no script / completed)
    script_phase_idx: int = -1

    def find_member(self, agent_id: str) -> Optional[Member]:
        """Locate a member by agent ID."""
        for m in self.members:
            if m.agent_id == agent_id:
                return m
        return None

    def ordered_members(self) -> List[Member]:
        """Return members sorted by ``order`` for round-robin scheduling."""
        return sorted(self.members, key=lambda m: m.order)

    def touch(self) -> None:
        """Update the ``updated_at`` timestamp."""
        self.updated_at = time.time()


# ── Host metadata parsing ────────────────────────────────────────────────

_HOST_META_RE = None  # compiled lazily


def _ensure_host_meta_re():
    """Compile the HOST metadata regex on first use."""
    global _HOST_META_RE  # noqa: PLW0603
    if _HOST_META_RE is None:
        import re

        _HOST_META_RE = re.compile(r"<!--\s*HOST:\s*(\{.*?\})\s*-->", re.DOTALL)
    return _HOST_META_RE


def parse_host_meta(description: str) -> Optional[Dict[str, Any]]:
    """Extract the ``<!-- HOST:{...} -->`` metadata block from a description.

    Returns the parsed JSON dict or ``None`` if no metadata is found.
    """
    if not description:
        return None
    match = _ensure_host_meta_re().search(description)
    if not match:
        return None
    import json

    try:
        data = json.loads(match.group(1))
        if not isinstance(data, dict):
            return None
        return data
    except (json.JSONDecodeError, ValueError):
        return None


def is_group_host_description(description: str) -> bool:
    """Check whether an agent description marks it as a group-chat host."""
    return parse_host_meta(description) is not None


def build_group_id(host_agent_id: str, session_id: str) -> str:
    """Construct a deterministic group ID from host agent and session.

    Uses a short hash so that downstream file names (session files,
    group session JSON) stay well within Windows MAX_PATH (260 chars).
    """
    import hashlib

    digest = hashlib.md5(
        f"{host_agent_id}:{session_id}".encode(),
    ).hexdigest()[:16]
    return f"gcid:{digest}"
