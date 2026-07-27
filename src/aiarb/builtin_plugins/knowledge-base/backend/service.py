# -*- coding: utf-8 -*-
"""知识库服务 — 轻量解析器 + OKF 概念图 + 可追溯引用。

移除 doc_processing 依赖，改用内嵌 parser.py。
入库时构建 OKF 概念图并存储。
检索时返回概念 + 证据 + 引用。
"""

from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import aiofiles
import orjson

from .citations import knowledge_citations_from_results
from .discovery import DiscoveryManager, discover_suggestions
from .okf import (
    OKFConcept,
    build_okf_for_document,
    build_buckets_from_sections,
    build_sections_from_text,
    search_concepts,
)
from .parser import KnowledgeParseError, extract_text
from .vector_store import KnowledgeVectorStore

logger = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class KnowledgeBaseService:
    """知识库服务。"""

    _instance: "KnowledgeBaseService | None" = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self):
        if not hasattr(self, "_initialized"):
            self._vector_store: KnowledgeVectorStore | None = None
            self._storage_dir: Path | None = None
            self._okf_file: Path | None = None
            self._initialized = False

    async def initialize(self) -> None:
        """初始化服务。"""
        if self._initialized:
            return
        try:
            from aiarb.constant import WORKING_DIR

            self._storage_dir = WORKING_DIR / "knowledge_base"
        except Exception:
            self._storage_dir = Path.home() / ".aiarb" / "knowledge_base"

        self._storage_dir.mkdir(parents=True, exist_ok=True)
        self._okf_file = self._storage_dir / "okf_concepts.json"
        self._vector_store = KnowledgeVectorStore(self._storage_dir)
        await self._vector_store.initialize()
        # 初始化 OKF 存储文件
        if not self._okf_file.exists():
            await self._write_json(self._okf_file, {})
        self._initialized = True
        logger.info("知识库服务初始化完成")

    # ── JSON 读写辅助 ──────────────────────────────────────────────────

    async def _read_json(self, file_path: Path) -> dict[str, Any]:
        """读取 JSON 文件。"""
        if not file_path.exists():
            return {}
        try:
            async with aiofiles.open(file_path, "rb") as f:
                return orjson.loads(await f.read())
        except Exception as e:
            logger.error("读取 %s 失败: %s", file_path, e)
            return {}

    async def _write_json(self, file_path: Path, data: dict[str, Any]) -> None:
        """写入 JSON 文件。"""
        try:
            async with aiofiles.open(file_path, "wb") as f:
                await f.write(orjson.dumps(data))
        except Exception as e:
            logger.error("写入 %s 失败: %s", file_path, e)

    # ── OKF 存储 ────────────────────────────────────────────────────────

    async def _store_okf_concepts(self, doc_id: str, concepts: list[OKFConcept]) -> None:
        """存储 OKF 概念到 JSON 文件。"""
        if self._okf_file is None:
            return
        existing = await self._read_json(self._okf_file)
        existing[doc_id] = [c.to_dict() for c in concepts]
        await self._write_json(self._okf_file, existing)
        logger.info("文档 %s 存储 %d 个 OKF 概念", doc_id, len(concepts))

    async def _load_okf_concepts(self, doc_id: str | None = None) -> list[OKFConcept]:
        """加载 OKF 概念。"""
        if self._okf_file is None:
            return []
        data = await self._read_json(self._okf_file)
        concepts: list[OKFConcept] = []
        if doc_id:
            concept_dicts = data.get(doc_id, [])
            concepts = [OKFConcept.from_dict(c) for c in concept_dicts]
        else:
            for doc_concepts in data.values():
                if isinstance(doc_concepts, list):
                    concepts.extend(OKFConcept.from_dict(c) for c in doc_concepts)
        return concepts

    async def _delete_okf_concepts(self, doc_id: str) -> None:
        """删除文档的 OKF 概念。"""
        if self._okf_file is None:
            return
        data = await self._read_json(self._okf_file)
        if doc_id in data:
            del data[doc_id]
            await self._write_json(self._okf_file, data)

    # ── 入库 ────────────────────────────────────────────────────────────

    async def ingest_document(self, request: Any) -> dict[str, Any]:
        """入库文档（通过文件路径）。

        步骤：
        1. 轻量解析（不依赖 doc_processing）
        2. 分块
        3. 构建 OKF 概念图（v5.0: LLM 分桶 + 规则回退）
        4. 存储到向量库 + OKF 存储
        5. 知识自发现（v5.0: LLM 发现 + 规则回退）
        """
        await self.initialize()

        # 获取 agent_id（用于 LLM 调用）
        agent_id = getattr(request, "agent_id", None) or None

        # Step 1: 轻量解析
        try:
            with open(request.file_path, "rb") as f:
                content = f.read()
            text, fmt = extract_text(request.file_path, content)
        except KnowledgeParseError as e:
            logger.error("文档解析失败: %s", e)
            return {"success": False, "error": str(e)}
        except Exception as e:
            logger.error("文档读取失败: %s", e)
            return {"success": False, "error": f"文档读取失败: {e}"}

        if not text.strip():
            return {"success": False, "error": "文档解析结果为空"}

        # Step 2: 分块
        chunks = self._chunk_text(
            text,
            request.chunk_size,
            request.chunk_overlap,
        )

        # Step 3: 存储
        content_hash = hashlib.sha256(text.encode()).hexdigest()
        doc_id = content_hash[:16]

        title = request.title or Path(request.file_path).stem
        await self._vector_store.store_document(
            doc_id=doc_id,
            title=title,
            chunks=chunks,
            tags=request.tags,
            source_path=request.file_path,
            content_hash=content_hash,
        )

        # Step 4: 构建 OKF 概念图（v5.0: LLM 分桶）
        sections = build_sections_from_text(text)
        buckets = await _build_buckets_with_llm_fallback(sections, agent_id)
        concepts = build_okf_for_document(doc_id, title, sections, buckets)
        await self._store_okf_concepts(doc_id, concepts)

        # Step 5: 知识自发现（v5.0: LLM 发现）
        try:
            discovery_mgr = DiscoveryManager()
            await discovery_mgr.initialize()
            suggestions = await discovery_mgr.discover_with_llm(
                doc_id, title, sections, buckets, agent_id,
            )
            if suggestions:
                await discovery_mgr.add_suggestions(suggestions)
                logger.info(
                    "文档 %s 发现 %d 条建议",
                    doc_id,
                    len(suggestions),
                )
        except Exception as e:
            logger.warning("知识自发现失败: %s", e)

        return {
            "success": True,
            "document_id": doc_id,
            "chunk_count": len(chunks),
            "title": title,
            "format": fmt,
            "okf_concept_count": len(concepts),
        }

    async def ingest_text(self, request: Any) -> dict[str, Any]:
        """直接文本入库。"""
        await self.initialize()

        # 获取 agent_id（用于 LLM 调用）
        agent_id = getattr(request, "agent_id", None) or None

        text = request.text
        if not text.strip():
            return {"success": False, "error": "文本内容为空"}

        # Step 1: 分块
        chunks = self._chunk_text(
            text,
            request.chunk_size,
            request.chunk_overlap,
        )

        # Step 2: 存储
        content_hash = hashlib.sha256(text.encode()).hexdigest()
        doc_id = content_hash[:16]

        title = request.title or f"文档_{doc_id[:8]}"
        await self._vector_store.store_document(
            doc_id=doc_id,
            title=title,
            chunks=chunks,
            tags=request.tags,
            source_path="(text_input)",
            content_hash=content_hash,
        )

        # Step 3: 构建 OKF 概念图（v5.0: LLM 分桶）
        sections = build_sections_from_text(text)
        buckets = await _build_buckets_with_llm_fallback(sections, agent_id)
        concepts = build_okf_for_document(doc_id, title, sections, buckets)
        await self._store_okf_concepts(doc_id, concepts)

        # Step 4: 知识自发现（v5.0: LLM 发现）
        try:
            discovery_mgr = DiscoveryManager()
            await discovery_mgr.initialize()
            suggestions = await discovery_mgr.discover_with_llm(
                doc_id, title, sections, buckets, agent_id,
            )
            if suggestions:
                await discovery_mgr.add_suggestions(suggestions)
                logger.info(
                    "文档 %s 发现 %d 条建议",
                    doc_id,
                    len(suggestions),
                )
        except Exception as e:
            logger.warning("知识自发现失败: %s", e)

        return {
            "success": True,
            "document_id": doc_id,
            "chunk_count": len(chunks),
            "title": title,
            "okf_concept_count": len(concepts),
        }

    def _chunk_text(
        self,
        text: str,
        chunk_size: int,
        overlap: int,
    ) -> list[str]:
        """简单分块（按字符数，重叠窗口）。"""
        chunks: list[str] = []
        start = 0
        while start < len(text):
            end = start + chunk_size
            chunk = text[start:end].strip()
            if chunk:
                chunks.append(chunk)
            if end >= len(text):
                break
            start = end - overlap
            if start < 0:
                start = 0
        return chunks

    # ── 检索 ────────────────────────────────────────────────────────────

    async def search(
        self,
        query: str,
        top_k: int = 5,
        knowledge_scope: str = "",
        filter_tags: list[str] | None = None,
        agent_id: str | None = None,
    ) -> dict[str, Any]:
        """多级漏斗检索，借鉴 StaffDeck _search。

        Level 1: OKF 概念搜索（已有，保留）
        Level 2: 文档级筛选（新增：LLM 路由或词法评分）
        Level 3: chunk 排序（已有，改用 _score_text）

        Returns:
            {
                "chunks": [...],       # 向量检索结果
                "concepts": [...],     # OKF 概念搜索结果
                "citations": [...],    # 引用列表
                "trace": [...],        # v5.0: 检索路由追踪
            }
        """
        await self.initialize()
        if self._vector_store is None:
            return {"chunks": [], "concepts": [], "citations": [], "trace": []}

        trace: list[dict] = []  # v5.0: 检索路由追踪

        # Level 1: OKF 概念搜索（保留现有逻辑）
        all_concepts = await self._load_okf_concepts()
        concept_results = search_concepts(all_concepts, query, top_k=3)
        selected_concepts = [c for c, _ in concept_results]
        trace.append({"phase": "concept_search", "hit_count": len(concept_results)})

        # Level 2: 文档级筛选
        all_docs = await self._vector_store.list_documents()
        trace.append({"phase": "document_load", "candidate_count": len(all_docs)})

        # 尝试 LLM 文档路由
        selected_doc_ids = await _route_documents(
            query, all_docs, concept_results, agent_id, trace,
        )

        # Level 3: chunk 检索（在选中文档范围内）
        if selected_doc_ids:
            chunks = await self._vector_store.search_in_documents(
                query, selected_doc_ids, top_k=top_k,
                filter_scope=knowledge_scope, filter_tags=filter_tags,
            )
        else:
            # 回退：全量检索
            chunks = await self._vector_store.search(
                query=query,
                top_k=top_k,
                filter_scope=knowledge_scope,
                filter_tags=filter_tags,
            )
        trace.append({"phase": "chunk_rank", "result_count": len(chunks)})

        # 生成引用（保留现有逻辑）
        citations = knowledge_citations_from_results(
            {
                "selected_concepts": [c.to_dict() for c in selected_concepts],
                "evidence_pack": chunks[:top_k],
            },
            limit=4,
        )

        return {
            "chunks": chunks,
            "concepts": [
                {"concept": c.to_dict(), "score": s}
                for c, s in concept_results
            ],
            "citations": citations,
            "trace": trace,  # v5.0: 检索路由追踪
        }

    # ── 文档管理 ────────────────────────────────────────────────────────

    async def list_documents(self) -> list[dict[str, Any]]:
        """列出所有文档。"""
        await self.initialize()
        if self._vector_store is None:
            return []
        return await self._vector_store.list_documents()

    async def get_document(self, doc_id: str) -> dict[str, Any] | None:
        """获取文档详情。"""
        await self.initialize()
        if self._vector_store is None:
            return None
        doc = await self._vector_store.get_document(doc_id)
        if doc is None:
            return None
        # 附带 OKF 概念
        concepts = await self._load_okf_concepts(doc_id)
        doc["okf_concepts"] = [c.to_dict() for c in concepts]
        return doc

    async def delete_document(self, doc_id: str) -> bool:
        """删除文档。"""
        await self.initialize()
        if self._vector_store is None:
            return False
        success = await self._vector_store.delete_document(doc_id)
        if success:
            await self._delete_okf_concepts(doc_id)
        return success

    async def list_okf_concepts(self, doc_id: str | None = None) -> list[dict[str, Any]]:
        """列出 OKF 概念。"""
        await self.initialize()
        concepts = await self._load_okf_concepts(doc_id)
        return [c.to_dict() for c in concepts]

    async def lint_okf(self, doc_id: str | None = None) -> list[dict[str, str]]:
        """对 OKF 概念进行健康检查。"""
        await self.initialize()
        from .okf import lint_concepts
        concepts = await self._load_okf_concepts(doc_id)
        return lint_concepts(concepts)

    async def list_discovery_suggestions(
        self,
        status: str | None = None,
        doc_id: str | None = None,
    ) -> list[dict[str, Any]]:
        """列出发现建议。"""
        await self.initialize()
        discovery_mgr = DiscoveryManager()
        await discovery_mgr.initialize()
        return await discovery_mgr.list_suggestions(status=status, doc_id=doc_id)

    async def update_suggestion_status(
        self,
        suggestion_id: str,
        status: str,
    ) -> bool:
        """更新建议状态。"""
        await self.initialize()
        discovery_mgr = DiscoveryManager()
        await discovery_mgr.initialize()
        return await discovery_mgr.update_suggestion_status(suggestion_id, status)


