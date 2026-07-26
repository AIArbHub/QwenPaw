# -*- coding: utf-8 -*-
"""评分反馈数据模型。"""

from __future__ import annotations

from pydantic import BaseModel, Field


class FeedbackEntry(BaseModel):
    """单条评分反馈。"""

    id: str
    agent_id: str
    session_id: str = ""
    message_id: str = ""
    rating: int = Field(ge=1, le=5, description="1-5 星评分")
    comment: str = ""
    tags: list[str] = Field(default_factory=list)
    created_at: str = ""
    # ── 新增归因字段 ──
    analysis_status: str = "pending"  # pending / analyzed / needs_model_analysis / failed
    analysis_bucket: str = ""  # model_issue / skill_issue / tool_or_system_issue / ...
    analysis_reason: str = ""
    analysis_summary: str = ""
    analysis_confidence: float = 0.0
    analyzed_at: str = ""
    # ── 新增技能级反馈字段 ──
    skill_id: str = ""
    skill_version: str = ""
    step_id: str = ""  # 关联到具体 SOP 步骤


class FeedbackCreate(BaseModel):
    """创建评分反馈请求。"""

    agent_id: str
    session_id: str = ""
    message_id: str = ""
    rating: int = Field(ge=1, le=5)
    comment: str = ""
    tags: list[str] = Field(default_factory=list)
    # ── 新增技能级反馈字段 ──
    skill_id: str = ""
    skill_version: str = ""
    step_id: str = ""


class FeedbackSummary(BaseModel):
    """Agent 评分汇总。"""

    agent_id: str
    total_feedback: int = 0
    avg_rating: float = 0.0
    rating_distribution: dict[str, int] = Field(
        default_factory=lambda: {"1": 0, "2": 0, "3": 0, "4": 0, "5": 0}
    )
    recent_comments: list[FeedbackEntry] = Field(default_factory=list)
    # ── 新增归因汇总字段 ──
    buckets: dict[str, int] = Field(
        default_factory=dict,
        description="归因分类计数",
    )
    top_down_summaries: list[dict[str, str]] = Field(
        default_factory=list,
        description="Top 5 点踩摘要",
    )
    summary_text: str = ""
