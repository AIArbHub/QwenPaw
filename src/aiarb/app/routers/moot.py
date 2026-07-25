# -*- coding: utf-8 -*-
"""Moot API routes — arbitration practice case management and multi-agent dialogue."""

from __future__ import annotations

import logging
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Request, UploadFile, File as FastAPIFile
from starlette.responses import StreamingResponse, Response

from ...moot.models import (
    AddParticipantRequest,
    ARBITRATION_RULES,
    AutoSpeakRequest,
    CASE_TEMPLATES,
    CaseEventRequest,
    CaseStage,
    CaseStage as MootCaseStage,
    CollaborationMode,
    CreateCaseRequest,
    DOCUMENT_TEMPLATES,
    EventType,
    FileVisibility,
    MootCaseSummary,
    RemoveParticipantRequest,
    RoleCategory,
    SCORING_DIMENSIONS,
    Side,
    SpeakRequest,
    StageTransitionRequest,
    TRIAL_STYLE_TEMPLATES,
    TrialStyle,
    UpdateFileVisibilityRequest,
    UpdateParticipantRequest,
    CASE_STAGE_LABELS,
    ROLE_CATEGORY_LABELS,
    COLLABORATION_MODE_LABELS,
    SIDE_LABELS,
    TRIAL_STYLE_LABELS,
    AddCaseLinkRequest,
    CopilotRequest,
)
from ...moot import orchestrator

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/moot", tags=["moot"])


@router.get("/trial-styles", summary="List trial style templates")
async def list_trial_styles() -> List[dict]:
    return list(TRIAL_STYLE_TEMPLATES.values())


@router.get("/templates", summary="List case templates")
async def list_templates() -> List[dict]:
    return [
        {
            "template_id": t.template_id,
            "name": t.name,
            "description": t.description,
            "case_name": t.case_name,
            "case_description": t.case_description,
            "rules": t.rules,
            "default_participants": t.default_participants,
        }
        for t in CASE_TEMPLATES
    ]


@router.get("/rules", summary="List arbitration rules")
async def list_rules() -> List[dict]:
    return ARBITRATION_RULES


@router.get("/document-templates", summary="List document templates")
async def list_document_templates() -> List[dict]:
    return DOCUMENT_TEMPLATES


@router.get("/scoring-dimensions", summary="List scoring dimensions")
async def list_scoring_dimensions() -> List[dict]:
    return SCORING_DIMENSIONS


@router.post("/create", summary="Create a new arbitration case")
async def create_case(req: CreateCaseRequest, request: Request) -> dict:
    case = await orchestrator.create_case(
        case_name=req.case_name,
        case_description=req.case_description,
        rules=req.rules,
        trial_style=req.trial_style,
        global_collaboration_mode=req.global_collaboration_mode,
    )
    return {
        "case_id": case.case_id,
        "case_name": case.case_name,
        "status": case.status,
        "current_stage": case.current_stage.value,
        "rules": case.rules,
        "trial_style": case.trial_style.value,
        "global_collaboration_mode": case.global_collaboration_mode.value,
    }


@router.get("/cases", summary="List all arbitration cases")
async def list_cases() -> List[dict]:
    cases = await orchestrator.list_cases()
    result = []
    for c in cases:
        result.append({
            "case_id": c.case_id,
            "case_name": c.case_name,
            "status": c.status,
            "current_stage": c.current_stage.value,
            "current_stage_label": CASE_STAGE_LABELS.get(c.current_stage, c.current_stage.value),
            "rules": c.rules,
            "trial_style": c.trial_style.value,
            "global_collaboration_mode": c.global_collaboration_mode.value,
            "participants": [
                {
                    "participant_id": p.participant_id,
                    "agent_id": p.agent_id,
                    "display_name": p.display_name,
                    "role": p.role.value,
                    "role_detail": p.role_detail,
                    "side": p.side.value,
                    "collaboration_mode": p.collaboration_mode.value,
                    "active": p.active,
                }
                for p in c.participants
            ],
            "message_count": len(c.messages),
            "event_count": len(c.events),
            "created_at": c.created_at,
            "current_speaker": c.current_speaker,
        })
    return result


