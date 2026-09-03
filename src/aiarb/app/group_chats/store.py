# -*- coding: utf-8 -*-
"""JSON persistence for group-chat sessions.

Sessions are stored as individual JSON files under
``{workspace_dir}/sessions/console/group_chats/{group_id}.json``.

This is intentionally separate from the host agent's own
``SafeJSONSession`` so member turns, round records, and host opener /
summary texts do not bloat the host's conversation context.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Optional

from ...utils.io_utils import get_path_lock, run_sync_io, write_json_atomic_async
from .models import GroupSession

logger = logging.getLogger(__name__)

_GROUP_CHATS_SUBDIR = Path("sessions", "console", "group_chats")


def _group_chats_dir(workspace_dir: str | Path | None) -> Path:
    """Return the group-chats directory for a workspace.

    When ``workspace_dir`` is ``None`` (e.g. HITL API requests that don't
    pass through the contextvars hook), fall back to the default workspace.
    """
    if workspace_dir is None:
        from ...constant import WORKING_DIR

        workspace_dir = WORKING_DIR / "workspaces" / "default"
    base = Path(workspace_dir).expanduser()
    target = base / _GROUP_CHATS_SUBDIR
    target.mkdir(parents=True, exist_ok=True)
    return target


def _group_session_path(workspace_dir: str | Path | None, group_id: str) -> str:
    """Return the JSON file path for one group session."""
    # Sanitise group_id for filesystem safety
    safe = group_id.replace("/", "-").replace("\\", "-").replace(":", "--")
    if len(safe) > 200:
        import hashlib

        safe = hashlib.sha256(group_id.encode()).hexdigest()[:40]
    return str(_group_chats_dir(workspace_dir) / f"{safe}.json")


async def save_group_session(
    workspace_dir: str | Path | None,
    session: GroupSession,
) -> None:
    """Persist a group session to disk atomically."""
    session.touch()
    path = _group_session_path(workspace_dir, session.group_id)
    async with get_path_lock(path):
        await write_json_atomic_async(
            path,
            session.model_dump(),
            indent=None,
        )
    logger.debug("Saved group session %s", session.group_id)


async def load_group_session(
    workspace_dir: str | Path | None,
    group_id: str,
) -> Optional[GroupSession]:
    """Load a group session from disk, or ``None`` if it doesn't exist."""
    path = _group_session_path(workspace_dir, group_id)

    def _read():
        if not os.path.exists(path):
            return None
        with open(path, "r", encoding="utf-8", errors="surrogatepass") as f:
            import json

            return json.load(f)

    data = await run_sync_io(_read)
    if data is None:
        return None
    try:
        return GroupSession.model_validate(data)
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "Failed to validate group session %s: %s",
            group_id,
            exc,
        )
        return None
