# -*- coding: utf-8 -*-
"""Pet ↔ Agent binding service.

Maintains a persistent mapping from pet_id to agent_id, stored as JSON in
the pet runtime home (``~/.aiarb-pet/bindings.json`` by default).

The binding lets the desktop pet forward user-typed messages to a chosen
QwenPaw agent and stream the agent's reply back into the pet bubble.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from pathlib import Path
from typing import Any

from .runtime import home_dir


def _bindings_path() -> Path:
    """Return the path to bindings.json inside the pet runtime home."""
    return home_dir() / "bindings.json"


def _load_bindings() -> dict[str, dict[str, Any]]:
    """Read the binding store from disk. Returns ``{}`` if missing/invalid."""
    path = _bindings_path()
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            return data
    except Exception:
        pass
    return {}


def _save_bindings(data: dict[str, dict[str, Any]]) -> None:
    """Persist the binding store atomically."""
    path = _bindings_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    tmp.replace(path)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def list_bindings() -> list[dict[str, Any]]:
    """Return all bindings as a list of ``{pet_id, agent_id, ...}`` dicts."""
    data = _load_bindings()
    out: list[dict[str, Any]] = []
    for pet_id, entry in data.items():
        if not isinstance(entry, dict):
            continue
        out.append({
            "pet_id": pet_id,
            "agent_id": entry.get("agent_id", ""),
            "agent_name": entry.get("agent_name", ""),
            "session_id": entry.get("session_id", ""),
            "created_at": entry.get("created_at", ""),
            "updated_at": entry.get("updated_at", ""),
        })
    return out


def get_binding(pet_id: str) -> dict[str, Any] | None:
    """Return the binding for a single pet, or ``None`` if unbound."""
    data = _load_bindings()
    entry = data.get(pet_id)
    if not isinstance(entry, dict):
        return None
    return {
        "pet_id": pet_id,
        "agent_id": entry.get("agent_id", ""),
        "agent_name": entry.get("agent_name", ""),
        "session_id": entry.get("session_id", ""),
    }


def set_binding(
    pet_id: str,
    agent_id: str,
    agent_name: str = "",
    session_id: str | None = None,
) -> dict[str, Any]:
    """Create or update a binding. Generates a new session_id if missing."""
    from datetime import datetime
    now = datetime.utcnow().isoformat() + "Z"

    data = _load_bindings()
    existing = data.get(pet_id, {}) if isinstance(data.get(pet_id), dict) else {}

    if session_id is None:
        session_id = existing.get("session_id") or f"pet-{pet_id}-{uuid.uuid4().hex[:12]}"

    data[pet_id] = {
        "agent_id": agent_id,
        "agent_name": agent_name,
        "session_id": session_id,
        "created_at": existing.get("created_at", now),
        "updated_at": now,
    }
    _save_bindings(data)
    return {
        "pet_id": pet_id,
        "agent_id": agent_id,
        "agent_name": agent_name,
        "session_id": session_id,
    }


def remove_binding(pet_id: str) -> bool:
    """Delete a binding. Returns True if a binding was removed."""
    data = _load_bindings()
    if pet_id in data:
        del data[pet_id]
        _save_bindings(data)
        return True
    return False


def get_or_create_session(pet_id: str) -> str | None:
    """Return the session_id for a bound pet, or None if unbound."""
    binding = get_binding(pet_id)
    if not binding:
        return None
    return binding.get("session_id") or None