@router.get("/{case_id}", summary="Get case details")
async def get_case(case_id: str) -> dict:
    case = await orchestrator.get_case(case_id)
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    return {
        "case_id": case.case_id,
        "case_name": case.case_name,
        "case_description": case.case_description,
        "status": case.status,
        "current_stage": case.current_stage.value,
        "current_stage_label": CASE_STAGE_LABELS.get(case.current_stage, case.current_stage.value),
        "rules": case.rules,
        "trial_style": case.trial_style.value,
        "global_collaboration_mode": case.global_collaboration_mode.value,
        "controller_participant_id": case.controller_participant_id,
        "participants": [
            {
                "participant_id": p.participant_id,
                "agent_id": p.agent_id,
                "display_name": p.display_name,
                "role": p.role.value,
                "role_detail": p.role_detail,
                "side": p.side.value,
                "collaboration_mode": p.collaboration_mode.value,
                "joined_at": p.joined_at,
                "active": p.active,
            }
            for p in case.participants
        ],
        "events": [
            {
                "event_id": e.event_id,
                "event_type": e.event_type.value,
                "description": e.description,
                "data": e.data,
                "timestamp": e.timestamp,
                "actor_participant_id": e.actor_participant_id,
            }
            for e in case.events
        ],
        "messages": [
            {
                "id": m.id,
                "participant_id": m.participant_id,
                "agent_id": m.agent_id,
                "display_name": m.display_name,
                "role": m.role.value,
                "content": m.content,
                "stage": m.stage.value,
                "timestamp": m.timestamp,
                "is_system": m.is_system,
            }
            for m in case.messages
        ],
        "created_at": case.created_at,
        "updated_at": case.updated_at,
        "current_speaker": case.current_speaker,
    }


