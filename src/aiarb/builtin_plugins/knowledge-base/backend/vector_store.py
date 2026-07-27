# -*- coding: utf-8 -*-
"""基于 JSON 文件的向量存储适配器。

复用 ReMe 的向量层基础设施概念，但在知识库场景下使用 JSON 文件存储。
后续可渐进升级为真正的向量嵌入检索。
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import aiofiles
import orjson

logger = logging.getLogger(__name__)


# ── v5.0: 中文 n-gram 分词和评分（借鉴 StaffDeck _query_terms / _score_text）──


def _query_terms(query: str) -> list[str]:
    """中文 n-gram 分词，借鉴 StaffDeck _query_terms。

    对中文做 4/3/2 字滑动窗口扩展，解决中文无空格问题。
    """
    query = query.strip().lower()
    if not query:
        return []

    terms: list[str] = []
    parts = query.split()
    for part in parts:
        if part.isascii():
            terms.append(part)
        else:
            n = len(part)
            for size in (4, 3, 2):
                if n >= size:
                    for i in range(n - size + 1):
                        gram = part[i : i + size]
                        if gram not in terms:
                            terms.append(gram)
            if part not in terms:
                terms.append(part)
    return terms


def _score_text(query: str, content: str) -> float:
    """改进的词法评分，借鉴 StaffDeck _score_text。

    - 整句命中 +5.0
    - 中文 n-gram 按词长加权（4字 +3.0，3字 +2.5，2字 +2.0）
    - 英文按词长加权（>=5字 +3.4，3-4字 +2.0）
    - 上限 8.0
    """
    query_lower = query.lower().strip()
    content_lower = content.lower()

    if not query_lower or not content_lower:
        return 0.0

    score = 0.0

    if query_lower in content_lower:
        score += 5.0

    terms = _query_terms(query_lower)
    for term in terms:
        if term in content_lower:
            tlen = len(term)
            if tlen >= 5:
                score += 3.4
            elif tlen >= 4:
                score += 3.0
            elif tlen >= 3:
                score += 2.5
            elif tlen >= 2:
                score += 2.0
            else:
                score += 1.0

    return min(score, 8.0)


class KnowledgeVectorStore:
    """知识库向量存储。

    使用 JSON 文件持久化文档和分块。
    检索阶段先使用关键词匹配兜底，后续可升级为向量嵌入。
    """

    def __init__(self, storage_dir: Path):
        self._storage_dir = storage_dir
        self._index_file = storage_dir / "kb_index.json"
        self._docs_dir = storage_dir / "documents"
        self._initialized = False

    async def initialize(self) -> None:
        """初始化存储目录。"""
        self._storage_dir.mkdir(parents=True, exist_ok=True)
        self._docs_dir.mkdir(parents=True, exist_ok=True)
        if not self._index_file.exists():
            await self._write_index({"documents": []})
        self._initialized = True
        logger.info("知识库向量存储初始化完成: %s", self._storage_dir)

    async def _read_index(self) -> dict[str, Any]:
        """读取索引文件。"""
        if not self._index_file.exists():
            return {"documents": []}
        try:
            async with aiofiles.open(self._index_file, "rb") as f:
                return orjson.loads(await f.read())
        except Exception as e:
            logger.error("读取知识库索引失败: %s", e)
            return {"documents": []}

    async def _write_index(self, index: dict[str, Any]) -> None:
        """写入索引文件。"""
        try:
            async with aiofiles.open(self._index_file, "wb") as f:
                await f.write(orjson.dumps(index))
        except Exception as e:
            logger.error("写入知识库索引失败: %s", e)

    async def store_document(
        self,
        doc_id: str,
        title: str,
        chunks: list[str],
        tags: list[str],
        source_path: str,
        content_hash: str = "",
    ) -> dict[str, Any]:
        """存储文档及其分块。

        Args:
            doc_id: 文档 ID。
            title: 文档标题。
            chunks: 文本分块列表。
            tags: 文档标签。
            source_path: 原始文件路径。
            content_hash: 内容哈希。

        Returns:
            文档元数据字典。
        """
        doc_meta: dict[str, Any] = {
            "id": doc_id,
            "title": title,
            "tags": tags,
            "source_path": source_path,
            "content_hash": content_hash,
            "chunk_count": len(chunks),
            "status": "ready",
            "chunks": [],
        }

        for i, chunk_text in enumerate(chunks):
            chunk_id = f"{doc_id}_{i}"
            doc_meta["chunks"].append(
                {
                    "id": chunk_id,
                    "document_id": doc_id,
                    "content": chunk_text,
                    "index": i,
                }
            )

        # 持久化文档
        doc_file = self._docs_dir / f"{doc_id}.json"
        try:
            async with aiofiles.open(doc_file, "wb") as f:
                await f.write(orjson.dumps(doc_meta))
        except Exception as e:
            logger.error("存储文档 %s 失败: %s", doc_id, e)
            raise

        # 更新索引
        index = await self._read_index()
        docs_list = index.get("documents", [])
        # 移除同 ID 旧记录
        docs_list = [d for d in docs_list if d.get("id") != doc_id]
        docs_list.append(
            {
                "id": doc_id,
                "title": title,
                "tags": tags,
                "source_path": source_path,
                "chunk_count": len(chunks),
                "status": "ready",
            }
        )
        index["documents"] = docs_list
        await self._write_index(index)

        logger.info(
            "文档 %s 入库完成，分块数 %d",
            doc_id,
            len(chunks),
        )
        return doc_meta

    async def search(
        self,
        query: str,
        top_k: int = 5,
        filter_scope: str = "",
        filter_tags: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        """检索最相关的文档分块。

        当前实现：基于关键词匹配的检索。
        后续可升级为向量嵌入相似度检索。

        Args:
            query: 搜索查询。
            top_k: 返回结果数。
            filter_scope: 知识范围过滤（标签匹配）。
            filter_tags: 标签过滤。

        Returns:
            检索结果列表。
        """
        if not self._initialized:
            await self.initialize()

        results: list[dict[str, Any]] = []

        # 遍历所有文档
        index = await self._read_index()
        for doc_summary in index.get("documents", []):
            # 标签过滤
            doc_tags = doc_summary.get("tags", [])
            if filter_tags:
                if not any(t in doc_tags for t in filter_tags):
                    continue
            if filter_scope and filter_scope not in doc_tags:
                continue

            doc_id = doc_summary.get("id", "")
            doc_file = self._docs_dir / f"{doc_id}.json"
            if not doc_file.exists():
                continue

            try:
                async with aiofiles.open(doc_file, "rb") as f:
                    doc = orjson.loads(await f.read())
            except Exception:
                continue

            for chunk in doc.get("chunks", []):
                content = chunk.get("content", "")
                # v5.0: 使用改进的 _score_text 替换硬编码评分
                score = _score_text(query, content)

                if score > 0:
                    results.append(
                        {
                            "document_id": doc_id,
                            "document_title": doc_summary.get(
                                "title", ""
                            ),
                            "chunk_content": content,
                            "score": round(score, 4),
                            "metadata": {
                                "tags": doc_tags,
                                "chunk_index": chunk.get("index", 0),
                                "source_path": doc_summary.get(
                                    "source_path", ""
                                ),
                            },
                        }
                    )

        # 按分数降序排序
        results.sort(key=lambda x: x["score"], reverse=True)
        return results[:top_k]

    async def list_documents(self) -> list[dict[str, Any]]:
        """列出所有文档摘要。"""
        if not self._initialized:
            await self.initialize()
        index = await self._read_index()
        return index.get("documents", [])

    async def get_document(self, doc_id: str) -> dict[str, Any] | None:
        """获取单个文档详情。"""
        if not self._initialized:
            await self.initialize()
        doc_file = self._docs_dir / f"{doc_id}.json"
        if not doc_file.exists():
            return None
        try:
            async with aiofiles.open(doc_file, "rb") as f:
                return orjson.loads(await f.read())
        except Exception as e:
            logger.error("读取文档 %s 失败: %s", doc_id, e)
            return None

    async def delete_document(self, doc_id: str) -> bool:
        """删除文档。"""
        if not self._initialized:
            await self.initialize()

        # 删除文档文件
        doc_file = self._docs_dir / f"{doc_id}.json"
        if doc_file.exists():
            try:
                doc_file.unlink()
            except Exception as e:
                logger.error("删除文档文件 %s 失败: %s", doc_id, e)

        # 更新索引
        index = await self._read_index()
        docs_list = index.get("documents", [])
        original_len = len(docs_list)
        docs_list = [d for d in docs_list if d.get("id") != doc_id]
        index["documents"] = docs_list
        await self._write_index(index)

        return len(docs_list) < original_len

    async def search_in_documents(
        self,
        query: str,
        doc_ids: list[str],
        top_k: int = 5,
        filter_scope: str = "",
        filter_tags: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        """在指定文档范围内检索（多级漏斗用）。

        v5.0: 借鉴 StaffDeck 多级漏斗检索，缩小搜索范围。
        """
        if not self._initialized:
            await self.initialize()

        doc_id_set = set(doc_ids)
        results: list[dict[str, Any]] = []

        index = await self._read_index()
        for doc_summary in index.get("documents", []):
            if doc_summary.get("id", "") not in doc_id_set:
                continue

            # 标签过滤
            doc_tags = doc_summary.get("tags", [])
            if filter_tags:
                if not any(t in doc_tags for t in filter_tags):
                    continue
            if filter_scope and filter_scope not in doc_tags:
                continue

            doc_id = doc_summary.get("id", "")
            doc_file = self._docs_dir / f"{doc_id}.json"
            if not doc_file.exists():
                continue

            try:
                async with aiofiles.open(doc_file, "rb") as f:
                    doc = orjson.loads(await f.read())
            except Exception:
                continue

            for chunk in doc.get("chunks", []):
                content = chunk.get("content", "")
                score = _score_text(query, content)

                if score > 0:
                    results.append(
                        {
                            "document_id": doc_id,
                            "document_title": doc_summary.get("title", ""),
                            "chunk_content": content,
                            "score": round(score, 4),
                            "metadata": {
                                "tags": doc_tags,
                                "chunk_index": chunk.get("index", 0),
                                "source_path": doc_summary.get("source_path", ""),
                            },
                        }
                    )

        results.sort(key=lambda x: x["score"], reverse=True)
        return results[:top_k]