# ── Agent 可调用的知识库检索工具 ──────────────────────────────────────────


async def kb_search_tool(query: str, top_k: int = 5) -> str:
    """Agent 可调用的知识库检索工具。

    Args:
        query: 搜索查询文本。
        top_k: 返回结果数量。

    Returns:
        格式化的检索结果文本（含引用编号）。
    """
    svc = KnowledgeBaseService()
    await svc.initialize()
    result = await svc.search(query, top_k=top_k)
    chunks = result.get("chunks", [])
    concepts = result.get("concepts", [])
    citations = result.get("citations", [])

    if not chunks and not concepts:
        return "(无相关知识)"

    parts: list[str] = []
    for i, r in enumerate(chunks):
        label = f"[{i + 1}]"
        parts.append(
            f"{label} [{r['document_title']}] (score: {r['score']:.2f})\n"
            f"{r['chunk_content']}"
        )

    if concepts:
        parts.append("\n--- 相关概念 ---")
        for c_info in concepts:
            c = c_info["concept"]
            parts.append(
                f"[{c.get('concept_id', '')}] {c.get('title', '')} "
                f"(score: {c_info['score']:.2f})\n"
                f"{c.get('description', '')}"
            )

    # 附带引用来源
    if citations:
        parts.append("\n--- 引用来源 ---")
        for cite in citations:
            parts.append(
                f"{cite['label']} {cite['kind']}: {cite['title']}"
            )

    return "\n---\n".join(parts)


