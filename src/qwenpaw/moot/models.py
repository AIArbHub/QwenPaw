# -*- coding: utf-8 -*-
"""Data models for moot arbitration practice multi-agent system."""

from __future__ import annotations

import hashlib
import time
import uuid
from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


# ── Trial style (not legal system — arbitration is cross-jurisdictional) ─────


class TrialStyle(str, Enum):
    CIVIL_STYLE = "civil_style"      # 大陆法系风格: 职权探知式
    COMMON_STYLE = "common_style"    # 普通法系风格: 当事人对抗式


TRIAL_STYLE_LABELS: Dict[TrialStyle, str] = {
    TrialStyle.CIVIL_STYLE: "大陆法系风格",
    TrialStyle.COMMON_STYLE: "普通法系风格",
}

TRIAL_STYLE_DESCRIPTIONS: Dict[TrialStyle, str] = {
    TrialStyle.CIVIL_STYLE: "职权探知式，仲裁庭主导推进，纠问式庭审",
    TrialStyle.COMMON_STYLE: "当事人对抗式，律师驱动推进，对抗式庭审",
}


# ── Collaboration mode ────────────────────────────────────────────────────────


class CollaborationMode(str, Enum):
    HUMAN_LEAD = "human_lead"
    AI_LEAD = "ai_lead"
    FULL_AI = "full_ai"
    FULL_HUMAN = "full_human"


COLLABORATION_MODE_LABELS: Dict[CollaborationMode, str] = {
    CollaborationMode.HUMAN_LEAD: "人主导",
    CollaborationMode.AI_LEAD: "AI主导",
    CollaborationMode.FULL_AI: "AI全自动",
    CollaborationMode.FULL_HUMAN: "纯人工",
}


# ── Role & Side ───────────────────────────────────────────────────────────────


class RoleCategory(str, Enum):
    ARBITRATOR = "arbitrator"
    PARTY = "party"
    COUNSEL = "counsel"
    SECRETARY = "secretary"
    CONTROLLER = "controller"  # legacy, kept for backward compat


ROLE_CATEGORY_LABELS: Dict[RoleCategory, str] = {
    RoleCategory.ARBITRATOR: "仲裁员",
    RoleCategory.PARTY: "当事人",
    RoleCategory.COUNSEL: "代理人",
    RoleCategory.SECRETARY: "仲裁秘书",
    RoleCategory.CONTROLLER: "主控",
}


class Side(str, Enum):
    CLAIMANT = "claimant"
    RESPONDENT = "respondent"
    NEUTRAL = "neutral"


SIDE_LABELS: Dict[Side, str] = {
    Side.CLAIMANT: "申请人方",
    Side.RESPONDENT: "被申请人方",
    Side.NEUTRAL: "中立",
}


# ── Case stage ────────────────────────────────────────────────────────────────


class CaseStage(str, Enum):
    # Legacy stages (kept for backward compat with existing DB records)
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
    AWARD = "award"
    ENFORCEMENT = "enforcement"
    # New trial stages (used by trial style templates)
    OPENING = "opening"
    PLEADING = "pleading"
    EVIDENCE = "evidence"
    DEBATE = "debate"
    CLOSING = "closing"
    DELIBERATION = "deliberation"
    # Shared
    CLOSED = "closed"


CASE_STAGE_LABELS: Dict[CaseStage, str] = {
    # Legacy
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
    CaseStage.AWARD: "裁决",
    CaseStage.ENFORCEMENT: "执行",
    # New trial stages
    CaseStage.OPENING: "开庭准备",
    CaseStage.PLEADING: "陈述与答辩",
    CaseStage.EVIDENCE: "举证质证",
    CaseStage.DEBATE: "辩论",
    CaseStage.CLOSING: "最后陈述",
    CaseStage.DELIBERATION: "合议与裁决",
    # Shared
    CaseStage.CLOSED: "结案",
}

# Stages used by the new trial flow (in order)
TRIAL_STAGE_FLOW: List[CaseStage] = [
    CaseStage.OPENING,
    CaseStage.PLEADING,
    CaseStage.EVIDENCE,
    CaseStage.DEBATE,
    CaseStage.CLOSING,
    CaseStage.DELIBERATION,
    CaseStage.CLOSED,
]


# ── Event types ───────────────────────────────────────────────────────────────


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


# ── File visibility ───────────────────────────────────────────────────────────


class FileVisibility(str, Enum):
    PRIVATE = "private"
    SHARED = "shared"
    DIRECTED = "directed"


FILE_VISIBILITY_LABELS: Dict[FileVisibility, str] = {
    FileVisibility.PRIVATE: "私有文件",
    FileVisibility.SHARED: "庭审共享",
    FileVisibility.DIRECTED: "定向共享",
}


