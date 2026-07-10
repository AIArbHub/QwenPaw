# -*- coding: utf-8 -*-
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Body, HTTPException
from pydantic import BaseModel, Field

from ...constant import WORKING_DIR
from ...cases.models import CaseRef, CaseFile
from ...knowledge.desensitize import local_desensitize
from ...knowledge.backfill import save_backfill, load_backfill, merge_mappings, restore_text
from ...parsers.router import ParserRouter

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/cases", tags=["cases"])

_parser_router: ParserRouter | None = None


def _get_parser() -> ParserRouter:
    global _parser_router
    if _parser_router is None:
        try:
            from ...config import load_config
            config = load_config()
            parser_cfg = getattr(config, "documents", None)
            if parser_cfg is not None:
                parser_cfg = getattr(parser_cfg, "parser", None)
            mineru_key = (getattr(parser_cfg, "mineru_api_key", "") or "") if parser_cfg else ""
            mineru_url = (getattr(parser_cfg, "mineru_base_url", "https://mineru.net/api/v4") or "https://mineru.net/api/v4") if parser_cfg else "https://mineru.net/api/v4"
            mineru_backend = (getattr(parser_cfg, "mineru_backend", "pipeline") or "pipeline") if parser_cfg else "pipeline"
            mineru_effort = (getattr(parser_cfg, "mineru_effort", "medium") or "medium") if parser_cfg else "medium"
        except Exception:
            mineru_key = ""
            mineru_url = "https://mineru.net/api/v4"
            mineru_backend = "pipeline"
            mineru_effort = "medium"
        _parser_router = ParserRouter(
            mineru_api_key=mineru_key,
            mineru_base_url=mineru_url,
            mineru_backend=mineru_backend,
            mineru_effort=mineru_effort,
        )
    return _parser_router


