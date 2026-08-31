# -*- coding: utf-8 -*-
# flake8: noqa: E501
# pylint: disable=line-too-long
"""Shared, cross-agent knowledge base search tool (read-only)."""

from __future__ import annotations

import asyncio
import re
import threading
from pathlib import Path
from typing import Optional

from agentscope.tool import ToolChunk

from ...knowledge import get_knowledge_dirs
from ...runtime.tool_registry import tool_descriptor
from .file_search import (
    _compile_search_pattern,
    _make_response,
    _walk_and_grep,
)

_KNOWLEDGE_SCOPES = frozenset({"laws", "rules", "cases", "templates"})
_SEARCH_TIMEOUT = 30  # seconds
_MAX_TOTAL_LINES = 200
_MAX_TOTAL_CHARS = 50_000


@tool_descriptor(
    name="search_knowledge",
    requires_sandbox=("file_read",),
    async_execution=True,
    tool_type="internal",
    policy_name="SearchKnowledge",
    default_policy="allow",
    policy_reason="Shared knowledge base search (read-only)",
    ui_description="Search the shared arbitration knowledge base",
    ui_icon="📚",
)
async def search_knowledge(
    query: str,
    scope: Optional[str] = None,
) -> ToolChunk:
    """Search the shared, cross-agent knowledge base (read-only).

    Searches laws, arbitration rules, case libraries and document templates
    that are shared by every agent in the project.  Use this before answering
    questions about legal provisions, arbitration rules, precedents or
    document drafting — never invent statutes or rules from memory.

    Args:
        query (`str`):
            Keyword or phrase to search for (literal match, case-insensitive;
            use ``a|b`` for alternatives).
        scope (`str`, optional):
            Restrict search to one category: ``laws``, ``rules``, ``cases``
            or ``templates``.  Defaults to searching all categories.
    """
    if not query or not query.strip():
        return _make_response("Error: No search `query` provided.")

    roots = get_knowledge_dirs()
    if not roots:
        return _make_response(
            "Error: No knowledge base directories are available. "
            "Add documents under the global knowledge_base directory or "
            "configure knowledge_paths in config.json.",
        )

    target_scope = scope.strip().lower() if scope else None
    if target_scope and target_scope not in _KNOWLEDGE_SCOPES:
        return _make_response(
            f"Error: Unknown scope {scope!r}. "
            f"Expected one of {sorted(_KNOWLEDGE_SCOPES)}.",
        )

    search_roots: list[Path] = []
    for root in roots:
        if target_scope:
            candidate = root / target_scope
            if candidate.is_dir():
                search_roots.append(candidate)
        elif root.is_dir():
            search_roots.append(root)

    if not search_roots:
        return _make_response(
            f"Error: No documents found under scope {target_scope!r} "
            "in the knowledge base.",
        )

    regex = _compile_search_pattern(query, False, re.IGNORECASE)
    cancel = threading.Event()

    all_matches: list[str] = []
    total_chars = 0
    status = "ok"
    truncated = False
    timed_out = False

    for search_root in search_roots:
        if cancel.is_set() or len(all_matches) >= _MAX_TOTAL_LINES:
            break

        def _worker(root: Path = search_root) -> tuple[list[str], str]:
            try:
                return _walk_and_grep(
                    root,
                    regex,
                    0,
                    cancel,
                    None,
                    show_file=True,
                )
            except Exception as exc:  # pragma: no cover - defensive
                return [], f"error: {exc}"

        try:
            from ...tool_calls import cancellable_wait

            match_lines, root_status = await cancellable_wait(
                asyncio.to_thread(_worker),
                fallback_secs=_SEARCH_TIMEOUT,
                as_kill_deadline=True,
            )
        except (asyncio.TimeoutError, asyncio.CancelledError):
            cancel.set()
            await asyncio.sleep(0.05)
            timed_out = True
            break

        if root_status.startswith("error:"):
            status = root_status
            continue
        if root_status.startswith("truncated:"):
            truncated = True
        if root_status == "timeout":
            timed_out = True

        for line in match_lines:
            if len(all_matches) >= _MAX_TOTAL_LINES:
                truncated = True
                break
            if total_chars + len(line) + 1 > _MAX_TOTAL_CHARS:
                truncated = True
                break
            all_matches.append(line)
            total_chars += len(line) + 1

    if status.startswith("error:") and not all_matches:
        return _make_response(f"Error: search_knowledge failed — {status}")

    if not all_matches:
        scope_text = f" in scope {target_scope!r}" if target_scope else ""
        return _make_response(
            f"No knowledge base matches found for query: {query}{scope_text}",
        )

    text = "\n".join(all_matches)
    if truncated or timed_out:
        note = (
            "search timed out" if timed_out else "result limits were reached"
        )
        text += (
            f"\n\n(Partial results — {note}. "
            "Try a more specific query or scope.)"
        )
    return _make_response(text)