# ── File models ───────────────────────────────────────────────────────────────


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


# ── Participant ───────────────────────────────────────────────────────────────


class Participant(BaseModel):
    participant_id: str = Field(default="")
    agent_id: str
    display_name: str
    role: RoleCategory
    role_detail: str = Field(default="", description="e.g. chief_arbitrator, claimant_1, respondent_1")
    side: Side = Field(default=Side.NEUTRAL)
    collaboration_mode: CollaborationMode = Field(default=CollaborationMode.FULL_AI)
    joined_at: float = Field(default_factory=time.time)
    active: bool = Field(default=True)


# ── Events & Messages ─────────────────────────────────────────────────────────


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


# ── MootCase ──────────────────────────────────────────────────────────────────


class MootCase(BaseModel):
    case_id: str
    case_name: str = Field(default="仲裁模拟案")
    case_description: str = Field(default="")
    status: str = Field(default="draft")
    current_stage: CaseStage = Field(default=CaseStage.DRAFT)
    rules: List[str] = Field(default_factory=list, description="Applied arbitration rules")
    trial_style: TrialStyle = Field(default=TrialStyle.CIVIL_STYLE)
    global_collaboration_mode: CollaborationMode = Field(default=CollaborationMode.FULL_AI)
    participants: List[Participant] = Field(default_factory=list)
    events: List[CaseEvent] = Field(default_factory=list)
    messages: List[MootMessage] = Field(default_factory=list)
    controller_participant_id: Optional[str] = Field(default=None, description="Main controller agent")
    created_at: float = Field(default_factory=time.time)
    updated_at: float = Field(default_factory=time.time)
    current_speaker: Optional[str] = None


# ── Request models ────────────────────────────────────────────────────────────


class CreateCaseRequest(BaseModel):
    case_name: str = Field(default="仲裁模拟案")
    case_description: str = Field(default="")
    rules: List[str] = Field(default_factory=list)
    trial_style: TrialStyle = Field(default=TrialStyle.CIVIL_STYLE)
    global_collaboration_mode: CollaborationMode = Field(default=CollaborationMode.FULL_AI)


class AddParticipantRequest(BaseModel):
    agent_id: Optional[str] = Field(default=None, description="Existing agent ID")
    new_agent_name: Optional[str] = Field(default=None, description="Name for quick-create agent")
    new_agent_description: Optional[str] = Field(default=None)
    display_name: str
    role: RoleCategory
    role_detail: str = Field(default="")
    side: Side = Field(default=Side.NEUTRAL)
    collaboration_mode: CollaborationMode = Field(default=CollaborationMode.FULL_AI)


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
    side: Optional[Side] = None
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
    trial_style: str
    global_collaboration_mode: str
    participants: List[Dict[str, Any]]
    message_count: int
    event_count: int
    created_at: float
    current_speaker: Optional[str] = None


