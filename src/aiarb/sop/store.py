# -*- coding: utf-8 -*-
"""JSON file storage for SkillCard definitions.

SkillCards are persisted as individual JSON files under
``~/.aiarb/sop/<skill_id>.json``. This module provides CRUD operations
and search/filter capabilities.

No database is required — the file system IS the database.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ..constant import WORKING_DIR
from .schema import SkillCard, validate_graph

logger = logging.getLogger(__name__)

# SOP directory under the working directory
SOP_DIR = WORKING_DIR / "sop"


def _ensure_dir() -> Path:
    """Ensure the SOP directory exists and return it."""
    SOP_DIR.mkdir(parents=True, exist_ok=True)
    return SOP_DIR


def _skill_path(skill_id: str) -> Path:
    """Get the JSON file path for a skill ID."""
    # Sanitize skill_id to prevent path traversal
    safe_id = skill_id.replace("/", "_").replace("\\", "_").replace("..", "_")
    return _ensure_dir() / f"{safe_id}.json"


def _now_iso() -> str:
    """Return current UTC time in ISO 8601 format."""
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# CRUD operations
# ---------------------------------------------------------------------------

def save_skill(card: SkillCard) -> SkillCard:
    """Save a SkillCard to disk.

    Updates the ``updated_at`` timestamp and validates the graph before
    saving. Returns the updated card.
    """
    card.updated_at = _now_iso()
    if not card.created_at:
        card.created_at = _now_iso()

    # Validate graph
    issues = validate_graph(card)
    if issues:
        logger.warning(
            "SkillCard '%s' has graph validation issues: %s",
            card.id,
            issues,
        )

    path = _skill_path(card.id)
    path.write_text(
        card.model_dump_json(indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    logger.info("Saved SkillCard '%s' to %s", card.id, path)
    return card


def load_skill(skill_id: str) -> SkillCard | None:
    """Load a SkillCard by ID. Returns None if not found."""
    path = _skill_path(skill_id)
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return SkillCard.model_validate(data)
    except Exception as e:
        logger.error("Failed to load SkillCard '%s': %s", skill_id, e)
        return None


def delete_skill(skill_id: str) -> bool:
    """Delete a SkillCard by ID. Returns True if deleted."""
    path = _skill_path(skill_id)
    if not path.exists():
        return False
    path.unlink()
    logger.info("Deleted SkillCard '%s'", skill_id)
    return True


def list_skills(
    status: str | None = None,
    tag: str | None = None,
) -> list[SkillCard]:
    """List all SkillCards, optionally filtered by status or tag."""
    cards: list[SkillCard] = []
    sop_dir = _ensure_dir()
    for path in sorted(sop_dir.glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            card = SkillCard.model_validate(data)
            if status and card.status != status:
                continue
            if tag and tag not in card.tags:
                continue
            cards.append(card)
        except Exception as e:
            logger.warning("Failed to load SkillCard from %s: %s", path, e)
    return cards


def skill_exists(skill_id: str) -> bool:
    """Check if a SkillCard with the given ID exists."""
    return _skill_path(skill_id).exists()


def increment_call_count(skill_id: str) -> None:
    """自增技能调用次数。

    v5.0: 在 start_skill 时调用，激活 call_count 字段。
    """
    card = load_skill(skill_id)
    if card:
        card.call_count = (card.call_count or 0) + 1
        save_skill(card)
    else:
        logger.warning("Cannot increment call_count: skill '%s' not found", skill_id)


# ---------------------------------------------------------------------------
# Validation helper
# ---------------------------------------------------------------------------

def validate_skill(skill_id: str) -> list[str]:
    """Load and validate a SkillCard's graph. Returns issue list."""
    card = load_skill(skill_id)
    if card is None:
        return [f"SkillCard '{skill_id}' not found"]
    return validate_graph(card)


# ---------------------------------------------------------------------------
# Built-in arbitration skill templates
# ---------------------------------------------------------------------------

