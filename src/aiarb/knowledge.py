# -*- coding: utf-8 -*-
"""Shared, cross-agent knowledge base resolution and seeding.

The knowledge base is a read-only (from the agent's perspective) corpus that
every agent in a project can search regardless of its workspace.  It is
distinct from per-workspace memory / skills: knowledge documents live in a
global directory and are reached via the ``search_knowledge`` tool.

Layout (global, under ``WORKING_DIR``):

    knowledge_base/
        INDEX.md          # index / usage notes
        laws/             # 仲裁法、相关法律
        rules/            # 仲裁机构仲裁规则
        cases/            # 案例库
        templates/        # 文书模板

The packaged corpus ships inside the install tree and is copied into the
global directory on first run (``ensure_global_knowledge_base``), so users
can edit/extend it without touching the read-only install files.
"""

from __future__ import annotations

import logging
import shutil
from pathlib import Path

logger = logging.getLogger(__name__)

_KNOWLEDGE_SUBDIRS = ("laws", "rules", "cases", "templates")


def get_packaged_knowledge_base_dir() -> Path:
    """Return the packaged (read-only) knowledge base shipped with the app."""
    return Path(__file__).resolve().parent / "knowledge_base"


def get_global_knowledge_base_dir() -> Path:
    """Return the user-editable global knowledge base directory."""
    from .constant import WORKING_DIR

    return Path(WORKING_DIR) / "knowledge_base"


def ensure_global_knowledge_base() -> Path:
    """Seed the global knowledge base from the packaged corpus on first run.

    Never overwrites existing user files; only copies missing entries, so
    user additions/edits are preserved across upgrades.
    """
    global_dir = get_global_knowledge_base_dir()
    packaged_dir = get_packaged_knowledge_base_dir()

    global_dir.mkdir(parents=True, exist_ok=True)
    if not packaged_dir.is_dir():
        return global_dir

    try:
        for entry in sorted(packaged_dir.iterdir()):
            target = global_dir / entry.name
            if target.exists():
                continue
            if entry.is_dir():
                shutil.copytree(entry, target)
            else:
                shutil.copy2(entry, target)
    except OSError as exc:
        logger.warning("Failed to seed global knowledge base: %s", exc)
    return global_dir


def get_knowledge_dirs() -> list[Path]:
    """Return the ordered knowledge-base roots to search.

    Primary global directory first, then any configured ``knowledge_paths``
    roots.  Falls back to the packaged corpus when the global directory is
    missing (e.g. the tool is invoked before startup seeding completes).
    """
    global_dir = get_global_knowledge_base_dir()
    dirs: list[Path] = []
    seen: set[Path] = set()

    primary = global_dir if global_dir.is_dir() else get_packaged_knowledge_base_dir()
    try:
        primary_resolved = primary.resolve()
    except OSError:
        primary_resolved = primary
    if primary_resolved.is_dir():
        dirs.append(primary_resolved)
        seen.add(primary_resolved)

    try:
        from .config.utils import load_config

        raw_paths = list(load_config().knowledge_paths or [])
    except Exception as exc:  # pragma: no cover
        logger.warning("Failed to load configured knowledge_paths: %s", exc)
        raw_paths = []

    for raw in raw_paths:
        try:
            path = Path(str(raw)).expanduser().resolve()
        except Exception:
            logger.warning("Skipping invalid knowledge path: %r", raw)
            continue
        if path in seen or not path.is_dir():
            continue
        seen.add(path)
        dirs.append(path)
    return dirs
