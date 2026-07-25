# -*- coding: utf-8 -*-
from __future__ import annotations

from pydantic import BaseModel, Field


class WikiPage(BaseModel):
    path: str = Field(default="", description="Relative path under wiki/, e.g. concepts/合同纠纷.md")
    name: str = Field(default="", description="Page title")
    page_type: str = Field(
        default="concept",
        description="concept / case / comparison / synthesis / index / log",
    )
    source_doc_ids: list[str] = Field(
        default_factory=list,
        description="IDs of source documents this page was compiled from",
    )
    source_case_ids: list[str] = Field(
        default_factory=list,
        description="IDs of source cases this page was compiled from",
    )
    updated_at: str = Field(default="", description="ISO 8601 timestamp")


class WikiIndex(BaseModel):
    pages: list[WikiPage] = Field(default_factory=list, description="All wiki pages")
    last_ingest: str = Field(default="", description="ISO 8601 timestamp of last ingest")
    last_lint: str = Field(default="", description="ISO 8601 timestamp of last lint")


class WikiLink(BaseModel):
    """Wiki 页面间的双向链接"""
    source_path: str = Field(default="", description="Source wiki page path")
    target_path: str = Field(default="", description="Target wiki page path")
    link_text: str = Field(default="", description="Link display text")
    link_type: str = Field(default="reference", description="reference / contrast / subtopic")


class KnowledgeGraph(BaseModel):
    """知识图谱"""
    nodes: list[dict] = Field(
        default_factory=list,
        description="Graph nodes: {id, label, type, page_path}",
    )
    edges: list[dict] = Field(
        default_factory=list,
        description="Graph edges: {source, target, type, weight}",
    )
