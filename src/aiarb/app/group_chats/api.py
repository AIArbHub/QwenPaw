# -*- coding: utf-8 -*-
"""群聊 Human-in-the-Loop (HITL) 控制的 REST API。

端点概览
========
    GET   /api/console/group-chats?host_agent_id=&session_id=
          → { members: [...], round, mode, script_phase }
          查询群聊当前状态（成员、轮次、模式、脚本阶段）

    PATCH /api/console/group-chats/members/controller
          body: { host_agent_id, session_id, member_id,
                  controller: "auto"|"human"|"assist", assist_hint?: string }
          → 接管语义：同时取消该成员正在进行的生成

    POST  /api/console/group-chats/members/inject
          body: { host_agent_id, session_id, member_id, text }
          → 解析 pending Future（如有），否则写入下一轮上下文

    POST  /api/console/group-chats/members/interrupt
          body: { host_agent_id, session_id, member_id }
          → 取消成员正在进行的生成，不回写部分结果

    POST  /api/console/group-chats/turns/edit
          body: { host_agent_id, session_id, turn_id, text }
          → 编辑已完成的成员发言，回写到会话文件

认证
====
``X-Agent-Id: host_agent_id``（与 console chat 相同）。

Pending Registry
================
挂起 Future 的注册表位于 ``pending.py``（进程级单例，
单 worker asyncio 部署假设）。它映射
``group_id → {member_id: asyncio.Future}``，使 ``inject``
能够解析运行时挂起的人工输入 Future。
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from ...config.context import get_current_workspace_dir
from . import adapter, sse, store
from .models import GroupSession, Member, MemberTurn, build_group_id
from .pending import (
    get_pending_future,
    resolve_pending_future,
    cancel_pending_future,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/console/group-chats", tags=["group-chats"])


# ── 辅助函数 ────────────────────────────────────────────────────


async def _load_session(
    host_agent_id: str,
    session_id: str,
) -> GroupSession:
    """从磁盘加载 GroupSession，找不到则返回 404。"""
    workspace_dir = get_current_workspace_dir()
    group_id = build_group_id(host_agent_id, session_id)
    session = await store.load_group_session(workspace_dir, group_id)
    if session is None:
        raise HTTPException(
            status_code=404,
            detail="Group chat session not found",
        )
    return session


async def _save_session(session: GroupSession) -> None:
    """将 GroupSession 持久化到磁盘。"""
    workspace_dir = get_current_workspace_dir()
    await store.save_group_session(workspace_dir, session)


# ── 请求模型 ────────────────────────────────────────────────────


class ControllerRequest(BaseModel):
    host_agent_id: str
    session_id: str
    member_id: str
    controller: str = Field(..., description='"auto" | "human" | "assist"')
    assist_hint: Optional[str] = None


class InjectRequest(BaseModel):
    host_agent_id: str
    session_id: str
    member_id: str
    text: str


class InterruptRequest(BaseModel):
    host_agent_id: str
    session_id: str
    member_id: str


class EditTurnRequest(BaseModel):
    host_agent_id: str
    session_id: str
    turn_id: str
    text: str


# ── 端点 ────────────────────────────────────────────────────────


@router.get("", summary="Get group chat state")
async def get_group_chat(
    host_agent_id: str,
    session_id: str,
) -> dict:
    """返回群聊会话的当前状态。

    包含成员列表（含 controller 状态、override_count、是否正在等待
    人工输入）、当前轮次、调度模式、以及脚本阶段信息。
    """
    session = await _load_session(host_agent_id, session_id)

    members = []
    for m in session.ordered_members():
        members.append({
            "agent_id": m.agent_id,
            "name": m.name or m.agent_id,
            "controller": m.controller,
            "assist_hint": m.assist_hint,
            "override_count": m.override_count,
            "human_pending": get_pending_future(
                session.group_id, m.agent_id,
            ) is not None,
        })

    return {
        "members": members,
        "round": session.round,
        "mode": session.schedule_mode.value,
        "script_phase": (
            session.script[session.script_phase_idx].name
            if session.script and 0 <= session.script_phase_idx < len(session.script)
            else None
        ),
        "script_phase_idx": session.script_phase_idx,
    }


@router.patch("/members/controller", summary="Set member controller")
async def set_member_controller(
    payload: ControllerRequest,
) -> dict:
    """设置成员的 controller 模式（接管 / 释放 / 辅助审批）。

    当 controller 设为 human（接管）时，会同时取消该成员正在进行的
    AI 生成调用，使后续的 inject 能接替发言。
    """
    if payload.controller not in ("auto", "human", "assist"):
        raise HTTPException(
            status_code=400,
            detail='controller must be "auto", "human", or "assist"',
        )

    session = await _load_session(
        payload.host_agent_id, payload.session_id,
    )

    member = session.find_member(payload.member_id)
    if member is None:
        raise HTTPException(
            status_code=404,
            detail="Member not found in this group chat",
        )

    old_controller = member.controller
    member.controller = payload.controller

    if payload.assist_hint is not None:
        member.assist_hint = payload.assist_hint

    # 接管：取消正在进行的成员 AI 生成
    if payload.controller == "human" and old_controller != "human":
        member_session_id = member.ensure_session_id(session.group_id)
        try:
            from ...agents.tools.agent_management import stop_agent_chat_async

            await stop_agent_chat_async(
                None,
                member_session_id,
                member.agent_id,
            )
        except Exception:  # noqa: BLE001
            logger.debug(
                "Failed to stop member chat during takeover %s",
                member.agent_id,
                exc_info=True,
            )

    # 从 human 切换为其他模式时，取消挂起的 pending Future
    if old_controller == "human" and payload.controller != "human":
        cancel_pending_future(session.group_id, payload.member_id)

    await _save_session(session)

    return {
        "member_id": member.agent_id,
        "controller": member.controller,
        "assist_hint": member.assist_hint,
    }


@router.post("/members/inject", summary="Inject a human turn")
async def inject_human_turn(
    payload: InjectRequest,
    request: Request,
) -> dict:
    """为指定成员注入一条人工发言。

    如果该成员当前正在等待人工输入（Pending Registry 中有活跃
    Future），则立即解析 Future 并继续群聊流程。
    否则，将文本写入该成员的会话上下文，供下一轮使用。
    """
    session = await _load_session(
        payload.host_agent_id, payload.session_id,
    )

    member = session.find_member(payload.member_id)
    if member is None:
        raise HTTPException(
            status_code=404,
            detail="Member not found in this group chat",
        )

    text = payload.text.strip()
    if not text:
        raise HTTPException(
            status_code=400,
            detail="Text must not be empty",
        )

    # 尝试解析 pending Future（成员正在等待人工输入）
    resolved = resolve_pending_future(
        session.group_id,
        member.agent_id,
        text,
    )

    if not resolved:
        # 没有活跃的 Future——将文本写入成员的会话上下文，
        # 供下一轮使用（inject_human_turn 负责持久化）。
        manager = getattr(request.app.state, "multi_agent_manager", None)
        host_workspace = None
        if manager is not None:
            try:
                host_workspace = await manager.get_agent(
                    payload.host_agent_id,
                )
            except Exception:  # noqa: BLE001
                pass

        turn = await adapter.inject_human_turn(
            session, member, text, host_workspace=host_workspace,
        )

        # 如果存在最新的轮次记录，也将 turn 追加到其中
        if session.rounds:
            session.rounds[-1].turns.append(turn)
            await _save_session(session)

    return {
        "member_id": member.agent_id,
        "text": text,
        "resolved_pending": resolved,
    }


@router.post("/members/interrupt", summary="Interrupt a member's in-flight generation")
async def interrupt_member(
    payload: InterruptRequest,
) -> dict:
    """中断成员正在进行的 AI 生成，不回写部分结果。"""
    session = await _load_session(
        payload.host_agent_id, payload.session_id,
    )

    member = session.find_member(payload.member_id)
    if member is None:
        raise HTTPException(
            status_code=404,
            detail="Member not found in this group chat",
        )

    # 取消挂起的 pending Future
    cancel_pending_future(session.group_id, member.agent_id)

    # 取消正在进行的 agent 生成调用
    member_session_id = member.ensure_session_id(session.group_id)
    try:
        from ...agents.tools.agent_management import stop_agent_chat_async

        await stop_agent_chat_async(
            None,
            member_session_id,
            member.agent_id,
        )
    except Exception:  # noqa: BLE001
        logger.debug(
            "Failed to stop member chat during interrupt %s",
            member.agent_id,
            exc_info=True,
        )

    return {
        "member_id": member.agent_id,
        "interrupted": True,
    }


@router.post("/turns/edit", summary="Edit a completed member turn")
async def edit_turn(
    payload: EditTurnRequest,
) -> dict:
    """编辑已完成的成员发言，替换其结果文本。

    编辑后的文本会回写到成员的会话文件中，确保主持人的总结
    使用修正后的版本，且成员后续的自动发言也能看到修正内容。
    """
    session = await _load_session(
        payload.host_agent_id, payload.session_id,
    )

    # 在轮次记录中查找该 turn——按 member_id 匹配
    # （前端将 member_id 作为 turn_id 传入）。从最新轮次
    # 向前搜索，确保编辑的是最近的发言。
    found_turn: Optional[MemberTurn] = None
    for rd in reversed(session.rounds):
        for turn in rd.turns:
            if turn.member_id == payload.turn_id:
                turn.result = payload.text
                found_turn = turn
                break
        if found_turn is not None:
            break

    if found_turn is None:
        raise HTTPException(
            status_code=404,
            detail="Turn not found",
        )

    # 将编辑后的文本回写到成员的会话文件，使成员后续的自动
    # 发言能在对话历史中看到修正后的版本。
    member = session.find_member(payload.turn_id)
    if member is not None:
        member_session_id = member.ensure_session_id(session.group_id)
        try:
            await adapter.update_member_session_message(
                member_session_id, payload.text,
            )
        except Exception:  # noqa: BLE001
            logger.debug(
                "Failed to update member session file for edit %s",
                payload.turn_id,
                exc_info=True,
            )

    await _save_session(session)

    return {
        "turn_id": payload.turn_id,
        "text": payload.text,
        "updated": True,
    }