# ── v5.0: LLM 分桶 + 文档路由辅助函数 ─────────────────────────────────────


async def _build_buckets_with_llm_fallback(
    sections: list[dict[str, str]],
    agent_id: str | None = None,
) -> dict[str, list[dict[str, str]]]:
    """LLM 分桶 + 规则回退。

    借鉴 StaffDeck _build_buckets：先取 model_config，有则 LLM 分桶，无则/失败则规则分桶。
    """
    # 先尝试 LLM 分桶
    try:
        from .kb_llm import kb_generate_json, BUCKET_PROMPT

        if not BUCKET_PROMPT.exists():
            logger.warning("Bucket prompt file not found, falling back to rule-based bucketing")
            return build_buckets_from_sections(sections)

        # 构造 StaffDeck 格式的 section_nodes
        section_nodes = []
        for i, s in enumerate(sections[:60]):  # StaffDeck 限制最多 60 个 section
            content = s.get("content", "")
            section_nodes.append({
                "section_id": str(i),
                "path": s.get("title", ""),
                "title": s.get("title", ""),
                "summary": content[:180],
                "excerpt": content[:1800],
            })

        payload = {"sections": section_nodes}
        raw = await kb_generate_json(BUCKET_PROMPT, payload, agent_id)

        # StaffDeck LLM 返回: {buckets: [{bucket_key, title, summary, bucket_type, concept_type, section_ids, applicable_query_types}]}
        llm_buckets = raw.get("buckets", [])
        if not isinstance(llm_buckets, list) or not llm_buckets:
            logger.info("LLM bucketing returned empty, falling back to rules")
            return build_buckets_from_sections(sections)

        # 转换 LLM 桶为 QwenPaw 的 OKF bucket 格式 {topics: [], playbooks: [], rules: []}
        return _convert_llm_buckets_to_okf_format(llm_buckets, sections)

    except Exception as e:
        logger.warning("LLM bucketing failed: %s, falling back to rule-based bucketing", e)
        return build_buckets_from_sections(sections)


