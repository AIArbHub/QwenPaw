# -*- coding: utf-8 -*-
"""Data models for moot arbitration practice multi-agent system."""

from __future__ import annotations

import hashlib
import time
import uuid
from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class CollaborationMode(str, Enum):
    HUMAN_LEAD = "human_lead"
    AI_LEAD = "ai_lead"
    FULL_AI = "full_ai"
    FULL_HUMAN = "full_human"


COLLABORATION_MODE_LABELS: Dict[CollaborationMode, str] = {
    CollaborationMode.HUMAN_LEAD: "人主AI辅",
    CollaborationMode.AI_LEAD: "人辅AI主",
    CollaborationMode.FULL_AI: "全AI",
    CollaborationMode.FULL_HUMAN: "全人",
}


class RoleCategory(str, Enum):
    ARBITRATOR = "arbitrator"
    PARTY = "party"
    SECRETARY = "secretary"
    CONTROLLER = "controller"


ROLE_CATEGORY_LABELS: Dict[RoleCategory, str] = {
    RoleCategory.ARBITRATOR: "仲裁员",
    RoleCategory.PARTY: "当事人",
    RoleCategory.SECRETARY: "仲裁秘书",
    RoleCategory.CONTROLLER: "主控",
}


class CaseStage(str, Enum):
    DRAFT = "draft"
    FILING = "filing"
    SERVICE = "service"
    DEFENSE = "defense"
    ARBITRATOR_SELECTION = "arbitrator_selection"
    TRIBUNAL_FORMATION = "tribunal_formation"
    JURISDICTION_OBJECTION = "jurisdiction_objection"
    CHALLENGE = "challenge"
    APPRAISAL = "appraisal"
    MERGER = "merger"
    PRE_HEARING = "pre_hearing"
    HEARING = "hearing"
    DELIBERATION = "deliberation"
    AWARD = "award"
    ENFORCEMENT = "enforcement"
    CLOSED = "closed"


CASE_STAGE_LABELS: Dict[CaseStage, str] = {
    CaseStage.DRAFT: "草稿",
    CaseStage.FILING: "立案",
    CaseStage.SERVICE: "送达",
    CaseStage.DEFENSE: "答辩",
    CaseStage.ARBITRATOR_SELECTION: "选定仲裁员",
    CaseStage.TRIBUNAL_FORMATION: "组庭",
    CaseStage.JURISDICTION_OBJECTION: "管辖权异议",
    CaseStage.CHALLENGE: "回避申请",
    CaseStage.APPRAISAL: "鉴定",
    CaseStage.MERGER: "合并审理",
    CaseStage.PRE_HEARING: "庭前准备",
    CaseStage.HEARING: "开庭审理",
    CaseStage.DELIBERATION: "合议",
    CaseStage.AWARD: "裁决",
    CaseStage.ENFORCEMENT: "执行",
    CaseStage.CLOSED: "结案",
}


class EventType(str, Enum):
    STAGE_CHANGE = "stage_change"
    PARTY_CHANGE = "party_change"
    PROCEDURE_CHANGE = "procedure_change"
    TRIBUNAL_CHANGE = "tribunal_change"
    CLAIM_CHANGE = "claim_change"
    RULE_CHANGE = "rule_change"
    COLLABORATION_MODE_CHANGE = "collaboration_mode_change"
    PROCEDURAL_APPLICATION = "procedural_application"
    PROCEDURAL_DECISION = "procedural_decision"
    FILE_UPLOADED = "file_uploaded"
    FILE_SHARED = "file_shared"
    FILE_VERSIONED = "file_versioned"
    FILE_DELETED = "file_deleted"


class FileVisibility(str, Enum):
    PRIVATE = "private"
    SHARED = "shared"
    DIRECTED = "directed"


FILE_VISIBILITY_LABELS: Dict[FileVisibility, str] = {
    FileVisibility.PRIVATE: "私有文件",
    FileVisibility.SHARED: "庭审共享",
    FileVisibility.DIRECTED: "定向共享",
}


class FileBlob(BaseModel):
    blob_id: str = Field(default="", description="SHA-256 hex digest of content")
    size: int = 0
    mime_type: str = "application/octet-stream"
    ref_count: int = 1
    created_at: float = Field(default_factory=time.time)

    @staticmethod
    def compute_blob_id(content: bytes) -> str:
        return hashlib.sha256(content).hexdigest()