def _get_cases_dir(agent_id: str) -> Path:
    from ...config import load_config

    config = load_config()
    profile = config.agents.profiles.get(agent_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Agent not found")
    workspace_dir = Path(profile.workspace_dir)
    cases_dir = workspace_dir / "cases"
    cases_dir.mkdir(parents=True, exist_ok=True)
    return cases_dir


def _load_case_index(cases_dir: Path) -> dict[str, dict]:
    index_path = cases_dir / "_index.json"
    if index_path.is_file():
        try:
            return json.loads(index_path.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def _save_case_index(cases_dir: Path, data: dict[str, dict]) -> None:
    index_path = cases_dir / "_index.json"
    index_path.write_text(
        json.dumps(data, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


async def _run_case_parse_pipeline(
    case_dir: Path,
    source_path: Path,
    scan_mode: str = "auto",
) -> dict[str, Any]:
    supported_extensions = {
        ".pdf", ".docx", ".doc", ".xlsx", ".xls", ".pptx", ".ppt",
        ".jpg", ".jpeg", ".png", ".tiff", ".tif", ".bmp",
        ".md", ".txt", ".html", ".htm", ".csv",
    }

    parsed_dir = case_dir / "_parsed"
    desensitized_dir = case_dir / "_desensitized"
    backfill_dir = case_dir / "_backfill"
    parsed_dir.mkdir(parents=True, exist_ok=True)
    desensitized_dir.mkdir(parents=True, exist_ok=True)
    backfill_dir.mkdir(parents=True, exist_ok=True)

    parser = _get_parser()
    results: list[dict[str, str]] = []

    for file_path in sorted(source_path.rglob("*")):
        if not file_path.is_file():
            continue
        if file_path.suffix.lower() not in supported_extensions:
            continue

        rel_path = str(file_path.relative_to(source_path))
        safe_id = rel_path.replace("/", "_").replace("\\", "_").replace(".", "_")

        try:
            markdown_text = await parser.parse(file_path, parse_mode=scan_mode)

            parsed_file = parsed_dir / f"{safe_id}.md"
            parsed_file.write_text(markdown_text, encoding="utf-8")

            desensitized_text, backfill_map = local_desensitize(markdown_text)

            ds_file = desensitized_dir / f"{safe_id}.md"
            ds_file.write_text(desensitized_text, encoding="utf-8")

            if backfill_map:
                existing = load_backfill(backfill_dir, safe_id) or {}
                merged = merge_mappings(existing, backfill_map)
                save_backfill(backfill_dir, safe_id, merged, encrypt=True)

            results.append({
                "file": rel_path,
                "status": "parsed",
                "replacements": str(len(backfill_map)),
            })

        except Exception as exc:
            logger.error("Case file parse failed %s: %s", rel_path, exc)
            results.append({"file": rel_path, "status": "failed", "error": str(exc)})

    return {"results": results, "total": len(results)}


class CaseAddRequest(BaseModel):
    case_name: str = Field(default="", description="Human-readable case name")
    source_path: str = Field(default="", description="Absolute path to external case folder")
    scan_mode: str = Field(default="auto", description="auto / cloud_ocr / local_only")
    tags: list[str] = Field(default_factory=list, description="Case tags")
    auto_parse: bool = Field(default=True, description="Automatically parse and desensitize files")


class CaseListResponse(BaseModel):
    cases: list[CaseRef]
    total: int


class CaseParseRequest(BaseModel):
    scan_mode: str = Field(default="auto", description="auto / cloud_ocr / local_only")
    force: bool = Field(default=False, description="Force re-parse even if already parsed")


@router.post("/add", response_model=CaseRef)
async def add_case(agent_id: str = "default", body: CaseAddRequest = None):
    if not body or not body.source_path:
        raise HTTPException(status_code=400, detail="source_path is required")

    source_path = Path(body.source_path)
    if not source_path.is_dir():
        raise HTTPException(status_code=400, detail="source_path is not a directory")

    cases_dir = _get_cases_dir(agent_id)
    case_id = f"case_{uuid.uuid4().hex[:12]}"
    now = datetime.now(timezone.utc).isoformat()

    supported_extensions = {
        ".pdf", ".docx", ".doc", ".xlsx", ".xls", ".pptx", ".ppt",
        ".jpg", ".jpeg", ".png", ".tiff", ".tif", ".bmp",
        ".md", ".txt", ".html", ".htm", ".csv",
    }

    file_count = 0
    total_size = 0
    for p in source_path.rglob("*"):
        if p.is_file() and p.suffix.lower() in supported_extensions:
            file_count += 1
            total_size += p.stat().st_size

    case_ref = CaseRef(
        case_id=case_id,
        case_name=body.case_name or source_path.name,
        source_path=str(source_path),
        scan_mode=body.scan_mode,
        tags=body.tags,
        file_count=file_count,
        total_size=total_size,
        index_status="pending",
        last_scanned=now,
        enabled=True,
    )

    case_dir = cases_dir / case_id
    case_dir.mkdir(parents=True, exist_ok=True)
    ref_path = case_dir / "_ref.json"
    ref_path.write_text(
        case_ref.model_dump_json(indent=2),
        encoding="utf-8",
    )

    index = _load_case_index(cases_dir)
    index[case_id] = case_ref.model_dump()
    _save_case_index(cases_dir, index)

    if body.auto_parse:
        case_ref.index_status = "parsing"
        index[case_id] = case_ref.model_dump()
        _save_case_index(cases_dir, index)

        async def _bg_parse():
            try:
                await _run_case_parse_pipeline(case_dir, source_path, body.scan_mode)
                idx = _load_case_index(cases_dir)
                cr = CaseRef.model_validate(idx[case_id])
                cr.index_status = "ready"
                idx[case_id] = cr.model_dump()
                _save_case_index(cases_dir, idx)
            except Exception as exc:
                logger.error("Background case parse failed: %s", exc)
                idx = _load_case_index(cases_dir)
                cr = CaseRef.model_validate(idx[case_id])
                cr.index_status = "failed"
                idx[case_id] = cr.model_dump()
                _save_case_index(cases_dir, idx)

        asyncio.create_task(_bg_parse())

    return case_ref


@router.get("/list", response_model=CaseListResponse)
async def list_cases(agent_id: str = "default"):
    cases_dir = _get_cases_dir(agent_id)
    index = _load_case_index(cases_dir)
    cases = [CaseRef.model_validate(v) for v in index.values()]
    return CaseListResponse(cases=cases, total=len(cases))


@router.get("/{case_id}")
async def get_case(case_id: str, agent_id: str = "default"):
    cases_dir = _get_cases_dir(agent_id)
    index = _load_case_index(cases_dir)
    if case_id not in index:
        raise HTTPException(status_code=404, detail="Case not found")

    case_ref = CaseRef.model_validate(index[case_id])

    source_path = Path(case_ref.source_path)
    files = []
    supported_extensions = {
        ".pdf", ".docx", ".doc", ".xlsx", ".xls", ".pptx", ".ppt",
        ".jpg", ".jpeg", ".png", ".tiff", ".tif", ".bmp",
        ".md", ".txt", ".html", ".htm", ".csv",
    }
    if source_path.is_dir():
        for p in sorted(source_path.rglob("*")):
            if p.is_file() and p.suffix.lower() in supported_extensions:
                files.append(CaseFile(
                    file_name=p.name,
                    file_path=str(p.relative_to(source_path)),
                    file_type=p.suffix.lower().lstrip("."),
                    size=p.stat().st_size,
                    status="pending",
                ))

    return {"case": case_ref.model_dump(), "files": [f.model_dump() for f in files]}


@router.delete("/{case_id}")
async def delete_case(case_id: str, agent_id: str = "default"):
    cases_dir = _get_cases_dir(agent_id)
    index = _load_case_index(cases_dir)
    if case_id not in index:
        raise HTTPException(status_code=404, detail="Case not found")

    case_dir = cases_dir / case_id
    if case_dir.is_dir():
        import shutil
        shutil.rmtree(case_dir, ignore_errors=True)

    del index[case_id]
    _save_case_index(cases_dir, index)

    return {"status": "deleted", "case_id": case_id}


@router.post("/{case_id}/rescan")
async def rescan_case(case_id: str, agent_id: str = "default"):
    cases_dir = _get_cases_dir(agent_id)
    index = _load_case_index(cases_dir)
    if case_id not in index:
        raise HTTPException(status_code=404, detail="Case not found")

    case_ref = CaseRef.model_validate(index[case_id])
    source_path = Path(case_ref.source_path)

    supported_extensions = {
        ".pdf", ".docx", ".doc", ".xlsx", ".xls", ".pptx", ".ppt",
        ".jpg", ".jpeg", ".png", ".tiff", ".tif", ".bmp",
        ".md", ".txt", ".html", ".htm", ".csv",
    }

    file_count = 0
    total_size = 0
    if source_path.is_dir():
        for p in source_path.rglob("*"):
            if p.is_file() and p.suffix.lower() in supported_extensions:
                file_count += 1
                total_size += p.stat().st_size

    now = datetime.now(timezone.utc).isoformat()
    case_ref.file_count = file_count
    case_ref.total_size = total_size
    case_ref.last_scanned = now
    case_ref.index_status = "ready"

    case_dir = cases_dir / case_id
    ref_path = case_dir / "_ref.json"
    ref_path.write_text(
        case_ref.model_dump_json(indent=2),
        encoding="utf-8",
    )

    index[case_id] = case_ref.model_dump()
    _save_case_index(cases_dir, index)

    return {"status": "rescanned", "case": case_ref.model_dump()}


@router.post("/{case_id}/parse")
async def parse_case_files(case_id: str, agent_id: str = "default", body: CaseParseRequest = None):
    body = body or CaseParseRequest()
    cases_dir = _get_cases_dir(agent_id)
    index = _load_case_index(cases_dir)
    if case_id not in index:
        raise HTTPException(status_code=404, detail="Case not found")

    case_ref = CaseRef.model_validate(index[case_id])
    source_path = Path(case_ref.source_path)
    if not source_path.is_dir():
        raise HTTPException(status_code=400, detail="Source path no longer exists")

    case_dir = cases_dir / case_id

    case_ref.index_status = "parsing"
    index[case_id] = case_ref.model_dump()
    _save_case_index(cases_dir, index)

    async def _bg_parse():
        try:
            await _run_case_parse_pipeline(case_dir, source_path, body.scan_mode)
            idx = _load_case_index(cases_dir)
            cr = CaseRef.model_validate(idx[case_id])
            cr.index_status = "ready"
            idx[case_id] = cr.model_dump()
            _save_case_index(cases_dir, idx)
        except Exception as exc:
            logger.error("Case parse failed: %s", exc)
            idx = _load_case_index(cases_dir)
            cr = CaseRef.model_validate(idx[case_id])
            cr.index_status = "failed"
            idx[case_id] = cr.model_dump()
            _save_case_index(cases_dir, idx)

    asyncio.create_task(_bg_parse())

    return {"status": "parsing", "case_id": case_id}


@router.get("/{case_id}/parsed/{file_id:path}")
async def get_case_parsed_file(case_id: str, file_id: str, agent_id: str = "default"):
    cases_dir = _get_cases_dir(agent_id)
    case_dir = cases_dir / case_id
    if not case_dir.is_dir():
        raise HTTPException(status_code=404, detail="Case not found")

    parsed_path = case_dir / "_parsed" / f"{file_id}.md"
    if not parsed_path.is_file():
        raise HTTPException(status_code=404, detail="Parsed file not found")

    content = parsed_path.read_text(encoding="utf-8")
    return {"file_id": file_id, "content": content}


@router.get("/{case_id}/desensitized/{file_id:path}")
async def get_case_desensitized_file(case_id: str, file_id: str, agent_id: str = "default"):
    cases_dir = _get_cases_dir(agent_id)
    case_dir = cases_dir / case_id
    if not case_dir.is_dir():
        raise HTTPException(status_code=404, detail="Case not found")

    ds_path = case_dir / "_desensitized" / f"{file_id}.md"
    if not ds_path.is_file():
        raise HTTPException(status_code=404, detail="Desensitized file not found")

    content = ds_path.read_text(encoding="utf-8")
    return {"file_id": file_id, "content": content}


class RestoreRequest(BaseModel):
    authorize: bool = Field(default=False, description="User explicitly authorizes restore")


@router.post("/{case_id}/restore/{file_id:path}")
async def restore_case_file(
    case_id: str,
    file_id: str,
    agent_id: str = "default",
    body: RestoreRequest | None = None,
):
    if not body or not body.authorize:
        raise HTTPException(status_code=403, detail="Restore requires explicit authorization")

    cases_dir = _get_cases_dir(agent_id)
    case_dir = cases_dir / case_id
    if not case_dir.is_dir():
        raise HTTPException(status_code=404, detail="Case not found")

    ds_path = case_dir / "_desensitized" / f"{file_id}.md"
    if not ds_path.is_file():
        raise HTTPException(status_code=404, detail="Desensitized file not found")

    mapping = load_backfill(case_dir / "_backfill", file_id)
    if not mapping:
        raise HTTPException(status_code=404, detail="Backfill mapping not found")

    desensitized_text = ds_path.read_text(encoding="utf-8")
    restored = restore_text(desensitized_text, mapping)

    return {"file_id": file_id, "content": restored, "restored": True}


class ExportRequest(BaseModel):
    file_ids: list[str] = Field(default_factory=list, description="File IDs to export")
    restore: bool = Field(default=False, description="Restore desensitized content before export")
    authorize: bool = Field(default=False, description="User explicitly authorizes export with restore")


@router.post("/{case_id}/export")
async def export_case_files(
    case_id: str,
    agent_id: str = "default",
    body: ExportRequest | None = None,
):
    body = body or ExportRequest()
    cases_dir = _get_cases_dir(agent_id)
    case_dir = cases_dir / case_id
    if not case_dir.is_dir():
        raise HTTPException(status_code=404, detail="Case not found")

    if body.restore and not body.authorize:
        raise HTTPException(
            status_code=403,
            detail="Export with restore requires explicit authorization",
        )

    desensitized_dir = case_dir / "_desensitized"
    backfill_dir = case_dir / "_backfill"
    if not desensitized_dir.is_dir():
        raise HTTPException(status_code=404, detail="No desensitized files found")

    target_ids = body.file_ids
    if not target_ids:
        for p in desensitized_dir.glob("*.md"):
            target_ids.append(p.stem)

    results: list[dict[str, str]] = []
    for fid in target_ids:
        ds_path = desensitized_dir / f"{fid}.md"
        if not ds_path.is_file():
            results.append({"file_id": fid, "status": "not_found"})
            continue

        content = ds_path.read_text(encoding="utf-8")

        if body.restore:
            mapping = load_backfill(backfill_dir, fid)
            if mapping:
                content = restore_text(content, mapping)
            else:
                results.append({"file_id": fid, "status": "no_backfill", "note": "exported as desensitized"})
                continue

        results.append({"file_id": fid, "status": "ok", "content": content})

    return {"case_id": case_id, "results": results, "restored": body.restore}