# -*- coding: utf-8 -*-
"""Moot Award API routes — award generation, review, and review rule management.

These endpoints extend the moot module with:
- Award draft generation (AI-powered, with case context)
- Award content editing and versioning
- Award review against built-in and custom rules
- Review report generation with categorized issues
- Custom review rule CRUD (create, update, delete, toggle)
"""

from __future__ import annotations

import logging
import time
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ...moot.award_store import AwardStore
from ...moot.orchestrator import _get_store as _get_moot_store

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/moot", tags=["moot-award"])


def _get_award_store() -> AwardStore:
    return AwardStore.get_instance()


# ── Request models ──────────────────────────────────────────────────────────


class GenerateAwardRequest(BaseModel):
    template_type: str = Field(default="domestic", description="domestic | international")
    institution_name: str = Field(default="", description="仲裁机构名称")
    custom_instructions: str = Field(default="", description="用户自定义生成指令")


class UpdateAwardRequest(BaseModel):
    content: str


class ReviewAwardRequest(BaseModel):
    rule_ids: Optional[List[str]] = Field(default=None, description="指定规则ID列表，为空则使用全部活跃规则")
    custom_instructions: str = Field(default="", description="用户自定义核阅指令")


class CreateReviewRuleRequest(BaseModel):
    name: str
    category: str = Field(description="format | text | law | content | expression")
    sub_category: str = ""
    description: str = ""
    severity: str = Field(default="must_fix", description="must_fix | suggest_fix")
    detection_logic: str = ""
    suggestion_template: str = ""
    is_active: bool = True
    applicable_template_types: List[str] = Field(
        default=["domestic", "international"]
    )


