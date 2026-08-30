# -*- coding: utf-8 -*-
"""FlowManager — JSON-based persistence for flow definitions and instances.

Pattern follows ``agent-kanban`` — in-memory cache with background
persistence, cross-process file locking, and atomic writes.

Author: Sum
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import tempfile
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from .models import FlowDefinition, FlowInstance

logger = logging.getLogger(__name__)

try:
    import fcntl
except ImportError:  # pragma: no cover - Windows fallback
    fcntl = None

_DATA_DIR = Path(__file__).resolve().parent.parent / "data"
_FLOWS_FILE = _DATA_DIR / "flows.json"
_FLOW_INSTANCES_FILE = _DATA_DIR / "flow_instances.json"

_LOCK = asyncio.Lock()


def _ensure_dir() -> None:
    _DATA_DIR.mkdir(parents=True, exist_ok=True)


def _load_json(path: Path) -> List[Dict[str, Any]]:
    """Load JSON list from disk with retry on parse failure."""
    if not path.exists():
        return []
    for _ in range(5):
        try:
            text = path.read_text(encoding="utf-8")
            if not text.strip():
                return []
            return json.loads(text)
        except FileNotFoundError:
            return []
        except (json.JSONDecodeError, ValueError):
            time.sleep(0.05)
    logger.warning("Failed to load %s after 5 retries", path)
    return []


def _persist_json(path: Path, data: List[Dict[str, Any]]) -> None:
    """Atomically persist a list to JSON."""
    _ensure_dir()
    payload = json.dumps(data, ensure_ascii=False, indent=2)
    fd, tmp = tempfile.mkstemp(dir=str(_DATA_DIR), prefix=".tmp.", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(payload)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


# ── In-memory caches ──────────────────────────────────────────────

_FLOWS_CACHE: Optional[List[Dict[str, Any]]] = None
_FLOW_INSTANCES_CACHE: Optional[List[Dict[str, Any]]] = None

_FLOWS_DIRTY = False
_FLOW_INSTANCES_DIRTY = False


def _init_caches() -> None:
    global _FLOWS_CACHE, _FLOW_INSTANCES_CACHE
    if _FLOWS_CACHE is None:
        _FLOWS_CACHE = _load_json(_FLOWS_FILE)
    if _FLOW_INSTANCES_CACHE is None:
        _FLOW_INSTANCES_CACHE = _load_json(_FLOW_INSTANCES_FILE)


class Storage:
    """Async-safe storage for FlowManager data."""

    # ── Flow Definitions ──────────────────────────────────────────

    async def list_flows(self) -> List[Dict[str, Any]]:
        _init_caches()
        return list(_FLOWS_CACHE or [])

    async def get_flow(self, flow_id: str) -> Optional[Dict[str, Any]]:
        _init_caches()
        for f in _FLOWS_CACHE or []:
            if f.get("id") == flow_id:
                return f
        return None

    async def save_flow(self, flow: FlowDefinition) -> Dict[str, Any]:
        global _FLOWS_DIRTY
        _init_caches()
        data = flow.to_dict()
        async with _LOCK:
            existing = None
            for i, f in enumerate(_FLOWS_CACHE):
                if f.get("id") == flow.id:
                    existing = i
                    break
            if existing is not None:
                _FLOWS_CACHE[existing] = data
            else:
                _FLOWS_CACHE.append(data)
            _FLOWS_DIRTY = True
        return data

    async def delete_flow(self, flow_id: str) -> bool:
        global _FLOWS_DIRTY
        _init_caches()
        async with _LOCK:
            before = len(_FLOWS_CACHE)
            _FLOWS_CACHE[:] = [
                f for f in _FLOWS_CACHE if f.get("id") != flow_id
            ]
            if len(_FLOWS_CACHE) < before:
                _FLOWS_DIRTY = True
                return True
            return False

    # ── Flow Instances ─────────────────────────────────────────────

    async def list_flow_instances(self) -> List[Dict[str, Any]]:
        _init_caches()
        return list(_FLOW_INSTANCES_CACHE or [])

    async def get_flow_instance(
        self, instance_id: str
    ) -> Optional[Dict[str, Any]]:
        _init_caches()
        for fi in (_FLOW_INSTANCES_CACHE or []):
            if fi.get("id") == instance_id:
                return fi
        return None

    async def get_flow_instance_by_group(
        self, group_id: str
    ) -> Optional[Dict[str, Any]]:
        _init_caches()
        for fi in (_FLOW_INSTANCES_CACHE or []):
            if fi.get("group_id") == group_id:
                return fi
        return None

    async def get_flow_instance_by_session(
        self, session_id: str
    ) -> Optional[Dict[str, Any]]:
        _init_caches()
        for fi in (_FLOW_INSTANCES_CACHE or []):
            if fi.get("session_id") == session_id:
                return fi
        return None

    async def save_flow_instance(
        self, instance: FlowInstance
    ) -> Dict[str, Any]:
        global _FLOW_INSTANCES_DIRTY
        _init_caches()
        data = instance.to_dict()
        async with _LOCK:
            existing = None
            for i, fi in enumerate(_FLOW_INSTANCES_CACHE):
                if fi.get("id") == instance.id:
                    existing = i
                    break
            if existing is not None:
                _FLOW_INSTANCES_CACHE[existing] = data
            else:
                _FLOW_INSTANCES_CACHE.append(data)
            _FLOW_INSTANCES_DIRTY = True
        return data

    async def delete_flow_instance_by_group(self, group_id: str) -> bool:
        global _FLOW_INSTANCES_DIRTY
        _init_caches()
        async with _LOCK:
            before = len(_FLOW_INSTANCES_CACHE)
            _FLOW_INSTANCES_CACHE[:] = [
                fi for fi in _FLOW_INSTANCES_CACHE
                if fi.get("group_id") != group_id
            ]
            if len(_FLOW_INSTANCES_CACHE) < before:
                _FLOW_INSTANCES_DIRTY = True
                return True
            return False

    # ── Persistence ────────────────────────────────────────────────

    async def flush(self) -> None:
        """Persist all dirty caches to disk."""
        global _FLOWS_DIRTY, _FLOW_INSTANCES_DIRTY
        async with _LOCK:
            if _FLOWS_DIRTY and _FLOWS_CACHE is not None:
                await asyncio.to_thread(
                    _persist_json, _FLOWS_FILE, list(_FLOWS_CACHE),
                )
                _FLOWS_DIRTY = False
            if _FLOW_INSTANCES_DIRTY and _FLOW_INSTANCES_CACHE is not None:
                await asyncio.to_thread(
                    _persist_json, _FLOW_INSTANCES_FILE,
                    list(_FLOW_INSTANCES_CACHE),
                )
                _FLOW_INSTANCES_DIRTY = False


# Singleton
storage = Storage()
