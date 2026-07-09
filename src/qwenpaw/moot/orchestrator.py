# -*- coding: utf-8 -*-
"""Moot orchestrator — controls multi-agent arbitration practice flow.

Data persistence: SQLite via MootStore (~/.aiarb/moot/moot.db).
SSE broadcast: in-memory asyncio.Queue per case, not persisted.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from typing import Any, AsyncGenerator, Dict, List, Optional

from .models import (
    CASE_STAGE_LABELS,
    CaseEvent,
    CaseStage,
    CollaborationMode,
    EventType,
    FileVisibility,
    MootCase,
    MootCaseFile,
    MootMessage,
    Participant,
    RoleCategory,
)
from .store import MootStore

logger = logging.getLogger(__name__)

_queues: Dict[str, List[asyncio.Queue]] = {}
_queue_lock = asyncio.Lock()

_store: Optional[MootStore] = None


def _get_store() -> MootStore:
    global _store
    if _store is None:
        _store = MootStore.get_instance()
    return _store


def _gen_id() -> str:
    return uuid.uuid4().hex[:12]


# ── SSE broadcast helpers ──────────────────────────────────────────────────


async def subscribe(case_id: str) -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue()
    async with _queue_lock:
        if case_id not in _queues:
            _queues[case_id] = []
        _queues[case_id].append(q)
    return q


async def unsubscribe(case_id: str, q: asyncio.Queue) -> None:
    async with _queue_lock:
        if case_id in _queues and q in _queues[case_id]:
            _queues[case_id].remove(q)


async def _broadcast(case_id: str, data: Dict[str, Any]) -> None:
    async with _queue_lock:
        queues = list(_queues.get(case_id, []))
    for q in queues:
        try:
            await q.put(data)
        except Exception:
            logger.exception("Failed to put message to SSE queue")


async def _emit_message(msg: MootMessage) -> None:
    await _broadcast(
        msg.case_id,
        {
            "type": "moot_message",
            "id": msg.id,
            "case_id": msg.case_id,
            "participant_id": msg.participant_id,
            "agent_id": msg.agent_id,
            "display_name": msg.display_name,
            "role": msg.role.value,
            "content": msg.content,
            "stage": msg.stage.value,
            "timestamp": msg.timestamp,
            "is_system": msg.is_system,
        },
    )


async def _emit_event(event: CaseEvent, case_id: str) -> None:
    await _broadcast(
        case_id,
        {
            "type": "case_event",
            "event_id": event.event_id,
            "event_type": event.event_type.value,
            "description": event.description,
            "data": event.data,
            "timestamp": event.timestamp,
        },
    )


async def _emit_stage_change(
    case_id: str,
    old_stage: CaseStage,
    new_stage: CaseStage,
) -> None:
    await _broadcast(
        case_id,
        {
            "type": "stage_change",
            "old_stage": old_stage.value,
            "new_stage": new_stage.value,
            "old_stage_label": CASE_STAGE_LABELS.get(old_stage, old_stage.value),
            "new_stage_label": CASE_STAGE_LABELS.get(new_stage, new_stage.value),
            "timestamp": time.time(),
        },
    )


# ── Case CRUD ──────────────────────────────────────────────────────────────


async def create_case(
    case_name: str = "仲裁模拟案",
    case_description: str = "",
    rules: Optional[List[str]] = None,
) -> MootCase:
    case_id = f"moot_{_gen_id()}"
    now = time.time()
    case = MootCase(
        case_id=case_id,
        case_name=case_name,
        case_description=case_description,
        rules=rules or [],
        created_at=now,
        updated_at=now,
    )
    store = _get_store()
    await asyncio.to_thread(store.create_case, case)
    async with _queue_lock:
        _queues[case_id] = []
    return case


async def get_case(case_id: str) -> Optional[MootCase]:
    store = _get_store()
    return await asyncio.to_thread(store.get_case, case_id)


async def list_cases() -> List[MootCase]:
    store = _get_store()
    return await asyncio.to_thread(store.list_cases)


async def delete_case(case_id: str) -> bool:
    store = _get_store()
    await asyncio.to_thread(store.delete_case, case_id)
    async with _queue_lock:
        if case_id in _queues:
            for q in _queues[case_id]:
                await q.put(None)
            del _queues[case_id]
    return True


# ── Participant management ─────────────────────────────────────────────────


def _find_participant(case: MootCase, participant_id: str) -> Optional[Participant]:
    for p in case.participants:
        if p.participant_id == participant_id:
            return p
    return None


async def add_participant(
    case_id: str,
    agent_id: str,
    display_name: str,
    role: RoleCategory,
    role_detail: str = "",
    collaboration_mode: CollaborationMode = CollaborationMode.AI_LEAD,
) -> Participant:
    store = _get_store()
    case = await asyncio.to_thread(store.get_case, case_id)
    if not case:
        raise ValueError(f"Case {case_id} not found")

    now = time.time()
    participant = Participant(
        participant_id=f"p_{_gen_id()}",
        agent_id=agent_id,
        display_name=display_name,
        role=role,
        role_detail=role_detail,
        collaboration_mode=collaboration_mode,
        joined_at=now,
    )

    await asyncio.to_thread(store.add_participant, participant, case_id)

    event = CaseEvent(
        event_id=_gen_id(),
        event_type=EventType.PARTY_CHANGE,
        description=f"新增参与者：{display_name}（{role.value}）",
        data={
            "action": "add",
            "participant_id": participant.participant_id,
            "agent_id": agent_id,
            "display_name": display_name,
            "role": role.value,
            "role_detail": role_detail,
        },
        timestamp=now,
    )
    await asyncio.to_thread(store.add_event, event, case_id)
    await asyncio.to_thread(store.update_case, case_id, updated_at=now)
    await _emit_event(event, case_id)

    return participant


async def remove_participant(case_id: str, participant_id: str) -> bool:
    store = _get_store()
    case = await asyncio.to_thread(store.get_case, case_id)
    if not case:
        raise ValueError(f"Case {case_id} not found")

    participant = _find_participant(case, participant_id)
    if not participant:
        raise ValueError(f"Participant {participant_id} not found")

    now = time.time()
    await asyncio.to_thread(
        store.update_participant, participant_id, active=False
    )
    await asyncio.to_thread(store.update_case, case_id, updated_at=now)

    event = CaseEvent(
        event_id=_gen_id(),
        event_type=EventType.PARTY_CHANGE,
        description=f"参与者退出：{participant.display_name}",
        data={
            "action": "remove",
            "participant_id": participant_id,
            "display_name": participant.display_name,
        },
        timestamp=now,
    )
    await asyncio.to_thread(store.add_event, event, case_id)
    await _emit_event(event, case_id)
    return True


async def update_participant(
    case_id: str,
    participant_id: str,
    collaboration_mode: Optional[CollaborationMode] = None,
    role_detail: Optional[str] = None,
    active: Optional[bool] = None,
) -> Participant:
    store = _get_store()
    case = await asyncio.to_thread(store.get_case, case_id)
    if not case:
        raise ValueError(f"Case {case_id} not found")

    participant = _find_participant(case, participant_id)
    if not participant:
        raise ValueError(f"Participant {participant_id} not found")

    changes: Dict[str, Any] = {}
    if collaboration_mode is not None and collaboration_mode != participant.collaboration_mode:
        changes["old_mode"] = participant.collaboration_mode.value
        changes["new_mode"] = collaboration_mode.value

    now = time.time()
    await asyncio.to_thread(
        store.update_participant,
        participant_id,
        collaboration_mode=collaboration_mode,
        role_detail=role_detail,
        active=active,
    )
    await asyncio.to_thread(store.update_case, case_id, updated_at=now)

    if changes:
        event = CaseEvent(
            event_id=_gen_id(),
            event_type=EventType.COLLABORATION_MODE_CHANGE,
            description=f"{participant.display_name} 协作模式变更",
            data={"participant_id": participant_id, **changes},
            timestamp=now,
        )
        await asyncio.to_thread(store.add_event, event, case_id)
        await _emit_event(event, case_id)

    updated_case = await asyncio.to_thread(store.get_case, case_id)
    p = _find_participant(updated_case, participant_id)
    return p if p else participant


# ── Stage management ───────────────────────────────────────────────────────


async def advance_stage(
    case_id: str,
    target_stage: CaseStage,
    description: Optional[str] = None,
) -> MootCase:
    store = _get_store()
    case = await asyncio.to_thread(store.get_case, case_id)
    if not case:
        raise ValueError(f"Case {case_id} not found")

    old_stage = case.current_stage
    now = time.time()

    new_status = case.status
    if target_stage != CaseStage.DRAFT:
        new_status = "active"
    if target_stage == CaseStage.CLOSED:
        new_status = "closed"

    await asyncio.to_thread(
        store.update_case,
        case_id,
        current_stage=target_stage,
        status=new_status,
        updated_at=now,
    )

    await _emit_stage_change(case_id, old_stage, target_stage)

    event = CaseEvent(
        event_id=_gen_id(),
        event_type=EventType.STAGE_CHANGE,
        description=description or f"案件阶段变更：{CASE_STAGE_LABELS.get(old_stage, old_stage.value)} → {CASE_STAGE_LABELS.get(target_stage, target_stage.value)}",
        data={"old_stage": old_stage.value, "new_stage": target_stage.value},
        timestamp=now,
    )
    await asyncio.to_thread(store.add_event, event, case_id)
    await _emit_event(event, case_id)

    return await asyncio.to_thread(store.get_case, case_id)


# ── Event management ───────────────────────────────────────────────────────


async def add_case_event(
    case_id: str,
    event_type: EventType,
    description: str,
    data: Optional[Dict[str, Any]] = None,
    actor_participant_id: Optional[str] = None,
) -> CaseEvent:
    store = _get_store()
    case = await asyncio.to_thread(store.get_case, case_id)
    if not case:
        raise ValueError(f"Case {case_id} not found")

    now = time.time()
    event = CaseEvent(
        event_id=_gen_id(),
        event_type=event_type,
        description=description,
        data=data or {},
        timestamp=now,
        actor_participant_id=actor_participant_id,
    )
    await asyncio.to_thread(store.add_event, event, case_id)
    await asyncio.to_thread(store.update_case, case_id, updated_at=now)
    await _emit_event(event, case_id)
    return event


# ── Message management ─────────────────────────────────────────────────────


async def _add_message(
    case_id: str,
    participant_id: str,
    agent_id: str,
    display_name: str,
    role: RoleCategory,
    content: str,
    stage: CaseStage,
    is_system: bool = False,
) -> MootMessage:
    store = _get_store()
    now = time.time()
    msg = MootMessage(
        id=_gen_id(),
        case_id=case_id,
        participant_id=participant_id,
        agent_id=agent_id,
        display_name=display_name,
        role=role,
        content=content,
        stage=stage,
        timestamp=now,
        is_system=is_system,
    )
    await asyncio.to_thread(store.add_message, msg)
    await asyncio.to_thread(store.update_case, case_id, updated_at=now)
    return msg


async def speak(
    case_id: str,
    participant_id: str,
    content: str,
) -> MootMessage:
    store = _get_store()
    case = await asyncio.to_thread(store.get_case, case_id)
    if not case:
        raise ValueError(f"Case {case_id} not found")
    if case.status == "closed":
        raise ValueError("Case is closed")

    participant = _find_participant(case, participant_id)
    if not participant or not participant.active:
        raise ValueError(f"Participant {participant_id} not found or inactive")

    msg = await _add_message(
        case_id,
        participant_id,
        participant.agent_id,
        participant.display_name,
        participant.role,
        content,
        case.current_stage,
    )
    await _emit_message(msg)
    return msg


async def auto_speak(
    case_id: str,
    participant_id: str,
    prompt: str,
) -> Optional[MootMessage]:
    store = _get_store()
    case = await asyncio.to_thread(store.get_case, case_id)
    if not case:
        raise ValueError(f"Case {case_id} not found")

    participant = _find_participant(case, participant_id)
    if not participant or not participant.active:
        raise ValueError(f"Participant {participant_id} not found or inactive")

    try:
        from ..agents.tools.agent_management import (
            chat_with_agent as _chat_with_agent,
            agent_exists,
        )

        exists = await asyncio.to_thread(agent_exists, participant.agent_id, None)
        if not exists:
            msg = await _add_message(
                case_id,
                participant_id,
                participant.agent_id,
                participant.display_name,
                participant.role,
                f"[系统提示：智能体 {participant.agent_id} 尚未创建，请先在智能体管理中创建]",
                case.current_stage,
                is_system=True,
            )
            await _emit_message(msg)
            return msg

        recent_messages = case.messages[-10:]
        context_parts = []
        for m in recent_messages:
            prefix = "[系统]" if m.is_system else f"[{m.display_name}]"
            context_parts.append(f"{prefix}: {m.content}")
        context_str = "\n".join(context_parts)

        events_summary = "\n".join(
            f"- {e.description}" for e in case.events[-5:]
        )

        full_prompt = (
            f"你正在参与仲裁实训，你的角色是「{participant.display_name}」"
            f"（{participant.role_detail or participant.role.value}）。\n"
            f"当前案件阶段：{CASE_STAGE_LABELS.get(case.current_stage, case.current_stage.value)}\n"
            f"案件：{case.case_name}\n"
            f"案件描述：{case.case_description or '无'}\n"
            f"适用规则：{', '.join(case.rules) if case.rules else '未指定'}\n\n"
            f"近期案件事件：\n{events_summary or '无'}\n\n"
            f"以下是近期对话：\n{context_str}\n\n"
            f"请根据你的角色、人设和当前案件阶段发言：{prompt}"
        )

        result = await _chat_with_agent(
            to_agent=participant.agent_id,
            text=full_prompt,
            timeout=120,
        )

        content = ""
        if hasattr(result, "content"):
            for block in result.content:
                if hasattr(block, "text"):
                    content += block.text

        if not content:
            content = "(未生成回复)"

        msg = await _add_message(
            case_id,
            participant_id,
            participant.agent_id,
            participant.display_name,
            participant.role,
            content,
            case.current_stage,
        )
        await _emit_message(msg)
        return msg

    except Exception as e:
        logger.exception("auto_speak failed for %s", participant_id)
        msg = await _add_message(
            case_id,
            participant_id,
            participant.agent_id,
            participant.display_name,
            participant.role,
            f"[发言失败：{str(e)}]",
            case.current_stage,
            is_system=True,
        )
        await _emit_message(msg)
        return msg


# ── Direct case field updates (for dynamic modification endpoints) ────────


_UNSET = object()


async def update_case_fields(
    case_id: str,
    *,
    rules: Optional[List[str]] = None,
    case_description: Optional[str] = None,
    controller_participant_id: Any = _UNSET,
    current_speaker: Any = _UNSET,
) -> MootCase:
    store = _get_store()
    case = await asyncio.to_thread(store.get_case, case_id)
    if not case:
        raise ValueError(f"Case {case_id} not found")

    now = time.time()
    kwargs: dict = {"updated_at": now}
    if rules is not None:
        kwargs["rules"] = rules
    if case_description is not None:
        kwargs["case_description"] = case_description
    if controller_participant_id is not _UNSET:
        kwargs["controller_participant_id"] = controller_participant_id
    if current_speaker is not _UNSET:
        kwargs["current_speaker"] = current_speaker
    await asyncio.to_thread(store.update_case, case_id, **kwargs)
    return await asyncio.to_thread(store.get_case, case_id)


# ── Document generation ────────────────────────────────────────────────────


async def generate_document(
    case_id: str,
    doc_type: str,
    doc_template: dict,
    participant_id: Optional[str] = None,
) -> str:
    store = _get_store()
    case = await asyncio.to_thread(store.get_case, case_id)
    if not case:
        raise ValueError(f"Case {case_id} not found")

    participant_info = ""
    if participant_id:
        for p in case.participants:
            if p.participant_id == participant_id and p.active:
                participant_info = f"\n起草人：{p.display_name}（{p.role.value}）"

    recent_messages = case.messages[-20:] if case.messages else []
    msg_summary = "\n".join(
        f"[{m.display_name}({m.role.value})] {m.content[:100]}"
        for m in recent_messages
    )

    event_summary = "\n".join(
        f"- {e.description}"
        for e in case.events[-10:]
    )

    prompt = (
        f"你是一位专业的仲裁文书起草专家。请根据以下案件信息，起草一份{doc_template['name']}。\n\n"
        f"文书类型：{doc_template['name']}（{doc_template.get('name_en', '')}）\n"
        f"文书说明：{doc_template['description']}\n\n"
        f"案件名称：{case.case_name}\n"
        f"案件描述：{case.case_description}\n"
        f"当前阶段：{CASE_STAGE_LABELS.get(case.current_stage, case.current_stage.value)}\n"
        f"适用规则：{'、'.join(case.rules) if case.rules else '未指定'}\n"
        f"参与者：{', '.join(p.display_name + '(' + p.role.value + ')' for p in case.participants if p.active)}\n"
        f"{participant_info}\n\n"
        f"近期事件：\n{event_summary or '无'}\n\n"
        f"近期对话摘要：\n{msg_summary or '无'}\n\n"
        f"请严格按照中国仲裁法和中国仲裁实务规范起草，格式规范、内容完整。"
    )

    try:
        from ..agents.tools.agent_management import chat_with_agent as _chat_with_agent

        result = await _chat_with_agent(
            to_agent=(case.participants[0].agent_id if case.participants else "default") or "default",
            text=prompt,
            timeout=120,
        )
        content = ""
        if hasattr(result, "content"):
            for block in result.content:
                if hasattr(block, "text"):
                    content += block.text
        if not content:
            content = str(result)
    except Exception as e:
        logger.warning("Document generation failed, using template: %s", e)
        content = (
            f"# {doc_template['name']}\n\n"
            f"案件名称：{case.case_name}\n"
            f"案件编号：{case_id}\n\n"
            f"案件描述：{case.case_description}\n\n"
            f"适用规则：{'、'.join(case.rules) if case.rules else '未指定'}\n\n"
            f"当前阶段：{CASE_STAGE_LABELS.get(case.current_stage, case.current_stage.value)}\n\n"
            f"参与者：{', '.join(p.display_name for p in case.participants if p.active)}\n\n"
            f"[AI文书生成失败，请手动补充文书内容]"
        )

    return content


# ── Scoring ────────────────────────────────────────────────────────────────


async def score_participant(
    case_id: str,
    participant_id: str,
    dimension_id: Optional[str] = None,
) -> List[dict]:
    from .models import SCORING_DIMENSIONS

    store = _get_store()
    case = await asyncio.to_thread(store.get_case, case_id)
    if not case:
        raise ValueError(f"Case {case_id} not found")

    participant = None
    for p in case.participants:
        if p.participant_id == participant_id and p.active:
            participant = p
            break
    if not participant:
        raise ValueError(f"Participant {participant_id} not found")

    participant_messages = [m for m in case.messages if m.participant_id == participant_id and not m.is_system]

    dimensions = SCORING_DIMENSIONS
    if dimension_id:
        dimensions = [d for d in dimensions if d["dimension_id"] == dimension_id]

    msg_summary = "\n".join(
        f"[{m.display_name}({m.stage.value})] {m.content[:80]}"
        for m in participant_messages[-15:]
    )

    scores: List[dict] = []
    for dim in dimensions:
        try:
            from ..agents.tools.agent_management import chat_with_agent as _chat_with_agent

            prompt = (
                f"你是一位仲裁实训评分专家。请对以下参与者在【{dim['name']}】维度的表现进行评分。\n\n"
                f"评分维度：{dim['name']}（{dim.get('name_en', '')}）\n"
                f"维度说明：{dim['description']}\n\n"
                f"案件名称：{case.case_name}\n"
                f"参与者：{participant.display_name}（{participant.role.value}）\n"
                f"角色细项：{participant.role_detail or '无'}\n\n"
                f"该参与者近期发言：\n{msg_summary or '无发言记录'}\n\n"
                f"请给出1-10分的评分，并简要说明理由。格式：评分|理由"
            )

            result = await _chat_with_agent(
                to_agent=participant.agent_id or "default",
                text=prompt,
                timeout=60,
            )
            result_str = ""
            if hasattr(result, "content"):
                for block in result.content:
                    if hasattr(block, "text"):
                        result_str += block.text
            if not result_str:
                result_str = str(result)

            parts = result_str.split("|", 1)
            try:
                score_val = min(10, max(1, int("".join(c for c in parts[0].strip() if c.isdigit()) or "5")))
            except (ValueError, IndexError):
                score_val = 5
            reason = parts[1].strip() if len(parts) > 1 else result_str[:100]

            scores.append({
                "dimension_id": dim["dimension_id"],
                "dimension_name": dim["name"],
                "score": score_val,
                "reason": reason,
            })
        except Exception as e:
            logger.warning("Scoring failed for dimension %s: %s", dim["dimension_id"], e)
            scores.append({
                "dimension_id": dim["dimension_id"],
                "dimension_name": dim["name"],
                "score": 5,
                "reason": f"AI评分暂不可用",
            })

    return scores


# ── SSE stream ─────────────────────────────────────────────────────────────


async def stream_events(
    case_id: str,
) -> AsyncGenerator[str, None]:
    q = await subscribe(case_id)
    try:
        while True:
            data = await q.get()
            if data is None:
                break
            yield f"data: {json.dumps(data, ensure_ascii=False)}\n\n"
    except asyncio.CancelledError:
        pass
    finally:
        await unsubscribe(case_id, q)


# ── File management ────────────────────────────────────────────────────────


async def upload_file(
    case_id: str,
    content: bytes,
    filename: str,
    original_filename: str,
    owner_participant_id: str,
    mime_type: str = "application/octet-stream",
    visibility: FileVisibility = FileVisibility.PRIVATE,
    allowed_participant_ids: Optional[List[str]] = None,
    category: str = "",
    tags: Optional[List[str]] = None,
    description: str = "",
) -> MootCaseFile:
    store = _get_store()
    case = await asyncio.to_thread(store.get_case, case_id)
    if not case:
        raise ValueError(f"Case {case_id} not found")

    owner_exists = any(
        p.participant_id == owner_participant_id and p.active
        for p in case.participants
    )
    if not owner_exists:
        raise ValueError(f"Participant {owner_participant_id} not found in case")

    case_file = await asyncio.to_thread(
        store.upload_file,
        content=content,
        case_id=case_id,
        filename=filename,
        original_filename=original_filename,
        owner_participant_id=owner_participant_id,
        mime_type=mime_type,
        visibility=visibility,
        allowed_participant_ids=allowed_participant_ids,
        category=category,
        tags=tags,
        description=description,
    )

    await _emit_event(
        CaseEvent(
            event_type=EventType.FILE_UPLOADED,
            description=f"上传文件：{filename}（{visibility.value}）",
            data={
                "file_id": case_file.file_id,
                "filename": filename,
                "visibility": visibility.value,
                "owner_participant_id": owner_participant_id,
            },
        ),
        case_id,
    )

    return case_file


async def list_case_files(
    case_id: str,
    participant_id: Optional[str] = None,
) -> List[MootCaseFile]:
    store = _get_store()
    if participant_id:
        return await asyncio.to_thread(store.get_visible_files, case_id, participant_id)
    return await asyncio.to_thread(store.get_case_files, case_id)


async def get_file_content(case_id: str, file_id: str) -> Optional[bytes]:
    store = _get_store()
    case_file = await asyncio.to_thread(store.get_file, file_id)
    if not case_file or case_file.case_id != case_id:
        return None
    return await asyncio.to_thread(store.get_file_content, case_file.blob_id)


async def update_file_visibility(
    case_id: str,
    file_id: str,
    visibility: FileVisibility,
    allowed_participant_ids: Optional[List[str]] = None,
) -> MootCaseFile:
    store = _get_store()
    case_file = await asyncio.to_thread(store.get_file, file_id)
    if not case_file or case_file.case_id != case_id:
        raise ValueError(f"File {file_id} not found in case {case_id}")

    updated = await asyncio.to_thread(
        store.update_file_visibility,
        file_id,
        visibility,
        allowed_participant_ids,
    )
    if not updated:
        raise ValueError(f"Failed to update file {file_id}")

    await _emit_event(
        CaseEvent(
            event_type=EventType.FILE_SHARED,
            description=f"文件可见性变更：{case_file.filename} → {visibility.value}",
            data={
                "file_id": file_id,
                "old_visibility": case_file.visibility.value,
                "new_visibility": visibility.value,
            },
        ),
        case_id,
    )

    return updated


async def delete_case_file(case_id: str, file_id: str) -> bool:
    store = _get_store()
    case_file = await asyncio.to_thread(store.get_file, file_id)
    if not case_file or case_file.case_id != case_id:
        raise ValueError(f"File {file_id} not found in case {case_id}")

    result = await asyncio.to_thread(store.delete_file, file_id)

    if result:
        await _emit_event(
            CaseEvent(
                event_type=EventType.FILE_DELETED,
                description=f"删除文件：{case_file.filename}",
                data={
                    "file_id": file_id,
                    "filename": case_file.filename,
                },
            ),
            case_id,
        )

    return result


async def get_file_versions(case_id: str, file_id: str) -> List[MootCaseFile]:
    store = _get_store()
    case_file = await asyncio.to_thread(store.get_file, file_id)
    if not case_file or case_file.case_id != case_id:
        raise ValueError(f"File {file_id} not found in case {case_id}")
    return await asyncio.to_thread(store.get_file_versions, file_id)