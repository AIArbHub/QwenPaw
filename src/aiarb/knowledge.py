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

Sync policy (important)
-----------------------
Seeding is **content-hash tracked**, not "copy-if-missing". On every startup
and ``aiarb init`` the packaged corpus is reconciled against the global one:

* packaged file missing in global  -> copied (new content ships to users)
* packaged file changed, user copy **unmodified** since last sync
  -> overwritten with the new packaged version (upgrades reach the user)
* packaged file changed, user copy **was edited** by the user
  -> user's version is preserved (never clobber user edits)
* files that exist only in global (``_parsed``, ``_desensitized``, user
  notes, PDFs, ...) -> never touched

The "was edited" decision uses ``.kb_sync_state.json``, which records the
hash of each packaged file as last written. If the on-disk hash differs from
the recorded one, the user changed it and we keep it.
"""

from __future__ import annotations

import hashlib
import json
import logging
import shutil
from pathlib import Path

logger = logging.getLogger(__name__)

_KNOWLEDGE_SUBDIRS = ("laws", "rules", "cases", "templates")

# Records the hash of each packaged file as last written into the global KB.
# Lives inside the global KB so it roams with user data.
_SYNC_STATE_FILE = ".kb_sync_state.json"

# Files/dirs in the global KB that are user data and must never be touched.
# Anything starting with "_" is treated as internal/user data as well.
_USER_OWNED_NAMES = frozenset({"_meta.json", "_enums.json"})


def get_packaged_knowledge_base_dir() -> Path:
    """Return the packaged (read-only) knowledge base shipped with the app."""
    return Path(__file__).resolve().parent / "knowledge_base"


def get_global_knowledge_base_dir() -> Path:
    """Return the user-editable global knowledge base directory."""
    from .constant import WORKING_DIR

    return Path(WORKING_DIR) / "knowledge_base"


def _file_hash(path: Path) -> str:
    """Return the sha256 of a file, or "" when it cannot be read."""
    try:
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1 << 20), b""):
                digest.update(chunk)
        return digest.hexdigest()
    except OSError:
        return ""


def _load_sync_state(state_path: Path) -> dict[str, str]:
    """Load {relative_path: hash_as_last_written} from the state file."""
    try:
        raw = json.loads(state_path.read_text(encoding="utf-8"))
        if isinstance(raw, dict):
            entries = raw.get("files")
            if isinstance(entries, dict):
                return {str(k): str(v) for k, v in entries.items()}
    except (OSError, ValueError, TypeError):
        # Missing/corrupt state: fall back to "unknown", which is handled
        # conservatively (existing files are then treated as user-owned).
        logger.debug("No usable KB sync state at %s", state_path)
    return {}


def _save_sync_state(state_path: Path, files: dict[str, str]) -> None:
    try:
        state_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {"version": 1, "files": files}
        state_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True),
            encoding="utf-8",
        )
    except OSError as exc:
        logger.warning("Failed to persist KB sync state: %s", exc)


def ensure_global_knowledge_base() -> Path:
    """Reconcile the packaged corpus into the global knowledge base.

    Runs on every startup and ``aiarb init``. It seeds a fresh install, ships
    newly added content to existing installs, and upgrades files the user has
    not edited — while always preserving user edits and user-owned data.
    """
    global_dir = get_global_knowledge_base_dir()
    packaged_dir = get_packaged_knowledge_base_dir()

    global_dir.mkdir(parents=True, exist_ok=True)
    if not packaged_dir.is_dir():
        return global_dir

    state_path = global_dir / _SYNC_STATE_FILE
    previous = _load_sync_state(state_path)
    current: dict[str, str] = {}

    added = updated = preserved = 0

    try:
        packaged_files = sorted(p for p in packaged_dir.rglob("*") if p.is_file())
    except OSError as exc:
        logger.warning("Failed to enumerate packaged knowledge base: %s", exc)
        return global_dir

    for src in packaged_files:
        rel = src.relative_to(packaged_dir).as_posix()
        # Never manage our own state file through the corpus logic.
        if rel == _SYNC_STATE_FILE:
            continue

        src_hash = _file_hash(src)
        if not src_hash:
            continue
        current[rel] = src_hash

        dst = global_dir / rel
        recorded = previous.get(rel)

        if not dst.exists():
            # New content (fresh install or newly shipped file).
            try:
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src, dst)
                added += 1
            except OSError as exc:
                logger.warning("Failed to seed %s: %s", rel, exc)
            continue

        if recorded == src_hash:
            # Already in sync with this packaged version.
            continue

        dst_hash = _file_hash(dst)
        if recorded is not None and dst_hash != recorded:
            # User edited it after we wrote it -> keep their version.
            preserved += 1
            continue

        # Either we never tracked it, or it is untouched since we wrote it:
        # safe to bring it up to date with the packaged version.
        if dst_hash == src_hash:
            continue
        try:
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)
            updated += 1
        except OSError as exc:
            logger.warning("Failed to update %s: %s", rel, exc)

    _save_sync_state(state_path, current)

    if added or updated or preserved:
        logger.debug(
            "Knowledge base sync: %d added, %d updated, %d user edits preserved",
            added,
            updated,
            preserved,
        )
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
