# -*- coding: utf-8 -*-
from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ..config import load_config
from ..constant import WORKING_DIR
from .models import WikiPage, WikiIndex, WikiLink, KnowledgeGraph

logger = logging.getLogger(__name__)


def _wiki_base_dir() -> Path:
    return WORKING_DIR / "knowledge_base" / "_wiki"


def _load_index() -> WikiIndex:
    idx_path = _wiki_base_dir() / "_index.json"
    if idx_path.is_file():
        try:
            return WikiIndex.model_validate_json(idx_path.read_text(encoding="utf-8"))
        except Exception:
            return WikiIndex()
    return WikiIndex()


def _save_index(idx: WikiIndex) -> None:
    base = _wiki_base_dir()
    base.mkdir(parents=True, exist_ok=True)
    idx_path = base / "_index.json"
    idx_path.write_text(idx.model_dump_json(indent=2), encoding="utf-8")


def _load_doc_meta() -> dict[str, dict]:
    meta_path = WORKING_DIR / "knowledge_base" / "_meta.json"
    if meta_path.is_file():
        try:
            return json.loads(meta_path.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def _load_parsed(doc_id: str) -> str:
    parsed_path = WORKING_DIR / "knowledge_base" / "_parsed" / f"{doc_id}.md"
    if parsed_path.is_file():
        return parsed_path.read_text(encoding="utf-8", errors="replace")
    return ""


def _load_desensitized(doc_id: str) -> str:
    ds_path = WORKING_DIR / "knowledge_base" / "_desensitized" / f"{doc_id}.md"
    if ds_path.is_file():
        return ds_path.read_text(encoding="utf-8", errors="replace")
    return _load_parsed(doc_id)


async def ingest(
    doc_ids: list[str] | None = None,
    case_ids: list[str] | None = None,
    page_type: str = "auto",
    force: bool = False,
) -> dict[str, Any]:
    base = _wiki_base_dir()
    base.mkdir(parents=True, exist_ok=True)
    idx = _load_index()
    meta = _load_doc_meta()

    existing_paths = {p.path for p in idx.pages}

    target_ids = list(doc_ids or [])
    if case_ids:
        for cid in case_ids:
            case_meta_ids = [k for k in meta if meta[k].get("case_id") == cid]
            target_ids.extend(case_meta_ids)
    if not target_ids:
        target_ids = list(meta.keys())
    target_ids = list(dict.fromkeys(target_ids))

    ingested: list[str] = []
    skipped: list[str] = []
    errors: list[str] = []

    for doc_id in target_ids:
        if doc_id not in meta:
            errors.append(f"{doc_id}: not found in meta")
            continue

        doc_data = meta[doc_id]
        doc_name = doc_data.get("name", doc_id)
        doc_category = doc_data.get("category", "")
        doc_tags = doc_data.get("tags", [])
        doc_case_id = doc_data.get("case_id", "")

        content = _load_desensitized(doc_id)
        if not content.strip():
            skipped.append(f"{doc_id}: no parsed content")
            continue

        wiki_path = _derive_wiki_path(doc_id, doc_name, doc_category, page_type)

        if wiki_path in existing_paths and not force:
            skipped.append(f"{doc_id}: already compiled")
            continue

        page_dir = base / Path(wiki_path).parent
        page_dir.mkdir(parents=True, exist_ok=True)

        compiled = _compile_content(content, doc_name, doc_category, doc_tags)

        page_file = base / wiki_path
        page_file.write_text(compiled, encoding="utf-8")

        source_case_ids = [doc_case_id] if doc_case_id else []
        page_entry = WikiPage(
            path=wiki_path,
            name=_derive_page_name(doc_name, page_type),
            page_type=_resolve_page_type(doc_category, page_type),
            source_doc_ids=[doc_id],
            source_case_ids=source_case_ids,
            updated_at=datetime.now(timezone.utc).isoformat(),
        )

        idx.pages = [p for p in idx.pages if p.path != wiki_path]
        idx.pages.append(page_entry)
        ingested.append(doc_id)

    idx.last_ingest = datetime.now(timezone.utc).isoformat()
    _save_index(idx)

    return {
        "ingested": ingested,
        "skipped": skipped,
        "errors": errors,
        "total_pages": len(idx.pages),
    }


async def query(
    keyword: str = "",
    page_type: str = "",
    source_doc_id: str = "",
    source_case_id: str = "",
) -> list[WikiPage]:
    idx = _load_index()
    results = idx.pages

    if keyword:
        kw_lower = keyword.lower()
        results = [p for p in results if kw_lower in p.name.lower() or kw_lower in p.path.lower()]

    if page_type:
        results = [p for p in results if p.page_type == page_type]

    if source_doc_id:
        results = [p for p in results if source_doc_id in p.source_doc_ids]

    if source_case_id:
        results = [p for p in results if source_case_id in p.source_case_ids]

    return results


async def read_page(path: str) -> str:
    page_file = _wiki_base_dir() / path
    if not page_file.is_file():
        raise FileNotFoundError(f"Wiki page not found: {path}")
    return page_file.read_text(encoding="utf-8")


async def lint(fix: bool = False) -> dict[str, Any]:
    idx = _load_index()
    issues: list[dict[str, str]] = []
    fixed: list[str] = []

    for page in list(idx.pages):
        page_file = _wiki_base_dir() / page.path

        if not page_file.is_file():
            issues.append({"path": page.path, "issue": "file_missing"})
            if fix:
                idx.pages = [p for p in idx.pages if p.path != page.path]
                fixed.append(f"removed_orphan_entry:{page.path}")
            continue

        content = page_file.read_text(encoding="utf-8", errors="replace")

        if len(content.strip()) < 50:
            issues.append({"path": page.path, "issue": "content_too_short"})

        if not page.name:
            issues.append({"path": page.path, "issue": "missing_name"})
            if fix:
                name = Path(page.path).stem.replace("_", " ").replace("-", " ")
                page.name = name
                fixed.append(f"fixed_name:{page.path}")

        for doc_id in page.source_doc_ids:
            meta = _load_doc_meta()
            if doc_id not in meta:
                issues.append({"path": page.path, "issue": f"orphan_source:{doc_id}"})
                if fix:
                    page.source_doc_ids.remove(doc_id)
                    fixed.append(f"removed_orphan_source:{page.path}:{doc_id}")

    if fix and (fixed or issues):
        idx.last_lint = datetime.now(timezone.utc).isoformat()
        _save_index(idx)

    return {
        "issues": issues,
        "fixed": fixed,
        "total_pages": len(idx.pages),
    }


def _derive_wiki_path(
    doc_id: str,
    doc_name: str,
    category: str,
    page_type: str,
) -> str:
    stem = Path(doc_name).stem
    safe_name = re.sub(r"[^\w\u4e00-\u9fff\-]", "_", stem)

    if category:
        cat_dir = category.replace("/", "/")
    else:
        cat_dir = "uncategorized"

    resolved_type = _resolve_page_type(category, page_type)
    type_dir = {
        "concept": "concepts",
        "case": "cases",
        "comparison": "comparisons",
        "synthesis": "synthesis",
        "index": "indices",
        "log": "logs",
    }.get(resolved_type, "concepts")

    return f"{type_dir}/{cat_dir}/{safe_name}.md"


def _derive_page_name(doc_name: str, page_type: str) -> str:
    stem = Path(doc_name).stem
    type_prefix = {
        "concept": "",
        "case": "案例：",
        "comparison": "对比：",
        "synthesis": "综合：",
        "index": "索引：",
        "log": "日志：",
    }.get(page_type, "")
    return f"{type_prefix}{stem}" if type_prefix else stem


def _resolve_page_type(category: str, page_type: str) -> str:
    if page_type and page_type != "auto":
        return page_type

    cat_lower = category.lower() if category else ""
    if any(kw in cat_lower for kw in ("案例", "case", "判决", "裁定")):
        return "case"
    if any(kw in cat_lower for kw in ("对比", "comparison", "比较")):
        return "comparison"
    if any(kw in cat_lower for kw in ("综合", "synthesis", "总结")):
        return "synthesis"
    return "concept"


def _compile_content(
    content: str,
    doc_name: str,
    category: str,
    tags: list[str],
) -> str:
    lines: list[str] = []
    lines.append(f"# {Path(doc_name).stem}")
    lines.append("")

    meta_lines: list[str] = []
    if category:
        meta_lines.append(f"- 分类: {category}")
    if tags:
        meta_lines.append(f"- 标签: {', '.join(tags)}")
    meta_lines.append(f"- 编译时间: {datetime.now(timezone.utc).isoformat()}")
    meta_lines.append(f"- 原始长度: {len(content)} 字符")

    if meta_lines:
        lines.append("> **Wiki 编译页**")
        for ml in meta_lines:
            lines.append(f"> {ml}")
        lines.append("")
        lines.append("---")
        lines.append("")

    summary = _extract_summary(content)
    if summary:
        lines.append("## 摘要")
        lines.append("")
        lines.append(summary)
        lines.append("")
        lines.append("---")
        lines.append("")

    lines.append("## 原文")
    lines.append("")
    lines.append(content)

    return "\n".join(lines)


def _extract_summary(content: str, max_chars: int = 500) -> str:
    paragraphs = re.split(r"\n{2,}", content.strip())
    summary_parts: list[str] = []
    total = 0
    for p in paragraphs:
        p = p.strip()
        if not p or p.startswith("#") or p.startswith("|") or p.startswith("---"):
            continue
        if total + len(p) > max_chars:
            remaining = max_chars - total
            if remaining > 50:
                summary_parts.append(p[:remaining] + "…")
            break
        summary_parts.append(p)
        total += len(p)

    return "\n\n".join(summary_parts)


_FUTURE_PROMPT = """你是一个法律知识预测助手。基于以下已有的Wiki知识页面内容，生成预测性的问答对（QA），用于提升未来检索的命中率。

要求：
1. 每个问答对应一个可能的法律咨询场景
2. 问题应自然、口语化，模拟真实用户提问
3. 答案应简明扼要，引用页面中的关键信息
4. 输出JSON数组格式：[{{"question": "...", "answer": "...", "tags": ["..."]}}]
5. 生成5-10个问答对

Wiki页面内容：
---
{content}
---

请输出JSON数组："""


async def future(
    doc_ids: list[str] | None = None,
    page_paths: list[str] | None = None,
    llm_call_fn: Any = None,
) -> dict[str, Any]:
    base = _wiki_base_dir()
    idx = _load_index()
    results: list[dict[str, Any]] = []
    errors: list[str] = []

    if llm_call_fn is None:
        try:
            llm_call_fn = None  # LLM desensitize function removed
        except Exception:
            return {"results": [], "errors": ["LLM service not available"], "total_qa": 0}

    target_pages: list[WikiPage] = []

    if page_paths:
        path_set = set(page_paths)
        target_pages = [p for p in idx.pages if p.path in path_set]
    elif doc_ids:
        doc_set = set(doc_ids)
        target_pages = [p for p in idx.pages if doc_set & set(p.source_doc_ids)]
    else:
        target_pages = list(idx.pages)

    qa_dir = base / "_qa"
    qa_dir.mkdir(parents=True, exist_ok=True)

    total_qa = 0

    for page in target_pages:
        page_file = base / page.path
        if not page_file.is_file():
            errors.append(f"{page.path}: file not found")
            continue

        content = page_file.read_text(encoding="utf-8", errors="replace")
        if len(content.strip()) < 100:
            continue

        prompt = _FUTURE_PROMPT.format(content=content[:3000])

        try:
            response = await llm_call_fn(prompt)
            qa_list = _parse_qa_response(response)

            if qa_list:
                qa_file = qa_dir / f"{Path(page.path).stem}_qa.json"
                qa_file.parent.mkdir(parents=True, exist_ok=True)
                qa_file.write_text(
                    json.dumps(qa_list, ensure_ascii=False, indent=2),
                    encoding="utf-8",
                )
                total_qa += len(qa_list)
                results.append({
                    "page_path": page.path,
                    "qa_count": len(qa_list),
                    "qa": qa_list,
                })
        except Exception as exc:
            errors.append(f"{page.path}: {exc}")

    return {
        "results": results,
        "errors": errors,
        "total_qa": total_qa,
    }


def _parse_qa_response(response: str) -> list[dict[str, Any]]:
    json_match = re.search(r"```json\s*(.*?)\s*```", response, re.DOTALL)
    if json_match:
        try:
            return json.loads(json_match.group(1))
        except json.JSONDecodeError:
            pass

    try:
        parsed = json.loads(response)
        if isinstance(parsed, list):
            return parsed
    except json.JSONDecodeError:
        pass

    brace_start = response.find("[")
    brace_end = response.rfind("]")
    if brace_start != -1 and brace_end > brace_start:
        try:
            return json.loads(response[brace_start:brace_end + 1])
        except json.JSONDecodeError:
            pass

    logger.warning("Failed to parse Future QA response as JSON")
    return []


# ── Bidirectional links & knowledge graph ────────────────────────────────────


_WIKI_LINK_PATTERN = re.compile(r"\[\[([^\]]+)\]\]")
_WIKI_LINK_TEXT_PATTERN = re.compile(r"\[\[([^\]|]+)\|([^\]]+)\]\]")


def extract_wiki_links(content: str, source_path: str) -> list[WikiLink]:
    """Extract [[target]] and [[target|text]] style links from wiki content."""
    links: list[WikiLink] = []

    # Match [[target|text]] pattern
    for m in _WIKI_LINK_TEXT_PATTERN.finditer(content):
        target = m.group(1).strip()
        text = m.group(2).strip()
        links.append(WikiLink(
            source_path=source_path,
            target_path=target,
            link_text=text,
            link_type="reference",
        ))

    # Match [[target]] pattern (without text override)
    for m in _WIKI_LINK_PATTERN.finditer(content):
        raw = m.group(1).strip()
        if "|" in raw:
            continue  # Already captured above
        links.append(WikiLink(
            source_path=source_path,
            target_path=raw,
            link_text=raw,
            link_type="reference",
        ))

    return links


async def build_link_graph() -> dict[str, Any]:
    """Build bidirectional link graph from all wiki pages."""
    idx = _load_index()
    base = _wiki_base_dir()

    all_links: list[WikiLink] = []
    for page in idx.pages:
        page_file = base / page.path
        if not page_file.is_file():
            continue
        content = page_file.read_text(encoding="utf-8", errors="replace")
        page_links = extract_wiki_links(content, page.path)
        all_links.extend(page_links)

    # Build adjacency
    forward: dict[str, list[str]] = {}
    backward: dict[str, list[str]] = {}
    for link in all_links:
        forward.setdefault(link.source_path, []).append(link.target_path)
        backward.setdefault(link.target_path, []).append(link.source_path)

    return {
        "links": [l.model_dump() for l in all_links],
        "forward": forward,
        "backward": backward,
        "total_links": len(all_links),
    }


async def build_knowledge_graph() -> KnowledgeGraph:
    """Build a knowledge graph for visualization."""
    idx = _load_index()
    base = _wiki_base_dir()

    nodes: list[dict] = []
    edges: list[dict] = []
    node_paths: set[str] = set()

    # Add nodes from wiki pages
    for page in idx.pages:
        nodes.append({
            "id": page.path,
            "label": page.name or Path(page.path).stem,
            "type": page.page_type,
            "page_path": page.path,
        })
        node_paths.add(page.path)

    # Extract links and build edges
    for page in idx.pages:
        page_file = base / page.path
        if not page_file.is_file():
            continue
        content = page_file.read_text(encoding="utf-8", errors="replace")
        page_links = extract_wiki_links(content, page.path)
        for link in page_links:
            # Resolve target path
            target = link.target_path
            if target not in node_paths:
                # Try to find a matching page
                for p in idx.pages:
                    if p.path.endswith(target) or p.name == target:
                        target = p.path
                        break

            edges.append({
                "source": page.path,
                "target": target,
                "type": link.link_type,
                "weight": 1,
            })

    return KnowledgeGraph(nodes=nodes, edges=edges)


async def semantic_search(query: str, case_id: str = "") -> list[dict[str, Any]]:
    """Search wiki pages, document summaries, and AI memories."""
    results: list[dict[str, Any]] = []

    # 1. Search wiki pages
    wiki_results = await query(keyword=query)
    for p in wiki_results:
        results.append({
            "type": "wiki_page",
            "path": p.path,
            "name": p.name,
            "page_type": p.page_type,
            "source": "wiki",
            "score": 1.0,
        })

    # 2. Search document metadata
    meta = _load_doc_meta()
    query_lower = query.lower()
    for doc_id, doc_data in meta.items():
        doc_name = doc_data.get("name", "")
        doc_tags = doc_data.get("tags", [])
        doc_category = doc_data.get("category", "")
        searchable = f"{doc_name} {doc_category} {' '.join(doc_tags)}".lower()
        if query_lower in searchable:
            results.append({
                "type": "document",
                "doc_id": doc_id,
                "name": doc_name,
                "category": doc_category,
                "source": "knowledge",
                "score": 0.8,
            })

    # 3. Search ReMe memory
    try:
        from ..agents.memory.reme_light_memory_manager import get_reme_manager
        reme = get_reme_manager()
        if reme:
            memories = await _sync_to_async(reme.search, query, top_k=5)
            for m in memories:
                results.append({
                    "type": "memory",
                    "content": m.get("content", "")[:300],
                    "metadata": m.get("metadata", {}),
                    "source": "reme",
                    "score": 0.6,
                })
    except Exception:
        pass

    # Sort by score
    results.sort(key=lambda x: x.get("score", 0), reverse=True)
    return results


async def _sync_to_async(fn, *args, **kwargs):
    """Run a sync function in async context."""
    import asyncio
    return await asyncio.to_thread(fn, *args, **kwargs)


async def auto_compile(doc_ids: list[str] | None = None) -> dict[str, Any]:
    """Auto-compile wiki pages and build bidirectional links."""
    # Run ingest first
    ingest_result = await ingest(doc_ids=doc_ids, force=True)

    # Build link graph
    link_graph = await build_link_graph()

    return {
        "ingest": ingest_result,
        "links": link_graph,
    }