class MootCaseFile(BaseModel):
    file_id: str = Field(default_factory=lambda: uuid.uuid4().hex[:12])
    case_id: str = ""
    blob_id: str = ""
    filename: str = ""
    original_filename: str = ""
    description: str = ""
    owner_participant_id: str = ""
    visibility: FileVisibility = FileVisibility.PRIVATE
    allowed_participant_ids: List[str] = Field(default_factory=list)
    category: str = ""
    tags: List[str] = Field(default_factory=list)
    version: int = 1
    parent_file_id: Optional[str] = None
    uploaded_at: float = Field(default_factory=time.time)
    updated_at: float = Field(default_factory=time.time)


class UploadFileRequest(BaseModel):
    filename: str
    description: str = ""
    owner_participant_id: str
    visibility: FileVisibility = FileVisibility.PRIVATE
    allowed_participant_ids: List[str] = Field(default_factory=list)
    category: str = ""
    tags: List[str] = Field(default_factory=list)


class UpdateFileVisibilityRequest(BaseModel):
    visibility: FileVisibility
    allowed_participant_ids: Optional[List[str]] = None


class Participant(BaseModel):
    participant_id: str = Field(default="")
    agent_id: str
    display_name: str
    role: RoleCategory
    role_detail: str = Field(default="", description="e.g. chief_arbitrator, claimant_1, respondent_1")
    collaboration_mode: CollaborationMode = Field(default=CollaborationMode.AI_LEAD)
    joined_at: float = Field(default_factory=time.time)
    active: bool = Field(default=True)


class CaseEvent(BaseModel):
    event_id: str = Field(default="")
    event_type: EventType
    description: str
    data: Dict[str, Any] = Field(default_factory=dict)
    timestamp: float = Field(default_factory=time.time)
    actor_participant_id: Optional[str] = None


class MootMessage(BaseModel):
    id: str = Field(default="")
    case_id: str = Field(default="")
    participant_id: str
    agent_id: str
    display_name: str
    role: RoleCategory
    content: str
    stage: CaseStage
    timestamp: float = Field(default_factory=time.time)
    is_system: bool = Field(default=False)


class MootCase(BaseModel):
    case_id: str
    case_name: str = Field(default="仲裁模拟案")
    case_description: str = Field(default="")
    status: str = Field(default="draft")
    current_stage: CaseStage = Field(default=CaseStage.DRAFT)
    rules: List[str] = Field(default_factory=list, description="Applied arbitration rules")
    participants: List[Participant] = Field(default_factory=list)
    events: List[CaseEvent] = Field(default_factory=list)
    messages: List[MootMessage] = Field(default_factory=list)
    controller_participant_id: Optional[str] = Field(default=None, description="Main controller agent")
    created_at: float = Field(default_factory=time.time)
    updated_at: float = Field(default_factory=time.time)
    current_speaker: Optional[str] = None


class CreateCaseRequest(BaseModel):
    case_name: str = Field(default="仲裁模拟案")
    case_description: str = Field(default="")
    rules: List[str] = Field(default_factory=list)


class AddParticipantRequest(BaseModel):
    agent_id: Optional[str] = Field(default=None, description="Existing agent ID")
    new_agent_name: Optional[str] = Field(default=None, description="Name for quick-create agent")
    new_agent_description: Optional[str] = Field(default=None)
    display_name: str
    role: RoleCategory
    role_detail: str = Field(default="")
    collaboration_mode: CollaborationMode = Field(default=CollaborationMode.AI_LEAD)


class SpeakRequest(BaseModel):
    participant_id: str
    content: str


class AutoSpeakRequest(BaseModel):
    participant_id: str
    prompt: str = Field(default="请根据案件上下文发言")


class StageTransitionRequest(BaseModel):
    stage: CaseStage
    description: Optional[str] = None


class UpdateParticipantRequest(BaseModel):
    collaboration_mode: Optional[CollaborationMode] = None
    role_detail: Optional[str] = None
    active: Optional[bool] = None


class RemoveParticipantRequest(BaseModel):
    participant_id: str


class CaseEventRequest(BaseModel):
    event_type: EventType
    description: str
    data: Dict[str, Any] = Field(default_factory=dict)


class MootCaseSummary(BaseModel):
    case_id: str
    case_name: str
    status: str
    current_stage: CaseStage
    current_stage_label: str
    rules: List[str]
    participants: List[Dict[str, Any]]
    message_count: int
    event_count: int
    created_at: float
    current_speaker: Optional[str] = None


class CaseTemplate(BaseModel):
    template_id: str
    name: str
    description: str
    case_name: str = Field(default="仲裁模拟案")
    case_description: str = Field(default="")
    rules: List[str] = Field(default_factory=list)
    default_participants: List[Dict[str, str]] = Field(default_factory=list)