class UpdateReviewRuleRequest(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    sub_category: Optional[str] = None
    description: Optional[str] = None
    severity: Optional[str] = None
    detection_logic: Optional[str] = None
    suggestion_template: Optional[str] = None
    is_active: Optional[bool] = None
    applicable_template_types: Optional[List[str]] = None


class ExportAwardRequest(BaseModel):
    format: str = Field(default="markdown", description="markdown | docx")


# ── Award generation & management ───────────────────────────────────────────


@router.post("/{case_id}/award/generate", summary="Generate award draft for a case")
async def generate_award(case_id: str, req: GenerateAwardRequest) -> Dict[str, Any]:
    """Generate an arbitration award draft based on case data and messages.

    The award is generated using the case's participant messages, events,
    and procedural history as context. Supports both domestic and
    international templates.
    """
    moot_store = _get_moot_store()
    case = moot_store.get_case(case_id)
    if case is None:
        raise HTTPException(status_code=404, detail="Case not found")

    messages = moot_store.get_messages(case_id)
    participants = moot_store.get_participants(case_id)
    events = moot_store.get_events(case_id)

    institution = req.institution_name or "XX仲裁委员会"
    template_type = req.template_type

    # Build award content from case context
    content = _build_award_content(
        case_name=case.case_name,
        case_description=case.case_description,
        rules=case.rules,
        messages=messages,
        participants=participants,
        events=events,
        institution_name=institution,
        template_type=template_type,
        custom_instructions=req.custom_instructions,
    )

    sections = _parse_award_sections(content)

    store = _get_award_store()
    award = store.save_award(
        case_id=case_id,
        template_type=template_type,
        institution_name=institution,
        content=content,
        sections=sections,
    )
    return award


@router.get("/{case_id}/award", summary="Get award for a case")
async def get_award(case_id: str) -> Optional[Dict[str, Any]]:
    store = _get_award_store()
    award = store.get_award(case_id)
    return award


@router.patch("/{case_id}/award", summary="Update award content")
async def update_award(case_id: str, req: UpdateAwardRequest) -> Dict[str, Any]:
    store = _get_award_store()
    try:
        return store.update_award_content(case_id, req.content)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@router.post("/{case_id}/award/review", summary="Review award against rules")
async def review_award(case_id: str, req: ReviewAwardRequest) -> Dict[str, Any]:
    """Review the award draft against built-in and custom review rules.

    Returns a structured review report with categorized issues.
    """
    store = _get_award_store()
    award = store.get_award(case_id)
    if award is None:
        raise HTTPException(status_code=404, detail="Award not found. Generate award first.")

    moot_store = _get_moot_store()
    case = moot_store.get_case(case_id)
    case_name = case.case_name if case else ""

    # Get rules to apply
    if req.rule_ids:
        all_rules = store.list_review_rules()
        rules = [r for r in all_rules if r["rule_id"] in req.rule_ids]
    else:
        rules = store.list_active_review_rules(award["template_type"])

    # Run review
    issues = _run_review(
        award_content=award["content"],
        rules=rules,
        case_name=case_name,
        institution_name=award["institution_name"],
        custom_instructions=req.custom_instructions,
    )

    # Build report
    issues_by_category: Dict[str, int] = {}
    must_fix_count = 0
    suggest_fix_count = 0
    for issue in issues:
        cat = issue["category"]
        issues_by_category[cat] = issues_by_category.get(cat, 0) + 1
        if issue["severity"] == "must_fix":
            must_fix_count += 1
        else:
            suggest_fix_count += 1

    report = {
        "award_id": award["award_id"],
        "case_id": case_id,
        "case_name": case_name,
        "template_type": award["template_type"],
        "institution_name": award["institution_name"],
        "total_issues": len(issues),
        "must_fix_count": must_fix_count,
        "suggest_fix_count": suggest_fix_count,
        "issues_by_category": issues_by_category,
        "issues": issues,
    }

    return store.save_review_report(report)


@router.get("/{case_id}/award/review-report", summary="Get latest review report")
async def get_review_report(case_id: str) -> Optional[Dict[str, Any]]:
    store = _get_award_store()
    return store.get_review_report(case_id)


@router.post("/{case_id}/award/export", summary="Export award")
async def export_award(case_id: str, req: ExportAwardRequest) -> Dict[str, Any]:
    store = _get_award_store()
    award = store.get_award(case_id)
    if award is None:
        raise HTTPException(status_code=404, detail="Award not found")

    # For markdown, return content directly
    # For docx, would need conversion (placeholder for now)
    filename = f"裁决书_{case_id}.{'md' if req.format == 'markdown' else 'docx'}"
    return {
        "url": f"/moot/{case_id}/award",
        "filename": filename,
        "content": award["content"] if req.format == "markdown" else None,
    }


# ── Review rules management ─────────────────────────────────────────────────


@router.get("/review-rules", summary="List all review rules")
async def list_review_rules() -> List[Dict[str, Any]]:
    store = _get_award_store()
    return store.list_review_rules()


@router.post("/review-rules", summary="Create a custom review rule")
async def create_review_rule(req: CreateReviewRuleRequest) -> Dict[str, Any]:
    store = _get_award_store()
    return store.create_review_rule(req.model_dump())


@router.patch("/review-rules/{rule_id}", summary="Update a review rule")
async def update_review_rule(rule_id: str, req: UpdateReviewRuleRequest) -> Dict[str, Any]:
    store = _get_award_store()
    # Filter out None values
    params = {k: v for k, v in req.model_dump().items() if v is not None}
    result = store.update_review_rule(rule_id, params)
    if result is None:
        raise HTTPException(status_code=404, detail="Rule not found")
    return result


@router.delete("/review-rules/{rule_id}", summary="Delete a review rule")
async def delete_review_rule(rule_id: str) -> Dict[str, Any]:
    store = _get_award_store()
    success = store.delete_review_rule(rule_id)
    if not success:
        raise HTTPException(status_code=404, detail="Rule not found")
    return {"success": True}


@router.get("/review-rules/categories", summary="List review rule categories")
async def list_review_rule_categories() -> List[Dict[str, Any]]:
    store = _get_award_store()
    rules = store.list_review_rules()
    categories_map: Dict[str, Dict[str, Any]] = {}
    for r in rules:
        cat = r["category"]
        if cat not in categories_map:
            labels = {
                "format": "格式",
                "text": "文字",
                "law": "法律",
                "content": "内容",
                "expression": "表述",
            }
            categories_map[cat] = {
                "category": cat,
                "label": labels.get(cat, cat),
                "sub_categories": set(),
                "builtin_count": 0,
                "custom_count": 0,
            }
        cat_info = categories_map[cat]
        if r["sub_category"]:
            cat_info["sub_categories"].add(r["sub_category"])
        if r["is_builtin"]:
            cat_info["builtin_count"] += 1
        else:
            cat_info["custom_count"] += 1
    # Convert sets to lists
    for cat_info in categories_map.values():
        cat_info["sub_categories"] = sorted(list(cat_info["sub_categories"]))
    return list(categories_map.values())


# ── Helper functions ────────────────────────────────────────────────────────


def _build_award_content(
    case_name: str,
    case_description: str,
    rules: List[str],
    messages: List[Any],
    participants: List[Any],
    events: List[Any],
    institution_name: str,
    template_type: str,
    custom_instructions: str,
) -> str:
    """Build award markdown content from case context."""
    now = time.strftime("%Y年%m月%d日", time.localtime())

    # Collect party info
    applicant = next(
        (p for p in participants if p.role.value == "party" and "申请" in (p.role_detail or "")),
        None,
    )
    if not applicant:
        applicant = next(
            (p for p in participants if p.role.value == "party"), None
        )
    respondent = next(
        (p for p in participants if p.role.value == "party" and "被申请" in (p.role_detail or "")),
        None,
    )
    arbitrators = [p for p in participants if p.role.value == "arbitrator"]

    # Collect claims from messages
    applicant_statements = []
    respondent_statements = []
    tribunal_opinions = []
    for msg in messages:
        if msg.is_system:
            continue
        if msg.role.value == "party":
            if "被申请" in (msg.display_name or ""):
                respondent_statements.append(msg.content)
            else:
                applicant_statements.append(msg.content)
        elif msg.role.value == "arbitrator":
            tribunal_opinions.append(f"**{msg.display_name}**：{msg.content}")

    # Build sections
    sections = []

    # Title
    if template_type == "international":
        title = f"{institution_name}（国际仲裁中心）裁决书"
    else:
        title = f"{institution_name}裁决书"
    sections.append(f"# {title}\n")

    # Header: case info
    case_no = f"（{time.strftime('%Y')}）{institution_name}字第____号"
    header_parts = [f"**案号**：{case_no}"]
    if applicant:
        header_parts.append(f"**申请人**：{applicant.display_name}")
    if respondent:
        header_parts.append(f"**被申请人**：{respondent.display_name}")
    sections.append("\n".join(header_parts) + "\n")

    # Procedural description
    proc_events = [e for e in events if e.event_type.value in ("stage_change", "procedure_change")]
    proc_lines = []
    if proc_events:
        proc_lines.append("申请人因与被申请人之间的纠纷，向本会申请仲裁。本会受理后，依法组成仲裁庭审理本案。")
        for e in proc_events[-5:]:  # Last 5 events
            proc_lines.append(f"- {e.description}")
    else:
        proc_lines.append(
            "申请人因与被申请人之间的纠纷，于____年__月__日向本会申请仲裁。"
            "本会受理后，根据《仲裁规则》的规定，依法组成仲裁庭审理本案。"
        )
    sections.append(f"## 程序事项\n\n" + "\n".join(proc_lines) + "\n")

    # Claims
    claims_text = "\n\n".join(applicant_statements[:5]) if applicant_statements else "（待补充仲裁请求内容）"
    sections.append(f"## 仲裁请求\n\n{claims_text}\n")

    # Defense
    defense_text = "\n\n".join(respondent_statements[:5]) if respondent_statements else "（待补充答辩意见）"
    sections.append(f"## 答辩意见\n\n{defense_text}\n")

    # Facts
    facts_text = case_description or "（待补充案件事实认定）"
    sections.append(f"## 事实认定\n\n{facts_text}\n")

    # Tribunal opinion
    if tribunal_opinions:
        opinion_text = "\n\n".join(tribunal_opinions)
    else:
        opinion_text = "（待补充仲裁庭意见）"
    sections.append(f"## 仲裁庭意见\n\n{opinion_text}\n")

    # Award
    sections.append("## 裁决\n\n（待补充裁决主文）\n")

    # Footer
    arbitrator_names = "、".join(a.display_name for a in arbitrators) if arbitrators else "____"
    sections.append(
        f"\n\n---\n\n"
        f"**仲裁员**：{arbitrator_names}\n\n"
        f"**日期**：{now}\n\n"
        f"**书记员**：____"
    )

    if custom_instructions:
        sections.append(f"\n\n> **用户补充说明**：{custom_instructions}")

    return "\n".join(sections)


def _parse_award_sections(content: str) -> List[Dict[str, Any]]:
    """Parse markdown content into sections based on ## headers."""
    sections = []
    current_title = "首部"
    current_lines: List[str] = []
    order = 0

    for line in content.split("\n"):
        if line.startswith("## "):
            if current_lines:
                sections.append({
                    "section_id": f"sec_{order}",
                    "title": current_title,
                    "content": "\n".join(current_lines).strip(),
                    "order": order,
                })
                order += 1
            current_title = line[3:].strip()
            current_lines = []
        else:
            current_lines.append(line)

    if current_lines:
        sections.append({
            "section_id": f"sec_{order}",
            "title": current_title,
            "content": "\n".join(current_lines).strip(),
            "order": order,
        })

    return sections


def _run_review(
    award_content: str,
    rules: List[Dict[str, Any]],
    case_name: str,
    institution_name: str,
    custom_instructions: str,
) -> List[Dict[str, Any]]:
    """Run review rules against award content and produce issues.

    This is a heuristic-based review that checks for common issues
    based on rule detection logic descriptions. In production, this
    would be enhanced with NLP/LLM analysis.
    """
    issues: List[Dict[str, Any]] = []
    content_lower = award_content.lower()

    for rule in rules:
        rule_id = rule["rule_id"]
        rule_name = rule["name"]
        category = rule["category"]
        severity = rule["severity"]
        detection = rule.get("detection_logic", "")
        suggestion = rule.get("suggestion_template", "")

        # Heuristic checks based on rule category and detection logic
        detected = False
        position = ""
        problem = ""
        original_text = ""

        if category == "format":
            if "标题" in rule_name:
                if institution_name and institution_name not in award_content:
                    detected = True
                    position = "标题部分"
                    problem = f"标题中未包含仲裁机构名称「{institution_name}」"
                    original_text = ""
            elif "字体" in rule_name:
                # Can't check fonts in markdown, skip
                pass

        elif category == "text":
            if "错别字" in rule_name:
                # Simple common typo check
                common_typos = {
                    "根据": ["根椐"],
                    "裁决": ["截决"],
                    "仲裁": "伸裁",
                    "申请": "申清",
                    "答辩": "答辩",
                }
                for correct, wrongs in common_typos.items():
                    wrong_list = [wrongs] if isinstance(wrongs, str) else wrongs
                    for wrong in wrong_list:
                        if wrong in award_content:
                            detected = True
                            position = f"包含「{wrong}」"
                            problem = f"疑似错别字：「{wrong}」应为「{correct}」"
                            original_text = wrong
                            break
                    if detected:
                        break

        elif category == "law":
            if "条款引用" in rule_name:
                # Check for incomplete legal citations
                import re
                # Find patterns like 《XX法》第X条 without complete info
                citations = re.findall(r"《[^》]+》第[^\d]+条", award_content)
                for cite in citations:
                    # Check if it has a number after 第
                    if not re.search(r"第\d+条", cite):
                        detected = True
                        position = f"法律引用：{cite}"
                        problem = f"法律条款引用不完整：{cite}，缺少具体条款号"
                        original_text = cite
                        break
            elif "漏裁" in rule_name:
                if "待补充裁决主文" in award_content:
                    detected = True
                    position = "裁决主文部分"
                    problem = "裁决主文尚未补充，可能存在漏裁风险"
            elif "超裁" in rule_name:
                # Would need case materials to check, skip heuristic
                pass
            elif "费用" in rule_name:
                if "仲裁费" not in award_content and "费用" not in award_content:
                    detected = True
                    position = "裁决主文部分"
                    problem = "裁决书未涉及仲裁费用承担问题"
            elif "可执行性" in rule_name:
                if "待补充裁决主文" in award_content:
                    detected = True
                    position = "裁决主文部分"
                    problem = "裁决主文不明确，影响可执行性"

        elif category == "content":
            if "仲裁请求" in rule_name:
                if "待补充仲裁请求" in award_content:
                    detected = True
                    position = "仲裁请求部分"
                    problem = "仲裁请求部分尚未补充"
            elif "证据" in rule_name:
                if "证据" not in award_content and "举证" not in award_content:
                    detected = True
                    position = "事实认定/证据部分"
                    problem = "裁决书未涉及证据材料列举"
            elif "事实认定" in rule_name:
                if "待补充案件事实" in award_content:
                    detected = True
                    position = "事实认定部分"
                    problem = "事实认定部分尚未补充"
            elif "争议点" in rule_name:
                if "争议焦点" not in award_content and "争议点" not in award_content:
                    detected = True
                    position = "仲裁庭意见部分"
                    problem = "仲裁庭意见未明确归纳争议焦点"

        elif category == "expression":
            if "表述风格" in rule_name:
                informal_words = ["嗯", "啊", "就是说", "然后呢", "那个"]
                for word in informal_words:
                    if word in award_content:
                        detected = True
                        position = f"包含「{word}」"
                        problem = f"表述不够正式：包含口语化表达「{word}」"
                        original_text = word
                        break

        if detected:
            issue = {
                "issue_id": f"issue_{len(issues)+1}_{rule_id}",
                "rule_id": rule_id,
                "rule_name": rule_name,
                "category": category,
                "severity": severity,
                "section_title": _find_section_for_position(award_content, position),
                "position_description": position,
                "problem_description": problem,
                "suggestion": suggestion.replace("{institution_name}", institution_name)
                .replace("{wrong_text}", original_text or "...")
                .replace("{correct_text}", "..."),
                "original_text": original_text if original_text else None,
                "corrected_text": None,
            }
            issues.append(issue)

    return issues


def _find_section_for_position(content: str, position: str) -> str:
    """Try to find which section a position belongs to."""
    sections = content.split("## ")
    if len(sections) <= 1:
        return "全文"
    # Simple heuristic: return the first section header
    first_section = sections[1].split("\n")[0] if len(sections) > 1 else "全文"
    return first_section.strip()
