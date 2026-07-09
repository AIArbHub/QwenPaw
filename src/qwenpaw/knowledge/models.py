# -*- coding: utf-8 -*-
from __future__ import annotations

from pydantic import BaseModel, Field


class KnowledgeDoc(BaseModel):
    id: str = Field(default="", description="Document unique ID")
    name: str = Field(default="", description="Original file name")
    file_path: str = Field(default="", description="Relative path under files/")
    tags: list[str] = Field(default_factory=list, description="Free-form tags")
    category: str = Field(default="", description="Single-select category, supports '/' hierarchy")
    owner: str = Field(default="", description="Single-select owner, supports '/' hierarchy")
    file_type: str = Field(default="", description="pdf / docx / md / jpg / xlsx ...")
    source: str = Field(default="upload", description="upload / scan / external")
    external_path: str = Field(default="", description="Original path for external references")
    size: int = Field(default=0, description="File size in bytes")
    status: str = Field(default="ready", description="uploading / parsing / indexing / ready / failed")
    created_at: str = Field(default="", description="ISO 8601 timestamp")
    updated_at: str = Field(default="", description="ISO 8601 timestamp")
    parse_mode: str = Field(default="auto", description="auto / cloud_ocr / local_only")
    checksum: str = Field(default="", description="SHA-256 file fingerprint")
    summary: str = Field(default="", description="Auto-generated summary after parsing")
    desensitized: bool = Field(default=False, description="Whether desensitization has been applied")


class FilterRule(BaseModel):
    field: str = Field(default="", description="category / owner / tags / file_type")
    op: str = Field(default="eq", description="eq / contains / prefix")
    value: str | list = Field(default="", description="Filter value")


class KnowledgeView(BaseModel):
    id: str = Field(default="", description="View unique ID")
    name: str = Field(default="", description="Display name")
    rules: list[FilterRule] = Field(default_factory=list, description="Filter rules")
    order: int = Field(default=0, description="Sort order")


class KnowledgeEnums(BaseModel):
    categories: list[str] = Field(default_factory=list, description="All category values")
    owners: list[str] = Field(default_factory=list, description="All owner values")
    tags: list[str] = Field(default_factory=list, description="All tag values")


class KnowledgeScopeConfig(BaseModel):
    include_rules: list[FilterRule] = Field(
        default_factory=list,
        description="Include rules (any match makes doc visible)",
    )
    exclude_rules: list[FilterRule] = Field(
        default_factory=list,
        description="Exclude rules (higher priority than include)",
    )
    external_paths: list[dict] = Field(
        default_factory=list,
        description="External knowledge folder references",
    )