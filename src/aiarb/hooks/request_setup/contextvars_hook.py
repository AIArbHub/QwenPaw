# -*- coding: utf-8 -*-
"""ContextVar setup hook.

Injects per-request ContextVars before agent execution so that tools
(shell, file_io, etc.) see correct workspace_dir, session_id, etc.
"""

from __future__ import annotations

import logging
from datetime import datetime
from pathlib import Path

from ..base import LifecycleHook
from ...runtime.hooks import HookContext, HookResult
from ...runtime.phases import Phase

logger = logging.getLogger(__name__)

# Characters that are illegal in Windows filenames
_WIN_ILLEGAL_CHARS = '<>:"|?*'


def _sanitize_path_component(value: str) -> str:
    """Sanitise a string for use as a single filesystem path component.

    Replaces path separators and Windows-illegal characters with ``_``
    so the result is safe on both POSIX and Windows.
    """
    if not value:
        return ""
    result = value.strip()
    for ch in "/\\:" + _WIN_ILLEGAL_CHARS:
        result = result.replace(ch, "_")
    # Collapse consecutive underscores
    while "__" in result:
        result = result.replace("__", "_")
    return result.strip("_")


def _resolve_work_dir(
    workspace_dir: Path,
    agent_id: str,
    agent_name: str,
    session_id: str,
    work_dir_config,
) -> Path | None:
    """Compute the effective work directory for this request.

    Returns None when work_dir is disabled (caller falls back to
    workspace_dir, preserving backward-compatible behaviour).
    """
    if not getattr(work_dir_config, "enabled", False):
        return None

    # 1. Determine base directory
    raw_base = getattr(work_dir_config, "base_dir", None)
    if raw_base:
        base = Path(raw_base).expanduser().resolve()
    else:
        base = workspace_dir / "work"

    # 2. Build subfolder from pattern
    pattern = getattr(work_dir_config, "subfolder_pattern", "{agent_name}_{date}")
    now = datetime.now()
    subfolder = pattern.format(
        agent_name=agent_name or agent_id,
        agent_id=agent_id,
        date=now.strftime("%Y-%m-%d"),
        session_id=session_id or "",
    )
    # Sanitise subfolder for filesystem safety (Windows + POSIX)
    subfolder = _sanitize_path_component(subfolder)
    if subfolder:
        base = base / subfolder

    # 3. Session isolation subfolder
    if getattr(work_dir_config, "session_isolation", True) and session_id:
        safe_session = _sanitize_path_component(session_id)
        if safe_session:
            base = base / safe_session

    base.mkdir(parents=True, exist_ok=True)
    return base


class ContextVarsSetupHook(LifecycleHook):
    """Inject per-request ContextVars before agent execution."""

    phase = Phase.PRE_DISPATCH
    name = "contextvars_setup"
    priority = 10

    async def run(self, ctx: HookContext) -> HookResult:
        from ...config.context import (
            set_current_workspace_dir,
            set_current_work_dir,
            set_current_session_id,
            set_current_recent_max_bytes,
            set_current_shell_command_timeout,
            set_current_shell_command_executable,
        )
        from ...app.agent_context import (
            set_current_agent_id,
            set_current_approval_route,
            set_current_channel,
            set_current_root_session_id,
            set_current_session_id as _set_app_session_id,
            set_current_user_id,
        )

        if ctx.workspace_dir is not None:
            set_current_workspace_dir(ctx.workspace_dir)
        # Always reset work_dir to avoid stale values from a previous
        # request in the same async context.
        set_current_work_dir(None)

        set_current_agent_id(ctx.agent_id or "default")
        _session_id = ctx.session_id or ""
        set_current_session_id(_session_id)
        _set_app_session_id(_session_id)
        set_current_root_session_id(
            ctx.root_session_id or ctx.session_id or "",
        )
        set_current_user_id(ctx.request.user_id)
        set_current_channel(getattr(ctx.request, "channel", None))
        request_context = getattr(ctx.request, "request_context", None)
        if isinstance(request_context, dict) and request_context.get(
            "_spawn_subagent",
        ):
            approval_route = {
                key: request_context.get(key)
                for key in (
                    "root_session_id",
                    "user_id",
                    "channel",
                    "channel_meta",
                )
            }
        else:
            approval_route = {
                "root_session_id": ctx.root_session_id or ctx.session_id or "",
                "user_id": getattr(ctx.request, "user_id", None) or "",
                "channel": getattr(ctx.request, "channel", None) or "",
                "channel_meta": getattr(ctx.request, "channel_meta", None),
            }
        set_current_approval_route(approval_route)

        coding_project_dir = None
        try:
            from ...config.config import load_agent_config

            cfg = load_agent_config(ctx.agent_id)
            running = cfg.running
            pruning_cfg = (
                running.light_context_config.tool_result_pruning_config
            )
            set_current_recent_max_bytes(
                pruning_cfg.pruning_recent_msg_max_bytes,
            )
            set_current_shell_command_timeout(running.shell_command_timeout)
            set_current_shell_command_executable(
                running.shell_command_executable or None,
            )
            _cm = getattr(cfg, "coding_mode", None)
            if (
                _cm
                and getattr(_cm, "enabled", False)
                and getattr(_cm, "project_dir", None)
            ):
                coding_project_dir = _cm.project_dir

            # Resolve work_dir for conversation-produced documents
            ws_dir = Path(ctx.workspace_dir) if ctx.workspace_dir else None
            if ws_dir and hasattr(cfg, "work_dir"):
                resolved = _resolve_work_dir(
                    ws_dir,
                    agent_id=ctx.agent_id or "default",
                    agent_name=getattr(cfg, "name", ""),
                    session_id=_session_id,
                    work_dir_config=cfg.work_dir,
                )
                if resolved is not None:
                    set_current_work_dir(resolved)
                    logger.debug(
                        "contextvars_setup: work_dir=%s (session=%s)",
                        resolved,
                        _session_id,
                    )

        except Exception:
            logger.warning(
                "contextvars_setup: config-derived vars failed; "
                "tools may see defaults",
                exc_info=True,
            )

        # Forked subagents must resolve relative file/shell paths against
        # the worktree, not the parent workspace.
        fork_dir = None
        if isinstance(request_context, dict):
            from ...agents.fork_project import resolve_allowed_fork_project_dir

            fork_dir = resolve_allowed_fork_project_dir(
                request_context.get("fork_project_dir"),
                workspace_dir=ctx.workspace_dir,
                coding_project_dir=coding_project_dir,
            )
        if fork_dir is not None:
            set_current_workspace_dir(fork_dir)
        elif ctx.workspace_dir is not None:
            set_current_workspace_dir(ctx.workspace_dir)
        return HookResult()


__all__ = ["ContextVarsSetupHook"]
