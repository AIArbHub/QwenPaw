# -*- coding: utf-8 -*-
from __future__ import annotations

from typing import Literal, Optional
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
    # Extended fields for material zones and tags
    zone: Optional[Literal["shared", "claimant", "respondent", "arbitrator", "secretary"]] = None
    category: Optional[str] = None
    custom_tags: list[str] = Field(default_factory=list)


class CaseStructuredInfo(BaseModel):
    case_id: str
    case_number: Optional[str] = None
    arbitration_institution: Optional[str] = None
    dispute_type: Optional[str] = None
    claim_amount: Optional[float] = None
    arbitration_procedure: str = "普通程序"
    arbitration_rules: Optional[str] = None
    filing_date: Optional[str] = None
    hearing_date: Optional[str] = None
    case_summary: Optional[str] = None
    parties: list[CaseParty] = Field(default_factory=list)


class CaseParty(BaseModel):
    party_id: Optional[str] = None
    party_type: Literal["claimant", "respondent"]
    name: str
    legal_representative: Optional[str] = None
    contact: Optional[str] = None
    address: Optional[str] = None
    counsel: Optional[str] = None


class FileTag(BaseModel):
    tag_id: str
    case_id: str
    file_path: str
    zone: Literal["shared", "claimant", "respondent", "arbitrator", "secretary"] = "shared"
    category: str = ""
    custom_tags: list[str] = Field(default_factory=list)
    description: Optional[str] = None
    created_at: float
    updated_at: float


class AIOrganizeResult(BaseModel):
    id: Optional[str] = None
    case_id: str
    backup_path: str = ""
    organized_files: list[dict]
    summary: str = ""
    dry_run: bool = True
    timestamp: float


class CaseAIChatMessage(BaseModel):
    id: Optional[str] = None
    case_id: str
    role: Literal["user", "assistant", "system"]
    content: str
    documents: list[dict] = Field(default_factory=list)
    timestamp: float


class ProcessingRecord(BaseModel):
    id: Optional[str] = None
    file_name: str
    file_type: str = ""
    file_size: int = 0
    engine_used: str = ""
    status: Literal["success", "failed", "processing"] = "success"
    duration: float = 0
    pages: Optional[int] = None
    has_images: bool = False
    has_tables: bool = False
    preview_content: str = ""
    timestamp: float