def _create_builtin_arbitration_skills() -> None:
    """Create built-in arbitration SkillCard templates on first run.

    These are lightweight SOP templates for common arbitration workflows.
    Users can fork and customize them.
    """
    from .schema import (
        SkillGraphNode,
        SkillGraphNode_Type,
        SkillGraphEdge,
    )

    # Template: 仲裁庭审质证流程
    cross_exam_id = "arb_cross_examination"
    if not skill_exists(cross_exam_id):
        card = SkillCard(
            id=cross_exam_id,
            name="仲裁庭审质证流程",
            description="标准化的仲裁庭审质证流程：从证据开示到质证结论的完整SOP",
            status="active",
            soul_md_ref="arbitrator",
            tags=["仲裁", "庭审", "质证", "内置"],
            knowledge_scope="仲裁法/证据规则",
            nodes=[
                SkillGraphNode(
                    id="start",
                    type=SkillGraphNode_Type.START,
                    title="开始质证",
                    description="质证流程入口，确认案件信息和质证范围",
                    prompt_hint="确认当前案件的仲裁编号、当事人信息、待质证证据清单",
                ),
                SkillGraphNode(
                    id="review_evidence",
                    type=SkillGraphNode_Type.ACTION,
                    title="审查证据",
                    description="逐项审查证据的真实性、合法性、关联性",
                    prompt_hint="对每份证据从真实性、合法性、关联性三方面进行审查",
                ),
                SkillGraphNode(
                    id="query_knowledge",
                    type=SkillGraphNode_Type.KNOWLEDGE_QUERY,
                    title="查阅证据规则",
                    description="查阅适用的证据规则和法律条文",
                    knowledge_scope="仲裁法/证据规则/民事诉讼法",
                ),
                SkillGraphNode(
                    id="ask_party",
                    type=SkillGraphNode_Type.ACTION,
                    title="询问当事人",
                    description="就证据争议点询问申请人或被申请人",
                    prompt_hint="围绕证据争议焦点向当事人发问",
                ),
                SkillGraphNode(
                    id="decide_admissibility",
                    type=SkillGraphNode_Type.DECISION,
                    title="判断可采性",
                    description="根据审查结果判断证据是否可采",
                    prompt_hint="综合三性审查结果，判断证据是否具有可采性",
                ),
                SkillGraphNode(
                    id="record_conclusion",
                    type=SkillGraphNode_Type.REPLY,
                    title="记录质证结论",
                    description="形成质证结论并记录",
                    prompt_hint="记录每份证据的质证结论：可采/不可采/部分可采及理由",
                ),
                SkillGraphNode(
                    id="terminal",
                    type=SkillGraphNode_Type.TERMINAL,
                    title="质证完结",
                    description="所有证据质证完毕",
                ),
            ],
            edges=[
                SkillGraphEdge(from_node="start", to_node="review_evidence", condition="", priority=0),
                SkillGraphEdge(from_node="review_evidence", to_node="query_knowledge", condition="需查阅规则", priority=0),
                SkillGraphEdge(from_node="review_evidence", to_node="ask_party", condition="有争议需询问", priority=1),
                SkillGraphEdge(from_node="review_evidence", to_node="decide_admissibility", condition="无争议直接判断", priority=2),
                SkillGraphEdge(from_node="query_knowledge", to_node="ask_party", condition="", priority=0),
                SkillGraphEdge(from_node="ask_party", to_node="decide_admissibility", condition="", priority=0),
                SkillGraphEdge(from_node="decide_admissibility", to_node="record_conclusion", condition="", priority=0),
                SkillGraphEdge(from_node="record_conclusion", to_node="terminal", condition="全部质证完毕", priority=0),
                SkillGraphEdge(from_node="record_conclusion", to_node="review_evidence", condition="还有证据待审", priority=1),
            ],
            start_node_id="start",
        )
        save_skill(card)
        logger.info("Created built-in skill: %s", cross_exam_id)

    # Template: 仲裁文书起草流程
    drafting_id = "arb_award_drafting"
    if not skill_exists(drafting_id):
        card = SkillCard(
            id=drafting_id,
            name="仲裁裁决书起草流程",
            description="从案件事实认定到裁决书起草的标准化流程",
            status="active",
            soul_md_ref="arbitrator",
            tags=["仲裁", "裁决书", "起草", "内置"],
            knowledge_scope="仲裁法/裁决书格式",
            nodes=[
                SkillGraphNode(
                    id="start",
                    type=SkillGraphNode_Type.START,
                    title="开始起草",
                    description="裁决书起草入口，确认案件基本信息",
                ),
                SkillGraphNode(
                    id="collect_facts",
                    type=SkillGraphNode_Type.ACTION,
                    title="归纳事实",
                    description="归纳查明事实和争议焦点",
                    prompt_hint="从庭审笔录和证据中归纳已查明事实、争议焦点",
                ),
                SkillGraphNode(
                    id="query_law",
                    type=SkillGraphNode_Type.KNOWLEDGE_QUERY,
                    title="法律检索",
                    description="检索适用法律条文和类案",
                    knowledge_scope="仲裁法/民法典/合同法",
                ),
                SkillGraphNode(
                    id="draft_reasoning",
                    type=SkillGraphNode_Type.ACTION,
                    title="撰写说理",
                    description="撰写裁决理由部分",
                    prompt_hint="围绕争议焦点展开法律论证，逻辑严密",
                ),
                SkillGraphNode(
                    id="draft_dispositif",
                    type=SkillGraphNode_Type.ACTION,
                    title="撰写主文",
                    description="撰写裁决主文",
                    prompt_hint="明确、具体、可执行的裁决主文",
                ),
                SkillGraphNode(
                    id="review_format",
                    type=SkillGraphNode_Type.DECISION,
                    title="格式审查",
                    description="审查裁决书格式和形式要件",
                    prompt_hint="检查裁决书格式是否符合仲裁规则要求",
                ),
                SkillGraphNode(
                    id="terminal",
                    type=SkillGraphNode_Type.TERMINAL,
                    title="起草完成",
                    description="裁决书草稿完成",
                ),
            ],
            edges=[
                SkillGraphEdge(from_node="start", to_node="collect_facts", priority=0),
                SkillGraphEdge(from_node="collect_facts", to_node="query_law", priority=0),
                SkillGraphEdge(from_node="query_law", to_node="draft_reasoning", priority=0),
                SkillGraphEdge(from_node="draft_reasoning", to_node="draft_dispositif", priority=0),
                SkillGraphEdge(from_node="draft_dispositif", to_node="review_format", priority=0),
                SkillGraphEdge(from_node="review_format", to_node="terminal", condition="格式合规", priority=0),
                SkillGraphEdge(from_node="review_format", to_node="draft_reasoning", condition="需修改", priority=1),
            ],
            start_node_id="start",
        )
        save_skill(card)
        logger.info("Created built-in skill: %s", drafting_id)


def ensure_builtin_skills() -> None:
    """Create built-in skill templates if they don't exist.

    Called during application startup.
    """
    try:
        _create_builtin_arbitration_skills()
    except Exception as e:
        logger.warning("Failed to create built-in SOP skills: %s", e)