def _convert_llm_buckets_to_okf_format(
    llm_buckets: list[dict],
    sections: list[dict[str, str]],
) -> dict[str, list[dict[str, str]]]:
    """把 StaffDeck LLM 桶格式转换为 QwenPaw OKF bucket 格式。

    StaffDeck LLM 桶: {bucket_key, title, summary, bucket_type, concept_type, section_ids}
    QwenPaw OKF 桶: {topics: [{title, content}], playbooks: [...], rules: [...]}

    concept_type 映射: Topic -> topics, Playbook -> playbooks, Business Rule -> rules
    """
    buckets: dict[str, list[dict[str, str]]] = {"topics": [], "playbooks": [], "rules": []}

    # section_id -> section 映射
    section_map = {str(i): s for i, s in enumerate(sections)}

    for lb in llm_buckets:
        if not isinstance(lb, dict):
            continue
        concept_type = str(lb.get("concept_type", "Topic")).strip()
        title = str(lb.get("title", lb.get("bucket_key", "未命名")))
        summary = str(lb.get("summary", ""))

        # 根据 section_ids 收集内容
        section_ids = lb.get("section_ids", [])
        if isinstance(section_ids, list):
            content_parts = []
            for sid in section_ids:
                s = section_map.get(str(sid))
                if s:
                    content_parts.append(f"## {s.get('title', '')}\n{s.get('content', '')}")
            content = "\n\n".join(content_parts) if content_parts else summary
        else:
            content = summary

        bucket_item = {"title": title, "content": content}

        if concept_type == "Playbook":
            buckets["playbooks"].append(bucket_item)
        elif concept_type == "Business Rule":
            buckets["rules"].append(bucket_item)
        else:
            buckets["topics"].append(bucket_item)

    # 若 LLM 桶为空，回退
    if not any(buckets.values()):
        return build_buckets_from_sections(sections)

    return buckets


