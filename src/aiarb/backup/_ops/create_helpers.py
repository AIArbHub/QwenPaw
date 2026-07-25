# -*- coding: utf-8 -*-
"""Helpers for creating backups: agents, global config, secrets, skill pool,
jobs, chats, plugins, browser data."""
from __future__ import annotations

import json
import logging
import zipfile
from pathlib import Path
from typing import Any

from .._utils.constants import (
    PREFIX_CONFIG,
    PREFIX_JOBS,
    PREFIX_CHATS,
    PREFIX_PLUGINS,
    PREFIX_SECRETS,
    PREFIX_SKILL_POOL,
    PREFIX_WORKSPACES,
    PREFIX_BROWSER_DATA,
)
from ...constant import (
    CHATS_FILE,
    CONFIG_FILE,
    JOBS_FILE,
    PLUGINS_DIR,
    SECRET_DIR,
    WORKING_DIR,
)

logger = logging.getLogger(__name__)


def add_agent_workspaces(
    zf: zipfile.ZipFile,
    valid_agents: list[tuple[str, Any]],
    progress_callback=None,
    stop_event=None,
) -> bool:
    """Add each agent's workspace directory to the zip.

    Returns:
        False if stop_event was set (cancelled), True otherwise.
    """
    total = len(valid_agents)
    logger.info(
        "Backing up %d agent(s): %s",
        total,
        [aid for aid, _ in valid_agents],
    )

    for i, (aid, ref) in enumerate(valid_agents):
        if stop_event and stop_event.is_set():
            return False

        if progress_callback:
            progress_callback(i, total, aid)

        ws = Path(ref.workspace_dir).expanduser().resolve()
        if ws.is_dir():
            file_count = 0
            skipped = 0
            for entry in sorted(ws.rglob("*")):
                if not entry.is_file():
                    continue
                rel = entry.relative_to(ws).as_posix()
                arcname = f"{PREFIX_WORKSPACES}{aid}/{rel}"
                try:
                    zf.write(entry, arcname)
                except (PermissionError, OSError) as exc:
                    # A file that can't be added (e.g. an open Chromium
                    # cache file the backend has locked) must not abort
                    # the whole backup; skip it and continue (#4916).
                    skipped += 1
                    logger.warning(
                        "Skipping %s (could not be added to backup): %s",
                        entry,
                        exc,
                    )
                    continue
                file_count += 1
            if skipped:
                logger.warning(
                    "Agent '%s': skipped %d file(s) that could not be "
                    "added to the backup",
                    aid,
                    skipped,
                )
            logger.debug(
                "Agent '%s': %d file(s) added from %s",
                aid,
                file_count,
                ws,
            )
        else:
            logger.warning(
                "Agent '%s' workspace directory not found: %s",
                aid,
                ws,
            )

    return not (stop_event and stop_event.is_set())


def add_global_config(zf: zipfile.ZipFile) -> None:
    """Add the global config file to the zip."""
    cfg_src = WORKING_DIR / CONFIG_FILE
    if cfg_src.is_file():
        zf.write(cfg_src, PREFIX_CONFIG)
        logger.info("Global config added to backup: %s", cfg_src)
    else:
        logger.warning(
            "include_global_config=True but config file not found: %s",
            cfg_src,
        )


def add_secrets(zf: zipfile.ZipFile, stop_event=None) -> bool:
    """Add all files from the secrets directory to the zip.

    Returns ``False`` if *stop_event* was set before or during the operation
    (cancelled), ``True`` otherwise.
    """
    if not SECRET_DIR.is_dir():
        logger.warning("Secrets directory not found: %s", SECRET_DIR)
        return True
    file_count = 0
    for entry in sorted(SECRET_DIR.rglob("*")):
        if stop_event and stop_event.is_set():
            return False
        if entry.is_file():
            arcname = (
                f"{PREFIX_SECRETS}{entry.relative_to(SECRET_DIR).as_posix()}"
            )
            zf.write(entry, arcname)
            file_count += 1
    logger.info(
        "Secrets backed up: %d file(s) from %s",
        file_count,
        SECRET_DIR,
    )
    return True


