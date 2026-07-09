# -*- coding: utf-8 -*-
from __future__ import annotations

from pydantic import BaseModel, Field


class CaseRef(BaseModel):
    case_id: str = Field(default="", description="Case unique ID")
    case_name: str = Field(default="", description="Human-readable case name")
    source_path: str = Field(default="", description="Absolute path to external case folder")
    scan_mode: str = Field(default="auto", description="auto / cloud_ocr / local_only")
    tags: list[str] = Field(default_factory=list, description="Case tags")
    file_count: int = Field(default=0, description="Number of files in case")
    total_size: int = Field(default=0, description="Total file size in bytes")
    index_status: str = Field(
        default="pending",
        description="pending / scanning / parsing / indexing / ready / failed",
    )
    last_scanned: str = Field(default="", description="ISO 8601 timestamp")
    enabled: bool = Field(default=True, description="Whether case is active")


class CaseFile(BaseModel):
    file_name: str = Field(default="", description="File name")
    file_path: str = Field(default="", description="Relative path under source_path")
    file_type: str = Field(default="", description="pdf / docx / jpg / ...")
    size: int = Field(default=0, description="File size in bytes")
    status: str = Field(default="pending", description="pending / parsing / ready / failed")
    parsed_path: str = Field(default="", description="Path to parsed markdown cache")
    desensitized: bool = Field(default=False, description="Whether desensitization has been applied")