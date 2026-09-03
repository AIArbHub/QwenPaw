# -*- coding: utf-8 -*-
"""Group-chat orchestration state machine.

Manages the full lifecycle of a group-chat round:
    1. HOST_OPENER — host decomposes user message
    2. MEMBER_TURNS — members speak in round-robin or parallel order
    3. HOST_SUMMARY — host summarizes all member views
    4. ROUND_DONE — persist round record

Produces standard ``message`` events that ``stream_one`` serializes
via ``_serialize_event_for_sse``.  Member messages carry a
``meta.group_member`` marker so the frontend routes them to independent
``MemberReplyRow`` bubbles.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import Any, AsyncGenerator, Optional

from ...config.context import get_current_workspace_dir
from ...schemas import RunStatus
from . import adapter, context, sse, store
from .models import (
    GroupMode,
    GroupSession,
    Member,
    MemberTurn,
    RoundRecord,
    build_group_id,
    is_group_host_description,
    parse_host_meta,
)

# ── Pending Registry（进程级单例）────────────────────────────────
#
# 群聊运行时在此创建 asyncio.Future 并挂起等待；``inject`` API
# 通过 resolve_pending_future() 解除阻塞。
#
# 之所以抽取到独立的 ``pending.py`` 模块，是为了打破 runtime.py
# 与 api.py 之间的循环引用：runtime.py 创建 Future，api.py 解析
# Future，两者都只需导入 pending.py 即可，互不依赖。
from .pending import (
    get_pending_future,
    set_pending_future,
    resolve_pending_future,
    cancel_pending_future,
    cleanup_group,
)

logger = logging.getLogger(__name__)

# Fallback environment switch (for development/testing). In production,
# the frontend sends ``request_context.group_chat_native`` per request.
# The env var acts as a global override: when set to "0" / "false" it
# forces the feature off regardless of the frontend flag.
_ENV_FLAG = "GROUP_CHAT_NATIVE_DISABLED"

# Concurrency limits for parallel mode
MAX_PARALLEL_CONCURRENCY = 4
MAX_MEMBERS = 10


def is_native_group_chat_disabled() -> bool:
    """Check whether the native group-chat runtime is force-disabled by env.

    When ``GROUP_CHAT_NATIVE_DISABLED`` is set to a truthy value,
    the feature is off regardless of the per-request flag from the
    frontend. This is an escape-hatch for operators.
    """
    return os.getenv(_ENV_FLAG, "").lower() in ("1", "true", "yes", "on")


def is_native_group_chat_enabled(request_context: Any = None) -> bool:
    """Check whether the native group-chat runtime is enabled.

    Priority:
    1. If ``GROUP_CHAT_NATIVE_DISABLED`` env var is set → False (override).
    2. If ``request_context`` carries ``group_chat_native`` → use that value.
    3. Global ``group_chat_native_enabled`` in config.json.
    4. Default: **True** (enabled, safe because it only activates for
       group-chat host agents with ``<!-- HOST:{...} -->`` metadata).
    """
    if is_native_group_chat_disabled():
        logger.debug(
            "[group-chat-detect] is_native_group_chat_enabled=False "
            "(env GROUP_CHAT_NATIVE_DISABLED is set)",
        )
        return False

    # Per-request flag from frontend (highest priority after env override)
    if isinstance(request_context, dict):
        flag = request_context.get("group_chat_native")
        if flag is not None:
            logger.debug(
                "[group-chat-detect] is_native_group_chat_enabled=%s "
                "(per-request flag group_chat_native=%s)",
                bool(flag), flag,
            )
            return bool(flag)

    # Global config setting (backed up via include_global_config)
    try:
        from ...config.utils import load_config

        global_cfg = load_config()
        if global_cfg is not None:
            gc_flag = getattr(
                global_cfg.agents,
                "group_chat_native_enabled",
                None,
            )
            if gc_flag is not None:
                logger.debug(
                    "[group-chat-detect] is_native_group_chat_enabled=%s "
                    "(global config group_chat_native_enabled=%s)",
                    bool(gc_flag), gc_flag,
                )
                return bool(gc_flag)
    except Exception as exc:  # noqa: BLE001
        logger.debug(
            "[group-chat-detect] global config read failed: %s", exc,
        )

    # Default: enabled — does not affect single-agent chats.
    logger.debug(
        "[group-chat-detect] is_native_group_chat_enabled=True "
        "(default — no explicit config found)",
    )
    return True


def should_use_native_runtime(
    description: str,
    workspace_dir: Any,
    request_context: Any = None,
) -> bool:
    """Determine whether a request should use the native group-chat runtime.

    Returns True only when:
    1. The per-request flag from frontend is enabled (or default on)
    2. The agent description contains HOST metadata
    3. The schedule mode is NOT ``autonomous`` (unsupported, falls back)
    """
    if not is_native_group_chat_enabled(request_context):
        logger.debug(
            "[group-chat-detect] should_use_native_runtime=False "
            "(feature disabled by config/env/flag)",
        )
        return False

    meta = parse_host_meta(description or "")
    if meta is None:
        # 检查 description 是否为空或缺少 HOST 元数据
        desc_preview = (description or "")[:200]
        logger.debug(
            "[group-chat-detect] should_use_native_runtime=False "
            "(no HOST metadata in description, preview: %s)",
            desc_preview,
        )
        return False

    mode = meta.get("mode", "round_robin")
    if mode == GroupMode.AUTONOMOUS.value:
        logger.info(
            "[group-chat-detect] should_use_native_runtime=False "
            "(autonomous mode → falling back to _process path)",
        )
        return False

    logger.debug(
        "[group-chat-detect] should_use_native_runtime=True "
        "(mode=%s, members=%d)",
        mode,
        len(meta.get("members", [])),
    )
    return True


async def run_group_chat(
    request: Any,
    channel: Any,
) -> AsyncGenerator[Any, None]:
    """Run one group-chat round and yield SSE-serialisable events.

    This generator yields ``Message`` and response-complete events that
    ``stream_one`` can pass through ``_serialize_event_for_sse``.

    The caller is responsible for calling ``_detect_group_host`` before
    invoking this function.
    """
    # Extract request fields
    host_agent_id = getattr(request, "user_id", "") or ""
    session_id = getattr(request, "session_id", "") or ""
    # channel._workspace_dir 可能为 None（workspace 未初始化时），
    # 回退到 contextvar 中的当前 workspace_dir。
    workspace_dir = (
        getattr(channel, "_workspace_dir", None)
        or get_current_workspace_dir()
    )

    # Get the workspace for persistence
    workspace = getattr(channel, "_workspace", None)

    # Extract the user's message text
    user_message = ""
    input_list = getattr(request, "input", None)
    if input_list:
        first_msg = input_list[0]
        content = getattr(first_msg, "content", None) or []
        for part in content:
            text = getattr(part, "text", None)
            if text:
                user_message = text
                break

    if not user_message:
        # No text — yield a minimal error message
        msg = sse.make_host_message(
            "(No message content received)",
            status=RunStatus.Completed,
        )
        yield msg
        return

    # Parse host metadata
    # We need the agent description — get it from the workspace
    host_description = ""
    if workspace is not None:
        from ...config.config import load_agent_config

        try:
            agent_config = await asyncio.to_thread(
                load_agent_config,
                host_agent_id,
            )
            host_description = agent_config.description or ""
        except Exception:  # noqa: BLE001
            logger.warning(
                "Failed to load host agent config for %s",
                host_agent_id,
                exc_info=True,
            )

    meta = parse_host_meta(host_description)
    if meta is None:
        # Fallback: yield through _process (shouldn't reach here)
        msg = sse.make_host_message(
            "Group chat metadata not found.",
            status=RunStatus.Completed,
        )
        yield msg
        return

    # Build / load group session
    group_id = build_group_id(host_agent_id, session_id)
    group_session = await store.load_group_session(workspace_dir, group_id)
    if group_session is None:
        # Create a new session from metadata
        members_list = meta.get("members", [])
        members = [
            Member(
                agent_id=m["id"],
                name=m.get("name", m["id"]),
                role="",
                order=idx,
            )
            for idx, m in enumerate(members_list)
        ]
        schedule_mode_str = meta.get("mode", "round_robin")
        try:
            schedule_mode = GroupMode(schedule_mode_str)
        except ValueError:
            schedule_mode = GroupMode.ROUND_ROBIN

        group_session = GroupSession(
            group_id=group_id,
            host_agent_id=host_agent_id,
            schedule_mode=schedule_mode,
            members=members,
        )

        # M3: Parse script phases from host metadata
        script_data = meta.get("script", [])
        if isinstance(script_data, list) and script_data:
            from .models import ScriptPhase

            phases = []
            for sp in script_data:
                if isinstance(sp, dict):
                    phases.append(ScriptPhase(
                        name=sp.get("name", ""),
                        mode=sp.get("mode", "round_robin"),
                        member_filter=sp.get("member_filter", []),
                        host_opener_hint=sp.get("host_opener_hint", ""),
                    ))
            if phases:
                group_session.script = phases
                group_session.script_phase_idx = 0

    # Enforce member count limit
    if len(group_session.members) > MAX_MEMBERS:
        group_session.members = group_session.members[:MAX_MEMBERS]

    # Start a new round
    group_session.round += 1
    round_no = group_session.round

    # M3: Determine this round's phase and schedule mode
    current_phase = None
    if group_session.script and group_session.script_phase_idx >= 0:
        if group_session.script_phase_idx < len(group_session.script):
            current_phase = group_session.script[group_session.script_phase_idx]
        else:
            # Script completed — fall back to fixed schedule_mode
            group_session.script_phase_idx = -1

    # Determine effective schedule mode for this round
    if current_phase is not None:
        phase_mode_str = current_phase.mode
        try:
            effective_mode = GroupMode(phase_mode_str)
        except ValueError:
            effective_mode = group_session.schedule_mode
    else:
        effective_mode = group_session.schedule_mode

    round_record = RoundRecord(round_no=round_no)
    if current_phase is not None:
        round_record.phase = current_phase.name

    # Resolve root session for approval routing
    root_session_id = session_id

    all_output: list = []  # Collected messages for response.completed

    try:
        # ── 1. HOST OPENER ──────────────────────────────────────────
        # M3: If a script phase is active, include its hint in the opener.
        phase_hint = ""
        if current_phase is not None:
            phase_hint = current_phase.host_opener_hint or current_phase.name

        opener_prompt = context.build_host_opener_prompt(
            user_message, group_session,
            phase_hint=phase_hint,
        )
        # Yield an InProgress message first so the frontend exits the
        # "loading" state and shows a "thinking" indicator while the
        # host agent generates the opener text.  Without this, the
        # frontend stays on "正在加载…" until the full opener completes.
        opener_msg_id = sse.make_host_message(
            "", status=RunStatus.InProgress,
        ).id
        yield sse.make_host_message(
            "", status=RunStatus.InProgress, msg_id=opener_msg_id,
        )

        opener_text = await adapter.collect_host_subrun(
            host_agent_id,
            session_id,
            opener_prompt,
            timeout=120,
            root_session_id=root_session_id,
            host_workspace=workspace,
        )
        if not opener_text:
            opener_text = user_message  # Fallback: use the raw user message

        round_record.opener = opener_text

        # Emit the opener as a completed host message (same ID so SDK
        # merges it with the InProgress placeholder above).
        opener_msg = sse.make_host_message(
            opener_text, status=RunStatus.Completed, msg_id=opener_msg_id,
        )
        yield opener_msg
        all_output.append(opener_msg)

        # ── 2. MEMBER TURNS (M6: streamed in real-time) ──────────────
        # Each member's reply is streamed live: delta events are tagged
        # with ``meta.group_member`` and yielded immediately so the
        # frontend shows a "typing" bubble that fills in incrementally.
        member_turns: list[MemberTurn] = []

        if effective_mode == GroupMode.PARALLEL:
            async for turn, event in _stream_parallel_turns(
                group_session, opener_text, root_session_id,
                host_workspace=workspace,
                member_filter=current_phase.member_filter if current_phase else None,
            ):
                if event is not None:
                    yield event
                    # Only collect *completed* message events for the
                    # final response output.  InProgress messages are
                    # transient SDK state — collecting them would create
                    # duplicate entries (same ID) in the persisted output.
                    if (
                        getattr(event, "object", None) == "message"
                        and getattr(event, "status", None) == RunStatus.Completed
                    ):
                        all_output.append(event)
                if turn is not None and turn.status != "running":
                    member_turns.append(turn)
        else:
            async for turn, event in _stream_round_robin_turns(
                group_session, opener_text, root_session_id,
                host_workspace=workspace,
                member_filter=current_phase.member_filter if current_phase else None,
            ):
                if event is not None:
                    yield event
                    # Only collect *completed* message events for the
                    # final response output.  InProgress messages are
                    # transient SDK state — collecting them would create
                    # duplicate entries (same ID) in the persisted output.
                    if (
                        getattr(event, "object", None) == "message"
                        and getattr(event, "status", None) == RunStatus.Completed
                    ):
                        all_output.append(event)
                if turn is not None and turn.status != "running":
                    member_turns.append(turn)

        # Ensure all turns are recorded even if stream ended early
        for t in member_turns:
            if t not in round_record.turns:
                round_record.turns.append(t)

        # ── 控制点2：审批门控（M2, controller=assist）─────────────────────
        #
        # 对于 controller=assist 的成员，其生成的草稿必须经过人工审批
        # （或编辑）后才能被主持人的总结阶段看到。
        #
        # 机制：复用 Pending Registry——在此创建 Future 并挂起等待；
        # ``inject`` API 可以解析 Future 并传入审批文本（原样通过或编辑后）。
        #
        # 注意：审批等待期间群聊流程是阻塞的（这是设计决策：后续成员
        # 的发言可能依赖于审批结果，且主持人总结需要看到审批后的版本）。
        # 超时后使用原始草稿继续，避免流程无限挂起。
        approved_turns: list[MemberTurn] = []
        for turn in member_turns:
            member = group_session.find_member(turn.member_id)
            if member is not None and member.controller == "assist" and turn.status == "done":
                # 使用稳定的 msg_id 使 SDK 将「审批中」(InProgress)
                # 和「已审批」(Completed) 消息合并为同一个气泡。
                from uuid import uuid4

                approval_msg_id = uuid4().hex

                # 发出审批待决事件（InProgress，展示草稿内容）
                approval_msg = sse.make_member_approval_pending_message(
                    member, turn.result,
                    msg_id=approval_msg_id,
                )
                yield approval_msg

                # 等待人工审批（与控制点1相同的 Future 机制）
                loop = asyncio.get_event_loop()
                future: asyncio.Future = loop.create_future()
                set_pending_future(group_session.group_id, member.agent_id, future)

                try:
                    approved_text = await asyncio.wait_for(
                        future, timeout=HUMAN_WAIT_TIMEOUT,
                    )
                    # 用审批/编辑后的文本更新 turn
                    turn.result = approved_text or turn.result
                    member.override_count += 1
                except asyncio.TimeoutError:
                    cancel_pending_future(
                        group_session.group_id, member.agent_id,
                    )
                    # 超时：使用原始草稿继续
                    logger.info(
                        "Approval timeout for member %s, using draft as-is",
                        member.agent_id,
                    )

                # 发出已审批的成员消息（与上面的 InProgress 使用相同
                # msg_id，SDK 会自动合并为同一个气泡的最终状态）
                approved_msg = sse.make_member_message(
                    member, turn.result,
                    status=RunStatus.Completed,
                    msg_id=approval_msg_id,
                    human_override=True,
                )
                yield approved_msg
                all_output.append(approved_msg)

            approved_turns.append(turn)

        # ── 3. HOST SUMMARY ─────────────────────────────────────────
        summary_prompt = context.build_host_summary_prompt(
            group_session, opener_text, approved_turns,
        )
        # Yield an InProgress placeholder for the summary so the
        # frontend shows a "thinking" indicator during generation.
        summary_msg_id = sse.make_host_message(
            "", status=RunStatus.InProgress,
        ).id
        yield sse.make_host_message(
            "", status=RunStatus.InProgress, msg_id=summary_msg_id,
        )

        summary_text = await adapter.collect_host_subrun(
            host_agent_id,
            session_id,
            summary_prompt,
            timeout=180,
            root_session_id=root_session_id,
            host_workspace=workspace,
        )

        round_record.summary = summary_text

        summary_msg = sse.make_host_message(
            summary_text or "(Summary generation failed)",
            status=RunStatus.Completed,
            msg_id=summary_msg_id,
        )
        # Attach round marker to summary message metadata
        if summary_msg.metadata is None:
            summary_msg.metadata = {}
        summary_msg.metadata["group_round"] = round_no
        yield summary_msg
        all_output.append(summary_msg)

    except asyncio.CancelledError:
        logger.info("Group chat round %d cancelled", round_no)
        # In M6, member events were already streamed live — no need to
        # replay them.  Just yield a response.completed so the frontend
        # exits the loading state cleanly.
        from ...schemas import AgentResponse

        yield AgentResponse(
            output=[],
            status=RunStatus.Completed,
        )
        raise
    finally:
        # M3: 本轮结束后推进脚本阶段索引。
        # 如果脚本还有后续阶段，推进到下一个；
        # 如果已是最后一个阶段，标记脚本为已完成（idx=-1）。
        if group_session.script and group_session.script_phase_idx >= 0:
            next_idx = group_session.script_phase_idx + 1
            if next_idx < len(group_session.script):
                group_session.script_phase_idx = next_idx
            else:
                # 脚本所有阶段已完成
                group_session.script_phase_idx = -1

        # Persist the round
        group_session.rounds.append(round_record)
        try:
            await store.save_group_session(workspace_dir, group_session)
        except Exception:  # noqa: BLE001
            logger.warning(
                "Failed to persist group session %s",
                group_id,
                exc_info=True,
            )

    # ── 4. RESPONSE COMPLETED ─────────────────────────────────────
    # Build a response-completed envelope for downstream SSE consumers.
    # The SDK's ``handleResponse`` sets ``draft.status = Completed`` which
    # makes the frontend exit the loading state and finalize the chat.
    from ...schemas import AgentResponse

    response = AgentResponse(
        output=all_output,
        status=RunStatus.Completed,
    )
    yield response


# Human wait timeout (seconds). Much longer than member generation timeout
# because a human may need time to think and type.
HUMAN_WAIT_TIMEOUT = 15 * 60  # 15 minutes


async def _stream_round_robin_turns(
    session: GroupSession,
    opener_text: str,
    root_session_id: str,
    *,
    host_workspace: Any = None,
    member_filter: list[str] | None = None,
) -> Any:
    """Execute member turns in sequential order, streaming events live.

    Yields ``(MemberTurn, event)`` tuples.  The ``event`` is a runtime
    schema object tagged with ``meta.group_member`` for frontend routing.
    ``MemberTurn`` starts as ``running`` and transitions to terminal
    status when the member's stream completes.

    ``member_filter``: if provided (from a script phase), only members
    whose ``agent_id`` is in this list will speak.  Others are skipped.
    """
    prior_results: list[MemberTurn] = []

    for member in session.ordered_members():
        # M3: Skip members not in the phase's member_filter
        if member_filter and member.agent_id not in member_filter:
            continue
        # ── 控制点1：检查 controller 字段，决定是否需要人工介入 ──
        # controller=human 的成员不自动发言，而是挂起等待 inject API
        # 注入人工输入的文本。这对群聊流程是阻塞的（round-robin 模式
        # 下后续成员需要看到前面成员的发言内容）。
        if member.controller == "human":
            logger.info(
                "Member %s controller=human, awaiting human input (group=%s)",
                member.agent_id,
                session.group_id,
            )
            # Emit awaiting-human event and wait for inject
            awaiting_msg = sse.make_member_awaiting_message(member)
            yield MemberTurn(
                member_id=member.agent_id,
                status="awaiting_human",
                started_at=time.time(),
            ), awaiting_msg

            loop = asyncio.get_event_loop()
            future: asyncio.Future = loop.create_future()
            set_pending_future(session.group_id, member.agent_id, future)

            try:
                text = await asyncio.wait_for(future, timeout=HUMAN_WAIT_TIMEOUT)
                turn = MemberTurn(
                    member_id=member.agent_id,
                    prompt="(human override)",
                    status="done",
                    result=text or "",
                    started_at=time.time(),
                    finished_at=time.time(),
                    human_override=True,
                )
                member.override_count += 1
                # Emit the human's speech as a completed member message
                human_msg = sse.make_member_message(
                    member, text or "",
                    status=RunStatus.Completed,
                    human_override=True,
                )
                yield turn, human_msg
                prior_results.append(turn)
            except asyncio.TimeoutError:
                cancel_pending_future(session.group_id, member.agent_id)
                timeout_turn = MemberTurn(
                    member_id=member.agent_id,
                    prompt="(human timeout)",
                    status="timeout",
                    result="(该角色本轮未发言（等待人工超时）)",
                    started_at=time.time(),
                    finished_at=time.time(),
                )
                timeout_msg = sse.make_member_message(
                    member, timeout_turn.result,
                    status=RunStatus.Completed,
                    human_pending_timeout=True,
                )
                yield timeout_turn, timeout_msg
            finally:
                # 无论正常完成、超时还是异常，都清理 pending Future，
                # 避免残留的 Future 阻止后续轮次的 inject。
                cancel_pending_future(session.group_id, member.agent_id)
            continue

        prompt = context.build_member_prompt(
            session, member, opener_text, prior_results,
        )

        logger.info(
            "Round-robin turn (streamed): member=%s (group=%s)",
            member.agent_id,
            session.group_id,
        )

        current_turn: MemberTurn | None = None
        async for turn, event in adapter.stream_member(
            session,
            member,
            prompt,
            timeout=300,
            host_agent_id=session.host_agent_id,
            root_session_id=root_session_id,
            host_workspace=host_workspace,
        ):
            current_turn = turn
            if event is not None:
                # Tag the event with the member marker for frontend routing
                tagged = sse.tag_event_as_member(event, member)
                yield turn, tagged
            else:
                yield turn, None

        if current_turn is not None and current_turn.status == "done":
            prior_results.append(current_turn)


async def _stream_parallel_turns(
    session: GroupSession,
    opener_text: str,
    root_session_id: str,
    *,
    host_workspace: Any = None,
    member_filter: list[str] | None = None,
) -> Any:
    """Execute all member turns concurrently, streaming events live.

    Each member's stream runs independently.  If one member times out
    or fails (e.g. free-tier LLM not responding), the error is isolated
    to that member's bubble — other members continue and complete
    normally.  A failed member produces a ``MemberTurn`` with
    ``status="error"`` or ``"timeout"`` so the summary stage can skip
    it.

    ``member_filter``: if provided (from a script phase), only members
    whose ``agent_id`` is in this list will speak.  Others are excluded.
    """
    all_members = session.ordered_members()
    if member_filter:
        members = [
            m for m in all_members if m.agent_id in member_filter
        ]
    else:
        members = all_members
    sem = asyncio.Semaphore(min(MAX_PARALLEL_CONCURRENCY, len(members)))

    async def _stream_one(member: Member):
        """Yield ``(turn, event)`` tuples for one member.

        All exceptions are caught and converted into terminal
        ``MemberTurn`` + error message events so a failure in one
        member never propagates to the merge loop.

        Human-controlled members: do NOT call the agent. Instead, emit
        an awaiting-human event and wait for the inject API to resolve
        a pending Future. The merge loop is not blocked because each
        member runs independently.
        """
        # ── 控制点1（并行模式）：检查 controller 字段 ──
        # 与 round-robin 模式不同，并行模式下人工介入不阻塞其他成员：
        # 每个成员在独立的生成器中运行，互不影响。
        if member.controller == "human":
            logger.info(
                "Parallel member %s controller=human, awaiting input (group=%s)",
                member.agent_id,
                session.group_id,
            )
            # Emit awaiting-human event
            awaiting_msg = sse.make_member_awaiting_message(member)
            yield MemberTurn(
                member_id=member.agent_id,
                status="awaiting_human",
                started_at=time.time(),
            ), awaiting_msg

            loop = asyncio.get_event_loop()
            future: asyncio.Future = loop.create_future()
            set_pending_future(session.group_id, member.agent_id, future)

            try:
                text = await asyncio.wait_for(future, timeout=HUMAN_WAIT_TIMEOUT)
                turn = MemberTurn(
                    member_id=member.agent_id,
                    prompt="(human override)",
                    status="done",
                    result=text or "",
                    started_at=time.time(),
                    finished_at=time.time(),
                    human_override=True,
                )
                member.override_count += 1
                human_msg = sse.make_member_message(
                    member, text or "",
                    status=RunStatus.Completed,
                    human_override=True,
                )
                yield turn, human_msg
            except asyncio.TimeoutError:
                cancel_pending_future(session.group_id, member.agent_id)
                timeout_turn = MemberTurn(
                    member_id=member.agent_id,
                    prompt="(human timeout)",
                    status="timeout",
                    result="(该角色本轮未发言（等待人工超时）)",
                    started_at=time.time(),
                    finished_at=time.time(),
                )
                timeout_msg = sse.make_member_message(
                    member, timeout_turn.result,
                    status=RunStatus.Completed,
                    human_pending_timeout=True,
                )
                yield timeout_turn, timeout_msg
            finally:
                # 清理 pending Future，避免残留影响后续轮次
                cancel_pending_future(session.group_id, member.agent_id)
            return

        prompt = context.build_parallel_member_prompt(opener_text, "")
        try:
            async with sem:
                async for turn, event in adapter.stream_member(
                    session,
                    member,
                    prompt,
                    timeout=600,
                    host_agent_id=session.host_agent_id,
                    root_session_id=root_session_id,
                    host_workspace=host_workspace,
                ):
                    if event is not None:
                        tagged = sse.tag_event_as_member(event, member)
                        yield turn, tagged
                    else:
                        yield turn, None
        except Exception as exc:  # noqa: BLE001
            # Last-resort isolation: if adapter.stream_member itself
            # raised (not the normal internal-catch path), emit an
            # error turn so the member's bubble shows the failure
            # instead of hanging on "loading" forever.
            logger.warning(
                "Parallel member %s stream raised: %s",
                member.agent_id,
                exc,
                exc_info=True,
            )
            from ...schemas import RunStatus
            from uuid import uuid4

            err_turn = MemberTurn(
                member_id=member.agent_id,
                prompt=prompt,
                status="error",
                result=f"(Error: {exc})",
                started_at=time.time(),
                finished_at=time.time(),
            )
            err_event = sse.make_member_message(
                member,
                err_turn.result,
                status=RunStatus.Completed,
                msg_id=uuid4().hex,
            )
            yield err_turn, err_event

    # Interleave all member streams — events arrive as they're produced
    # and are yielded to the frontend in real time.  Each member's
    # generator is independent; one member finishing (or failing) does
    # not affect the others.
    async def _merge():
        generators = [_stream_one(m) for m in members]
        pending: set[asyncio.Task] = set()
        next_yield: dict[asyncio.Task, Any] = {}

        for gen in generators:
            task = asyncio.ensure_future(gen.__anext__())
            pending.add(task)
            next_yield[task] = gen

        while pending:
            done, pending = await asyncio.wait(
                pending, return_when=asyncio.FIRST_COMPLETED,
            )
            for task in done:
                gen = next_yield.pop(task)
                try:
                    result = task.result()
                except StopAsyncIteration:
                    # This member's generator is exhausted — it has
                    # finished (either completed or failed with an
                    # error turn already yielded).  Do not reschedule.
                    continue
                except StopIteration:
                    continue
                except Exception as exc:  # noqa: BLE001
                    # Should not happen because _stream_one catches
                    # everything, but guard just in case.
                    logger.warning(
                        "Parallel member stream unexpected error: %s",
                        exc,
                        exc_info=True,
                    )
                    continue
                yield result
                # Schedule next iteration for this member
                task = asyncio.ensure_future(gen.__anext__())
                pending.add(task)
                next_yield[task] = gen

    async for item in _merge():
        yield item