def add_skill_pool(zf: zipfile.ZipFile, stop_event=None) -> bool:
    """Add all files from the skill pool directory to the zip.

    Returns ``False`` if *stop_event* was set before or during the operation
    (cancelled), ``True`` otherwise.
    """
    from ...agents.skill_system.store import get_skill_pool_dir

    skill_pool_dir = get_skill_pool_dir()
    if not skill_pool_dir.is_dir():
        logger.warning("Skill pool directory not found: %s", skill_pool_dir)
        return True
    logger.info("Backing up skill pool from %s", skill_pool_dir)
    file_count = 0
    for entry in sorted(skill_pool_dir.rglob("*")):
        if stop_event and stop_event.is_set():
            return False
        if entry.is_file():
            rel = entry.relative_to(skill_pool_dir).as_posix()
            arcname = f"{PREFIX_SKILL_POOL}{rel}"
            logger.debug("  Adding %s", arcname)
            zf.write(entry, arcname)
            file_count += 1
    logger.info("Skill pool backed up: %d file(s)", file_count)
    return True


def add_jobs_file(zf: zipfile.ZipFile) -> None:
    """Add the jobs.json file to the zip if it exists."""
    src = WORKING_DIR / JOBS_FILE
    if src.is_file():
        zf.write(src, PREFIX_JOBS)
        logger.info("Jobs file added to backup: %s", src)
    else:
        logger.debug("Jobs file not found, skipping: %s", src)


def add_chats_file(zf: zipfile.ZipFile) -> None:
    """Add the chats.json file to the zip if it exists."""
    src = WORKING_DIR / CHATS_FILE
    if src.is_file():
        zf.write(src, PREFIX_CHATS)
        logger.info("Chats file added to backup: %s", src)
    else:
        logger.debug("Chats file not found, skipping: %s", src)


def add_plugins_list(zf: zipfile.ZipFile) -> None:
    """Add a lightweight plugin manifest (names + versions, no binaries)."""
    if not PLUGINS_DIR.is_dir():
        logger.debug("Plugins directory not found, skipping")
        return
    plugin_data: list[dict[str, str]] = []
    for entry in sorted(PLUGINS_DIR.iterdir()):
        if entry.is_dir():
            manifest = entry / "plugin.json"
            if manifest.is_file():
                try:
                    info = json.loads(manifest.read_text(encoding="utf-8"))
                    plugin_data.append({
                        "name": info.get("name", entry.name),
                        "version": info.get("version", ""),
                        "dir": entry.name,
                    })
                except Exception:
                    plugin_data.append({
                        "name": entry.name,
                        "version": "",
                        "dir": entry.name,
                    })
    if plugin_data:
        zf.writestr(PREFIX_PLUGINS, json.dumps(
            plugin_data, ensure_ascii=False, indent=2,
        ))
        logger.info("Plugin list backed up: %d plugin(s)", len(plugin_data))
    else:
        logger.debug("No plugins found, skipping")


def add_browser_data(zf: zipfile.ZipFile, browser_data: dict | None = None) -> None:
    """Add browser-side user data to the backup zip.

    *browser_data* should be a dict collected from the frontend containing
    user records (desensitize tasks, preferences, etc.).  If ``None``,
    the entry is skipped.
    """
    if browser_data is None:
        logger.debug("No browser data provided, skipping")
        return
    zf.writestr(PREFIX_BROWSER_DATA, json.dumps(
        browser_data, ensure_ascii=False,
    ))
    logger.info("Browser data added to backup")


def add_files_to_zip(
    zf: zipfile.ZipFile,
    meta,
    progress_callback=None,
    stop_event=None,
    valid_agents=None,
    browser_data: dict | None = None,
) -> list[str]:
    """Add files to zip based on backup scope.

    Args:
        zf: ZipFile object to write to
        meta: Backup metadata with scope information
        progress_callback: Optional callback(current_index, total, agent_id)
        stop_event: Optional threading.Event to support cancellation
        valid_agents: Pre-computed ``(aid, ref)`` pairs to back up.
                      Empty list when meta.scope.include_agents is False.
        browser_data: Optional dict of browser-side user data to include.

    Returns:
        List of agent IDs that were backed up, or empty list if cancelled
    """
    if valid_agents is None:
        valid_agents = []

    if valid_agents and not add_agent_workspaces(
        zf,
        valid_agents,
        progress_callback,
        stop_event,
    ):
        return []

    if meta.scope.include_global_config:
        add_global_config(zf)
    if meta.scope.include_secrets:
        if not add_secrets(zf, stop_event):
            return []
    if meta.scope.include_skill_pool:
        if not add_skill_pool(zf, stop_event):
            return []
    if meta.scope.include_jobs:
        add_jobs_file(zf)
    if meta.scope.include_chats:
        add_chats_file(zf)
    if meta.scope.include_plugins:
        add_plugins_list(zf)
    if meta.scope.include_browser_data:
        add_browser_data(zf, browser_data)

    return [aid for aid, _ in valid_agents]