CASE_TEMPLATES: List[CaseTemplate] = [
    CaseTemplate(
        template_id="sales_contract",
        name="买卖合同纠纷",
        description="因买卖合同履行、质量、交付等引发的仲裁模拟案件",
        case_name="买卖合同纠纷仲裁模拟案",
        case_description="申请人与被申请人因买卖合同履行发生争议，申请人依据合同中的仲裁条款向仲裁委员会申请仲裁。",
        rules=["北京仲裁委员会仲裁规则"],
        default_participants=[
            {"role": "party", "role_detail": "申请人", "display_name": "买方"},
            {"role": "party", "role_detail": "被申请人", "display_name": "卖方"},
            {"role": "arbitrator", "role_detail": "首席仲裁员", "display_name": "首席仲裁员"},
            {"role": "secretary", "role_detail": "仲裁秘书", "display_name": "仲裁秘书"},
        ],
    ),
    CaseTemplate(
        template_id="construction",
        name="建设工程纠纷",
        description="因建设工程施工合同价款、质量、工期等引发的仲裁模拟案件",
        case_name="建设工程纠纷仲裁模拟案",
        case_description="申请人与被申请人因建设工程施工合同的工程款结算、工程质量等事项发生争议，申请人依据仲裁条款申请仲裁。",
        rules=["北京仲裁委员会仲裁规则", "建设工程争议评审规则"],
        default_participants=[
            {"role": "party", "role_detail": "申请人", "display_name": "发包方"},
            {"role": "party", "role_detail": "被申请人", "display_name": "承包方"},
            {"role": "arbitrator", "role_detail": "首席仲裁员", "display_name": "首席仲裁员"},
            {"role": "arbitrator", "role_detail": "仲裁员", "display_name": "仲裁员一"},
            {"role": "arbitrator", "role_detail": "仲裁员", "display_name": "仲裁员二"},
            {"role": "secretary", "role_detail": "仲裁秘书", "display_name": "仲裁秘书"},
        ],
    ),
    CaseTemplate(
        template_id="loan_contract",
        name="借款合同纠纷",
        description="因金融借款、民间借贷等合同引发的仲裁模拟案件",
        case_name="借款合同纠纷仲裁模拟案",
        case_description="申请人与被申请人因借款合同的偿还、利息计算等事项发生争议，申请人依据仲裁协议申请仲裁。",
        rules=["北京仲裁委员会仲裁规则"],
        default_participants=[
            {"role": "party", "role_detail": "申请人", "display_name": "出借人"},
            {"role": "party", "role_detail": "被申请人", "display_name": "借款人"},
            {"role": "arbitrator", "role_detail": "首席仲裁员", "display_name": "首席仲裁员"},
            {"role": "secretary", "role_detail": "仲裁秘书", "display_name": "仲裁秘书"},
        ],
    ),
    CaseTemplate(
        template_id="equity_dispute",
        name="股权纠纷",
        description="因股权转让、股东资格确认等引发的仲裁模拟案件",
        case_name="股权纠纷仲裁模拟案",
        case_description="申请人与被申请人因股权转让协议的履行、股东资格确认等事项发生争议，申请人依据仲裁条款申请仲裁。",
        rules=["北京仲裁委员会仲裁规则"],
        default_participants=[
            {"role": "party", "role_detail": "申请人", "display_name": "转让方"},
            {"role": "party", "role_detail": "被申请人", "display_name": "受让方"},
            {"role": "arbitrator", "role_detail": "首席仲裁员", "display_name": "首席仲裁员"},
            {"role": "secretary", "role_detail": "仲裁秘书", "display_name": "仲裁秘书"},
        ],
    ),
    CaseTemplate(
        template_id="ip_license",
        name="知识产权许可纠纷",
        description="因知识产权许可使用合同引发的仲裁模拟案件",
        case_name="知识产权许可纠纷仲裁模拟案",
        case_description="申请人与被申请人因知识产权许可合同的许可费、使用范围等事项发生争议，申请人依据仲裁条款申请仲裁。",
        rules=["北京仲裁委员会仲裁规则", "数字经济仲裁程序规定"],
        default_participants=[
            {"role": "party", "role_detail": "申请人", "display_name": "许可方"},
            {"role": "party", "role_detail": "被申请人", "display_name": "被许可方"},
            {"role": "arbitrator", "role_detail": "首席仲裁员", "display_name": "首席仲裁员"},
            {"role": "secretary", "role_detail": "仲裁秘书", "display_name": "仲裁秘书"},
        ],
    ),
    CaseTemplate(
        template_id="blank",
        name="空白案件",
        description="从零开始创建仲裁模拟案件，不预设任何内容",
        case_name="仲裁模拟案",
        case_description="",
        rules=[],
        default_participants=[],
    ),
]


