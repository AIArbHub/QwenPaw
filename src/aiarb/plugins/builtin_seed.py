# -*- coding: utf-8 -*-
"""Seed built-in plugins from the repository into the user's plugin directory.

Built-in plugins live under ``plugins/bundle/`` in the repository (source
mode) or alongside the frozen backend (packaged mode).  On startup — before
``PluginLoader`` scans ``PLUGINS_DIR`` — this module copies any built-in
plugin that is missing or outdated into the user's ``~/.aiarb/plugins/``
directory so it is available without a separate ``aiarb plugin install``
step.

Only plugins whose ``plugin.json`` carries ``"builtin": true`` are seeded;
this prevents every bundle plugin from being force-installed.
"""
from __future__ import annotations

import json
import logging
import shutil
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# Files / dirs to skip when copying a built-in plugin tree.
_SKIP_NAMES = frozenset({
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    ".git",
    ".gitignore",
    "node_modules",
    ".venv",
    "venv",
    "*.egg-info",
})


def _is_skip(name: str) -> bool:
    """Return True for cache / venv directory names that should not be copied."""
    if name in _SKIP_NAMES:
        return True
    return name.endswith(".pyc") or name.endswith(".pyo")


def _read_manifest_version(plugin_dir: Path) -> Optional[str]:
    """Return the ``version`` field from ``plugin.json`` or ``None``."""
    manifest_path = plugin_dir / "plugin.json"
    if not manifest_path.is_file():
        return None
    try:
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
        ver = data.get("version")
        return str(ver) if ver else None
    except Exception:
        return None


def _is_builtin(manifest: dict) -> bool:
    """Return True when the manifest declares ``"builtin": true``."""
    return bool(manifest.get("builtin"))


def _find_repo_bundle_dir() -> Optional[Path]:
    """Return the ``plugins/bundle/`` directory in the source repository.

    In source mode the ``aiarb`` package lives under ``<repo>/src/aiarb/``.
    We walk up from ``__file__`` looking for a sibling ``plugins/bundle/``
    directory.

    In packaged (frozen) mode the bundle plugins are expected under
    ``<resource_dir>/plugins/bundle/`` — but seeding from there is handled
    by the Tauri resource directory resolution, not this function.
    """
    # Source mode: walk up from this file to find the repo root.
    cur = Path(__file__).resolve().parent
    for _ in range(20):
        candidate = cur / "plugins" / "bundle"
        if candidate.is_dir():
            # Verify it contains at least one plugin.json
            for child in candidate.iterdir():
                if child.is_dir() and (child / "plugin.json").is_file():
                    return candidate
        if cur.parent == cur:
            break
        cur = cur.parent
    return None


def _find_packaged_bundle_dir() -> Optional[Path]:
    """Return the bundled plugins directory in a packaged (frozen) build.

    The Tauri build copies ``plugins/bundle/`` into the resource directory.
    We look for it relative to ``sys.executable`` (the frozen backend) and
    the ``AIARB_TAURI_RESOURCE_DIR`` environment variable.
    """
    import os
    import sys

    # 1. AIARB_TAURI_RESOURCE_DIR (set by Tauri shell for packaged builds)
    resource_dir = os.environ.get("AIARB_TAURI_RESOURCE_DIR", "").strip()
    if resource_dir:
        candidate = Path(resource_dir) / "plugins" / "bundle"
        if candidate.is_dir():
            return candidate

    # 2. Relative to the frozen executable
    if getattr(sys, "frozen", False):
        exe_dir = Path(sys.executable).resolve().parent
        for base in (exe_dir, exe_dir.parent):
            candidate = base / "plugins" / "bundle"
            if candidate.is_dir():
                return candidate

    return None


def find_bundle_plugins_dir() -> Optional[Path]:
    """Return the directory containing built-in bundle plugins, or ``None``.

    Checks source mode first, then packaged mode.
    """
    return _find_repo_bundle_dir() or _find_packaged_bundle_dir()


def _should_seed(
    source_dir: Path,
    target_dir: Path,
) -> bool:
    """Return True when the target is missing or has an older version.

    A target that does not exist always needs seeding.  When it exists,
    compare version strings — seed only when the source version differs
    (covers both upgrades and downgrades).
    """
    if not target_dir.is_dir():
        return True
    src_ver = _read_manifest_version(source_dir) or "0.0.0"
    tgt_ver = _read_manifest_version(target_dir) or "0.0.0"
    return src_ver != tgt_ver


def _copy_plugin_tree(source: Path, target: Path) -> None:
    """Copy *source* plugin tree into *target*, preserving subdirectory structure.

    Skips cache files, ``__pycache__``, ``node_modules``, etc.
    """
    if target.exists():
        shutil.rmtree(target)
    target.mkdir(parents=True, exist_ok=True)

    def _ignore(directory: str, names: list[str]) -> list[str]:
        return [n for n in names if _is_skip(n)]

    # copytree with ignore handles the full recursive copy
    shutil.copytree(source, target, ignore=_ignore, dirs_exist_ok=True)


def seed_builtin_plugins(
    plugins_dir: Path,
    bundle_dir: Path | None = None,
) -> list[str]:
    """Copy built-in plugins into *plugins_dir* if missing or outdated.

    Only plugins whose ``plugin.json`` contains ``"builtin": true`` are
    seeded.  Already-installed plugins with the same version are skipped.

    Args:
        plugins_dir: The user's plugin directory (``~/.aiarb/plugins``).
        bundle_dir: Override for the source bundle directory.  When
            ``None``, :func:`find_bundle_plugins_dir` is used.

    Returns:
        A list of plugin ids that were seeded (copied or updated).
    """
    if bundle_dir is None:
        bundle_dir = find_bundle_plugins_dir()
    if bundle_dir is None:
        logger.debug("No built-in plugin bundle directory found; skipping seed")
        return []

    seeded: list[str] = []
    plugins_dir.mkdir(parents=True, exist_ok=True)

    for plugin_dir in sorted(p for p in bundle_dir.iterdir() if p.is_dir()):
        manifest_path = plugin_dir / "plugin.json"
        if not manifest_path.is_file():
            continue
        try:
            manifest = json.loads(
                manifest_path.read_text(encoding="utf-8"),
            )
        except Exception as exc:
            logger.warning(
                "Cannot read manifest for built-in plugin %s: %s",
                plugin_dir.name,
                exc,
            )
            continue

        if not _is_builtin(manifest):
            continue

        plugin_id = str(manifest.get("id") or plugin_dir.name)
        target = plugins_dir / plugin_id

        if not _should_seed(plugin_dir, target):
            logger.debug(
                "Built-in plugin '%s' already up-to-date, skipping",
                plugin_id,
            )
            continue

        try:
            _copy_plugin_tree(plugin_dir, target)
            seeded.append(plugin_id)
            logger.info(
                "Seeded built-in plugin '%s' (v%s) -> %s",
                plugin_id,
                manifest.get("version", "?"),
                target,
            )
        except Exception as exc:
            logger.error(
                "Failed to seed built-in plugin '%s': %s",
                plugin_id,
                exc,
                exc_info=True,
            )

    return seeded
