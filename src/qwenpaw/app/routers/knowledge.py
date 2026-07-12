# -*- coding: utf-8 -*-
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Body, HTTPException, UploadFile, File, Form
from pydantic import BaseModel, Field

from ...constant import WORKING_DIR
from ...knowledge.models import (
    KnowledgeDoc,
    KnowledgeView,
    KnowledgeEnums,
    FilterRule,
)
from ...knowledge.filter_utils import filter_docs, match_hierarchical
from ...knowledge.desensitize import local_desensitize, DesensitizeRule, DEFAULT_RULES
from ...knowledge.backfill import (
    save_backfill,
    load_backfill,
    delete_backfill,
    merge_mappings,
    restore_text,
)
from ...parsers.router import ParserRouter

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/knowledge", tags=["knowledge"])

_KNOWLEDGE_BASE_DIR = WORKING_DIR / "knowledge_base"

_parser_router: ParserRouter | None = None


async def _try_start_local_mineru() -> bool:
    """Try to start the local MinerU service if it's installed but not running.

    Returns True if MinerU is now running (was already running or just started).
    """
    import os
    import sys
    import asyncio
    import subprocess

    # Check if MinerU is already running
    try:
        import httpx
        r = httpx.get("http://localhost:8000/api/v4/tasks", timeout=3)
        if r.status_code in (200, 404, 422):
            return True
    except Exception:
        pass

    # Find MinerU venv
    base = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
    venv_dir = os.path.join(base, ".mineru-venv")
    if not os.path.isdir(venv_dir):
        return False

    # Find the API command
    if sys.platform == "win32":
        api_script = os.path.join(venv_dir, "Scripts", "mineru-api.exe")
        if not os.path.isfile(api_script):
            api_script = os.path.join(venv_dir, "Scripts", "magic-pdf.exe")
            if os.path.isfile(api_script):
                cmd = [api_script, "api", "--host", "0.0.0.0", "--port", "8000"]
            else:
                return False
        else:
            cmd = [api_script, "--host", "0.0.0.0", "--port", "8000"]
    else:
        api_script = os.path.join(venv_dir, "bin", "mineru-api")
        if not os.path.isfile(api_script):
            api_script = os.path.join(venv_dir, "bin", "magic-pdf")
            if os.path.isfile(api_script):
                cmd = [api_script, "api", "--host", "0.0.0.0", "--port", "8000"]
            else:
                return False
        else:
            cmd = [api_script, "--host", "0.0.0.0", "--port", "8000"]

    # Start the process
    log_dir = os.path.join(base, "logs")
    os.makedirs(log_dir, exist_ok=True)
    log_path = os.path.join(log_dir, "mineru-api.log")

    try:
        with open(log_path, "a") as log_f:
            subprocess.Popen(
                cmd,
                stdout=log_f,
                stderr=log_f,
                stdin=subprocess.DEVNULL,
                cwd=venv_dir,
                env=os.environ.copy(),
                creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
            )
    except Exception:
        return False

    # Wait for the service to be ready (up to 30 seconds)
    for _ in range(30):
        await asyncio.sleep(1)
        try:
            r = httpx.get("http://localhost:8000/api/v4/tasks", timeout=3)
            if r.status_code in (200, 404, 422):
                return True
        except Exception:
            pass

    return False


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
            tesseract_langs = (getattr(parser_cfg, "tesseract_langs", "chi_sim+eng") or "chi_sim+eng") if parser_cfg else "chi_sim+eng"
        except Exception:
            mineru_key = ""
            mineru_url = "https://mineru.net/api/v4"
            mineru_backend = "pipeline"
            mineru_effort = "medium"
            tesseract_langs = "chi_sim+eng"
        _parser_router = ParserRouter(
            mineru_api_key=mineru_key,
            mineru_base_url=mineru_url,
            mineru_backend=mineru_backend,
            mineru_effort=mineru_effort,
            tesseract_langs=tesseract_langs,
        )
    return _parser_router


def _ensure_dirs() -> None:
    for sub in ("files", "_parsed", "_desensitized", "_backfill"):
        (_KNOWLEDGE_BASE_DIR / sub).mkdir(parents=True, exist_ok=True)


