# -*- coding: utf-8 -*-
"""Adapter for driving member agents in group-chat rounds.

Handles the actual communication with member agents.

Two paths:

* **M2 (one-shot)**: ``collect_member_once`` uses HTTP-level
  ``collect_final_agent_chat_response_async`` — the same mechanism as
  ``chat_with_agent``.  Collects the full reply before returning.

* **M6 (streaming)**: ``stream_member`` drives the member agent
  **in-process** via ``Workspace.stream_query()``, yielding runtime
  events (deltas, message objects, response lifecycle) in real time.
  The runtime tags each event with ``meta.group_member`` so the
  frontend renders it in the member's independent bubble with a
  live "typing" indicator.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Optional
from uuid import uuid4

from ...agents.tools.agent_management import (
    _request_headers,
    build_agent_chat_request,
    collect_final_agent_chat_response_async,
    extract_agent_text_content,
    stop_agent_chat_async,
)
from ...config.context import get_current_workspace_dir
from ...utils.http import trust_env_for_url
from .models import GroupSession, Member, MemberTurn

logger = logging.getLogger(__name__)

# Per-member timeout floor (matches MIN_CHAT_WITH_AGENT_TIMEOUT_SECS).
DEFAULT_MEMBER_TIMEOUT = 300
MAX_MEMBER_TIMEOUT = 1800


async def collect_member_once(
    session: GroupSession,
    member: Member,
    prompt: str,
    *,
    timeout: float = DEFAULT_MEMBER_TIMEOUT,
    host_agent_id: str = "",
    root_session_id: str = "",
) -> MemberTurn:
    """Collect a member's full reply via HTTP one-shot SSE collection.

    Uses ``collect_final_agent_chat_response_async`` (the same path as
    ``chat_with_agent``) to POST to ``/console/chat`` on the target
    agent and collect the final response.

    Returns a ``MemberTurn`` with status ``done`` / ``timeout`` / ``error``.
    """
    # R10 safety: verify the member agent exists before dispatch.
    # This prevents orchestrating non-existent or deleted agents.
    try:
        from ...agents.tools.agent_management import agent_exists

        if not agent_exists(member.agent_id):
            logger.warning(
                "Group chat member %s does not exist, skipping turn",
                member.agent_id,
            )
            return MemberTurn(
                member_id=member.agent_id,
                prompt=prompt,
                status="error",
                result=f"(Agent '{member.agent_id}' not found)",
                started_at=time.time(),
                finished_at=time.time(),
            )
    except Exception as exc:  # noqa: BLE001
        # If the existence check fails, continue anyway — the
        # collect call below will handle the error naturally.
        logger.debug(
            "Failed to check agent_exists for %s: %s",
            member.agent_id,
            exc,
        )

    member_session_id = member.ensure_session_id(session.group_id)

    # Build the request payload for the member agent
    final_session_id, request_payload, _ = build_agent_chat_request(
        member.agent_id,
        prompt,
        session_id=member_session_id,
        from_agent=host_agent_id,
        root_session_id=root_session_id,
    )

    turn = MemberTurn(
        member_id=member.agent_id,
        prompt=prompt,
        status="running",
        started_at=time.time(),
    )

    try:
        response_data = await asyncio.wait_for(
            collect_final_agent_chat_response_async(
                None,  # Use default base URL
                request_payload,
                member.agent_id,
                timeout=min(timeout, MAX_MEMBER_TIMEOUT),
            ),
            timeout=timeout + 30,  # Extra buffer for HTTP overhead
        )
        if response_data is None:
            turn.status = "error"
            turn.result = "(No response received)"
        else:
            text = extract_agent_text_content(response_data)
            turn.status = "done"
            turn.result = text or "(No text content in response)"
    except asyncio.TimeoutError:
        turn.status = "timeout"
        turn.result = "(Member response timed out)"
        # Best-effort stop the orphan member chat
        try:
            await stop_agent_chat_async(
                None,
                final_session_id,
                member.agent_id,
            )
        except Exception:  # noqa: BLE001
            logger.debug(
                "Failed to stop timed-out member chat %s",
                member.agent_id,
                exc_info=True,
            )
    except asyncio.CancelledError:
        # Stop the member chat on cancellation
        try:
            await stop_agent_chat_async(
                None,
                final_session_id,
                member.agent_id,
            )
        except Exception:  # noqa: BLE001
            logger.debug(
                "Failed to stop cancelled member chat %s",
                member.agent_id,
                exc_info=True,
            )
        turn.status = "error"
        turn.result = "(Cancelled)"
        raise
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "Member %s collection failed: %s",
            member.agent_id,
            exc,
            exc_info=True,
        )
        turn.status = "error"
        turn.result = f"(Error: {exc})"

    turn.finished_at = time.time()
    return turn


# ── M6: In-process streaming ───────────────────────────────────────────


async def stream_member(
    session: GroupSession,
    member: Member,
    prompt: str,
    *,
    timeout: float = DEFAULT_MEMBER_TIMEOUT,
    host_agent_id: str = "",
    root_session_id: str = "",
    host_workspace: Any = None,
) -> tuple[MemberTurn, Any]:
    """Drive a member agent in-process, yielding real-time streaming events.

    This generator yields ``(member_turn, event)`` tuples where ``event``
    is a runtime schema object (Message, TextContent delta, AgentResponse)
    that ``stream_one`` can serialize via ``_serialize_event_for_sse``.

    The caller (runtime.py) is responsible for tagging each event with
    ``meta.group_member`` via ``sse.tag_event_as_member`` before yielding
    to ``stream_one``.

    Returns a ``MemberTurn`` as the first element of each tuple.  The
    turn status starts as ``"running"`` and transitions to ``"done"``,
    ``"timeout"``, or ``"error"`` on completion.

    Falls back to ``collect_member_once`` if the member workspace cannot
    be obtained (e.g., MultiAgentManager not available).
    """
    from . import sse as sse_module  # for make_member_message fallback

    member_session_id = member.ensure_session_id(session.group_id)
    started = time.time()
    turn = MemberTurn(
        member_id=member.agent_id,
        prompt=prompt,
        status="running",
        started_at=started,
    )

    # Try to get the member's Workspace via MultiAgentManager
    workspace = None
    workspace_error: Exception | None = None
    manager_available = False
    if host_workspace is not None:
        manager = getattr(host_workspace, "_manager", None)
        if manager is not None:
            manager_available = True
            try:
                workspace = await manager.get_agent(member.agent_id)
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "Failed to get workspace for member %s: %s",
                    member.agent_id,
                    exc,
                )
                workspace_error = exc
                workspace = None

    if workspace is None:
        if manager_available and workspace_error is not None:
            # In-process mode: workspace loading failed.  Do NOT fall back
            # to HTTP (which would hit the same server and deadlock).  Emit
            # a clear error bubble so the user knows what happened.
            from ...schemas import RunStatus

            err_text = (
                f"(无法启动成员 [{member.name or member.agent_id}]: "
                f"{workspace_error})"
            )
            turn.status = "error"
            turn.result = err_text
            turn.finished_at = time.time()
            err_msg = sse_module.make_member_message(
                member,
                err_text,
                status=RunStatus.Completed,
            )
            yield turn, err_msg
            return

        # Fallback: use one-shot collection, emit streaming-like events.
        # This path is only reached when running outside the server process
        # (e.g. a CLI orchestrator that has no MultiAgentManager).
        logger.info(
            "Member %s: no in-process workspace, falling back to one-shot HTTP",
            member.agent_id,
        )
        # Emit an InProgress message first so the frontend shows a
        # "typing" indicator while the one-shot collection is running.
        from ...schemas import RunStatus
        from uuid import uuid4

        fallback_msg_id = uuid4().hex
        in_progress_msg = sse_module.make_member_message(
            member,
            "",
            status=RunStatus.InProgress,
            msg_id=fallback_msg_id,
        )
        yield turn, in_progress_msg

        turn = await collect_member_once(
            session,
            member,
            prompt,
            timeout=timeout,
            host_agent_id=host_agent_id,
            root_session_id=root_session_id,
        )
        # Emit the result as a completed message (same ID so SDK merges)
        msg = sse_module.make_member_message(
            member,
            turn.result,
            status=RunStatus.Completed,
            msg_id=fallback_msg_id,
        )
        yield turn, msg
        return

    # Build AgentRequest for in-process stream_query
    from ...schemas import (
        AgentRequest,
        ContentType,
        Message as SchemaMessage,
        MessageType,
        Role,
        TextContent as SchemaTextContent,
    )

    content_parts = [SchemaTextContent(type=ContentType.TEXT, text=prompt)]
    user_msg = SchemaMessage(
        type=MessageType.MESSAGE,
        role=Role.USER,
        content=content_parts,
    )
    request = AgentRequest(
        session_id=member_session_id,
        user_id=member.agent_id,
        input=[user_msg],
        channel="console",
    )
    # Attach request_context for group chat flag propagation
    request.request_context = {
        "group_chat_native": True,
        "parent_session_id": root_session_id or "",
    }
    if host_agent_id:
        request.request_context["from_agent"] = host_agent_id

    # Collect text for the MemberTurn result
    text_parts: list[str] = []

    try:
        async for event in _stream_with_timeout(
            workspace.stream_query(request),
            timeout=timeout,
        ):
            obj = getattr(event, "object", None)
            status = getattr(event, "status", None)

            # Collect text from completed text content chunks
            if obj == "content":
                delta = getattr(event, "delta", False)
                text = getattr(event, "text", None)
                if text:
                    if delta:
                        text_parts.append(text)
                    else:
                        # Non-delta = full block; replace deltas
                        text_parts = [text]

            # On message completed, finalize turn
            if obj == "message" and status is not None:
                from ...schemas import RunStatus

                if status == RunStatus.Completed:
                    # Extract full text from message content
                    content = getattr(event, "content", None) or []
                    msg_texts: list[str] = []
                    for part in content:
                        part_text = getattr(part, "text", None)
                        if part_text:
                            msg_texts.append(part_text)
                    if msg_texts:
                        text_parts = msg_texts

            # On response completed, finalize turn status (but do NOT
            # yield the member's ``response`` event to the outer stream).
            #
            # The SDK's ``AgentScopeRuntimeResponseBuilder.handleResponse``
            # uses ``Object.assign(draft, data)`` which would overwrite the
            # *host* response's id/status/created_at with the member's —
            # causing the frontend to think the entire chat response is
            # complete after the first member finishes, dropping all
            # subsequent members' streaming events.
            #
            # Only ``message`` and ``content`` events are yielded; the
            # member's response lifecycle is tracked internally via
            # ``turn.status``.
            from ...schemas import RunStatus as _RS

            if obj == "response" and status == _RS.Completed:
                turn.status = "done"
                turn.result = "".join(text_parts) or "(No text content)"
                turn.finished_at = time.time()
                # Skip yielding the member's response event
                continue

            # Also skip the member's response Created/InProgress events
            if obj == "response":
                continue

            yield turn, event

    except asyncio.TimeoutError:
        turn.status = "timeout"
        turn.result = "(Member response timed out)"
        turn.finished_at = time.time()
        # Yield a timeout message so the frontend shows it in the
        # member's bubble instead of hanging on "loading".
        from ...schemas import RunStatus as _TimeoutRS
        from uuid import uuid4 as _uuid4

        timeout_msg = sse_module.make_member_message(
            member,
            turn.result,
            status=_TimeoutRS.Completed,
            msg_id=_uuid4().hex,
        )
        yield turn, timeout_msg
    except asyncio.CancelledError:
        turn.status = "error"
        turn.result = "(Cancelled)"
        turn.finished_at = time.time()
        yield turn, None
        raise
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "Member %s streaming failed: %s",
            member.agent_id,
            exc,
            exc_info=True,
        )
        turn.status = "error"
        turn.result = f"(Error: {exc})"
        turn.finished_at = time.time()
        # Yield an error message so the frontend shows the failure in
        # the member's bubble instead of hanging on "loading" forever.
        from ...schemas import RunStatus as _ErrRS
        from uuid import uuid4 as _uuid4

        err_msg = sse_module.make_member_message(
            member,
            turn.result,
            status=_ErrRS.Completed,
            msg_id=_uuid4().hex,
        )
        yield turn, err_msg
    finally:
        if turn.status == "running":
            # Stream ended without a response.completed event.
            # Finalize the turn and yield a completed message so the
            # frontend doesn't leave the member bubble stuck in
            # the InProgress / "typing" state forever.
            turn.status = "done"
            turn.result = "".join(text_parts) or "(No text content)"
            turn.finished_at = time.time()
            from ...schemas import RunStatus as _FinalRS
            from uuid import uuid4 as _final_uuid

            final_msg = sse_module.make_member_message(
                member,
                turn.result,
                status=_FinalRS.Completed,
                msg_id=_final_uuid().hex,
            )
            try:
                yield turn, final_msg
            except (RuntimeError, StopAsyncIteration):
                # Generator was closed by consumer (e.g. async for loop
                # break or aclose()) — cannot yield, but turn.status has
                # been finalized so subsequent code reading the turn object
                # sees the correct state.
                pass


async def _stream_with_timeout(
    agen: Any,
    *,
    timeout: float,
) -> Any:
    """Wrap an async generator with an overall timeout.

    Yields items from ``agen``.  Raises ``asyncio.TimeoutError`` if no
    item is produced within ``timeout`` seconds from the start, or if
    the overall deadline is exceeded.

    Uses ``asyncio.wait_for`` on each ``__anext__`` call so that a
    stalled upstream (e.g. LLM API connection hang) is properly timed
    out rather than blocking forever.

    The underlying generator is always closed via ``aclose()`` when this
    wrapper finishes (whether by completion, timeout, or consumer
    cancellation) to prevent resource leaks.
    """
    deadline = time.time() + timeout
    try:
        while True:
            remaining = deadline - time.time()
            if remaining <= 0:
                raise asyncio.TimeoutError()
            try:
                item = await asyncio.wait_for(
                    agen.__anext__(),
                    timeout=remaining,
                )
            except StopAsyncIteration:
                break
            yield item
            if time.time() > deadline:
                raise asyncio.TimeoutError()
    finally:
        # ── 关闭底层 async generator，释放资源（LLM 连接、文件句柄等）──────
        #
        # aclose() 会向内部生成器注入 GeneratorExit。如果内部生成器
        # 的 finally 块中包含 await（如 runtime.py 的 _deferred_cleanup），
        # PEP 525 会抛出 RuntimeError: "async generator ignored
        # GeneratorExit"。这是 runtime.py 的上游已知问题，此处捕获并
        # 抑制，避免影响群聊外层流程的正常执行。
        try:
            await agen.aclose()
        except Exception:  # noqa: BLE001
            pass


async def inject_human_turn(
    session: GroupSession,
    member: Member,
    text: str,
    *,
    host_workspace: Any = None,
) -> MemberTurn:
    """将一条人工发言写入成员的会话上下文。

    这是一个**只写**操作：向成员的 ``member_session_id`` 会话记录
    追加一条 assistant 消息，**不触发** LLM 调用。文本被持久化后：
    1. 主持人总结（``build_host_summary_prompt``）在读取
       ``round_record.turns`` 时能看到人工的贡献。
    2. 成员后续的自动发言能在对话历史中看到人工输入的内容。

    返回一个已完成的 ``MemberTurn``，``human_override=True``。
    """
    member_session_id = member.ensure_session_id(session.group_id)
    now = time.time()

    # 写回成员的会话文件（追加 assistant 消息）。
    # 使用与 host console channel 相同的会话存储路径。
    try:
        from ...config.context import get_current_workspace_dir

        workspace_dir = get_current_workspace_dir()
        if workspace_dir:
            from ..chats.session import SafeJSONSession

            session_path = SafeJSONSession.build_path(
                workspace_dir, member_session_id,
            )
            # Append a message record to the session file.
            import json
            from ...utils.io_utils import get_path_lock, run_sync_io

            def _append():
                import os
                records = []
                if os.path.exists(session_path):
                    with open(session_path, "r", encoding="utf-8", errors="surrogatepass") as f:
                        try:
                            data = json.load(f)
                            records = data.get("messages", []) if isinstance(data, dict) else []
                        except (json.JSONDecodeError, ValueError):
                            records = []
                records.append({
                    "id": uuid4().hex,
                    "role": "assistant",
                    "content": [{"type": "text", "text": text}],
                    "metadata": {
                        "human_override": True,
                        "group_member": member.agent_id,
                        "timestamp": now,
                    },
                })
                # Write back atomically
                from ...utils.io_utils import write_json_atomic
                write_json_atomic(
                    session_path,
                    {"messages": records, "session_id": member_session_id},
                    indent=None,
                )

            await run_sync_io(_append)
    except Exception:  # noqa: BLE001
        logger.warning(
            "Failed to write human turn to member session %s",
            member.agent_id,
            exc_info=True,
        )

    turn = MemberTurn(
        member_id=member.agent_id,
        prompt="(human override)",
        status="done",
        result=text,
        started_at=now,
        finished_at=now,
        human_override=True,
    )

    # 递增成员的 override_count 用于审计。
    member.override_count += 1

    return turn


async def update_member_session_message(
    member_session_id: str,
    new_text: str,
) -> None:
    """更新成员会话文件中最后一条 assistant 消息的文本。

    用于 ``edit_turn`` API：将编辑后的文本回写到成员的会话历史中，
    使成员后续的自动发言能在对话上下文中看到修正后的内容。

    这是一个**只写**操作：原地修改最后一条 assistant 消息的文本内容，
    不触发 LLM 调用。如果会话文件或消息找不到，则静默跳过
    （调用方仍会更新 GroupSession JSON，因此主持人总结仍会使用
    修正后的文本）。
    """
    try:
        from ...config.context import get_current_workspace_dir

        workspace_dir = get_current_workspace_dir()
        if not workspace_dir:
            return

        from ..chats.session import SafeJSONSession

        session_path = SafeJSONSession.build_path(
            workspace_dir, member_session_id,
        )
        import json
        from ...utils.io_utils import get_path_lock, run_sync_io

        def _update():
            import os

            if not os.path.exists(session_path):
                return
            with open(
                session_path, "r", encoding="utf-8", errors="surrogatepass",
            ) as f:
                try:
                    data = json.load(f)
                except (json.JSONDecodeError, ValueError):
                    return
            if not isinstance(data, dict):
                return
            records = data.get("messages", [])
            if not isinstance(records, list) or not records:
                return
            # Find the last assistant message and update its text content.
            for msg in reversed(records):
                if msg.get("role") == "assistant":
                    content = msg.get("content")
                    if isinstance(content, list) and content:
                        # Update the first text part (standard format)
                        for part in content:
                            if isinstance(part, dict) and part.get("type") == "text":
                                part["text"] = new_text
                                break
                    else:
                        # Single string content or other format — replace directly
                        msg["content"] = [{"type": "text", "text": new_text}]
                    break
            # 原子写回
            from ...utils.io_utils import write_json_atomic

            write_json_atomic(
                session_path,
                data,
                indent=None,
            )

        await run_sync_io(_update)
    except Exception:  # noqa: BLE001
        logger.warning(
            "Failed to update member session file %s",
            member_session_id,
            exc_info=True,
        )


async def collect_host_subrun(
    host_agent_id: str,
    host_session_id: str,
    prompt: str,
    *,
    timeout: float = 120,
    root_session_id: str = "",
    host_workspace: Any = None,
) -> str:
    """Collect a host sub-run (opener or summary).

    The host agent runs in a restricted context — it is called with a
    simple user message and its reply is collected as text.  The host's
    AGENTS.md already instructs it to act as a moderator, so the prompt
    framing guides the output.

    When ``host_workspace`` is available the call is made **in-process**
    via ``workspace.stream_query()`` — no HTTP round-trip, no extra chat
    session created.  When not available, falls back to HTTP POST
    ``/console/chat`` (legacy path).
    """
    # ── In-process path (preferred) ──────────────────────────────
    if host_workspace is not None:
        return await _collect_subrun_inprocess(
            host_workspace,
            prompt,
            host_session_id,
            timeout=timeout,
            root_session_id=root_session_id,
        )

    # ── HTTP fallback (legacy) ───────────────────────────────────
    logger.info(
        "Host sub-run: workspace unavailable, using HTTP fallback",
    )
    sub_session_id = f"{host_session_id}:sub:{int(time.time()*1000)}"

    final_session_id, request_payload, _ = build_agent_chat_request(
        host_agent_id,
        prompt,
        session_id=sub_session_id,
        from_agent=None,
        root_session_id=root_session_id,
    )

    try:
        response_data = await asyncio.wait_for(
            collect_final_agent_chat_response_async(
                None,
                request_payload,
                host_agent_id,
                timeout,
            ),
            timeout=timeout + 30,
        )
        if response_data is None:
            return ""
        return extract_agent_text_content(response_data) or ""
    except asyncio.TimeoutError:
        logger.warning("Host sub-run timed out after %ss", timeout)
        return ""
    except asyncio.CancelledError:
        logger.debug("Host sub-run cancelled")
        raise
    except Exception as exc:  # noqa: BLE001
        logger.warning("Host sub-run failed: %s", exc, exc_info=True)
        return ""


async def _collect_subrun_inprocess(
    workspace: Any,
    prompt: str,
    host_session_id: str,
    *,
    timeout: float = 120,
    root_session_id: str = "",
) -> str:
    """Run a host sub-run in-process, collecting the full text reply.

    Uses ``workspace.stream_query()`` — no HTTP round-trip, no extra
    chat session created in ``chat_manager``.  The sub-run uses a
    derived session ID so session files don't collide with the active
    streaming session.
    """
    from ...schemas import (
        AgentRequest,
        ContentType,
        Message as SchemaMessage,
        MessageType,
        Role,
        TextContent as SchemaTextContent,
    )

    sub_session_id = f"{host_session_id}:sub:{int(time.time()*1000)}"
    content_parts = [SchemaTextContent(type=ContentType.TEXT, text=prompt)]
    user_msg = SchemaMessage(
        type=MessageType.MESSAGE,
        role=Role.USER,
        content=content_parts,
    )
    request = AgentRequest(
        session_id=sub_session_id,
        user_id=workspace.agent_id,
        input=[user_msg],
        channel="console",
    )
    request.request_context = {
        "group_chat_native": True,
        "parent_session_id": root_session_id or "",
    }

    text_parts: list[str] = []
    try:
        async for event in _stream_with_timeout(
            workspace.stream_query(request),
            timeout=timeout,
        ):
            obj = getattr(event, "object", None)
            status = getattr(event, "status", None)

            if obj == "content":
                text = getattr(event, "text", None)
                if text:
                    delta = getattr(event, "delta", False)
                    if delta:
                        text_parts.append(text)
                    else:
                        text_parts = [text]

            if obj == "message" and status is not None:
                from ...schemas import RunStatus

                if status == RunStatus.Completed:
                    content = getattr(event, "content", None) or []
                    msg_texts: list[str] = []
                    for part in content:
                        part_text = getattr(part, "text", None)
                        if part_text:
                            msg_texts.append(part_text)
                    if msg_texts:
                        text_parts = msg_texts

            if obj == "response" and status is not None:
                from ...schemas import RunStatus

                if status in (RunStatus.Completed, RunStatus.Failed):
                    break

    except asyncio.TimeoutError:
        logger.warning("Host sub-run (in-process) timed out after %ss", timeout)
    except asyncio.CancelledError:
        logger.debug("Host sub-run (in-process) cancelled")
        raise
    except Exception as exc:  # noqa: BLE001
        logger.warning("Host sub-run (in-process) failed: %s", exc, exc_info=True)

    return "".join(text_parts)
