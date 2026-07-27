# -*- coding: utf-8 -*-
"""知识库数据模型。"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class KnowledgeDocument(BaseModel):
    """知识库文档。"""

    id: str
    title: str
    source_path: str = ""
    content: str = ""
    content_hash: str = ""
    chunk_count: int = 0
    status: str = "pending"  # pending / processing / ready / failed
    error: str = ""
    tags: list[str] = Field(default_factory=list)
    created_at: str = ""
    updated_at: str = ""


class KnowledgeChunk(BaseModel):
    """文档分块。"""

    id: str
    document_id: str
    content: str
    embedding: list[float] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class IngestRequest(BaseModel):
    """入库请求。"""

    file_path: str
    title: str = ""
    tags: list[str] = Field(default_factory=list)
    chunk_size: int = 512
    chunk_overlap: int = 50
    agent_id: str = ""


class IngestTextRequest(BaseModel):
    """直接文本入库请求。"""

    text: str
    title: str = ""
    tags: list[str] = Field(default_factory=list)
    chunk_size: int = 512
    chunk_overlap: int = 50
    agent_id: str = ""


class SearchRequest(BaseModel):
    """检索请求。"""

    query: str
    top_k: int = 5
    knowledge_scope: str = ""
    filter_tags: list[str] = Field(default_factory=list)
    agent_id: str = ""


class SearchResult(BaseModel):
    """检索结果。"""

    document_id: str
    document_title: str
    chunk_content: str
    score: float
    metadata: dict[str, Any] = Field(default_factory=dict)
