# -*- coding: utf-8 -*-
"""Document tools API — LDIR intake pipeline + redaction.

Exposes the A4 (LDIR document pipeline) and A5 (redaction module)
as REST endpoints so the console frontend can:

- Upload a document and run the full intake pipeline → 4 artifacts
- Detect document type from pasted text
- Run redaction on text or uploaded files
- List supported entity types, policies, and modes
- Restore redacted text via mapping file
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Body, File, Form, HTTPException, UploadFile, Request
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/document-tools", tags=["document-tools"])

# -- Helpers ----------------------------------------------------------------

_ALLOWED_INTAKE_EXT = {".pdf", ".txt", ".md", ".markdown", ".docx", ".doc", ".html", ".htm"}
_MAX_UPLOAD_SIZE = 50 * 1024 * 1024  # 50 MB


def _ensure_upload_dir() -> Path:
    """Return a temp directory for uploaded files."""
    d = Path(tempfile.gettempdir()) / "aiarb-document-tools"
    d.mkdir(parents=True, exist_ok=True)
    return d


# -- Pydantic models --------------------------------------------------------

class IntakeTextRequest(BaseModel):
    text: str = Field(..., description="Raw text to analyze for document type")
    doc_id: str = Field(default="pasted_text", description="Document ID for the LDIR output")


class RedactTextRequest(BaseModel):
    text: str = Field(..., description="Text to redact")
    policy: str = Field(default="external_client", description="Redaction policy name")
    entity_types: Optional[list[str]] = Field(default=None, description="Entity types to detect")
    custom_rules: Optional[dict[str, str]] = Field(default=None, description="Custom rule overrides")
    strength_level: Optional[str] = Field(default=None, description="L1/L2/L3/L4 strength level")


class RestoreTextRequest(BaseModel):
    text: str = Field(..., description="Redacted text to restore")
    mapping_json: str = Field(..., description="Mapping file content (JSON string)")


class DocTypeDetectRequest(BaseModel):
    text: str = Field(..., description="Text to analyze")


# -- A4: Document Intake Pipeline -------------------------------------------


@router.post("/intake/upload", summary="Upload and run intake pipeline")
async def intake_upload(
    file: UploadFile = File(...),
    output_dir: Optional[str] = Form(default=None),
) -> dict[str, Any]:
    """Upload a document and run the full LDIR intake pipeline.

    Produces 4 artifacts:
    1. ``{doc_id}.md`` — human-readable text
    2. ``{doc_id}.ldir.json`` — machine-readable LDIR
    3. ``{doc_id}.semantic.json`` — semantic metadata
    4. ``{doc_id}_intake_report.json`` — quality report
    """
    # Validate extension
    original_name = file.filename or "unknown"
    ext = Path(original_name).suffix.lower()
    if ext not in _ALLOWED_INTAKE_EXT:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {ext}. Supported: {sorted(_ALLOWED_INTAKE_EXT)}",
        )

    # Read content
    content = await file.read()
    if len(content) > _MAX_UPLOAD_SIZE:
        raise HTTPException(status_code=413, detail="File too large (max 50MB)")
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")

    # Save to temp
    upload_dir = _ensure_upload_dir()
    src_path = upload_dir / original_name
    src_path.write_bytes(content)

    # Determine working directory
    if output_dir:
        work_dir = Path(output_dir)
    else:
        work_dir = upload_dir / f"{src_path.stem}_working"

    try:
        from aiarb.document.intake import intake_document

        result = intake_document(src_path, work_dir)
        result.save_all()

        return {
            "success": True,
            "doc_id": result.ldir.doc_id,
            "doc_type": result.ldir.doc_type,
            "doc_type_label": _doc_type_label(result.ldir.doc_type),
            "doc_type_confidence": result.ldir.doc_type_confidence,
            "source_hash": result.ldir.source_hash,
            "page_count": result.report.page_count,
            "block_count": result.report.block_count,
            "char_count": result.report.char_count,
            "ocr_engine": result.report.ocr_engine,
            "ocr_confidence": result.report.ocr_confidence,
            "human_review_recommended": result.report.human_review_recommended,
            "warnings": result.report.warnings,
            "recommendations": result.report.recommendations,
            "markdown_preview": result.markdown[:2000],
            "semantic_summary": {
                "chunk_count": result.semantic.get("chunk_count", 0),
                "entity_count": result.semantic.get("entity_count", 0),
                "clause_ref_count": result.semantic.get("clause_ref_count", 0),
                "has_article_structure": result.semantic.get("statistics", {}).get(
                    "has_article_structure", False,
                ),
            },
            "outputs": {
                "markdown": str(result.md_path),
                "ldir_json": str(result.ldir_path),
                "semantic_json": str(result.semantic_path),
                "intake_report": str(result.report_path),
            },
        }
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("Intake pipeline failed")
        raise HTTPException(status_code=500, detail=f"Intake failed: {e}")


@router.post("/intake/text", summary="Analyze pasted text for document type")
async def intake_text(req: IntakeTextRequest) -> dict[str, Any]:
    """Analyze pasted text: infer document type and extract basic entities.

    This is a lightweight version of the intake pipeline that works on
    pasted text without file upload — useful for quick document type
    detection and entity preview.
    """
    try:
        from aiarb.document.doc_type import infer_doc_type, doc_type_label

        type_result = infer_doc_type(req.text)

        # Also run entity extraction for preview
        try:
            from aiarb.document.semantic.entity_extractor import LegalEntityExtractor

            extractor = LegalEntityExtractor()
            entities = extractor.extract(req.text)
            entity_summary: list[dict[str, Any]] = []
            seen_types: dict[str, int] = {}
            for e in entities[:30]:
                seen_types[e.type] = seen_types.get(e.type, 0) + 1
                entity_summary.append({
                    "type": e.type,
                    "text": e.text[:100],
                    "normalized": e.normalized[:100] if e.normalized else "",
                    "confidence": e.confidence,
                })
        except Exception:
            entity_summary = []
            seen_types = {}

        return {
            "success": True,
            "doc_type": type_result.doc_type,
            "doc_type_label": doc_type_label(type_result.doc_type),
            "confidence": type_result.confidence,
            "matched_keywords": [
                {"keyword": kw, "doc_type": dt, "count": c}
                for kw, dt, c in type_result.matched_keywords
            ],
            "char_count": len(req.text),
            "entity_preview": entity_summary,
            "entity_type_counts": seen_types,
        }
    except Exception as e:
        logger.exception("Text intake failed")
        raise HTTPException(status_code=500, detail=f"Analysis failed: {e}")


@router.get("/intake/result/{doc_id}", summary="Read intake artifacts")
async def get_intake_result(doc_id: str) -> dict[str, Any]:
    """Read previously generated intake artifacts by doc_id.

    Looks in the upload temp directory for ``{doc_id}_working/``.
    """
    upload_dir = _ensure_upload_dir()
    work_dir = upload_dir / f"{doc_id}_working"

    if not work_dir.exists():
        raise HTTPException(status_code=404, detail=f"No intake results for doc_id: {doc_id}")

    md_path = work_dir / f"{doc_id}.md"
    ldir_path = work_dir / f"{doc_id}.ldir.json"
    semantic_path = work_dir / f"{doc_id}.semantic.json"
    report_path = work_dir / f"{doc_id}_intake_report.json"

    result: dict[str, Any] = {"doc_id": doc_id, "working_dir": str(work_dir)}

    if md_path.exists():
        result["markdown"] = md_path.read_text(encoding="utf-8")
    if ldir_path.exists():
        result["ldir"] = json.loads(ldir_path.read_text(encoding="utf-8"))
    if semantic_path.exists():
        result["semantic"] = json.loads(semantic_path.read_text(encoding="utf-8"))
    if report_path.exists():
        result["report"] = json.loads(report_path.read_text(encoding="utf-8"))

    return result


# -- A5: Redaction API ------------------------------------------------------


@router.post("/redact/text", summary="Redact text")
async def redact_text(req: RedactTextRequest) -> dict[str, Any]:
    """Run redaction on plain text.

    Returns the redacted text, entity mappings, and review items.
    """
    try:
        from aiarb.redaction.agent import redact_text as _redact

        result = _redact(
            text=req.text,
            policy=req.policy,
            entity_types=req.entity_types,
            custom_rules=req.custom_rules,
            strength_level=req.strength_level,
        )
        return result
    except Exception as e:
        logger.exception("Text redaction failed")
        raise HTTPException(status_code=500, detail=f"Redaction failed: {e}")


class AgentRedactTextRequest(BaseModel):
    """Request body for agent-enhanced text redaction."""
    text: str = Field(..., min_length=1, description="Text to redact")
    policy: str = Field(default="external_client", description="Redaction policy")
    entity_types: Optional[str] = Field(
        default=None,
        description='JSON array or comma-separated list of entity types to detect',
    )
    custom_rules: Optional[dict] = Field(
        default=None,
        description="Custom redaction rules to override policy defaults",
    )
    strength_level: Optional[str] = Field(
        default=None,
        description="Strength level L1-L4 (overrides policy defaults)",
    )
    provider_id: Optional[str] = Field(
        default=None,
        description="Optional: override LLM provider ID (from aiarb config)",
    )
    model_id: Optional[str] = Field(
        default=None,
        description="Optional: override LLM model ID (from aiarb config)",
    )


@router.post("/redact/agent-enhanced", summary="Agent-enhanced redaction with LLM review")
async def agent_enhanced_redact_text(req: AgentRedactTextRequest) -> dict[str, Any]:
    """Run agent-enhanced redaction on plain text.

    This endpoint combines rule-based redaction with LLM deep semantic review:
    - Phase 1: Standard rule-based redaction (fast)
    - Phase 2: LLM reviews for missed entities, over-redactions, consistency
    - Phase 3: Merged result with agent suggestions

    The agent mode is the core differentiator of aiarb's multi-agent architecture:
    it leverages the configured (or user-specified) LLM model to provide intelligence
    that pure rules cannot achieve. Users can select a specific model via provider_id/model_id.
    """
    try:
        from aiarb.redaction.agent import agent_enhanced_redact

        et_list: Optional[list] = None
        if req.entity_types:
            import json
            try:
                et_list = json.loads(req.entity_types)
            except json.JSONDecodeError:
                et_list = [t.strip() for t in req.entity_types.split(",") if t.strip()]

        # agent_enhanced_redact is async — call it directly
        result = await agent_enhanced_redact(
            text=req.text,
            policy=req.policy,
            entity_types=et_list,
            custom_rules=req.custom_rules,
            strength_level=req.strength_level,
            provider_id=req.provider_id,
            model_id=req.model_id,
        )
        return result
    except Exception as e:
        logger.exception("Agent enhanced redaction failed")
        raise HTTPException(status_code=500, detail=f"Agent redaction failed: {e}")


@router.post("/redact/upload", summary="Upload and redact a file")
async def redact_upload(
    file: UploadFile = File(...),
    policy: str = Form(default="external_client"),
    entity_types: Optional[str] = Form(default=None),
    strength_level: Optional[str] = Form(default=None),
    output_format: Optional[str] = Form(default=None),
    document_name: Optional[str] = Form(default=None),
) -> dict[str, Any]:
    """Upload a file, run redaction, and return the redacted text + mappings.

    For PDF files, also produces a redacted PDF.
    """
    original_name = file.filename or "unknown"
    content = await file.read()
    if len(content) > _MAX_UPLOAD_SIZE:
        raise HTTPException(status_code=413, detail="File too large (max 50MB)")
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")

    upload_dir = _ensure_upload_dir()
    src_path = upload_dir / original_name
    src_path.write_bytes(content)

    et_list: Optional[list[str]] = None
    if entity_types:
        try:
            et_list = json.loads(entity_types)
        except json.JSONDecodeError:
            et_list = [t.strip() for t in entity_types.split(",") if t.strip()]

    try:
        from aiarb.redaction.agent import redact_file as _redact_file

        result = _redact_file(
            file_path=str(src_path),
            policy=policy,
            entity_types=et_list,
            strength_level=strength_level,
        )

        # 如果提供了文档名称，附加到结果中
        if document_name:
            result["document_name"] = document_name

        # 如果指定了输出格式，附加到结果中
        if output_format:
            result["output_format"] = output_format

        return result
    except Exception as e:
        logger.exception("File redaction failed")
        raise HTTPException(status_code=500, detail=f"Redaction failed: {e}")


@router.post("/redact/batch", summary="Batch redact multiple files (SSE streaming)")
async def redact_batch(
    request: Request,
    policy: str = Form(default="external_client"),
    entity_types: Optional[str] = Form(default=None),
    strength_level: Optional[str] = Form(default=None),
):
    """Upload multiple files and run batch redaction with SSE streaming progress.

    Returns a Server-Sent Events stream where each event is a JSON object:
    - {type: "progress", file: "...", status: "processing"}
    - {type: "result", file: "...", success: true, entity_count: N, output_file: "..."}
    - {type: "error", file: "...", error: "..."}
    - {type: "done", total_files: N, success_count: N, fail_count: N, total_entity_count: N}
    """
    from fastapi.responses import StreamingResponse
    import json as _json

    async def event_stream():
        # Parse multipart form
        form = await request.form()
        upload_files = []
        for key, value in form.items():
            if hasattr(value, "filename") and hasattr(value, "read"):
                upload_files.append(value)

        if not upload_files:
            yield f"data: {_json.dumps({'type': 'error', 'error': 'No files uploaded'}, ensure_ascii=False)}\n\n"
            return

        upload_dir = _ensure_upload_dir()
        batch_dir = upload_dir / f"batch_{__import__('time').time():.0f}"
        batch_dir.mkdir(parents=True, exist_ok=True)

        et_list: Optional[list[str]] = None
        if entity_types:
            try:
                et_list = _json.loads(entity_types)
            except _json.JSONDecodeError:
                et_list = [t.strip() for t in entity_types.split(",") if t.strip()]

        from aiarb.redaction.agent import redact_file as _redact_file
        import asyncio
        from concurrent.futures import ThreadPoolExecutor

        loop = asyncio.get_event_loop()
        executor = ThreadPoolExecutor(max_workers=4)
        total_files = len(upload_files)
        success_count = 0
        fail_count = 0
        total_entities = 0

        def process_one(upload_file) -> dict:
            original_name = getattr(upload_file, "filename", None) or "unknown"
            try:
                content = upload_file.read() if hasattr(upload_file, "read") else b""
            except Exception as e:
                return {"success": False, "error": f"Read error: {e}", "file": original_name}
            if not content:
                return {"success": False, "error": "Empty file", "file": original_name}

            src_path = batch_dir / original_name
            try:
                src_path.write_bytes(content)
            except Exception as e:
                return {"success": False, "error": f"Write error: {e}", "file": original_name}

            try:
                result = _redact_file(
                    file_path=str(src_path),
                    policy=policy,
                    entity_types=et_list,
                    strength_level=strength_level,
                )
                result["file"] = original_name
                return result
            except Exception as e:
                logger.exception(f"Batch redaction failed for {original_name}")
                return {"success": False, "error": str(e), "file": original_name}

        # Send start event
        yield f"data: {_json.dumps({'type': 'start', 'total_files': total_files}, ensure_ascii=False)}\n\n"

        # Process files one by one (for streaming progress)
        for idx, uf in enumerate(upload_files):
            # Send progress event
            filename = getattr(uf, "filename", None) or f"file_{idx}"
            yield f"data: {_json.dumps({'type': 'progress', 'file': filename, 'index': idx + 1, 'total': total_files}, ensure_ascii=False)}\n\n"

            # Run in thread pool to avoid blocking event loop
            result = await loop.run_in_executor(executor, lambda u=uf: process_one(u))

            # Send per-file result event
            if result.get("success"):
                success_count += 1
                total_entities += result.get("entity_count", 0)
            else:
                fail_count += 1

            yield f"data: {_json.dumps({'type': 'result', **result}, ensure_ascii=False)}\n\n"

        # Send final summary
        yield f"data: {_json.dumps({'type': 'done', 'total_files': total_files, 'success_count': success_count, 'fail_count': fail_count, 'total_entity_count': total_entities}, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/restore", summary="Restore redacted text")
async def restore_text(req: RestoreTextRequest) -> dict[str, Any]:
    """Restore redacted text using a mapping file.

    The mapping_json should be the content of a ``*.mapping.enc`` file
    (JSON string, possibly base64-encoded).
    """
    try:
        from aiarb.redaction.restorer import RedactionRestorer

        # 直接从 JSON 字符串加载，避免写临时文件
        restorer = RedactionRestorer(mapping_json=req.mapping_json)
        result = restorer.restore_text(req.text)

        return result
    except Exception as e:
        logger.exception("Restore failed")
        raise HTTPException(status_code=500, detail=f"Restore failed: {e}")


# -- Info endpoints ---------------------------------------------------------


@router.get("/entities", summary="List supported entity types")
async def list_entities() -> dict[str, Any]:
    """List all supported sensitive entity types for redaction."""
    from aiarb.redaction.agent import list_entities as _list

    return _list()


@router.get("/policies", summary="List redaction policies")
async def list_policies() -> dict[str, Any]:
    """List all predefined redaction policies."""
    from aiarb.redaction.agent import list_policies as _list

    return _list()


@router.get("/modes", summary="List redaction modes")
async def list_modes() -> dict[str, Any]:
    """List all redaction modes (MASK, REPLACE, TOKENIZE, etc.)."""
    from aiarb.redaction.agent import list_modes as _list

    return _list()


@router.get("/strength-levels", summary="List strength levels")
async def list_strength_levels() -> dict[str, Any]:
    """List all supported strength levels (L1-L4)."""
    from aiarb.redaction.agent import list_strength_levels as _list

    return _list()


@router.get("/doc-types", summary="List document types")
async def list_doc_types() -> dict[str, Any]:
    """List all supported document types for type inference."""
    from aiarb.document.doc_type import doc_type_label

    types = [
        "arbitration_award",
        "arbitration_application",
        "arbitration_defense",
        "arbitration_counterclaim",
        "arbitration_ruling",
        "arbitration_interim_measure",
        "court_judgment",
        "court_ruling",
        "contract",
        "legal_opinion",
        "evidence",
        "other",
    ]
    return {
        "success": True,
        "doc_types": [
            {"id": t, "label": doc_type_label(t)} for t in types
        ],
    }


def _doc_type_label(doc_type: str) -> str:
    """Helper to get doc type label."""
    from aiarb.document.doc_type import doc_type_label as _label

    return _label(doc_type)


# -- OCR Configuration API ---------------------------------------------------

class EngineDeploymentConfigRequest(BaseModel):
    """Deployment configuration for a single OCR capability."""
    mode: Optional[str] = Field(
        default="local",
        description="Deployment mode: 'local' (run locally) or 'cloud_api' (use cloud provider)",
    )
    provider: Optional[str] = Field(
        default=None,
        description="Cloud provider name when mode='cloud_api': ocr-space, baidu-ocr, tencent-ocr, mineru-cloud",
    )
    api_key: Optional[str] = Field(
        default=None,
        description="API key for cloud providers",
    )
    endpoint: Optional[str] = Field(
        default=None,
        description="Custom endpoint URL (empty = use provider default)",
    )
    use_gpu: Optional[bool] = Field(
        default=True,
        description="Use GPU acceleration (only relevant when mode='local')",
    )
    model_size: Optional[str] = Field(
        default="auto",
        description="Model size for local engines: small/medium/large/auto",
    )


class OCRConfigRequest(BaseModel):
    """Request body for OCR configuration.

    **New structure** (recommended): Use text_engine and layout_parser
    to explicitly configure each capability's deployment mode.

    **Legacy fields** (still supported): For backward compatibility,
    old field names are mapped to the new structure internally.
    """
    # New structure: explicit deployment configs
    text_engine: Optional[EngineDeploymentConfigRequest] = Field(
        default=None,
        description="Text recognition engine deployment config (local or cloud)",
    )
    layout_parser: Optional[EngineDeploymentConfigRequest] = Field(
        default=None,
        description="Layout parser (MinerU) deployment config. None/empty = disabled",
    )

    # Common settings
    language: Optional[str] = Field(
        default="ch",
        description="Language code: ch/en/ch_en",
    )
    confidence_threshold: Optional[float] = Field(
        default=0.5,
        description="Minimum confidence to accept a block (0.0-1.0)",
    )
    dpi: Optional[int] = Field(
        default=300,
        description="DPI for image rendering (higher=better quality, slower)",
    )
    enable_ocr: Optional[bool] = Field(
        default=True,
        description="Global OCR toggle: if False, skip all OCR operations",
    )
    fallback_to_cloud: Optional[bool] = Field(
        default=False,
        description="If local engine fails, automatically try cloud API",
    )

    # Legacy fields (mapped to new structure for backward compatibility)
    engine_type: Optional[str] = Field(
        default=None,
        description="[Legacy] Primary OCR engine type (use text_engine instead)",
    )
    use_gpu: Optional[bool] = Field(
        default=None,
        description="[Legacy] Use GPU (use text_engine.use_gpu instead)",
    )
    cloud_api_key: Optional[str] = Field(
        default=None,
        description="[Legacy] Cloud API key (use text_engine.api_key instead)",
    )
    cloud_api_url: Optional[str] = Field(
        default=None,
        description="[Legacy] Cloud endpoint URL (use text_engine.endpoint instead)",
    )
    mineru_enabled: Optional[bool] = Field(
        default=None,
        description="[Legacy] Enable MinerU (use layout_parser instead)",
    )
    mineru_mode: Optional[str] = Field(
        default=None,
        description="[Legacy] MinerU mode (use layout_parser.model_size instead)",
    )


@router.get("/ocr/config", summary="Get current OCR configuration")
async def get_ocr_config() -> dict[str, Any]:
    """Return the current OCR engine configuration and available engines.

    This endpoint lets the frontend:
    1. Display which OCR engines are installed
    2. Show current settings
    3. Guide the user to install missing engines
    """
    try:
        from aiarb.document.ocr import (
            OCREngine,
            OCRConfig,
            load_default_ocr_config,
            OCREngineType,
            get_ocr_config_path,
        )

        config = load_default_ocr_config()
        ocr = OCREngine(config)
        available = ocr.available_engines()

        # Engine info with installation instructions
        te = config.text_engine
        lp = config.layout_parser

        engine_info = {
            "text_engine": {
                "mode": te.mode,
                "provider": te.provider or "auto",
                "configured": True,
                "available": ocr.available_engines() if te.mode == "local" else bool(te.api_key),
            },
            "local_engines": {
                OCREngineType.PADDLE.value: {
                    "name": "PaddleOCR",
                    "description": "Best Chinese text accuracy, moderate resources",
                    "installed": OCREngineType.PADDLE.value in available,
                    "install": "pip install paddlepaddle paddleocr",
                    "hw_req": "CPU: any; GPU: NVIDIA CUDA recommended, VRAM ≥4GB",
                },
                OCREngineType.EASY.value: {
                    "name": "EasyOCR",
                    "description": "Good multilingual support, easy install",
                    "installed": OCREngineType.EASY.value in available,
                    "install": "pip install easyocr",
                    "hw_req": "CPU: any; GPU: optional PyTorch CUDA; RAM: 2GB+",
                },
                OCREngineType.TESSERACT.value: {
                    "name": "Tesseract",
                    "description": "Lightweight, fast, lower CJK accuracy",
                    "installed": OCREngineType.TESSERACT.value in available,
                    "install": "# Ubuntu/Debian:\nsudo apt-get install tesseract-ocr tesseract-ocr-chi-sim\n"
                               "# macOS:\nbrew install tesseract tesseract-lang\n"
                               "# Windows: download from UB-Mannheim/tesseract GitHub\n"
                               "pip install pytesseract pdf2image pillow",
                    "hw_req": "Very lightweight: <100MB RAM, any CPU",
                },
            },
            "cloud_engines": {
                "ocr-space": {
                    "name": "OCR.space",
                    "description": "Free 500 requests/month, $0.001/page after",
                    "configured": te.mode == "cloud_api" and te.provider == "ocr-space",
                    "api_endpoint": "https://api.ocr.space",
                    "signup_url": "https://ocr.space/",
                },
                "baidu-ocr": {
                    "name": "Baidu Cloud OCR",
                    "description": "Best for Chinese documents, domestic provider",
                    "configured": te.mode == "cloud_api" and te.provider == "baidu-ocr",
                    "api_endpoint": "https://aip.baidubce.com/rest/2.0/ocr/v1/general_basic",
                },
                "tencent-ocr": {
                    "name": "Tencent Cloud OCR",
                    "description": "Strong table recognition",
                    "configured": te.mode == "cloud_api" and te.provider == "tencent-ocr",
                    "api_endpoint": "https://ocr.tencentcloudapi.com/",
                },
            },
            "layout_parser": {
                "enabled": lp is not None,
                "mode": lp.mode if lp else "disabled",
                "provider": lp.provider if lp else "",
                "available": bool(ocr._mineru and ocr._mineru.is_available()) if lp else False,
                "install": "pip install 'magic-pdf[full]'  # Requires Python 3.10+",
                "hw_req": "GPU strongly recommended (NVIDIA VRAM ≥8GB); RAM: 16GB+; Disk: ~10GB models",
            } if lp else {
                "enabled": False,
                "mode": "disabled",
            },
        }

        return {
            "success": True,
            "config": config.to_dict(),
            "available_engines": available,
            "engines": engine_info,
            "config_file": str(get_ocr_config_path()),
            "has_any_engine": len(available) > 0,
        }
    except Exception as exc:
        logger.exception("Failed to get OCR config")
        raise HTTPException(status_code=500, detail=f"Failed to read OCR config: {exc}")


@router.put("/ocr/config", summary="Update OCR configuration")
async def update_ocr_config(req: OCRConfigRequest) -> dict[str, Any]:
    """Update OCR engine configuration and save to disk.

    The updated config takes effect immediately for subsequent operations.
    Supports both new nested structure (text_engine, layout_parser) and
    legacy flat fields (engine_type, cloud_api_key, etc.).
    """
    try:
        from aiarb.document.ocr import (
            OCRConfig,
            EngineDeploymentConfig,
            load_default_ocr_config,
            get_ocr_config_path,
        )

        # Load existing config
        config = load_default_ocr_config()
        updates = req.model_dump(exclude_unset=True)

        # Handle new nested structure: text_engine
        if "text_engine" in updates and updates["text_engine"] is not None:
            te_data = updates.pop("text_engine")
            if isinstance(te_data, dict):
                # Merge with existing text_engine settings
                existing = config.text_engine
                te_data = {
                    "mode": te_data.get("mode", existing.mode),
                    "provider": te_data.get("provider", existing.provider),
                    "api_key": te_data.get("api_key", existing.api_key),
                    "endpoint": te_data.get("endpoint", existing.endpoint),
                    "use_gpu": te_data.get("use_gpu", existing.use_gpu),
                    "model_size": te_data.get("model_size", existing.model_size),
                }
                config.text_engine = EngineDeploymentConfig(**te_data)

        # Handle new nested structure: layout_parser
        if "layout_parser" in updates:
            lp_data = updates.pop("layout_parser")
            if lp_data is None:
                # Disable layout parser
                config.layout_parser = None
            elif isinstance(lp_data, dict):
                # Create or update layout_parser
                existing = config.layout_parser or EngineDeploymentConfig()
                lp_data = {
                    "mode": lp_data.get("mode", existing.mode),
                    "provider": lp_data.get("provider", existing.provider),
                    "api_key": lp_data.get("api_key", existing.api_key),
                    "endpoint": lp_data.get("endpoint", existing.endpoint),
                    "use_gpu": lp_data.get("use_gpu", existing.use_gpu),
                    "model_size": lp_data.get("model_size", existing.model_size),
                }
                config.layout_parser = EngineDeploymentConfig(**lp_data)

        # Handle legacy flat fields by converting to new structure
        if "engine_type" in updates and updates["engine_type"] is not None:
            legacy_engine = updates.pop("engine_type")
            if legacy_engine.startswith("cloud-") and "text_engine" not in updates:
                config.text_engine.mode = "cloud_api"
                config.text_engine.provider = legacy_engine.replace("cloud-", "", 1)
            elif legacy_engine != "auto":
                config.text_engine.provider = legacy_engine

        if "cloud_api_key" in updates and updates["cloud_api_key"] is not None:
            config.text_engine.api_key = updates.pop("cloud_api_key")

        if "cloud_api_url" in updates and updates["cloud_api_url"] is not None:
            config.text_engine.endpoint = updates.pop("cloud_api_url")

        if "use_gpu" in updates and updates["use_gpu"] is not None:
            config.text_engine.use_gpu = updates.pop("use_gpu")

        if "mineru_enabled" in updates and updates["mineru_enabled"] is not None:
            mineru_en = updates.pop("mineru_enabled")
            if mineru_en and config.layout_parser is None:
                config.layout_parser = EngineDeploymentConfig(mode="local")
            elif not mineru_en:
                config.layout_parser = None

        if "mineru_mode" in updates and updates["mineru_mode"] is not None:
            if config.layout_parser:
                config.layout_parser.model_size = updates.pop("mineru_mode")

        # Apply remaining simple fields (language, dpi, enable_ocr, etc.)
        for key, value in updates.items():
            if value is not None and hasattr(config, key):
                setattr(config, key, value)

        # Save to disk
        config.save_to_file(get_ocr_config_path())

        # Validate by trying to create engine instance
        from aiarb.document.ocr import OCREngine

        ocr = OCREngine(config)
        available = ocr.available_engines()

        return {
            "success": True,
            "message": "OCR configuration saved",
            "config": config.to_dict(),
            "available_engines": available,
            "restart_note": "Configuration applied immediately; no restart required.",
        }
    except Exception as exc:
        logger.exception("Failed to save OCR config")
        raise HTTPException(status_code=500, detail=f"Failed to save OCR config: {exc}")


@router.get("/ocr/engines", summary="List available OCR engines")
async def list_ocr_engines() -> dict[str, Any]:
    """Quick check: which OCR engines are installed and ready?"""
    try:
        from aiarb.document.ocr import OCREngine, load_default_ocr_config

        ocr = OCREngine(load_default_ocr_config())
        available = ocr.available_engines()

        return {
            "success": True,
            "available": available,
            "count": len(available),
            "has_local": any(e not in ("cloud-ocr-space", "cloud-baidu", "cloud-tencent") for e in available),
            "has_cloud": any(e.startswith("cloud-") for e in available),
            "recommendation": (
                available[0] if available else
                "No OCR engine available. Install one: pip install paddlepaddle paddleocr"
            ),
        }
    except Exception as exc:
        logger.exception("Failed to list OCR engines")
        raise HTTPException(status_code=500, detail=f"Failed to list OCR engines: {exc}")


# -- OCR Auto-Install API ----------------------------------------------------

import sys


def _detect_china_network() -> bool:
    """Detect if the user is likely in China (for mirror selection).

    Uses a lightweight heuristic: check if the public IP resolves to a
    Chinese mainland IP range, or if system locale/language is Chinese.
    Falls back to checking common env vars.
    """
    import os

    # 1. Check locale / language env vars
    lang = os.environ.get("LANG", "") + os.environ.get("LC_ALL", "") + os.environ.get("LC_CTYPE", "")
    if "zh_CN" in lang or "zh_HK" in lang or "zh_TW" in lang:
        return True

    # 2. Check AIARB_REGION env var (explicit override)
    region = os.environ.get("AIARB_REGION", "").lower()
    if region in ("cn", "china", "prc"):
        return True
    if region in ("us", "eu", "global"):
        return False

    # 3. Try a quick IP geolocation check (5s timeout, non-blocking)
    try:
        import httpx
        resp = httpx.get("https://ipapi.co/country/", timeout=5.0)
        if resp.status_code == 200:
            country = resp.text.strip().upper()
            if country in ("CN", "HK", "TW", "MO"):
                return True
    except Exception:
        pass

    return False


@router.post("/ocr/install", summary="Auto-install OCR engine dependencies")
async def install_ocr_engines(
    req: Request = None,
) -> dict[str, Any]:
    """Automatically install OCR engine packages via pip.

    This endpoint detects the user's network region (China vs. international)
    and selects the appropriate PyPI mirror automatically. The installation
    runs in the background and returns immediately with a status.

    Args:
        engine: Which engine to install. Options:
            - "auto" (default): Install the recommended bundle (PaddleOCR + deps)
            - "paddleocr": Install paddlepaddle + paddleocr
            - "easyocr": Install easyocr only
            - "tesseract": Install pytesseract (note: tesseract binary also needed)
            - "mineru": Install magic-pdf[full] for layout parsing
            - "all": Install all engines + mineru
        use_mirror: Force mirror usage. None = auto-detect based on IP.
    """
    import asyncio

    # Parse body (JSON or query params for flexibility)
    engine = "auto"
    use_mirror = None
    if req:
        try:
            body = await req.json()
            engine = body.get("engine", "auto")
            use_mirror = body.get("use_mirror")
        except Exception:
            # Fall back to query params
            engine = req.query_params.get("engine", "auto")
            um = req.query_params.get("use_mirror")
            use_mirror = um.lower() == "true" if um else None

    # Determine if we should use Chinese mirrors
    if use_mirror is None:
        use_mirror = _detect_china_network()

    # Build pip install command
    pip_args: list[str] = []

    if engine in ("auto", "paddleocr"):
        pip_args = ["paddlepaddle", "paddleocr"]
    elif engine == "easyocr":
        pip_args = ["easyocr"]
    elif engine == "tesseract":
        pip_args = ["pytesseract", "pdf2image"]
    elif engine == "mineru":
        pip_args = ['magic-pdf[full]']
    elif engine == "all":
        pip_args = ["paddlepaddle", "paddleocr", "easyocr", "pytesseract", "pdf2image"]
    else:
        raise HTTPException(status_code=400, detail=f"Unknown engine: {engine}")

    # Build the full pip command
    # On Windows, sys.executable might point to a frozen exe; try pip directly
    import shutil

    pip_exe = shutil.which("pip") or shutil.which("pip3")
    if pip_exe:
        cmd = [pip_exe, "install", "--disable-pip-version-check", "--no-input"]
    else:
        cmd = [sys.executable, "-m", "pip", "install", "--disable-pip-version-check", "--no-input"]

    if use_mirror:
        cmd += ["-i", "https://mirrors.aliyun.com/pypi/simple/", "--trusted-host", "mirrors.aliyun.com"]
    cmd += pip_args

    logger.info("Installing OCR engines: %s (mirror=%s, cmd=%s)", engine, use_mirror, " ".join(cmd))

    # Run pip install in a subprocess (non-blocking for the event loop)
    async def _run_install():
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await proc.communicate()
            return {
                "returncode": proc.returncode,
                "stdout": stdout.decode("utf-8", errors="replace")[-2000:] if stdout else "",
                "stderr": stderr.decode("utf-8", errors="replace")[-2000:] if stderr else "",
            }
        except Exception as e:
            return {"returncode": -1, "stdout": "", "stderr": str(e)}

    result = await _run_install()

    if result["returncode"] == 0:
        # Verify installation by checking engine availability
        try:
            from aiarb.document.ocr import OCREngine, load_default_ocr_config
            ocr = OCREngine(load_default_ocr_config())
            available = ocr.available_engines()
        except Exception:
            available = []

        return {
            "success": True,
            "message": f"OCR engine '{engine}' installed successfully",
            "installed_packages": pip_args,
            "mirror_used": use_mirror,
            "available_engines": available,
            "stdout_tail": result["stdout"][-500:],
        }
    else:
        return {
            "success": False,
            "message": f"Installation failed (exit code {result['returncode']})",
            "installed_packages": [],
            "mirror_used": use_mirror,
            "stderr_tail": result["stderr"][-500:],
            "stdout_tail": result["stdout"][-500:],
        }


# -- File Operation APIs (open file, reveal folder, preview) ----------------


class OpenFileRequest(BaseModel):
    file_path: str = Field(..., description="Absolute path to the file to open")


class OpenFolderRequest(BaseModel):
    folder_path: str = Field(..., description="Absolute path to the folder to reveal")
    select_file: Optional[str] = Field(default=None, description="Optional file to highlight in the folder")


@router.post("/file/open", summary="Open a file with the system default application")
async def open_file(req: OpenFileRequest) -> dict[str, Any]:
    """Open a file using the OS default application.

    Uses ``os.startfile`` on Windows, ``open`` on macOS, ``xdg-open`` on Linux.
    """
    import platform
    import subprocess

    path = Path(req.file_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {req.file_path}")

    try:
        system = platform.system()
        if system == "Windows":
            os.startfile(str(path))  # type: ignore[attr-defined]
        elif system == "Darwin":
            subprocess.Popen(["open", str(path)])
        else:
            subprocess.Popen(["xdg-open", str(path)])
        return {"success": True, "message": f"Opened: {path.name}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to open file: {e}")


@router.post("/file/reveal", summary="Reveal a file/folder in the system file explorer")
async def reveal_in_folder(req: OpenFolderRequest) -> dict[str, Any]:
    """Open the system file explorer and optionally select a file.

    Uses ``explorer /select`` on Windows, ``open -R`` on macOS, ``xdg-open`` on Linux.
    """
    import platform
    import subprocess

    folder = Path(req.folder_path)
    if not folder.exists():
        raise HTTPException(status_code=404, detail=f"Folder not found: {req.folder_path}")

    try:
        system = platform.system()
        if system == "Windows":
            if req.select_file:
                subprocess.Popen(["explorer", "/select,", str(Path(req.select_file))])
            else:
                subprocess.Popen(["explorer", str(folder)])
        elif system == "Darwin":
            if req.select_file:
                subprocess.Popen(["open", "-R", str(req.select_file)])
            else:
                subprocess.Popen(["open", str(folder)])
        else:
            subprocess.Popen(["xdg-open", str(folder)])
        return {"success": True, "message": f"Revealed: {folder.name}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to reveal folder: {e}")


@router.post("/file/preview", summary="Read file content for preview")
async def preview_file(req: OpenFileRequest) -> dict[str, Any]:
    """Read a text file's content for preview in the browser.

    Returns up to 100KB of text content. For binary files (PDF, DOCX, etc.),
    returns the file metadata and a note that preview is not available.
    """
    path = Path(req.file_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {req.file_path}")

    suffix = path.suffix.lower()
    binary_exts = {".pdf", ".docx", ".doc", ".xlsx", ".xls", ".pptx", ".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff"}

    if suffix in binary_exts:
        stat = path.stat()
        return {
            "success": True,
            "is_binary": True,
            "file_name": path.name,
            "file_size": stat.st_size,
            "file_type": suffix,
            "message": "Binary file — use 'Open' to view in system application",
        }

    # Read text file
    try:
        content = path.read_text(encoding="utf-8", errors="replace")
        truncated = len(content) > 100_000
        if truncated:
            content = content[:100_000] + "\n\n... (truncated, full file is larger)"
        return {
            "success": True,
            "is_binary": False,
            "content": content,
            "file_name": path.name,
            "file_size": len(content),
            "truncated": truncated,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read file: {e}")
