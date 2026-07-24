# -*- coding: utf-8 -*-
"""Knowledge base API routes — full-text / property / backlink / graph / import / AI ask.

Prefix: ``/kb``
Depends on: ``qwenpaw.knowledge.kb_tools``, ``qwenpaw.parsers.router.ParserRouter``,
and the agent workspace for ReMe semantic search.
"""

from __future__ import annotations

import json
import shutil
import tempfile
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ...knowledge import kb_tools


def build_router() -> APIRouter:
    router = APIRouter(prefix="/kb", tags=["knowledge-base"])

    # ── File listing & tree ───────────────────────────────────────

    @router.get("/list")
    def list_files():
        """Return the full file tree + statistics."""
        return {
            "ok": True,
            "tree": kb_tools.file_tree(),
            "stats": kb_tools.statistics(),
        }

    @router.get("/stats")
    def get_stats():
        """Return knowledge base statistics."""
        return {"ok": True, "stats": kb_tools.statistics()}

    @router.get("/tags")
    def get_tags():
        """Return all tags with counts."""
        return {"ok": True, "tags": kb_tools.all_tags()}

    # ── File content ──────────────────────────────────────────────

    @router.get("/file")
    def get_file(path: str):
        """Read a single file by relative path."""
        result = kb_tools.get_file_content(path)
        if result is None:
            raise HTTPException(status_code=404, detail=f"file not found: {path}")
        return {"ok": True, "file": result}

    @router.get("/file/raw")
    def get_file_raw(path: str):
        """Read raw file content (no parsing)."""
        kb_dir = kb_tools._knowledge_dir()
        full = kb_dir / path
        if not full.is_file():
            raise HTTPException(status_code=404, detail=f"file not found: {path}")
        return {"ok": True, "content": full.read_text(encoding="utf-8", errors="replace")}

    # ── Search ────────────────────────────────────────────────────

    @router.get("/search")
    def full_text_search(q: str = ""):
        """Full-text search across all knowledge files."""
        if not q.strip():
            return {"ok": True, "results": []}
        return {"ok": True, "results": kb_tools.full_text_search(q)}

    @router.get("/by-tag")
    def search_by_tag(tag: str = ""):
        """Find entries by tag."""
        if not tag.strip():
            return {"ok": True, "results": []}
        return {"ok": True, "results": kb_tools.by_tag(tag)}

    @router.get("/by-status")
    def search_by_status(status: str = ""):
        """Find entries by status."""
        if not status.strip():
            return {"ok": True, "results": []}
        return {"ok": True, "results": kb_tools.by_status(status)}

    @router.get("/backlinks")
    def get_backlinks(title: str = ""):
        """Find entries that link TO the given title."""
        if not title.strip():
            return {"ok": True, "results": []}
        return {"ok": True, "results": kb_tools.backlinks(title)}

    @router.get("/forward-links")
    def get_forward_links(path: str = ""):
        """Return wikilink targets that the given file links to."""
        if not path.strip():
            return {"ok": True, "results": []}
        return {"ok": True, "links": kb_tools.forward_links(path)}

    class DSLQuery(BaseModel):
        dsl: str

    @router.post("/dsl")
    def dsl_query(payload: DSLQuery):
        """Execute a DSL query: ``tag:仲裁法 status:已核阅 text:管辖``."""
        return {"ok": True, "results": kb_tools.query_dsl(payload.dsl)}

    # ── Knowledge graph ───────────────────────────────────────────

    @router.get("/graph")
    def get_graph():
        """Build and return the knowledge graph (nodes + edges)."""
        return {"ok": True, "graph": kb_tools.build_graph()}

    # ── Smart import ──────────────────────────────────────────────

    class ImportResult(BaseModel):
        ok: bool
        file: str
        title: str
        tags: list[str]
        summary: str
        suggestions: dict[str, Any]

    @router.post("/import")
    async def import_file(
        file: UploadFile = File(...),
        auto_ocr: bool = True,
    ):
        """Smart import: parse any file format → generate Markdown + frontmatter.

        Pipeline:
        1. Save uploaded file to temp
        2. Parse via ParserRouter (PDF/DOCX/OCR/etc.)
        3. Generate frontmatter (title, tags, summary) heuristically
        4. Write to knowledge/ directory
        5. Return import result with link suggestions
        """
        # Save uploaded file
        suffix = Path(file.filename or "upload").suffix
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            content = await file.read()
            tmp.write(content)
            tmp_path = Path(tmp.name)

        try:
            # Parse using ParserRouter
            from ..parsers.router import ParserRouter

            parser = ParserRouter()
            try:
                markdown_text = await parser.parse(tmp_path, parse_mode="auto")
            except Exception as exc:
                raise HTTPException(
                    status_code=422,
                    detail=f"parse failed: {type(exc).__name__}: {exc}",
                ) from exc

            if not markdown_text or not markdown_text.strip():
                raise HTTPException(status_code=422, detail="parsed content is empty")

            # Generate frontmatter heuristically
            file_stem = Path(file.filename or "untitled").stem
            title = file_stem

            # Auto-detect tags from content
            tag_keywords = {
                "仲裁法": ["仲裁法", "中华人民共和国仲裁法"],
                "仲裁规则": ["仲裁规则", "北仲", "贸仲", "上仲"],
                "管辖": ["管辖", "管辖权"],
                "程序": ["程序", "送达", "答辩", "开庭"],
                "证据": ["证据", "举证", "质证"],
                "裁决": ["裁决", "裁决书", "仲裁裁决"],
                "司法审查": ["司法审查", "撤销", "不予执行"],
                "案例": ["案例", "判决", "裁定"],
            }
            detected_tags: list[str] = []
            content_lower = markdown_text[:5000]
            for tag, keywords in tag_keywords.items():
                if any(kw in content_lower for kw in keywords):
                    detected_tags.append(tag)

            # Generate summary (first 200 chars of body, cleaned)
            lines = markdown_text.strip().split("\n")
            summary_lines = [
                ln.strip().lstrip("#").strip()
                for ln in lines
                if ln.strip() and not ln.startswith("---") and not ln.startswith("!")
            ]
            summary = " ".join(summary_lines[:3])[:200]

            # Extract wikilinks found in content
            from ...knowledge.kb_tools import extract_wikilinks
            found_links = extract_wikilinks(markdown_text)

            # Build frontmatter
            import datetime
            frontmatter = {
                "title": title,
                "tags": detected_tags,
                "status": "待核阅",
                "summary": summary,
                "date": datetime.date.today().isoformat(),
                "source_file": file.filename,
            }

            # Build final Markdown
            fm_yaml = _dict_to_yaml(frontmatter)
            final_md = f"---\n{fm_yaml}---\n\n{markdown_text}\n"

            # Write to knowledge directory
            kb_dir = kb_tools._knowledge_dir()
            kb_dir.mkdir(parents=True, exist_ok=True)
            out_path = kb_dir / f"{file_stem}.md"
            counter = 1
            while out_path.exists():
                out_path = kb_dir / f"{file_stem}_{counter}.md"
                counter += 1
            out_path.write_text(final_md, encoding="utf-8")

            # Find link suggestions (existing entries that match found links)
            all_entries = kb_tools.all_entries()
            title_index = {e["title"].lower(): e["path"] for e in all_entries}
            linked: list[str] = []
            pending: list[str] = []
            for link in found_links:
                if link.lower() in title_index:
                    linked.append(link)
                else:
                    if link not in pending:
                        pending.append(link)

            return {
                "ok": True,
                "file": str(out_path.relative_to(kb_dir)).replace("\\", "/"),
                "title": title,
                "tags": detected_tags,
                "summary": summary,
                "suggestions": {
                    "linked": linked,
                    "pending_links": pending,
                },
            }
        finally:
            tmp_path.unlink(missing_ok=True)

    @router.post("/import-raw")
    async def import_raw_text(payload: dict[str, Any]):
        """Import raw text as a knowledge base entry (no file upload)."""
        title = (payload.get("title") or "untitled").strip()
        content = (payload.get("content") or "").strip()
        tags = payload.get("tags", [])
        if not content:
            raise HTTPException(status_code=400, detail="content is empty")

        import datetime
        frontmatter = {
            "title": title,
            "tags": tags if isinstance(tags, list) else [],
            "status": payload.get("status", "待核阅"),
            "summary": content[:200],
            "date": datetime.date.today().isoformat(),
        }
        fm_yaml = _dict_to_yaml(frontmatter)
        final_md = f"---\n{fm_yaml}---\n\n{content}\n"

        kb_dir = kb_tools._knowledge_dir()
        kb_dir.mkdir(parents=True, exist_ok=True)
        safe_name = title.replace("/", "_").replace("\\", "_")[:80]
        out_path = kb_dir / f"{safe_name}.md"
        counter = 1
        while out_path.exists():
            out_path = kb_dir / f"{safe_name}_{counter}.md"
            counter += 1
        out_path.write_text(final_md, encoding="utf-8")

        return {
            "ok": True,
            "file": str(out_path.relative_to(kb_dir)).replace("\\", "/"),
            "title": title,
        }

    # ── AI ask (streaming via agent) ──────────────────────────────

    class AIAskRequest(BaseModel):
        model_config = {"extra": "ignore"}
        question: str
        agent_id: str | None = None
        context_files: list[str] | None = None

    @router.post("/ai-ask")
    async def ai_ask(payload: AIAskRequest, request: Request):
        """Ask a question to the bound agent with knowledge base context.

        Returns a streaming SSE response with the agent's reply.
        """
        if not payload.question.strip():
            raise HTTPException(status_code=400, detail="question is empty")

        # Build context from knowledge base
        context_parts: list[str] = []

        # Full-text search for relevant files
        fts_results = kb_tools.full_text_search(payload.question)
        for r in fts_results[:5]:
            file_data = kb_tools.get_file_content(r["path"])
            if file_data:
                body = file_data.get("body", "")[:2000]
                context_parts.append(f"## {file_data['title']}\nPath: {r['path']}\n\n{body}")

        context = "\n\n---\n\n".join(context_parts) if context_parts else ""

        # Add explicitly selected context files
        if payload.context_files:
            for cf in payload.context_files[:3]:
                file_data = kb_tools.get_file_content(cf)
                if file_data:
                    context_parts.append(
                        f"## {file_data['title']}\nPath: {cf}\n\n{file_data.get('body', '')[:2000]}"
                    )

        # Build the prompt
        if context:
            prompt = f"""基于以下知识库内容回答问题。如果知识库中没有相关信息，请说明。

## 知识库参考

{context}

## 问题

{payload.question}

## 回答要求
1. 优先引用知识库中的具体法条、规则条文
2. 标注来源（如"根据《仲裁法》第16条"）
3. 如有相关双链，用 [[条文名称]] 格式标注
"""
        else:
            prompt = payload.question

        # Resolve agent
        agent_id = payload.agent_id
        if not agent_id:
            from qwenpaw.config import config as _cfg
            agent_id = _cfg.agents.active_agent or "default"

        async def event_generator():
            try:
                manager = request.app.state.multi_agent_manager
                workspace = await manager.get_agent(agent_id)

                from ...agents.acp.server import AgentRequest, Message

                req = AgentRequest(
                    input=[Message(role="user", content=[{"type": "text", "text": prompt}])],
                    session_id=f"kb-ask-{hash(payload.question) & 0xFFFFFFFF}",
                    agent_id=agent_id,
                )

                yield f'data: {json.dumps({"type": "start"}, ensure_ascii=False)}\n\n'

                full_parts: list[str] = []
                async for envelope in workspace.stream_query(req):
                    if await request.is_disconnected():
                        break
                    obj = getattr(envelope, "object", None)
                    msg_type = getattr(envelope, "type", None)
                    content = getattr(envelope, "content", None)
                    if obj == "message" and msg_type == "message" and isinstance(content, list):
                        for block in content:
                            text = None
                            if isinstance(block, dict) and block.get("type") == "text":
                                text = block.get("text")
                            elif hasattr(block, "text"):
                                text = getattr(block, "text", None)
                            if text:
                                full_parts.append(text)
                                yield f'data: {json.dumps({"type": "token", "text": text}, ensure_ascii=False)}\n\n'

                yield f'data: {json.dumps({"type": "done", "text": "".join(full_parts)}, ensure_ascii=False)}\n\n'

            except Exception as exc:
                yield f'data: {json.dumps({"type": "error", "message": f"{type(exc).__name__}: {exc}"[:200]}, ensure_ascii=False)}\n\n'

        return StreamingResponse(
            event_generator(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
        )

    return router


def _dict_to_yaml(d: dict[str, Any]) -> str:
    """Simple dict → YAML string (no external dep for basic cases)."""
    import yaml
    return yaml.dump(d, allow_unicode=True, default_flow_style=False, sort_keys=False)