@router.post("/{case_id}/participants", summary="Add a participant to the case")
async def add_participant(case_id: str, req: AddParticipantRequest, request: Request) -> dict:
    try:
        agent_id = req.agent_id
        if not agent_id and req.new_agent_name:
            try:
                from ...agents.tools.agent_management import create_agent as _create_agent
                result = await _create_agent(
                    name=req.new_agent_name,
                    description=req.new_agent_description or f"仲裁模拟实训智能体 - {req.display_name}",
                )
                agent_id = result if isinstance(result, str) else getattr(result, "id", str(result))
            except Exception as e:
                logger.warning("Quick-create agent failed: %s, using generated ID", e)
                agent_id = f"moot_agent_{req.new_agent_name}"

        if not agent_id:
            raise HTTPException(status_code=400, detail="agent_id or new_agent_name is required")

        participant = await orchestrator.add_participant(
            case_id=case_id,
            agent_id=agent_id,
            display_name=req.display_name,
            role=req.role,
            role_detail=req.role_detail,
            side=req.side,
            collaboration_mode=req.collaboration_mode,
        )
        return {
            "participant_id": participant.participant_id,
            "agent_id": participant.agent_id,
            "display_name": participant.display_name,
            "role": participant.role.value,
            "role_detail": participant.role_detail,
            "side": participant.side.value,
            "collaboration_mode": participant.collaboration_mode.value,
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.patch("/{case_id}/participants/{participant_id}", summary="Update participant settings")
async def update_participant(case_id: str, participant_id: str, req: UpdateParticipantRequest) -> dict:
    try:
        participant = await orchestrator.update_participant(
            case_id=case_id,
            participant_id=participant_id,
            collaboration_mode=req.collaboration_mode,
            role_detail=req.role_detail,
            side=req.side,
            active=req.active,
        )
        return {
            "participant_id": participant.participant_id,
            "collaboration_mode": participant.collaboration_mode.value,
            "role_detail": participant.role_detail,
            "side": participant.side.value,
            "active": participant.active,
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.delete("/{case_id}/participants/{participant_id}", summary="Remove a participant")
async def remove_participant(case_id: str, participant_id: str) -> dict:
    try:
        await orchestrator.remove_participant(case_id, participant_id)
        return {"success": True}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/{case_id}/stage", summary="Advance case to a new stage")
async def advance_stage(case_id: str, req: StageTransitionRequest) -> dict:
    try:
        case = await orchestrator.advance_stage(case_id, req.stage, req.description)
        return {
            "case_id": case.case_id,
            "status": case.status,
            "current_stage": case.current_stage.value,
            "current_stage_label": CASE_STAGE_LABELS.get(case.current_stage, case.current_stage.value),
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/{case_id}/advance-trial", summary="Advance trial: trigger AI speakers for current stage")
async def advance_trial(case_id: str) -> dict:
    try:
        result = await orchestrator.advance_trial(case_id)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/{case_id}/advance-to-next-stage", summary="Skip to next trial stage without AI speakers")
async def advance_to_next_stage(case_id: str) -> dict:
    try:
        result = await orchestrator.advance_to_next_stage(case_id)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/{case_id}/events", summary="Add a case event")
async def add_case_event(case_id: str, req: CaseEventRequest) -> dict:
    try:
        event = await orchestrator.add_case_event(
            case_id=case_id,
            event_type=req.event_type,
            description=req.description,
            data=req.data,
        )
        return {
            "event_id": event.event_id,
            "event_type": event.event_type.value,
            "description": event.description,
            "timestamp": event.timestamp,
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/{case_id}/speak", summary="Send a message as a participant")
async def speak(case_id: str, req: SpeakRequest) -> dict:
    try:
        msg = await orchestrator.speak(case_id, req.participant_id, req.content)
        return {
            "id": msg.id,
            "participant_id": msg.participant_id,
            "agent_id": msg.agent_id,
            "display_name": msg.display_name,
            "role": msg.role.value,
            "content": msg.content,
            "stage": msg.stage.value,
            "timestamp": msg.timestamp,
            "is_system": msg.is_system,
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/{case_id}/auto-speak", summary="Trigger an agent to auto-speak")
async def auto_speak(case_id: str, req: AutoSpeakRequest) -> dict:
    try:
        msg = await orchestrator.auto_speak(case_id, req.participant_id, req.prompt)
        if msg is None:
            raise HTTPException(status_code=400, detail="Auto-speak failed")
        return {
            "id": msg.id,
            "participant_id": msg.participant_id,
            "agent_id": msg.agent_id,
            "display_name": msg.display_name,
            "role": msg.role.value,
            "content": msg.content,
            "stage": msg.stage.value,
            "timestamp": msg.timestamp,
            "is_system": msg.is_system,
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.get("/{case_id}/stream", summary="SSE stream for case events")
async def moot_stream(case_id: str) -> StreamingResponse:
    case = await orchestrator.get_case(case_id)
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")

    return StreamingResponse(
        orchestrator.stream_events(case_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.delete("/{case_id}", summary="Delete a case")
async def delete_case(case_id: str) -> dict:
    await orchestrator.delete_case(case_id)
    return {"success": True}


# ── Dynamic case modification endpoints ──────────────────────────────────────


@router.post("/{case_id}/add-party", summary="Add a new party to an active case")
async def add_party_to_case(case_id: str, req: AddParticipantRequest) -> dict:
    """Allow adding new parties during case progression (当事人变更)."""
    try:
        agent_id = req.agent_id
        if not agent_id and req.new_agent_name:
            try:
                from ...agents.tools.agent_management import (
                    create_agent as _create_agent,
                )
                result = await _create_agent(
                    name=req.new_agent_name,
                    description=req.new_agent_description
                    or f"仲裁模拟实训智能体 - {req.display_name}",
                )
                agent_id = (
                    result
                    if isinstance(result, str)
                    else getattr(result, "id", str(result))
                )
            except Exception as e:
                logger.warning(
                    "Quick-create agent failed: %s, using generated ID", e
                )
                agent_id = f"moot_agent_{req.new_agent_name}"

        if not agent_id:
            raise HTTPException(
                status_code=400, detail="agent_id or new_agent_name is required"
            )

        participant = await orchestrator.add_participant(
            case_id=case_id,
            agent_id=agent_id,
            display_name=req.display_name,
            role=req.role,
            role_detail=req.role_detail,
            collaboration_mode=req.collaboration_mode,
        )

        # Also emit a party_change event
        await orchestrator.add_case_event(
            case_id=case_id,
            event_type=EventType.PARTY_CHANGE,
            description=f"新增当事人：{req.display_name}（{req.role_detail or req.role.value}）",
            data={"action": "mid_case_add", "participant_id": participant.participant_id},
            actor_participant_id=None,
        )

        return {
            "participant_id": participant.participant_id,
            "agent_id": participant.agent_id,
            "display_name": participant.display_name,
            "role": participant.role.value,
            "role_detail": participant.role_detail,
            "collaboration_mode": participant.collaboration_mode.value,
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/{case_id}/procedure-change", summary="Change arbitration procedure/rules")
async def change_procedure(
    case_id: str,
    request: Request,
) -> dict:
    """Allow changing rules or procedures during case progression (仲裁程序变更)."""
    body = await request.json()
    new_rules: Optional[List[str]] = body.get("rules")
    new_description: Optional[str] = body.get("description")

    case = await orchestrator.get_case(case_id)
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")

    if new_rules is not None:
        old_rules = list(case.rules)
        await orchestrator.add_case_event(
            case_id=case_id,
            event_type=EventType.RULE_CHANGE,
            description=f"仲裁规则变更：{'、'.join(old_rules)} → {'、'.join(new_rules)}",
            data={"old_rules": old_rules, "new_rules": new_rules},
        )

    update_kwargs: dict = {}
    if new_rules is not None:
        update_kwargs["rules"] = new_rules
    if new_description:
        update_kwargs["case_description"] = new_description

    if update_kwargs:
        case = await orchestrator.update_case_fields(case_id, **update_kwargs)

    return {
        "case_id": case.case_id,
        "rules": case.rules,
        "case_description": case.case_description,
    }


@router.post("/{case_id}/tribunal-change", summary="Change tribunal composition")
async def change_tribunal(
    case_id: str,
    request: Request,
) -> dict:
    """Change tribunal formation (仲裁庭变更): e.g. 1 arbitrator → 3, or replacement due to challenge."""
    body = await request.json()
    description: str = body.get("description", "仲裁庭变更")
    data: dict = body.get("data", {})

    case = await orchestrator.get_case(case_id)
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")

    await orchestrator.add_case_event(
        case_id=case_id,
        event_type=EventType.TRIBUNAL_CHANGE,
        description=description,
        data=data,
    )
    case = await orchestrator.update_case_fields(case_id)

    return {"case_id": case_id, "updated_at": case.updated_at}


@router.post("/{case_id}/claim-change", summary="Change arbitration claims")
async def change_claims(
    case_id: str,
    request: Request,
) -> dict:
    """Change arbitration claims (仲裁请求变更)."""
    body = await request.json()
    new_description: str = body.get("description", "")
    actor_participant_id: Optional[str] = body.get("actor_participant_id")

    case = await orchestrator.get_case(case_id)
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")

    old_desc = case.case_description

    await orchestrator.add_case_event(
        case_id=case_id,
        event_type=EventType.CLAIM_CHANGE,
        description="仲裁请求变更",
        data={"old_description": old_desc, "new_description": new_description},
        actor_participant_id=actor_participant_id,
    )
    case = await orchestrator.update_case_fields(case_id, case_description=new_description)

    return {
        "case_id": case_id,
        "case_description": case.case_description,
        "updated_at": case.updated_at,
    }


@router.post("/{case_id}/procedural-application", summary="Submit procedural application")
async def submit_procedural_application(
    case_id: str,
    request: Request,
) -> dict:
    """Submit a procedural application (程序申请): e.g. 回避, 管辖权异议, 鉴定, etc."""
    body = await request.json()
    event_type: str = body.get("event_type", "procedural_application")
    description: str = body.get("description", "")
    actor_participant_id: Optional[str] = body.get("actor_participant_id")

    case = await orchestrator.get_case(case_id)
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")

    et = EventType(event_type) if event_type in [e.value for e in EventType] else EventType.PROCEDURAL_APPLICATION

    await orchestrator.add_case_event(
        case_id=case_id,
        event_type=et,
        description=description,
        data={"actor_participant_id": actor_participant_id},
        actor_participant_id=actor_participant_id,
    )

    return {"case_id": case_id, "description": description}


@router.post("/{case_id}/generate-document", summary="Generate legal document from template")
async def generate_document(
    case_id: str,
    request: Request,
) -> dict:
    body = await request.json()
    doc_type: str = body.get("doc_type", "award")
    participant_id: Optional[str] = body.get("participant_id")

    case = await orchestrator.get_case(case_id)
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")

    doc_template = next((d for d in DOCUMENT_TEMPLATES if d["doc_type"] == doc_type), None)
    if not doc_template:
        raise HTTPException(status_code=400, detail=f"Unknown document type: {doc_type}")

    doc_content = await orchestrator.generate_document(case_id, doc_type, doc_template, participant_id)

    return {
        "case_id": case_id,
        "doc_type": doc_type,
        "doc_name": doc_template["name"],
        "content": doc_content,
    }


@router.post("/{case_id}/score", summary="Score participant performance")
async def score_participant(
    case_id: str,
    request: Request,
) -> dict:
    body = await request.json()
    participant_id: str = body.get("participant_id", "")
    dimension_id: Optional[str] = body.get("dimension_id")

    case = await orchestrator.get_case(case_id)
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")

    participant = None
    for p in case.participants:
        if p.participant_id == participant_id and p.active:
            participant = p
            break
    if not participant:
        raise HTTPException(status_code=404, detail="Participant not found")

    scores = await orchestrator.score_participant(case_id, participant_id, dimension_id)

    return {
        "case_id": case_id,
        "participant_id": participant_id,
        "participant_name": participant.display_name,
        "scores": scores,
    }


# ── File management endpoints ──────────────────────────────────────────────


def _case_file_to_dict(f) -> dict:
    return {
        "file_id": f.file_id,
        "case_id": f.case_id,
        "blob_id": f.blob_id,
        "filename": f.filename,
        "original_filename": f.original_filename,
        "description": f.description,
        "owner_participant_id": f.owner_participant_id,
        "visibility": f.visibility.value,
        "allowed_participant_ids": f.allowed_participant_ids,
        "category": f.category,
        "tags": f.tags,
        "version": f.version,
        "parent_file_id": f.parent_file_id,
        "uploaded_at": f.uploaded_at,
        "updated_at": f.updated_at,
    }


@router.post("/{case_id}/files", summary="Upload a file to the case")
async def upload_file(
    case_id: str,
    file: UploadFile = FastAPIFile(...),
    owner_participant_id: str = "",
    visibility: str = "private",
    allowed_participants: str = "[]",
    category: str = "",
    tags: str = "[]",
    description: str = "",
) -> dict:
    import json as _json

    case = await orchestrator.get_case(case_id)
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")

    if not owner_participant_id:
        raise HTTPException(status_code=400, detail="owner_participant_id is required")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")

    try:
        allowed_list = _json.loads(allowed_participants)
    except Exception:
        allowed_list = []
    try:
        tag_list = _json.loads(tags)
    except Exception:
        tag_list = []

    try:
        vis = FileVisibility(visibility)
    except ValueError:
        vis = FileVisibility.PRIVATE

    import mimetypes
    mime_type = file.content_type or mimetypes.guess_type(file.filename or "")[0] or "application/octet-stream"

    try:
        case_file = await orchestrator.upload_file(
            case_id=case_id,
            content=content,
            filename=file.filename or "unnamed",
            original_filename=file.filename or "unnamed",
            owner_participant_id=owner_participant_id,
            mime_type=mime_type,
            visibility=vis,
            allowed_participant_ids=allowed_list,
            category=category,
            tags=tag_list,
            description=description,
        )
        return _case_file_to_dict(case_file)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.get("/{case_id}/files", summary="List case files")
async def list_files(
    case_id: str,
    participant_id: Optional[str] = None,
) -> List[dict]:
    try:
        files = await orchestrator.list_case_files(case_id, participant_id)
        return [_case_file_to_dict(f) for f in files]
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.get("/{case_id}/files/{file_id}/content", summary="Download file content")
async def download_file(
    case_id: str,
    file_id: str,
) -> Response:
    content = await orchestrator.get_file_content(case_id, file_id)
    if content is None:
        raise HTTPException(status_code=404, detail="File not found")

    files = await orchestrator.list_case_files(case_id)
    case_file = next((f for f in files if f.file_id == file_id), None)
    filename = case_file.filename if case_file else file_id
    mime = "application/octet-stream"
    if case_file:
        import mimetypes as _mt
        mime = _mt.guess_type(filename)[0] or "application/octet-stream"

    from urllib.parse import quote as _url_quote
    encoded_filename = _url_quote(filename, safe="")
    return Response(
        content=content,
        media_type=mime,
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}",
        },
    )


@router.put("/{case_id}/files/{file_id}/visibility", summary="Update file visibility")
async def update_file_visibility(
    case_id: str,
    file_id: str,
    req: UpdateFileVisibilityRequest,
) -> dict:
    try:
        updated = await orchestrator.update_file_visibility(
            case_id=case_id,
            file_id=file_id,
            visibility=req.visibility,
            allowed_participant_ids=req.allowed_participant_ids,
        )
        return _case_file_to_dict(updated)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.delete("/{case_id}/files/{file_id}", summary="Delete a file")
async def delete_file(
    case_id: str,
    file_id: str,
) -> dict:
    try:
        result = await orchestrator.delete_case_file(case_id, file_id)
        return {"success": result}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


# ── Case Links (案件-文档/知识关联) ─────────────────────────────────────────


@router.get("/{case_id}/links", summary="Get case-document/knowledge links")
async def get_case_links(case_id: str) -> List[dict]:
    links = await orchestrator.get_case_links(case_id)
    return [
        {
            "link_id": l.link_id,
            "case_id": l.case_id,
            "doc_id": l.doc_id,
            "wiki_page_path": l.wiki_page_path,
            "link_type": l.link_type,
            "side": l.side,
            "ai_analysis": l.ai_analysis,
            "created_at": l.created_at,
        }
        for l in links
    ]


@router.post("/{case_id}/links", summary="Add a case-document/knowledge link")
async def add_case_link(case_id: str, req: AddCaseLinkRequest) -> dict:
    try:
        link = await orchestrator.add_case_link(
            case_id=case_id,
            doc_id=req.doc_id or "",
            wiki_page_path=req.wiki_page_path or "",
            link_type=req.link_type,
            side=req.side,
            ai_analysis=req.ai_analysis,
        )
        return {
            "link_id": link.link_id,
            "case_id": link.case_id,
            "doc_id": link.doc_id,
            "wiki_page_path": link.wiki_page_path,
            "link_type": link.link_type,
            "side": link.side,
            "ai_analysis": link.ai_analysis,
            "created_at": link.created_at,
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.delete("/{case_id}/links/{link_id}", summary="Delete a case link")
async def remove_case_link(case_id: str, link_id: str) -> dict:
    try:
        result = await orchestrator.delete_case_link(link_id)
        return {"success": result}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


# ── Copilot (AI 助手) ───────────────────────────────────────────────────────


@router.post("/{case_id}/copilot", summary="Send a message to the AI Copilot")
async def copilot_chat(case_id: str, req: CopilotRequest) -> dict:
    try:
        response = await orchestrator.copilot_chat(
            case_id=case_id,
            message=req.message,
            context_tab=req.context_tab,
            selected_doc_id=req.selected_doc_id,
        )
        return {"response": response}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.get("/{case_id}/copilot/history", summary="Get Copilot conversation history")
async def get_copilot_history(case_id: str) -> List[dict]:
    return await orchestrator.get_copilot_history(case_id)


# ── AI Document Analysis ────────────────────────────────────────────────────


@router.post("/analyze-doc", summary="AI analysis of a document")
async def analyze_document(doc_id: str, case_id: str = "") -> dict:
    try:
        result = await orchestrator.analyze_document(doc_id, case_id)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


# ── SOP Integration ─────────────────────────────────────────────────────────
# Endpoints that connect the SOP SkillCard state machine to moot cases,
# allowing arbitration workflows to be guided by structured process graphs.

from pydantic import BaseModel as PydanticBaseModel
from pydantic import Field as PydanticField

from ...sop.moot_integration import MootSOPAdapter

# Global adapter — maintains in-memory case→skill mappings.
# For persistence across restarts, callers should use serialize/deserialize.
_moot_sop_adapter = MootSOPAdapter()


class SopBindRequest(PydanticBaseModel):
    skill_id: str = PydanticField(..., description="SkillCard ID to bind")
    initial_context: dict = PydanticField(default_factory=dict)


class SopStepRequest(PydanticBaseModel):
    user_message: str = PydanticField(..., description="User input for this turn")
    history: list[dict[str, str]] = PydanticField(default_factory=list)
    agent_id: str = PydanticField(default="", description="Agent ID for LLM config")


@router.post("/{case_id}/sop/bind", summary="Bind a SkillCard to a moot case")
async def sop_bind(case_id: str, req: SopBindRequest) -> dict:
    """Associate a SkillCard with a moot case and start the SOP runtime."""
    case = await orchestrator.get_case(case_id)
    if case is None:
        raise HTTPException(status_code=404, detail=f"Case '{case_id}' not found")

    initial_ctx = req.initial_context or {}
    initial_ctx.setdefault("case_id", case_id)
    initial_ctx.setdefault("case_name", case.case_name)

    card = await _moot_sop_adapter.bind_skill_to_case(
        case_id=case_id,
        skill_id=req.skill_id,
        initial_context=initial_ctx,
    )
    if card is None:
        raise HTTPException(
            status_code=404,
            detail=f"SkillCard '{req.skill_id}' not found",
        )
    return {
        "bound": True,
        "skill_id": req.skill_id,
        "skill_name": card.name,
        "start_node": card.start_node_id,
    }


@router.delete("/{case_id}/sop/bind", summary="Unbind SOP from a moot case")
async def sop_unbind(case_id: str) -> dict:
    """Remove the SOP binding from a case."""
    if not _moot_sop_adapter.is_bound(case_id):
        raise HTTPException(status_code=404, detail="No SOP binding for this case")
    _moot_sop_adapter.unbind_skill(case_id)
    return {"unbound": True, "case_id": case_id}


@router.get("/{case_id}/sop/state", summary="Get current SOP node for a case")
async def sop_get_state(case_id: str) -> dict:
    """Get information about the current SOP node for a case."""
    info = _moot_sop_adapter.get_current_node_info(case_id)
    if info is None:
        raise HTTPException(
            status_code=404,
            detail="No active SOP skill for this case",
        )
    return info


@router.post("/{case_id}/sop/step", summary="Get next step via SOP StepAgent")
async def sop_step(case_id: str, req: SopStepRequest) -> dict:
    """Get the next arbitration step using the SOP StepAgent."""
    if not _moot_sop_adapter.is_bound(case_id):
        raise HTTPException(
            status_code=400,
            detail="No SOP binding for this case. Call /sop/bind first.",
        )

    case = await orchestrator.get_case(case_id)

    # Build history from moot messages if not provided
    history = req.history
    if not history and case:
        history = [
            {"role": "assistant" if not m.is_system else "system", "text": m.content}
            for m in case.messages[-10:]
        ]

    decision = await _moot_sop_adapter.get_next_step(
        case_id=case_id,
        user_message=req.user_message,
        case=case,
        history=history,
    )
    if decision is None:
        raise HTTPException(
            status_code=500,
            detail="StepAgent returned no decision",
        )

    # Determine the moot stage that corresponds to the current SOP node
    suggested_stage = _moot_sop_adapter.sync_node_to_stage(case_id)

    return {
        "action": decision.action.value,
        "content": decision.content,
        "next_step_id": decision.next_step_id,
        "tool_name": decision.tool_name,
        "knowledge_query": decision.knowledge_query,
        "is_step_completed": decision.is_step_completed,
        "reasoning": decision.reasoning,
        "suggested_stage": suggested_stage.value if suggested_stage else None,
    }


@router.post("/{case_id}/sop/suspend", summary="Suspend SOP for interruption")
async def sop_suspend(case_id: str, reason: str = "interruption") -> dict:
    """Suspend the current SOP skill when an interruption occurs."""
    if not _moot_sop_adapter.suspend_for_interruption(case_id, reason):
        raise HTTPException(
            status_code=400,
            detail="No active SOP skill to suspend",
        )
    return {"suspended": True, "reason": reason}


@router.post("/{case_id}/sop/restore", summary="Restore SOP after interruption")
async def sop_restore(case_id: str) -> dict:
    """Restore the suspended SOP skill after an interruption is handled."""
    if not _moot_sop_adapter.restore_after_interruption(case_id):
        raise HTTPException(
            status_code=400,
            detail="No suspended SOP skill to restore",
        )
    info = _moot_sop_adapter.get_current_node_info(case_id)
    return {"restored": True, "current_node": info}


@router.get("/{case_id}/sop/serialize", summary="Serialize SOP state for persistence")
async def sop_serialize(case_id: str) -> dict:
    """Get the serialized SOP state for persistence."""
    data = _moot_sop_adapter.serialize_state(case_id)
    if data is None:
        raise HTTPException(
            status_code=404,
            detail="No SOP state for this case",
        )
    return data


@router.post("/{case_id}/sop/deserialize", summary="Restore SOP state from persisted data")
async def sop_deserialize(case_id: str, data: dict) -> dict:
    """Restore the SOP state from persisted data."""
    _moot_sop_adapter.deserialize_state(case_id, data)
    return {"restored": True, "case_id": case_id}