ARBITRATION_RULES: List[Dict[str, str]] = [
    {"rule_id": "bzac_2026_general", "name": "北京仲裁委员会仲裁规则", "name_en": "BAC Arbitration Rules", "edition": "2026版", "description": "北京仲裁委员会/北京国际仲裁中心仲裁规则，适用于普通仲裁程序"},
    {"rule_id": "bzac_2026_summary", "name": "简易程序规定", "name_en": "Summary Procedure Provisions", "edition": "2026版", "description": "适用于争议金额较小或当事人约定适用简易程序的案件"},
    {"rule_id": "bzac_2026_digital", "name": "数字经济仲裁程序规定", "name_en": "Digital Economy Arbitration Provisions", "edition": "2026版", "description": "适用于数字经济领域争议的特别程序规定"},
    {"rule_id": "bzac_2026_med_arb", "name": "调仲对接程序规定", "name_en": "Mediation-Arbitration Provisions", "edition": "2026版", "description": "调解与仲裁对接程序，先调后仲、调仲结合"},
    {"rule_id": "bzac_2026_construction", "name": "建设工程争议评审规则", "name_en": "Construction Dispute Review Rules", "edition": "2026版", "description": "适用于建设工程争议的评审规则"},
    {"rule_id": "bzac_2026_emergency", "name": "紧急仲裁员程序规定", "name_en": "Emergency Arbitrator Provisions", "edition": "2026版", "description": "在仲裁庭组成前需要采取紧急措施时适用"},
    {"rule_id": "bzac_2026_intl", "name": "国际商事仲裁规则", "name_en": "International Commercial Arbitration Rules", "edition": "2026版", "description": "适用于国际商事仲裁案件"},
    {"rule_id": "cieta_arb", "name": "CIETAC仲裁规则", "name_en": "CIETAC Arbitration Rules", "edition": "2024版", "description": "中国国际经济贸易仲裁委员会仲裁规则"},
    {"rule_id": "scia_arb", "name": "SCIA仲裁规则", "name_en": "SCIA Arbitration Rules", "edition": "2022版", "description": "深圳国际仲裁院仲裁规则"},
    {"rule_id": "shiac_arb", "name": "SHIAC仲裁规则", "name_en": "SHIAC Arbitration Rules", "edition": "2024版", "description": "上海国际经济贸易仲裁委员会仲裁规则"},
]


DOCUMENT_TEMPLATES: List[Dict[str, str]] = [
    {"doc_type": "award", "name": "裁决书", "name_en": "Arbitral Award", "description": "仲裁庭就案件实体问题作出的终局裁决文书"},
    {"doc_type": "partial_award", "name": "部分裁决书", "name_en": "Partial Award", "description": "仲裁庭就部分请求或事项作出的裁决"},
    {"doc_type": "procedural_order", "name": "程序决定书", "name_en": "Procedural Order", "description": "仲裁庭或仲裁秘书就程序事项作出的决定"},
    {"doc_type": "jurisdiction_decision", "name": "管辖权决定书", "name_en": "Jurisdiction Decision", "description": "就管辖权异议作出的决定"},
    {"doc_type": "challenge_decision", "name": "回避决定书", "name_en": "Challenge Decision", "description": "就仲裁员回避申请作出的决定"},
    {"doc_type": "mediation_statement", "name": "调解书", "name_en": "Mediation Statement", "description": "经调解达成协议后制作的调解书"},
    {"doc_type": "interim_measures", "name": "临时措施决定", "name_en": "Interim Measures Order", "description": "仲裁庭作出的临时措施决定"},
]


SCORING_DIMENSIONS: List[Dict[str, str]] = [
    {"dimension_id": "legal_reasoning", "name": "法律推理", "name_en": "Legal Reasoning", "description": "法律适用准确性、论证逻辑性、法条引用规范性"},
    {"dimension_id": "procedural_compliance", "name": "程序合规", "name_en": "Procedural Compliance", "description": "程序申请的合理性、时限遵守、程序权利行使"},
    {"dimension_id": "evidence_presentation", "name": "证据展示", "name_en": "Evidence Presentation", "description": "举证质证的完整性、证据链构建、证据关联性"},
    {"dimension_id": "advocacy_skill", "name": "辩论技巧", "name_en": "Advocacy Skill", "description": "辩论策略、说服力、应对能力"},
    {"dimension_id": "professionalism", "name": "职业素养", "name_en": "Professionalism", "description": "仲裁礼仪、沟通规范、协作态度"},
]