def _load_meta() -> dict[str, dict]:
    meta_path = _KNOWLEDGE_BASE_DIR / "_meta.json"
    if meta_path.is_file():
        try:
            return json.loads(meta_path.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def _save_meta(data: dict[str, dict]) -> None:
    _ensure_dirs()
    meta_path = _KNOWLEDGE_BASE_DIR / "_meta.json"
    meta_path.write_text(
        json.dumps(data, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


def _load_views() -> dict[str, dict]:
    views_path = _KNOWLEDGE_BASE_DIR / "_views.json"
    if views_path.is_file():
        try:
            return json.loads(views_path.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def _save_views(data: dict[str, dict]) -> None:
    _ensure_dirs()
    views_path = _KNOWLEDGE_BASE_DIR / "_views.json"
    views_path.write_text(
        json.dumps(data, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


def _load_enums() -> KnowledgeEnums:
    enums_path = _KNOWLEDGE_BASE_DIR / "_enums.json"
    if enums_path.is_file():
        try:
            return KnowledgeEnums.model_validate_json(
                enums_path.read_text(encoding="utf-8"),
            )
        except Exception:
            return KnowledgeEnums()
    return KnowledgeEnums()


def _save_enums(data: KnowledgeEnums) -> None:
    _ensure_dirs()
    enums_path = _KNOWLEDGE_BASE_DIR / "_enums.json"
    enums_path.write_text(
        data.model_dump_json(indent=2),
        encoding="utf-8",
    )


def _rebuild_enums(meta: dict[str, dict]) -> KnowledgeEnums:
    categories: set[str] = set()
    owners: set[str] = set()
    tags: set[str] = set()
    for doc_data in meta.values():
        doc = KnowledgeDoc.model_validate(doc_data)
        if doc.category:
            categories.add(doc.category)
        if doc.owner:
            owners.add(doc.owner)
        tags.update(doc.tags)
    enums = KnowledgeEnums(
        categories=sorted(categories),
        owners=sorted(owners),
        tags=sorted(tags),
    )
    _save_enums(enums)
    return enums


async def _run_parse_pipeline(doc_id: str, doc: KnowledgeDoc) -> None:
    file_path = _KNOWLEDGE_BASE_DIR / doc.file_path
    if not file_path.is_file():
        logger.error("File not found for parse pipeline: %s", file_path)
        return

    meta = _load_meta()
    doc = KnowledgeDoc.model_validate(meta[doc_id])
    doc.status = "parsing"
    meta[doc_id] = doc.model_dump()
    _save_meta(meta)

    try:
        parser = _get_parser()
        markdown_text = await parser.parse(file_path, parse_mode=doc.parse_mode)

        # If parse returned empty/garbage, try auto-starting MinerU and retry
        if (not markdown_text or not markdown_text.strip()
                or markdown_text.startswith("[Cannot parse:")) and parser.mineru.is_local:
            logger.info("Parse pipeline: empty result, auto-starting local MinerU for doc %s", doc_id)
            started = await _try_start_local_mineru()
            if started:
                global _parser_router
                _parser_router = None
                parser = _get_parser()
                markdown_text = await parser.parse(file_path, parse_mode=doc.parse_mode)

        # Check if we still got no usable text
        if not markdown_text or not markdown_text.strip() or markdown_text.startswith("[Cannot parse:"):
            meta = _load_meta()
            doc = KnowledgeDoc.model_validate(meta[doc_id])
            doc.status = "failed"
            if markdown_text and "API密钥认证失败" in markdown_text:
                doc.summary = "解析失败：MinerU API 密钥无效或已过期，请访问 mineru.net 重新获取密钥，然后在引擎设置中更新。"
            else:
                doc.summary = "解析失败：无法提取文本，可能是扫描版PDF。请在引擎设置中检查 OCR 引擎状态。"
            meta[doc_id] = doc.model_dump()
            _save_meta(meta)
            logger.warning("Parse pipeline: no text extracted for doc %s", doc_id)
            return

        parsed_path = _KNOWLEDGE_BASE_DIR / "_parsed" / f"{doc_id}.md"
        parsed_path.parent.mkdir(parents=True, exist_ok=True)
        parsed_path.write_text(markdown_text, encoding="utf-8")

        desensitized_text, backfill_map = local_desensitize(markdown_text)

        desensitized_path = _KNOWLEDGE_BASE_DIR / "_desensitized" / f"{doc_id}.md"
        desensitized_path.parent.mkdir(parents=True, exist_ok=True)
        desensitized_path.write_text(desensitized_text, encoding="utf-8")

        if backfill_map:
            backfill_dir = _KNOWLEDGE_BASE_DIR / "_backfill"
            save_backfill(backfill_dir, doc_id, backfill_map, encrypt=True)

        meta = _load_meta()
        doc = KnowledgeDoc.model_validate(meta[doc_id])
        doc.status = "ready"
        doc.desensitized = bool(backfill_map)
        summary = markdown_text[:200].replace("\n", " ").strip()
        doc.summary = summary
        meta[doc_id] = doc.model_dump()
        _save_meta(meta)

        logger.info("Parse pipeline completed for doc %s", doc_id)

    except Exception as exc:
        logger.error("Parse pipeline failed for doc %s: %s", doc_id, exc)
        meta = _load_meta()
        doc = KnowledgeDoc.model_validate(meta[doc_id])
        doc.status = "failed"
        meta[doc_id] = doc.model_dump()
        _save_meta(meta)


class DocListResponse(BaseModel):
    docs: list[KnowledgeDoc]
    total: int


class DocUploadRequest(BaseModel):
    tags: list[str] = []
    category: str = ""
    owner: str = ""
    parse_mode: str = "auto"


class ViewCreateRequest(BaseModel):
    name: str
    rules: list[FilterRule] = []


class ViewUpdateRequest(BaseModel):
    name: str | None = None
    rules: list[FilterRule] | None = None


class ScopeUpdateRequest(BaseModel):
    include_rules: list[FilterRule] = []
    exclude_rules: list[FilterRule] = []
    external_paths: list[dict] = []


class ParseRequest(BaseModel):
    doc_ids: list[str] = []
    parse_mode: str = "auto"
    force: bool = False


class DesensitizeRequest(BaseModel):
    doc_ids: list[str] = []
    rules: list[dict] = []
    force: bool = False


class LlmDesensitizeRequest(BaseModel):
    doc_ids: list[str] = []


class TextDesensitizeRequest(BaseModel):
    text: str = Field(..., description="Raw text content to desensitize")
    name: str = Field(default="untitled", description="Document name for reference")
    mode: str = Field(default="local", description="Desensitization mode: local / local_ai / ai")
    rules: list[dict] = Field(default_factory=list, description="Custom desensitize rules; used by local and local_ai modes")


@router.get("/docs", response_model=DocListResponse)
async def list_docs(
    category: str = "",
    owner: str = "",
    tags: str = "",
    q: str = "",
    status: str = "",
):
    meta = _load_meta()
    docs = [KnowledgeDoc.model_validate(v) for v in meta.values()]

    if category:
        docs = [d for d in docs if match_hierarchical(d.category, category)]
    if owner:
        docs = [d for d in docs if match_hierarchical(d.owner, owner)]
    if tags:
        tag_list = [t.strip() for t in tags.split(",") if t.strip()]
        docs = [d for d in docs if all(t in d.tags for t in tag_list)]
    if q:
        q_lower = q.lower()
        docs = [d for d in docs if q_lower in d.name.lower() or q_lower in d.summary.lower()]
    if status:
        docs = [d for d in docs if d.status == status]

    return DocListResponse(docs=docs, total=len(docs))


@router.post("/upload")
async def upload_doc(
    file: UploadFile = File(...),
    tags: str = Form(""),
    category: str = Form(""),
    owner: str = Form(""),
    parse_mode: str = Form("auto"),
):
    _ensure_dirs()
    doc_id = f"doc_{uuid.uuid4().hex[:12]}"
    now = datetime.now(timezone.utc).isoformat()

    file_suffix = Path(file.filename or "unknown").suffix
    dest = _KNOWLEDGE_BASE_DIR / "files" / f"{doc_id}{file_suffix}"
    with open(dest, "wb") as f:
        content = await file.read()
        f.write(content)

    checksum = hashlib.sha256(content).hexdigest()

    doc = KnowledgeDoc(
        id=doc_id,
        name=file.filename or "unknown",
        file_path=f"files/{doc_id}{file_suffix}",
        tags=[t.strip() for t in tags.split(",") if t.strip()],
        category=category,
        owner=owner,
        file_type=file_suffix.lstrip("."),
        source="upload",
        size=len(content),
        status="uploaded",
        created_at=now,
        updated_at=now,
        parse_mode=parse_mode,
        checksum=checksum,
    )

    meta = _load_meta()
    meta[doc_id] = doc.model_dump()
    _save_meta(meta)
    _rebuild_enums(meta)

    asyncio.create_task(_run_parse_pipeline(doc_id, doc))

    return {"id": doc_id, "status": "uploaded", "doc": doc.model_dump()}


@router.delete("/docs/{doc_id}")
async def delete_doc(doc_id: str):
    meta = _load_meta()
    if doc_id not in meta:
        raise HTTPException(status_code=404, detail="Document not found")

    doc = KnowledgeDoc.model_validate(meta[doc_id])

    file_path = _KNOWLEDGE_BASE_DIR / doc.file_path
    if file_path.is_file():
        file_path.unlink()

    parsed_path = _KNOWLEDGE_BASE_DIR / "_parsed" / f"{doc_id}.md"
    if parsed_path.is_file():
        parsed_path.unlink()

    desensitized_path = _KNOWLEDGE_BASE_DIR / "_desensitized" / f"{doc_id}.md"
    if desensitized_path.is_file():
        desensitized_path.unlink()

    delete_backfill(_KNOWLEDGE_BASE_DIR / "_backfill", doc_id)

    del meta[doc_id]
    _save_meta(meta)
    _rebuild_enums(meta)

    return {"status": "deleted", "id": doc_id}


@router.put("/docs/{doc_id}")
async def update_doc(doc_id: str, body: dict = Body(...)):
    meta = _load_meta()
    if doc_id not in meta:
        raise HTTPException(status_code=404, detail="Document not found")

    doc = KnowledgeDoc.model_validate(meta[doc_id])

    for field_name in ("tags", "category", "owner", "status"):
        if field_name in body:
            setattr(doc, field_name, body[field_name])

    doc.updated_at = datetime.now(timezone.utc).isoformat()
    meta[doc_id] = doc.model_dump()
    _save_meta(meta)
    _rebuild_enums(meta)

    return {"status": "updated", "doc": doc.model_dump()}


@router.get("/docs/{doc_id}/parsed")
async def get_parsed_content(doc_id: str):
    meta = _load_meta()
    if doc_id not in meta:
        raise HTTPException(status_code=404, detail="Document not found")

    parsed_path = _KNOWLEDGE_BASE_DIR / "_parsed" / f"{doc_id}.md"
    if not parsed_path.is_file():
        raise HTTPException(status_code=404, detail="Parsed content not found")

    content = parsed_path.read_text(encoding="utf-8")
    return {"doc_id": doc_id, "content": content}


@router.get("/docs/{doc_id}/desensitized")
async def get_desensitized_content(doc_id: str):
    meta = _load_meta()
    if doc_id not in meta:
        raise HTTPException(status_code=404, detail="Document not found")

    desensitized_path = _KNOWLEDGE_BASE_DIR / "_desensitized" / f"{doc_id}.md"
    if not desensitized_path.is_file():
        raise HTTPException(status_code=404, detail="Desensitized content not found")

    content = desensitized_path.read_text(encoding="utf-8")
    return {"doc_id": doc_id, "content": content}


@router.post("/docs/{doc_id}/restore")
async def restore_doc_content(doc_id: str):
    meta = _load_meta()
    if doc_id not in meta:
        raise HTTPException(status_code=404, detail="Document not found")

    desensitized_path = _KNOWLEDGE_BASE_DIR / "_desensitized" / f"{doc_id}.md"
    if not desensitized_path.is_file():
        raise HTTPException(status_code=404, detail="Desensitized content not found")

    mapping = load_backfill(_KNOWLEDGE_BASE_DIR / "_backfill", doc_id)
    if not mapping:
        raise HTTPException(status_code=404, detail="Backfill mapping not found")

    desensitized_text = desensitized_path.read_text(encoding="utf-8")
    restored = restore_text(desensitized_text, mapping)

    return {"doc_id": doc_id, "content": restored}


@router.post("/parse")
async def batch_parse(body: ParseRequest):
    meta = _load_meta()
    target_ids = body.doc_ids if body.doc_ids else list(meta.keys())
    results: list[dict] = []

    for doc_id in target_ids:
        if doc_id not in meta:
            results.append({"doc_id": doc_id, "status": "not_found"})
            continue

        doc = KnowledgeDoc.model_validate(meta[doc_id])
        if doc.status == "parsing":
            results.append({"doc_id": doc_id, "status": "already_parsing"})
            continue

        if not body.force and doc.status == "ready":
            parsed_path = _KNOWLEDGE_BASE_DIR / "_parsed" / f"{doc_id}.md"
            if parsed_path.is_file():
                results.append({"doc_id": doc_id, "status": "skipped"})
                continue

        doc.parse_mode = body.parse_mode
        meta[doc_id] = doc.model_dump()
        _save_meta(meta)

        asyncio.create_task(_run_parse_pipeline(doc_id, doc))
        results.append({"doc_id": doc_id, "status": "parsing"})

    return {"results": results}


@router.post("/desensitize")
async def batch_desensitize(body: DesensitizeRequest):
    meta = _load_meta()
    target_ids = body.doc_ids if body.doc_ids else list(meta.keys())
    results: list[dict] = []

    custom_rules: list[DesensitizeRule] | None = None
    if body.rules:
        custom_rules = []
        for r in body.rules:
            custom_rules.append(DesensitizeRule(
                name=r.get("name", "custom"),
                pattern=r.get("pattern", ""),
                placeholder=r.get("placeholder", "CUSTOM_{seq:03d}"),
                group=r.get("group", 0),
            ))

    for doc_id in target_ids:
        if doc_id not in meta:
            results.append({"doc_id": doc_id, "status": "not_found"})
            continue

        parsed_path = _KNOWLEDGE_BASE_DIR / "_parsed" / f"{doc_id}.md"
        if not parsed_path.is_file():
            results.append({"doc_id": doc_id, "status": "no_parsed_content"})
            continue

        desensitized_path = _KNOWLEDGE_BASE_DIR / "_desensitized" / f"{doc_id}.md"
        if not body.force and desensitized_path.is_file():
            results.append({"doc_id": doc_id, "status": "skipped"})
            continue

        markdown_text = parsed_path.read_text(encoding="utf-8")
        desensitized_text, backfill_map = local_desensitize(
            markdown_text, rules=custom_rules
        )

        desensitized_path.parent.mkdir(parents=True, exist_ok=True)
        desensitized_path.write_text(desensitized_text, encoding="utf-8")

        if backfill_map:
            backfill_dir = _KNOWLEDGE_BASE_DIR / "_backfill"
            existing = load_backfill(backfill_dir, doc_id) or {}
            merged = merge_mappings(existing, backfill_map)
            save_backfill(backfill_dir, doc_id, merged, encrypt=True)

        doc = KnowledgeDoc.model_validate(meta[doc_id])
        doc.desensitized = bool(backfill_map)
        doc.updated_at = datetime.now(timezone.utc).isoformat()
        meta[doc_id] = doc.model_dump()
        _save_meta(meta)

        results.append({
            "doc_id": doc_id,
            "status": "desensitized",
            "replacements": len(backfill_map),
        })

    return {"results": results}


@router.post("/desensitize-llm")
async def batch_llm_desensitize(body: LlmDesensitizeRequest):
    meta = _load_meta()
    target_ids = body.doc_ids if body.doc_ids else list(meta.keys())
    results: list[dict] = []

    from ...knowledge.desensitize_llm import llm_desensitize, get_llm_call_fn

    llm_fn = None
    try:
        llm_fn = get_llm_call_fn()
    except Exception:
        pass

    if llm_fn is None:
        raise HTTPException(
            status_code=503,
            detail="LLM service not available for desensitization",
        )

    for doc_id in target_ids:
        if doc_id not in meta:
            results.append({"doc_id": doc_id, "status": "not_found"})
            continue

        desensitized_path = _KNOWLEDGE_BASE_DIR / "_desensitized" / f"{doc_id}.md"
        if not desensitized_path.is_file():
            results.append({"doc_id": doc_id, "status": "no_desensitized_content"})
            continue

        desensitized_text = desensitized_path.read_text(encoding="utf-8")
        existing_backfill = load_backfill(
            _KNOWLEDGE_BASE_DIR / "_backfill", doc_id
        ) or {}

        new_text, new_mappings = await llm_desensitize(
            desensitized_text,
            existing_backfill=existing_backfill,
            llm_call_fn=llm_fn,
        )

        if new_mappings:
            desensitized_path.write_text(new_text, encoding="utf-8")
            merged = merge_mappings(existing_backfill, new_mappings)
            save_backfill(
                _KNOWLEDGE_BASE_DIR / "_backfill", doc_id, merged, encrypt=True
            )

        results.append({
            "doc_id": doc_id,
            "status": "llm_desensitized",
            "new_replacements": len(new_mappings),
        })

    return {"results": results}


@router.post("/desensitize-text")
async def desensitize_text(body: TextDesensitizeRequest):
    if not body.text.strip():
        raise HTTPException(status_code=400, detail="Text content cannot be empty")

    mode = body.mode or "local"
    if mode not in ("local", "local_ai", "ai"):
        raise HTTPException(status_code=400, detail="Invalid mode, must be local / local_ai / ai")

    custom_rules: list[DesensitizeRule] | None = None
    if body.rules:
        custom_rules = []
        for r in body.rules:
            custom_rules.append(DesensitizeRule(
                name=r.get("name", "custom"),
                pattern=r.get("pattern", ""),
                placeholder=r.get("placeholder", "CUSTOM_{seq:03d}"),
                group=r.get("group", 0),
            ))

    desensitized_text = body.text
    backfill_map: dict[str, str] = {}

    if mode in ("local", "local_ai"):
        desensitized_text, backfill_map = local_desensitize(
            body.text, rules=custom_rules
        )

    if mode in ("local_ai", "ai"):
        try:
            from ...knowledge.desensitize_llm import get_llm_call_fn
            llm_fn = get_llm_call_fn()
        except Exception:
            raise HTTPException(
                status_code=503,
                detail="LLM service not available. Please configure a model provider in Settings > Models.",
            )

        from ...knowledge.desensitize_llm import llm_desensitize
        existing = backfill_map if mode == "local_ai" else {}
        desensitized_text, llm_mappings = await llm_desensitize(
            desensitized_text,
            existing_backfill=existing,
            llm_call_fn=llm_fn,
            ai_only=(mode == "ai"),
        )
        backfill_map.update(llm_mappings)

    return {
        "original_text": body.text,
        "desensitized_text": desensitized_text,
        "backfill_map": backfill_map,
        "replacements": len(backfill_map),
        "mode": mode,
    }


@router.post("/parse-file")
async def parse_file_for_desensitize(
    file: UploadFile = File(...),
    parse_mode: str = Form("auto"),
):
    import tempfile

    suffix = Path(file.filename or "unknown").suffix.lower()
    supported = {".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx",
                 ".txt", ".md", ".csv", ".json", ".log", ".rtf", ".html", ".htm"}
    if suffix not in supported:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {suffix}")

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = Path(tmp.name)

    try:
        parser = _get_parser()
        text = await parser.parse(tmp_path, parse_mode=parse_mode)

        # If parse returned empty/garbage, try auto-starting MinerU and retry
        if (not text or not text.strip() or text.startswith("[Cannot parse:")) and parser.mineru.is_local:
            import logging as _logging
            _logger = _logging.getLogger(__name__)
            _logger.info("Parse failed, attempting to auto-start local MinerU service...")
            started = await _try_start_local_mineru()
            if started:
                _logger.info("MinerU service started, retrying parse...")
                # Invalidate cached router so it picks up the running MinerU
                global _parser_router
                _parser_router = None
                parser = _get_parser()
                text = await parser.parse(tmp_path, parse_mode=parse_mode)

        if not text or not text.strip() or text.startswith("[Cannot parse:") or text.startswith("[Cannot OCR:"):
            # Build a helpful error message based on engine availability
            diag = parser.get_diagnostics()

            # Check for specific error patterns in the returned text
            if text and "API密钥认证失败" in text:
                raise HTTPException(
                    status_code=422,
                    detail="MinerU API 密钥认证失败，该密钥无效或已过期。请访问 mineru.net 重新获取有效的 API 密钥，然后在「引擎设置 > MinerU 引擎」中更新密钥。",
                )

            engine_status = []
            if diag.get("mineru", {}).get("available"):
                if diag["mineru"].get("is_local"):
                    engine_status.append("MinerU 本地服务未运行")
                else:
                    engine_status.append("MinerU 云端已配置但解析失败")
            else:
                engine_status.append("MinerU 未配置")
            if diag.get("tesseract", {}).get("available"):
                engine_status.append("Tesseract 已就绪但解析失败")
            else:
                engine_status.append("Tesseract 未安装")

            raise HTTPException(
                status_code=422,
                detail=(
                    f"无法提取文本，该文件可能是扫描版PDF或图片格式。"
                    f"引擎状态：{'; '.join(engine_status)}。"
                    f"请尝试：1) 启动本地 MinerU 服务；"
                    f"2) 在「引擎设置」中配置 MinerU 云端 API；"
                    f"3) 上传带有可选文字层的PDF。"
                ),
            )

        return {"text": text, "filename": file.filename, "chars": len(text)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse file: {e}")
    finally:
        tmp_path.unlink(missing_ok=True)


@router.get("/enums", response_model=KnowledgeEnums)
async def get_enums():
    return _load_enums()


@router.post("/enums")
async def create_enum(body: dict = Body(...)):
    field_name = body.get("field", "")
    value = body.get("value", "")
    if field_name not in ("categories", "owners", "tags") or not value:
        raise HTTPException(status_code=400, detail="Invalid field or value")

    enums = _load_enums()
    current_list = getattr(enums, field_name)
    if value not in current_list:
        current_list.append(value)
        current_list.sort()
        setattr(enums, field_name, current_list)
        _save_enums(enums)

    return {"status": "created", "enums": enums.model_dump()}


@router.delete("/enums/{field_name}/{value:path}")
async def delete_enum(field_name: str, value: str):
    if field_name not in ("categories", "owners", "tags"):
        raise HTTPException(status_code=400, detail="Invalid field")

    enums = _load_enums()
    current_list = getattr(enums, field_name)
    if value in current_list:
        current_list.remove(value)
        setattr(enums, field_name, current_list)
        _save_enums(enums)

    return {"status": "deleted", "enums": enums.model_dump()}


@router.get("/views")
async def list_views():
    views_data = _load_views()
    views = [KnowledgeView.model_validate(v) for v in views_data.values()]
    return {"views": [v.model_dump() for v in views]}


@router.post("/views")
async def create_view(body: ViewCreateRequest):
    views_data = _load_views()
    view_id = f"view_{uuid.uuid4().hex[:8]}"
    order = len(views_data)
    view = KnowledgeView(
        id=view_id,
        name=body.name,
        rules=body.rules,
        order=order,
    )
    views_data[view_id] = view.model_dump()
    _save_views(views_data)
    return {"id": view_id, "view": view.model_dump()}


@router.put("/views/{view_id}")
async def update_view(view_id: str, body: ViewUpdateRequest):
    views_data = _load_views()
    if view_id not in views_data:
        raise HTTPException(status_code=404, detail="View not found")

    view = KnowledgeView.model_validate(views_data[view_id])
    if body.name is not None:
        view.name = body.name
    if body.rules is not None:
        view.rules = body.rules

    views_data[view_id] = view.model_dump()
    _save_views(views_data)
    return {"status": "updated", "view": view.model_dump()}


@router.delete("/views/{view_id}")
async def delete_view(view_id: str):
    views_data = _load_views()
    if view_id not in views_data:
        raise HTTPException(status_code=404, detail="View not found")

    del views_data[view_id]
    _save_views(views_data)
    return {"status": "deleted"}


@router.get("/scope")
async def get_scope(agent_id: str = "default"):
    from ...config import load_config

    config = load_config()
    profile = config.agents.profiles.get(agent_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Agent not found")

    from ...config.config import AgentProfileConfig
    workspace_dir = Path(profile.workspace_dir)
    agent_json = workspace_dir / "agent.json"
    if not agent_json.is_file():
        return {"include_rules": [], "exclude_rules": [], "external_paths": []}

    try:
        agent_data = json.loads(agent_json.read_text(encoding="utf-8"))
        agent_config = AgentProfileConfig.model_validate(agent_data)
        scope = agent_config.documents.knowledge_scope
        if scope is None:
            return {"include_rules": [], "exclude_rules": [], "external_paths": []}
        return scope.model_dump()
    except Exception:
        return {"include_rules": [], "exclude_rules": [], "external_paths": []}


@router.put("/scope")
async def update_scope(agent_id: str = "default", body: ScopeUpdateRequest = None):
    from ...config import load_config

    config = load_config()
    profile = config.agents.profiles.get(agent_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Agent not found")

    from ...config.config import AgentProfileConfig, KnowledgeScopeConfig
    workspace_dir = Path(profile.workspace_dir)
    agent_json = workspace_dir / "agent.json"
    if not agent_json.is_file():
        raise HTTPException(status_code=404, detail="agent.json not found")

    try:
        agent_data = json.loads(agent_json.read_text(encoding="utf-8"))
        agent_config = AgentProfileConfig.model_validate(agent_data)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to load agent config: {exc}")

    scope = KnowledgeScopeConfig(
        include_rules=body.include_rules,
        exclude_rules=body.exclude_rules,
        external_paths=body.external_paths,
    )
    agent_config.documents.knowledge_scope = scope

    agent_data = agent_config.model_dump(mode="json")
    agent_json.write_text(
        json.dumps(agent_data, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    return {"status": "updated", "scope": scope.model_dump()}


@router.post("/scan-folder")
async def scan_folder(body: dict = Body(...)):
    folder_path = body.get("path", "")
    if not folder_path:
        raise HTTPException(status_code=400, detail="Path is required")

    path = Path(folder_path)
    if not path.is_dir():
        raise HTTPException(status_code=400, detail="Path is not a directory")

    supported_extensions = {
        ".pdf", ".docx", ".doc", ".xlsx", ".xls", ".pptx", ".ppt",
        ".jpg", ".jpeg", ".png", ".tiff", ".tif", ".bmp",
        ".md", ".txt", ".html", ".htm", ".csv",
    }

    files = []
    for p in sorted(path.rglob("*")):
        if p.is_file() and p.suffix.lower() in supported_extensions:
            files.append({
                "name": p.name,
                "path": str(p),
                "size": p.stat().st_size,
                "type": p.suffix.lower().lstrip("."),
            })

    return {"path": folder_path, "file_count": len(files), "files": files}


_CUSTOM_RULES_FILE = WORKING_DIR / ".aiarb" / "knowledge" / "_desensitize_rules.json"


@router.get("/desensitize-rules")
async def get_desensitize_rules():
    if _CUSTOM_RULES_FILE.is_file():
        data = json.loads(_CUSTOM_RULES_FILE.read_text(encoding="utf-8"))
        return {"rules": data, "source": "custom"}
    rules = [
        {
            "name": r.name,
            "pattern": r.pattern,
            "placeholder": r.placeholder,
            "group": r.group,
        }
        for r in DEFAULT_RULES
    ]
    return {"rules": rules, "source": "default"}


class DesensitizeRulesRequest(BaseModel):
    rules: list[dict] = Field(default_factory=list)


@router.put("/desensitize-rules")
async def update_desensitize_rules(body: DesensitizeRulesRequest):
    _CUSTOM_RULES_FILE.parent.mkdir(parents=True, exist_ok=True)
    _CUSTOM_RULES_FILE.write_text(
        json.dumps(body.rules, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return {"status": "ok", "rules": body.rules}


@router.get("/desensitize/active-model")
async def get_desensitize_active_model():
    """Get the currently active AI model info for desensitization features."""
    try:
        from ...providers.provider_manager import ProviderManager
        manager = ProviderManager.get_instance()
        model_config = manager.get_active_model()
        if not model_config or not model_config.provider_id or not model_config.model:
            return {
                "status": "ok",
                "has_model": False,
                "provider_id": "",
                "model": "",
                "hint": "No AI model configured",
            }
        return {
            "status": "ok",
            "has_model": True,
            "provider_id": model_config.provider_id,
            "model": model_config.model,
            "display_name": f"{model_config.provider_id} / {model_config.model}",
        }
    except Exception:
        return {
            "status": "ok",
            "has_model": False,
            "provider_id": "",
            "model": "",
            "hint": "Failed to load model config",
        }


@router.post("/desensitize-rules/reset")
async def reset_desensitize_rules():
    if _CUSTOM_RULES_FILE.is_file():
        _CUSTOM_RULES_FILE.unlink()
    rules = [
        {
            "name": r.name,
            "pattern": r.pattern,
            "placeholder": r.placeholder,
            "group": r.group,
        }
        for r in DEFAULT_RULES
    ]
    return {"status": "ok", "rules": rules}


class AIRulesGenerateRequest(BaseModel):
    description: str = Field(..., description="Natural language description of the desensitization rules needed")


@router.post("/desensitize-rules/generate-ai")
async def generate_ai_rules(body: AIRulesGenerateRequest):
    """Generate desensitization rules from natural language description using AI."""
    # Check if model is configured first
    try:
        from ...providers.provider_manager import ProviderManager
        model_config = ProviderManager.get_instance().get_active_model()
        if not model_config or not model_config.provider_id or not model_config.model:
            raise HTTPException(
                status_code=428,
                detail="No AI model configured. Please go to Settings → Models to select a model first.",
            )
    except HTTPException:
        raise
    except Exception:
        pass

    try:
        from ...knowledge.desensitize_llm import get_llm_call_fn
    except ImportError:
        raise HTTPException(
            status_code=500,
            detail="AI module not available. Please check your installation.",
        )

    try:
        llm_call = get_llm_call_fn()
    except Exception as e:
        logger.exception("Failed to initialize LLM call function")
        raise HTTPException(
            status_code=428,
            detail=f"AI model not available: {str(e)}. Please go to Settings → Models to configure a model.",
        )

    prompt = _build_rule_generation_prompt(body.description)
    try:
        result = await llm_call(prompt)
    except Exception as e:
        logger.exception("AI rule generation failed")
        error_msg = str(e)
        if "No active model" in error_msg or "provider" in error_msg.lower():
            raise HTTPException(
                status_code=428,
                detail="No AI model configured. Please go to Settings → Models to select a model first.",
            )
        raise HTTPException(status_code=500, detail=f"AI generation failed: {error_msg}")

    # Parse the AI output into rule objects
    parsed_rules = _parse_generated_rules(result)
    if not parsed_rules:
        raise HTTPException(status_code=422, detail="AI did not generate valid rules. Please try a more specific description.")

    return {"status": "ok", "rules": parsed_rules, "raw_output": result}


def _build_rule_generation_prompt(description: str) -> str:
    """Build the prompt for AI rule generation."""
    return f"""你是一个正则表达式专家，擅长识别中文文本中的敏感信息类型。请根据用户的需求描述，生成对应的脱敏规则。

每个规则需要包含以下字段：
- name: 英文规则名称（snake_case）
- pattern: 用于匹配的正则表达式
- placeholder: 替换占位符，使用 {{seq:03d}} 表示序号（如 ID_{{seq:03d}}、PHONE_{{seq:03d}}）
- group: 捕获组编号，0 表示整个匹配（通常为 0）

请以 JSON 数组格式返回，不要包含任何其他文字说明。每个规则必须是一个完整的 JSON 对象。

以下是一些参考规则示例：
```json
[
  {{"name": "id_card", "pattern": "[1-9]\\\\d{{5}}(?:19|20)\\\\d{{2}}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\\d|3[01])\\\\d{{3}}[\\dXx]", "placeholder": "ID_{{seq:03d}}", "group": 0}},
  {{"name": "phone", "pattern": "(?<!\\d)1[3-9]\\d{{9}}(?!\\d)", "placeholder": "PHONE_{{seq:03d}}", "group": 0}},
  {{"name": "email", "pattern": "[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\\\.[a-zA-Z]{{2,}}", "placeholder": "EMAIL_{{seq:03d}}", "group": 0}},
  {{"name": "bank_card", "pattern": "(?<!\\d)[1-9]\\d{{14,18}}(?!\\d)", "placeholder": "BANK_{{seq:03d}}", "group": 0}}
]
```

现在，用户的需求描述是：

{description}

请生成对应的脱敏规则，直接返回 JSON 数组（不要包含 markdown 代码块标记）。"""


def _parse_generated_rules(raw_output: str) -> list[dict]:
    """Parse AI-generated text into a list of rule dicts."""
    import re as _re

    # Strip markdown code fences if present
    cleaned = raw_output.strip()
    if cleaned.startswith("```"):
        cleaned = _re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = _re.sub(r"\s*```$", "", cleaned)

    try:
        parsed = json.loads(cleaned)
        if isinstance(parsed, list):
            # Validate each rule has required fields
            valid_rules = []
            for item in parsed:
                if isinstance(item, dict) and all(k in item for k in ("name", "pattern", "placeholder")):
                    valid_rules.append({
                        "name": str(item["name"]),
                        "pattern": str(item["pattern"]),
                        "placeholder": str(item["placeholder"]),
                        "group": int(item.get("group", 0)),
                    })
            return valid_rules
    except json.JSONDecodeError:
        # Try to extract JSON array from text
        match = _re.search(r"\[[\s\S]*\]", raw_output)
        if match:
            try:
                parsed = json.loads(match.group())
                if isinstance(parsed, list):
                    return [
                        {
                            "name": str(item["name"]),
                            "pattern": str(item["pattern"]),
                            "placeholder": str(item["placeholder"]),
                            "group": int(item.get("group", 0)),
                        }
                        for item in parsed
                        if isinstance(item, dict) and all(k in item for k in ("name", "pattern", "placeholder"))
                    ]
            except json.JSONDecodeError:
                pass

    return []


class KnowledgeExportRequest(BaseModel):
    doc_ids: list[str] = Field(default_factory=list, description="Document IDs to export")
    restore: bool = Field(default=False, description="Restore desensitized content before export")
    authorize: bool = Field(default=False, description="User explicitly authorizes export with restore")


@router.post("/export")
async def export_knowledge_docs(body: KnowledgeExportRequest | None = None):
    body = body or KnowledgeExportRequest()
    meta = _load_meta()

    if body.restore and not body.authorize:
        raise HTTPException(
            status_code=403,
            detail="Export with restore requires explicit authorization",
        )

    target_ids = body.doc_ids if body.doc_ids else list(meta.keys())
    desensitized_dir = _KNOWLEDGE_BASE_DIR / "_desensitized"
    backfill_dir = _KNOWLEDGE_BASE_DIR / "_backfill"

    results: list[dict] = []
    for doc_id in target_ids:
        if doc_id not in meta:
            results.append({"doc_id": doc_id, "status": "not_found"})
            continue

        ds_path = desensitized_dir / f"{doc_id}.md"
        if not ds_path.is_file():
            results.append({"doc_id": doc_id, "status": "no_desensitized"})
            continue

        content = ds_path.read_text(encoding="utf-8")

        if body.restore:
            mapping = load_backfill(backfill_dir, doc_id)
            if mapping:
                content = restore_text(content, mapping)
            else:
                results.append({
                    "doc_id": doc_id,
                    "status": "no_backfill",
                    "note": "exported as desensitized",
                })
                continue

        doc = KnowledgeDoc.model_validate(meta[doc_id])
        results.append({
            "doc_id": doc_id,
            "name": doc.name,
            "status": "ok",
            "content": content,
            "restored": body.restore,
        })

    return {"results": results, "total": len(results), "restored": body.restore}


@router.post("/ocr-try")
async def ocr_try(file: UploadFile = File(...), engine: str = "auto"):
    import tempfile

    suffix = Path(file.filename or "unknown").suffix.lower()
    ocr_supported = {".pdf", ".jpg", ".jpeg", ".png", ".tiff", ".tif", ".bmp", ".webp"}
    if suffix not in ocr_supported:
        raise HTTPException(status_code=400, detail=f"OCR unsupported file type: {suffix}")

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = Path(tmp.name)

    used_engine = engine
    diagnostics: dict = {}
    try:
        parser = _get_parser()

        # Report all available OCR engines
        if parser.mineru.available:
            mode = "local" if parser.mineru.is_local else "cloud"
            diagnostics["mineru"] = f"available ({mode} mode)"
        else:
            diagnostics["mineru"] = "not configured (no API key)"

        tess_diag = parser.tesseract.get_diagnostics()
        diagnostics["tesseract"] = tess_diag

        text = await parser.parse(tmp_path)

        # If parse failed, try auto-starting MinerU and retry
        if (not text or text.startswith("[Cannot parse:") or text.startswith("[MinerU:")) and parser.mineru.is_local:
            logger.info("OCR try failed, attempting to auto-start local MinerU...")
            started = await _try_start_local_mineru()
            if started:
                global _parser_router
                _parser_router = None
                parser = _get_parser()
                text = await parser.parse(tmp_path)

        if not text or text.startswith("[Cannot parse:") or text.startswith("[MinerU:") or text.startswith("[Cannot OCR:"):
            used_engine = "none"
        else:
            # Determine which engine actually produced the text
            if parser.mineru.available:
                used_engine = "local_mineru" if parser.mineru.is_local else "cloud_mineru"
            elif parser.tesseract.available:
                used_engine = "tesseract"
            else:
                used_engine = "native"

        diagnostics["ocr_engine"] = parser.ocr_engine_name
        return {"text": text or "", "engine": used_engine, "diagnostics": diagnostics}
    except Exception as e:
        logger.error("OCR try failed: %s", e)
        return {"text": "", "error": str(e), "engine": used_engine, "diagnostics": diagnostics}
    finally:
        try:
            tmp_path.unlink()
        except Exception:
            pass