# ── Case templates (dispute types, orthogonal to trial style) ────────────────


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
            {"role": "party", "role_detail": "申请人", "display_name": "买方", "side": "claimant"},
            {"role": "party", "role_detail": "被申请人", "display_name": "卖方", "side": "respondent"},
            {"role": "arbitrator", "role_detail": "首席仲裁员", "display_name": "首席仲裁员", "side": "neutral"},
            {"role": "secretary", "role_detail": "仲裁秘书", "display_name": "仲裁秘书", "side": "neutral"},
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
            {"role": "party", "role_detail": "申请人", "display_name": "发包方", "side": "claimant"},
            {"role": "party", "role_detail": "被申请人", "display_name": "承包方", "side": "respondent"},
            {"role": "arbitrator", "role_detail": "首席仲裁员", "display_name": "首席仲裁员", "side": "neutral"},
            {"role": "secretary", "role_detail": "仲裁秘书", "display_name": "仲裁秘书", "side": "neutral"},
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
            {"role": "party", "role_detail": "申请人", "display_name": "出借人", "side": "claimant"},
            {"role": "party", "role_detail": "被申请人", "display_name": "借款人", "side": "respondent"},
            {"role": "arbitrator", "role_detail": "首席仲裁员", "display_name": "首席仲裁员", "side": "neutral"},
            {"role": "secretary", "role_detail": "仲裁秘书", "display_name": "仲裁秘书", "side": "neutral"},
        ],
    ),
    CaseTemplate(
        template_id="equity_dispute",
        name="股权转让纠纷",
        description="因股权转让、股东资格确认等引发的仲裁模拟案件",
        case_name="股权转让纠纷仲裁模拟案",
        case_description="申请人与被申请人因股权转让协议的履行、股东资格确认等事项发生争议，申请人依据仲裁条款申请仲裁。",
        rules=["北京仲裁委员会仲裁规则"],
        default_participants=[
            {"role": "party", "role_detail": "申请人", "display_name": "转让方", "side": "claimant"},
            {"role": "party", "role_detail": "被申请人", "display_name": "受让方", "side": "respondent"},
            {"role": "arbitrator", "role_detail": "首席仲裁员", "display_name": "首席仲裁员", "side": "neutral"},
            {"role": "secretary", "role_detail": "仲裁秘书", "display_name": "仲裁秘书", "side": "neutral"},
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
            {"role": "party", "role_detail": "申请人", "display_name": "许可方", "side": "claimant"},
            {"role": "party", "role_detail": "被申请人", "display_name": "被许可方", "side": "respondent"},
            {"role": "arbitrator", "role_detail": "首席仲裁员", "display_name": "首席仲裁员", "side": "neutral"},
            {"role": "secretary", "role_detail": "仲裁秘书", "display_name": "仲裁秘书", "side": "neutral"},
        ],
    ),
    CaseTemplate(
        template_id="intl_sale",
        name="国际货物买卖争议",
        description="International sale of goods dispute suitable for common law style",
        case_name="国际货物买卖仲裁案",
        case_description="The claimant and respondent are in dispute over the performance of an international sale of goods contract. The claimant seeks arbitration pursuant to the arbitration clause.",
        rules=["CIETAC仲裁规则", "国际商事仲裁规则"],
        default_participants=[
            {"role": "counsel", "role_detail": "Claimant's Counsel", "display_name": "Claimant's Counsel", "side": "claimant"},
            {"role": "counsel", "role_detail": "Respondent's Counsel", "display_name": "Respondent's Counsel", "side": "respondent"},
            {"role": "party", "role_detail": "Claimant", "display_name": "Claimant", "side": "claimant"},
            {"role": "party", "role_detail": "Respondent", "display_name": "Respondent", "side": "respondent"},
            {"role": "arbitrator", "role_detail": "Sole Arbitrator", "display_name": "Arbitrator", "side": "neutral"},
            {"role": "secretary", "role_detail": "Tribunal Secretary", "display_name": "Tribunal Secretary", "side": "neutral"},
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


# ── Trial style templates ────────────────────────────────────────────────────

TRIAL_STYLE_TEMPLATES: Dict[str, Dict[str, Any]] = {
    "civil_style": {
        "style_id": "civil_style",
        "name": "大陆法系风格",
        "name_en": "Civil Law Style",
        "description": "职权探知式，仲裁庭主导推进，纠问式庭审",
        "stages": [
            {
                "id": "opening",
                "name": "开庭准备",
                "name_en": "Opening of Hearing",
                "description": "核对身份、宣布仲裁庭组成、告知权利义务",
                "speaker_order": ["secretary", "arbitrator"],
            },
            {
                "id": "pleading",
                "name": "陈述与答辩",
                "name_en": "Statements & Responses",
                "description": "申请人陈述仲裁请求，被申请人进行答辩",
                "speaker_order": ["arbitrator", "claimant", "respondent"],
            },
            {
                "id": "evidence",
                "name": "举证质证",
                "name_en": "Production & Cross-Examination",
                "description": "双方出示证据、相互质证；仲裁员可主动发问",
                "speaker_order": ["arbitrator", "claimant", "respondent", "arbitrator"],
            },
            {
                "id": "debate",
                "name": "辩论",
                "name_en": "Oral Argument",
                "description": "围绕争议焦点展开辩论",
                "speaker_order": ["claimant", "respondent"],
            },
            {
                "id": "closing",
                "name": "最后陈述",
                "name_en": "Closing Statements",
                "description": "双方做最后陈述",
                "speaker_order": ["claimant", "respondent"],
            },
            {
                "id": "deliberation",
                "name": "合议与裁决",
                "name_en": "Deliberation & Award",
                "description": "仲裁庭合议（仅仲裁员可见），制作裁决书",
                "speaker_order": ["arbitrator"],
            },
        ],
        "default_participants": [
            {"display_name": "首席仲裁员", "role": "arbitrator", "side": "neutral", "role_detail": "独任仲裁员"},
            {"display_name": "申请人", "role": "party", "side": "claimant", "role_detail": "当事人"},
            {"display_name": "被申请人", "role": "party", "side": "respondent", "role_detail": "当事人"},
            {"display_name": "仲裁秘书", "role": "secretary", "side": "neutral", "role_detail": "程序记录"},
        ],
        "ai_prompt_guidance": (
            "你采用大陆法系风格发言。仲裁员应主动引导程序、发问和总结；"
            "当事人应回应仲裁员的询问，不应主动驱动程序。"
        ),
    },
    "common_style": {
        "style_id": "common_style",
        "name": "普通法系风格",
        "name_en": "Common Law Style",
        "description": "当事人对抗式，律师驱动推进，对抗式庭审",
        "stages": [
            {
                "id": "opening",
                "name": "Opening of Hearing",
                "name_en": "Opening of Hearing",
                "description": "Verify identities, announce tribunal composition",
                "speaker_order": ["secretary", "arbitrator"],
            },
            {
                "id": "pleading",
                "name": "Opening Statements",
                "name_en": "Opening Statements",
                "description": "Both counsel present opening statements",
                "speaker_order": ["claimant_counsel", "respondent_counsel"],
            },
            {
                "id": "evidence",
                "name": "Production & Cross-Examination",
                "name_en": "Production & Cross-Examination",
                "description": "Each side presents evidence and cross-examines",
                "speaker_order": ["claimant_counsel", "respondent_counsel", "arbitrator"],
            },
            {
                "id": "debate",
                "name": "Oral Argument",
                "name_en": "Oral Argument",
                "description": "Both counsel argue on key issues",
                "speaker_order": ["claimant_counsel", "respondent_counsel"],
            },
            {
                "id": "closing",
                "name": "Closing Statements",
                "name_en": "Closing Statements",
                "description": "Both counsel deliver closing statements",
                "speaker_order": ["claimant_counsel", "respondent_counsel"],
            },
            {
                "id": "deliberation",
                "name": "Deliberation & Award",
                "name_en": "Deliberation & Award",
                "description": "Tribunal deliberates (arbitrator only), renders award",
                "speaker_order": ["arbitrator"],
            },
        ],
        "default_participants": [
            {"display_name": "Arbitrator", "role": "arbitrator", "side": "neutral", "role_detail": "Sole Arbitrator"},
            {"display_name": "Claimant's Counsel", "role": "counsel", "side": "claimant", "role_detail": "Claimant's Counsel"},
            {"display_name": "Respondent's Counsel", "role": "counsel", "side": "respondent", "role_detail": "Respondent's Counsel"},
            {"display_name": "Claimant", "role": "party", "side": "claimant", "role_detail": "Claimant"},
            {"display_name": "Respondent", "role": "party", "side": "respondent", "role_detail": "Respondent"},
            {"display_name": "Tribunal Secretary", "role": "secretary", "side": "neutral", "role_detail": "Secretary"},
        ],
        "ai_prompt_guidance": (
            "You speak in common law style. Counsel should actively present evidence "
            "and argue; the arbitrator mainly maintains order and rules on objections."
        ),
    },
}


# ── Arbitration rules ────────────────────────────────────────────────────────


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


# ── Case-Document/Knowledge links ────────────────────────────────────────────


class CaseLink(BaseModel):
    """案件与文档/知识的关联"""
    link_id: str = Field(default_factory=lambda: uuid.uuid4().hex[:12])
    case_id: str
    doc_id: str = ""
    wiki_page_path: str = ""
    link_type: str = "evidence"  # evidence / reference / context
    side: str = ""  # claimant / respondent / neutral
    ai_analysis: str = ""
    created_at: float = Field(default_factory=time.time)


class TrialContext(BaseModel):
    """庭审上下文 - 注入 AI 角色"""
    case_id: str
    evidence_docs: List[str] = Field(default_factory=list)  # 脱敏后的文档 ID
    knowledge_pages: List[str] = Field(default_factory=list)  # 相关 Wiki 页面
    rules: List[str] = Field(default_factory=list)  # 适用的仲裁规则
    case_summary: str = ""


class DocAnalysisResult(BaseModel):
    """AI 文档分析结果"""
    doc_id: str
    doc_type: str = ""  # 合同/判决书/答辩状/证据/其他
    key_points: List[str] = Field(default_factory=list)
    dispute_points: List[str] = Field(default_factory=list)
    evidence_chain: List[str] = Field(default_factory=list)
    legal_basis: List[str] = Field(default_factory=list)
    summary: str = ""


class AddCaseLinkRequest(BaseModel):
    doc_id: Optional[str] = None
    wiki_page_path: Optional[str] = None
    link_type: str = "evidence"
    side: str = ""
    ai_analysis: str = ""


class CopilotMessage(BaseModel):
    """Copilot 对话消息"""
    role: str = "user"  # user / assistant
    content: str
    timestamp: float = Field(default_factory=time.time)


class CopilotRequest(BaseModel):
    """Copilot 对话请求"""
    case_id: str
    message: str
    context_tab: str = "overview"  # overview / documents / trial / award
    selected_doc_id: Optional[str] = None