async def _route_documents(
    query: str,
    documents: list[dict],
    concept_results: list,
    agent_id: str | None,
    trace: list[dict],
) -> list[str]:
    """文档级路由：LLM 路由或词法评分。

    借鉴 StaffDeck _select_documents_with_llm / _score_documents。
    """
    # 合并概念关联的 document_id
    concept_doc_ids = set()
    for concept, _ in concept_results:
        if isinstance(concept, dict):
            doc_id = concept.get("document_id", "")
        else:
            doc_id = getattr(concept, "document_id", "")
        if doc_id:
            concept_doc_ids.add(doc_id)

    # 尝试 LLM 路由
    try:
        from .kb_llm import kb_generate_json, DOCUMENT_ROUTE_PROMPT

        if DOCUMENT_ROUTE_PROMPT.exists() and documents:
            # 构造文档卡片（借鉴 StaffDeck _document_card_for_route）
            doc_cards = []
            for doc in documents[:40]:  # 最多 40 个候选
                doc_cards.append({
                    "id": doc.get("id", ""),
                    "title": (doc.get("title", "") or "")[:120],
                    "filename": (doc.get("source_path", "") or "")[:120],
                    "summary": (doc.get("title", "") or "")[:160],
                    "chunk_count": doc.get("chunk_count", 0),
                })

            payload = {
                "query": query,
                "max_documents": 5,
                "documents": doc_cards,
            }
            raw = await kb_generate_json(DOCUMENT_ROUTE_PROMPT, payload, agent_id)
            selected = raw.get("selected_document_ids", [])
            if isinstance(selected, list) and selected:
                # 合并概念关联文档
                selected_set = set(str(s) for s in selected) | concept_doc_ids
                trace.append({"phase": "document_route_llm", "selected": list(selected_set)})
                return list(selected_set)[:5]
    except Exception as e:
        trace.append({"phase": "document_route_llm_failed", "message": str(e)})

    # 回退：词法评分（借鉴 StaffDeck _score_documents）
    from .vector_store import _score_text

    scored = []
    for doc in documents:
        score = _score_text(query, doc.get("title", ""))
        if score > 0:
            scored.append((doc.get("id", ""), score))
    scored.sort(key=lambda x: x[1], reverse=True)

    selected = [doc_id for doc_id, _ in scored[:5]]
    # 合并概念关联文档
    selected_set = set(selected) | concept_doc_ids
    trace.append({"phase": "document_route_lexical", "selected": list(selected_set)})
    return list(selected_set)[:5]
