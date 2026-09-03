# -*- coding: utf-8 -*-
"""KB Curator settings (AI 知识整理).

App-level settings, persisted in ``WORKING_DIR/kb_curator_settings.json``
independently of the per-agent configuration (same pattern as
``settings.json``).  Every field has a safe default so the module works
even before the first write.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from ...constant import WORKING_DIR
from ...utils.io_utils import (
    get_path_lock,
    path_exists_async,
    read_json_async,
    write_json_atomic_async,
)

logger = logging.getLogger(__name__)

_SETTINGS_FILE = WORKING_DIR / "kb_curator_settings.json"

#: Defaults; also the allow-list of persisted keys.
_DEFAULTS: dict[str, Any] = {
    "enabled": True,  # master switch for the AI curation feature
    "publish_enabled": True,  # auto-publish generated docs into global KB
    "default_category": "",  # "" = let the curator decide per document
    "timeout_seconds": 600,  # per-run timeout floor for the curator agent
    "language": "zh",  # language the generated docs should be written in
}

_TIMEOUT_MIN = 120
_TIMEOUT_MAX = 3600


def settings_file_path() -> Path:
    """Return the settings file path (for UI display / debugging)."""
    return _SETTINGS_FILE


def _normalize(data: dict) -> dict:
    """Coerce raw persisted values onto the allowed keys with safe types."""
    out = dict(_DEFAULTS)
    for key in _DEFAULTS:
        if key not in data:
            continue
        value = data[key]
        if key in ("enabled", "publish_enabled"):
            out[key] = bool(value)
        elif key == "timeout_seconds":
            try:
                timeout = int(value)
            except (TypeError, ValueError):
                timeout = _DEFAULTS[key]
            out[key] = max(_TIMEOUT_MIN, min(_TIMEOUT_MAX, timeout))
        elif key == "default_category":
            cleaned = (str(value or "")).strip().strip("/\\")
            out[key] = cleaned
        elif key == "language":
            lang = (str(value or "zh")).strip() or "zh"
            out[key] = lang if lang in ("zh", "en") else "zh"
    return out


async def load_settings() -> dict:
    """Load persisted settings merged over defaults (never fails)."""
    if not await path_exists_async(_SETTINGS_FILE):
        return dict(_DEFAULTS)
    try:
        data = await read_json_async(_SETTINGS_FILE)
    except (OSError, ValueError, TypeError):
        logger.debug("kb_curator settings unreadable, using defaults")
        return dict(_DEFAULTS)
    if not isinstance(data, dict):
        return dict(_DEFAULTS)
    return _normalize(data)


async def save_settings(patch: dict) -> dict:
    """Merge a partial update into persisted settings and return the result.

    Only known keys are accepted; unknown keys are ignored.
    """
    current = await load_settings()
    merged = _normalize({**current, **patch})
    async with get_path_lock(_SETTINGS_FILE):
        await write_json_atomic_async(
            _SETTINGS_FILE,
            merged,
            indent=2,
            new_file_mode=0o644,
        )
    return merged
