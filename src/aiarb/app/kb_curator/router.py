# -*- coding: utf-8 -*-
"""KB Curator (AI 知识整理) API endpoints.

- ``GET/PUT /kb-curator/settings`` — read/update curation settings
- ``POST /kb-curator/curate`` — submit text material
- ``POST /kb-curator/curate/upload`` — submit files as material
- ``GET /kb-curator/tasks`` / ``GET /kb-curator/tasks/{id}`` — task status
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, Body, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field

from ...constant import WORKING_DIR
from ...utils.io_utils import run_sync_io
from . import pipeline
from .settings import load_settings, save_settings, settings_file_path
from .tasks import get_registry

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/kb-curator", tags=["kb-curator"])

#: Where uploaded material files are staged before the background run.
_SPOOL_ROOT = WORKING_DIR / "kb_curator_spool"

#: Max characters accepted for inline text material.
_MAX_TEXT_CHARS = 200_000


async def _get_manager(request: Request):
    """Return the MultiAgentManager from app state (agent runtime)."""
    manager = getattr(request.app.state, "multi_agent_manager", None)
    if manager is None:
        raise HTTPException(
            status_code=500,
            detail="Agent runtime is not initialized",
        )
    return manager


class CurateTextRequest(BaseModel):
    """Inline text material submission."""

    text: str = Field(..., description="Material text to organize")
    title: str = Field(default="", max_length=200)
    category: str = Field(
        default="",
        max_length=64,
        description="Suggested top-level category (laws/rules/cases/templates)",
    )


class CurateTextResponse(BaseModel):
    task_id: str
    status: str


def _clean_category(category: str) -> str:
    text = (category or "").strip().strip("/\\")
    if "/" in text or "\\" in text:
        return ""
    return text


def _spool_for(task_id: str) -> Path:
    return _SPOOL_ROOT / task_id


async def _create_and_start(
    request: Request,
    *,
    title: str,
    category: str,
    text: str,
    file_names: Optional[list[str]] = None,
    spool_dir: Optional[Path] = None,
) -> dict:
    task_id = uuid4().hex
    spool = spool_dir or _spool_for(task_id)
    registry = get_registry()
    task = await registry.create(
        task_id=task_id,
        title=title,
        category=_clean_category(category),
        text=text,
        spool_dir=str(spool),
        file_names=file_names,
    )
    manager = await _get_manager(request)
    pipeline.start_curate_task(manager, task)
    return {"task_id": task.id, "status": task.status}


# ── Settings ─────────────────────────────────────────────────────────


@router.get("/settings", summary="Get KB Curator settings")
async def get_settings() -> dict:
    settings = await load_settings()
    return {**settings, "settings_file": str(settings_file_path())}


@router.put("/settings", summary="Update KB Curator settings")
async def put_settings(
    patch: dict = Body(..., description="Partial settings update"),
) -> dict:
    if not isinstance(patch, dict):
        raise HTTPException(status_code=400, detail="Invalid settings payload")
    updated = await save_settings(patch)
    return {**updated, "settings_file": str(settings_file_path())}


# ── Curate endpoints ─────────────────────────────────────────────────


@router.post("/curate", summary="Submit text material for AI organization")
async def curate_text(
    payload: CurateTextRequest,
    request: Request,
) -> CurateTextResponse:
    text = (payload.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="素材内容不能为空")
    if len(text) > _MAX_TEXT_CHARS:
        raise HTTPException(
            status_code=400,
            detail=f"素材内容过长（最多 {_MAX_TEXT_CHARS} 字）",
        )
    result = await _create_and_start(
        request,
        title=payload.title,
        category=payload.category,
        text=text,
    )
    return CurateTextResponse(**result)


@router.post("/curate/upload", summary="Upload files for AI organization")
async def curate_upload(
    request: Request,
    files: list[UploadFile],
    title: str = "",
    category: str = "",
) -> dict:
    if not files:
        raise HTTPException(status_code=400, detail="请至少上传一个文件")
    task_id = uuid4().hex
    spool = _spool_for(task_id)

    def _stage() -> list[str]:
        spool.mkdir(parents=True, exist_ok=True)
        names: list[str] = []
        for file in files:
            name = (file.filename or "upload").replace("\\", "/").split("/")[-1]
            if not name or name in (".", ".."):
                continue
            target = spool / name
            if target.exists():
                target = spool / f"{uuid4().hex[:6]}-{name}"
            target.write_bytes(file.file.read())
            names.append(target.name)
        return names

    try:
        names = await run_sync_io(_stage)
    except OSError as exc:
        raise HTTPException(
            status_code=500, detail=f"保存上传文件失败: {exc}"
        ) from exc
    finally:
        for file in files:
            await file.close()

    if not names:
        raise HTTPException(status_code=400, detail="没有可用的上传文件")

    result = await _create_and_start(
        request,
        title=title,
        category=category,
        text="",
        file_names=names,
        spool_dir=spool,
    )
    return {**result, "files": names}


# ── Task status ──────────────────────────────────────────────────────


@router.get("/tasks", summary="List KB Curator tasks")
async def list_tasks(limit: int = 50) -> dict:
    registry = get_registry()
    tasks = await registry.list(limit=limit)
    return {"tasks": tasks}


@router.get("/tasks/{task_id}", summary="Get a KB Curator task")
async def get_task(task_id: str) -> dict:
    registry = get_registry()
    task = await registry.get(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return task.to_dict()
