# -*- coding: utf-8 -*-
# flake8: noqa: E501
# pylint: disable=line-too-long
"""Case framework analysis tools for aiarb.

Four tools that bring the case-type-guide methodology into aiarb:

1. ``identify_case_type``       — keyword-based case type identification
2. ``generate_review_checklist``— six-stage framework checklist generation
3. ``dual_perspective_analysis`` — applicant/respondent dual-perspective analysis
4. ``legal_qa_consultation``    — structured legal Q&A with 5 question types

All tools are async, sandbox-safe (read-only), and auto-registered
via ``@tool_descriptor``.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Optional

from agentscope.message import TextBlock
from agentscope.tool import ToolChunk
from agentscope.message import ToolResultState

from ...runtime.tool_registry import tool_descriptor
from .case_framework_db import (
    FRAMEWORK_PARTS,
    PARTY_TYPE_MAP,
    get_case_framework_db,
)

logger = logging.getLogger(__name__)


# ── Helpers ────────────────────────────────────────────────────────────

def _make_response(text: str) -> ToolChunk:
    """Build a success ToolChunk with a single text block."""
    return ToolChunk(
        is_last=True,
        state=ToolResultState.SUCCESS,
        content=[TextBlock(type="text", text=text)],
    )


def _format_checklist_markdown(
    case_name: str,
    perspective: str,
    sections: list[dict[str, Any]],
) -> str:
    """Format checklist data as Markdown."""
    perspective_label = {
        "applicant": "申请人视角",
        "respondent": "被申请人视角",
        "neutral": "全视角（中立）",
    }.get(perspective, perspective)

    md = f"# {case_name} — {perspective_label}要件清单\n\n"

    for section in sections:
        md += f"## {section['part_name']}\n\n"
        items = section.get("checklist_items", [])
        if not items:
            md += "（无审查要点数据）\n\n"
            continue

        for item in items:
            status_icon = "❌" if item.get("status", "pending") == "pending" else "✅"
            core_mark = " **[核心]**" if item.get("is_core") else ""
            md += f"- [{status_icon}]{core_mark} {item['item_name']}\n"

            if item.get("review_content"):
                md += f"  - **审查要点**: {item['review_content']}\n"
            if item.get("attention_points"):
                md += f"  - **注意事项**: {item['attention_points']}\n"
            if item.get("legal_basis"):
                md += f"  - **法律依据**: {item['legal_basis']}\n"
            md += "\n"

    return md


# ── Question classification ───────────────────────────────────────────

_CASE_IDENT_KEYWORDS = [
    "是什么案件", "属于什么", "什么纠纷", "怎么定性",
    "属于哪种", "什么案由", "哪类纠纷", "什么类型",
]
_LEGAL_BASIS_KEYWORDS = [
    "法律依据", "法条", "法律规定", "根据什么法",
    "适用法律", "法律条文", "法律规定了",
]
_EVIDENCE_KEYWORDS = [
    "证据", "材料", "怎么证明", "需要什么",
    "提供什么", "举证", "证据清单", "什么材料",
]
_PROCESS_KEYWORDS = [
    "流程", "程序", "怎么办理", "如何办理",
    "步骤", "办案流程", "怎么办",
]


def _classify_question(question: str) -> str:
    """Classify a question into one of 5 types."""
    if any(kw in question for kw in _CASE_IDENT_KEYWORDS):
        return "case_identification"
    if any(kw in question for kw in _LEGAL_BASIS_KEYWORDS):
        return "legal_basis"
    if any(kw in question for kw in _EVIDENCE_KEYWORDS):
        return "evidence_guidance"
    if any(kw in question for kw in _PROCESS_KEYWORDS):
        return "process_guidance"
    return "general"


# ── Tool 1: identify_case_type ────────────────────────────────────────

@tool_descriptor(
    name="identify_case_type",
    requires_sandbox=("file_read",),
    async_execution=True,
    tool_type="internal",
    policy_name="IdentifyCaseType",
    default_policy="allow",
    policy_reason="Case type identification (read-only DB query)",
    ui_description="识别案件类型，返回匹配的案由和置信度",
    ui_icon="🎯",
)
async def identify_case_type(
    query: str,
    top_k: int = 3,
) -> ToolChunk:
    """案件类型智能识别。

    基于关键词匹配的混合策略，识别用户描述的案件类型。
    返回匹配的案由、置信度和匹配关键词。

    Args:
        query (`str`):
            用户案情描述或问题文本。
        top_k (`int`, optional):
            返回前k个候选结果，默认3。
    """
    if not query or not query.strip():
        return _make_response("错误：未提供查询文本。")

    db = get_case_framework_db()
    results = db.identify_case_type(query, top_k=top_k)

    if not results:
        return _make_response(
            f"未找到匹配的案件类型。请尝试提供更多案情细节。\n\n"
            f"查询文本：{query[:100]}..."
        )

    lines = [f"## 案件类型识别结果\n"]
    lines.append(f"查询文本：`{query[:100]}{'...' if len(query) > 100 else ''}`\n")

    for i, r in enumerate(results, 1):
        medal = "🥇" if i == 1 else "🥈" if i == 2 else "🥉"
        confidence = f"{r['score']:.1%}"
        matched = ", ".join(r.get("matched_keywords", []))

        lines.append(f"{medal} **{r['case_name']}**")
        lines.append(f"   - 置信度：{confidence}")
        lines.append(f"   - 匹配关键词：{matched}")
        if r.get("description"):
            lines.append(f"   - 描述：{r['description'][:80]}")
        lines.append("")

    lines.append("建议追问：")
    best = results[0]
    lines.append(f"- 查看「{best['case_name']}」的审查要点清单")
    lines.append(f"- 了解「{best['case_name']}」的法律依据")
    lines.append(f"- 分析「{best['case_name']}」的双向视角策略")

    return _make_response("\n".join(lines))


# ── Tool 2: generate_review_checklist ──────────────────────────────────

@tool_descriptor(
    name="generate_review_checklist",
    requires_sandbox=("file_read",),
    async_execution=True,
    tool_type="internal",
    policy_name="GenerateReviewChecklist",
    default_policy="allow",
    policy_reason="Review checklist generation (read-only DB query)",
    ui_description="生成六段式审查要点清单",
    ui_icon="📋",
)
async def generate_review_checklist(
    case_type: str,
    perspective: str = "neutral",
) -> ToolChunk:
    """生成六段式审查要点清单。

    基于上海法院类案办案要件指南的六段式审判框架，
    生成可检核的审查要点清单。支持申请人/被申请人/中立三种视角。

    Args:
        case_type (`str`):
            案件类型名称（如"民间借贷"、"买卖合同"等）。
        perspective (`str`, optional):
            视角：``applicant``（申请人）、``respondent``（被申请人）
            或 ``neutral``（中立，默认）。
    """
    if not case_type or not case_type.strip():
        return _make_response("错误：未提供案件类型名称。")

    valid_perspectives = {"applicant", "respondent", "neutral", "plaintiff", "defendant"}
    if perspective not in valid_perspectives:
        return _make_response(
            f"错误：视角参数 '{perspective}' 无效。"
            f"请使用 applicant/respondent/neutral。"
        )

    # Normalize party type
    arb_perspective = PARTY_TYPE_MAP.get(perspective, perspective)

    db = get_case_framework_db()

    # Find case type by name (fuzzy)
    ct = db.get_case_type_by_name(case_type)
    if not ct:
        return _make_response(
            f"未找到案件类型「{case_type}」。\n"
            f"可用的案件类型请通过 identify_case_type 工具查询。"
        )

    case_id = ct["case_id"]
    case_name = ct["case_name"]

    # Get frameworks
    frameworks = db.get_frameworks(case_id)
    if not frameworks:
        # Fallback: use all 6 parts as empty shells
        frameworks = [
            {"framework_id": p, "part_number": p, "part_name": name}
            for p, name in FRAMEWORK_PARTS.items()
        ]

    # Determine relevant parts based on perspective
    if arb_perspective == "applicant":
        relevant_parts = {2, 3, 5}
    elif arb_perspective == "respondent":
        relevant_parts = {4, 5}
    else:
        relevant_parts = {2, 3, 4, 5}

    sections: list[dict[str, Any]] = []
    for fw in frameworks:
        part_number = fw["part_number"]
        if part_number not in relevant_parts:
            continue

        # Source DB stores part_number as framework_id in review_points
        review_points = db.get_review_points(case_id, part_number)
        items = []
        for rp in review_points:
            items.append({
                "item_name": rp["point_name"],
                "review_content": rp.get("review_content", ""),
                "attention_points": rp.get("attention_points", ""),
                "legal_basis": rp.get("legal_basis", ""),
                "is_core": bool(rp.get("is_core", 0)),
                "status": "pending",
            })

        if items or part_number in (2, 3, 4, 5):
            sections.append({
                "part_name": fw.get("part_name", FRAMEWORK_PARTS.get(part_number, "")),
                "checklist_items": items,
            })

    markdown = _format_checklist_markdown(case_name, arb_perspective, sections)
    return _make_response(markdown)


# ── Tool 3: dual_perspective_analysis ─────────────────────────────────

@tool_descriptor(
    name="dual_perspective_analysis",
    requires_sandbox=("file_read",),
    async_execution=True,
    tool_type="internal",
    policy_name="DualPerspectiveAnalysis",
    default_policy="allow",
    policy_reason="Dual perspective analysis (read-only DB query)",
    ui_description="双向视角案件分析（申请人/被申请人）",
    ui_icon="⚖️",
)
async def dual_perspective_analysis(
    case_type: str,
    materials_summary: str = "",
) -> ToolChunk:
    """双向视角案件分析引擎。

    同时输出申请人视角和被申请人视角的完整分析：
    - 申请人：优势点、劣势点/缺失要素、证据清单、胜诉概率评估
    - 被申请人：原告主张薄弱点、抗辩策略、反证清单、预期效果

    Args:
        case_type (`str`):
            案件类型名称。
        materials_summary (`str`, optional):
            案件材料摘要（如有），用于更精准的分析。
    """
    if not case_type or not case_type.strip():
        return _make_response("错误：未提供案件类型名称。")

    db = get_case_framework_db()

    # Find case type
    ct = db.get_case_type_by_name(case_type)
    if not ct:
        return _make_response(
            f"未找到案件类型「{case_type}」。\n"
            f"请先使用 identify_case_type 工具识别案件类型。"
        )

    case_id = ct["case_id"]
    case_name = ct["case_name"]

    # ── Applicant perspective ──────────────────────────────────────
    applicant_evidence = db.get_evidence_checklist(case_id, "applicant")
    applicant_core_points = db.get_core_review_points(case_id)
    applicant_framework_points = db.get_review_points(case_id, 3)  # Part 3: applicant claims

    applicant_strengths = [
        {"name": rp["point_name"], "content": rp.get("review_content", "")}
        for rp in applicant_core_points
    ]
    applicant_gaps = [
        {"name": rp["point_name"], "angle": rp.get("attention_points", "需进一步审查")}
        for rp in applicant_core_points
    ] if not materials_summary else []

    applicant_claims = [
        {
            "name": rp["point_name"],
            "content": rp.get("review_content", ""),
            "basis": rp.get("legal_basis", ""),
        }
        for rp in applicant_framework_points
    ]

    total_app = len(applicant_strengths) + len(applicant_gaps)
    applicant_probability = len(applicant_strengths) / total_app if total_app > 0 else 0.5

    # ── Respondent perspective ─────────────────────────────────────
    respondent_evidence = db.get_evidence_checklist(case_id, "respondent")
    respondent_framework_points = db.get_review_points(case_id, 4)  # Part 4: respondent defenses

    respondent_weak_points = [
        {"name": rp["point_name"], "angle": rp.get("attention_points", "审查证据三性")}
        for rp in applicant_core_points
    ]
    respondent_defenses = [
        {
            "type": rp["point_name"],
            "content": rp.get("review_content", ""),
            "basis": rp.get("legal_basis", ""),
        }
        for rp in respondent_framework_points
    ]

    # Evaluate outcome
    if respondent_defenses:
        outcome = "若抗辩证据充分，可部分或全部反驳申请人主张"
    else:
        outcome = "抗辩空间有限，建议通过调解解决"

    # ── Build output ────────────────────────────────────────────────
    lines = [f"# {case_name} — 双向视角分析\n"]

    if materials_summary:
        lines.append(f"**案件材料摘要**：{materials_summary[:200]}{'...' if len(materials_summary) > 200 else ''}\n")

    # Applicant section
    lines.append("## 申请人视角分析\n")
    lines.append("### 优势点\n")
    if applicant_strengths:
        for s in applicant_strengths[:10]:
            lines.append(f"- {s['name']}")
            if s.get("content"):
                lines.append(f"  - {s['content'][:80]}")
    else:
        lines.append("- （数据库暂无核心要点数据）")
    lines.append("")

    lines.append("### 劣势点/缺失要素\n")
    if applicant_gaps:
        for g in applicant_gaps[:10]:
            lines.append(f"- {g['name']}")
            if g.get("angle"):
                lines.append(f"  - {g['angle'][:80]}")
    else:
        if materials_summary:
            lines.append("- 基于材料摘要，需逐一对照审查要点核实")
        else:
            lines.append("- 未提供材料信息，建议补充案件材料后分析")
    lines.append("")

    lines.append("### 证据清单\n")
    if applicant_evidence:
        for ev in applicant_evidence:
            lines.append(f"- **{ev['evidence_name']}**（{ev.get('necessity_level', '重要')}）")
            if ev.get("description"):
                lines.append(f"  - {ev['description'][:80]}")
    else:
        lines.append("- （数据库暂无证据清单数据）")
    lines.append("")

    lines.append(f"### 胜诉概率评估\n")
    prob_label = "高" if applicant_probability > 0.7 else "中" if applicant_probability > 0.4 else "中低"
    lines.append(f"基于核心要件覆盖率的初步评估：**{prob_label}**（{applicant_probability:.1%}）")
    lines.append("")

    # Respondent section
    lines.append("## 被申请人视角分析\n")
    lines.append("### 申请人主张薄弱点\n")
    if respondent_weak_points:
        for w in respondent_weak_points[:10]:
            lines.append(f"- {w['name']}")
            if w.get("angle"):
                lines.append(f"  - {w['angle'][:80]}")
    else:
        lines.append("- （数据库暂无数据）")
    lines.append("")

    lines.append("### 抗辩策略\n")
    if respondent_defenses:
        for d in respondent_defenses[:10]:
            lines.append(f"- **{d['type']}**")
            if d.get("content"):
                lines.append(f"  - {d['content'][:80]}")
            if d.get("basis"):
                lines.append(f"  - 法律依据：{d['basis'][:60]}")
    else:
        lines.append("- （数据库暂无抗辩策略数据）")
    lines.append("")

    lines.append("### 反证清单\n")
    if respondent_evidence:
        for ev in respondent_evidence:
            lines.append(f"- **{ev['evidence_name']}**")
            if ev.get("description"):
                lines.append(f"  - {ev['description'][:80]}")
    else:
        lines.append("- （数据库暂无反证清单数据）")
    lines.append("")

    lines.append("### 预期抗辩效果\n")
    lines.append(f"> {outcome}")
    lines.append("")

    # Reinforcement
    reinforcements = db.get_reinforcement_templates(case_id)
    if reinforcements:
        lines.append("## 补强建议\n")
        for r in reinforcements[:5]:
            lines.append(f"- **{r.get('gap_type', '缺失')}**: {r.get('reinforcement_advice', '')[:80]}")
            lines.append(f"  - 优先级：{r.get('priority', '中')} | 难度：{r.get('difficulty', '未知')} | 预计时间：{r.get('time_required', '未知')}")

    lines.append("\n---")
    lines.append("⚠️ 本分析基于数据库规则生成，仅供参考，不构成法律意见。")

    return _make_response("\n".join(lines))


# ── Tool 4: legal_qa_consultation ─────────────────────────────────────

@tool_descriptor(
    name="legal_qa_consultation",
    requires_sandbox=("file_read",),
    async_execution=True,
    tool_type="internal",
    policy_name="LegalQAConsultation",
    default_policy="allow",
    policy_reason="Legal Q&A consultation (read-only DB query)",
    ui_description="智能法律咨询问答",
    ui_icon="💬",
)
async def legal_qa_consultation(
    question: str,
    context: Optional[str] = None,
) -> ToolChunk:
    """法律智能问答系统。

    支持5种问题类型的自然语言问答：
    1. 案件识别 — "这是什么纠纷？"
    2. 法律依据 — "有什么法律依据？"
    3. 证据清单 — "需要什么证据？"
    4. 流程指导 — "怎么办理？"
    5. 一般咨询 — 其他法律问题

    Args:
        question (`str`):
            用户的法律问题。
        context (`str`, optional):
            上下文信息（如已知案件类型），JSON字符串。
            例如：'{"case_type": "民间借贷"}'
    """
    if not question or not question.strip():
        return _make_response("错误：未提供问题文本。")

    # Parse context
    ctx: dict[str, Any] = {}
    if context:
        try:
            ctx = json.loads(context)
        except (json.JSONDecodeError, TypeError):
            ctx = {"case_type": context.strip()}

    db = get_case_framework_db()

    # Classify question type
    question_type = _classify_question(question)
    type_labels = {
        "case_identification": "案件类型识别",
        "legal_basis": "法律依据查询",
        "evidence_guidance": "证据清单查询",
        "process_guidance": "办理流程查询",
        "general": "一般咨询",
    }

    # Identify case type from context or question
    case_type_name = ctx.get("case_type", "")
    case_id = ctx.get("case_id")

    if not case_id and not case_type_name:
        # Try to identify from the question
        results = db.identify_case_type(question, top_k=1)
        if results:
            case_id = results[0].get("case_id")
            case_type_name = results[0].get("case_name", "")

    # If still not found, try name lookup
    if case_type_name and not case_id:
        ct = db.get_case_type_by_name(case_type_name)
        if ct:
            case_id = ct["case_id"]

    lines = [f"## {type_labels.get(question_type, '法律咨询')}\n"]

    if question_type == "case_identification":
        # Case identification answer
        results = db.identify_case_type(question, top_k=3)
        if results:
            best = results[0]
            lines.append(f"根据您的描述，这属于**{best['case_name']}**（置信度：{best['score']:.1%}）\n")
            lines.append(f"匹配关键词：{', '.join(best.get('matched_keywords', []))}\n")
            if best.get("description"):
                lines.append(f"描述：{best['description'][:100]}\n")
            lines.append("建议追问：")
            lines.append(f"- 了解「{best['case_name']}」的法律依据")
            lines.append(f"- 查看「{best['case_name']}」需要什么证据")
            lines.append(f"- 了解「{best['case_name']}」的办理流程")
        else:
            lines.append("未能识别案件类型。请提供更多案情细节。")

    elif question_type == "legal_basis":
        if case_id:
            ct = db.get_case_type(case_id)
            if ct:
                case_name = ct["case_name"]
                legal_basis = ct.get("core_legal_basis", "")
                lines.append(f"**{case_name}**的主要法律依据：\n")
                if legal_basis:
                    lines.append(f"> {legal_basis}\n")
                else:
                    lines.append("> （数据库暂无法律依据数据，请使用 search_knowledge 检索法条）\n")
                lines.append("建议追问：")
                lines.append(f"- 查看「{case_name}」需要什么证据")
                lines.append(f"- 了解「{case_name}」的办理流程")
        else:
            lines.append("未能确定案件类型。请先描述案情或指定案件类型。")

    elif question_type == "evidence_guidance":
        if case_id:
            ct = db.get_case_type(case_id)
            if ct:
                case_name = ct["case_name"]
                applicant_ev = db.get_evidence_checklist(case_id, "applicant")
                respondent_ev = db.get_evidence_checklist(case_id, "respondent")

                lines.append(f"**{case_name}**的证据清单：\n")

                lines.append("### 申请人证据\n")
                if applicant_ev:
                    for ev in applicant_ev:
                        lines.append(f"- **{ev['evidence_name']}**（{ev.get('necessity_level', '重要')}）")
                        if ev.get("description"):
                            lines.append(f"  - {ev['description'][:80]}")
                else:
                    lines.append("（暂无申请人证据数据）")

                lines.append("\n### 被申请人证据\n")
                if respondent_ev:
                    for ev in respondent_ev:
                        lines.append(f"- **{ev['evidence_name']}**（{ev.get('necessity_level', '重要')}）")
                        if ev.get("description"):
                            lines.append(f"  - {ev['description'][:80]}")
                else:
                    lines.append("（暂无被申请人证据数据）")

                lines.append("\n建议追问：")
                lines.append(f"- 了解「{case_name}」的法律依据")
                lines.append(f"- 了解「{case_name}」的办理流程")
        else:
            lines.append("未能确定案件类型。请先描述案情或指定案件类型。")

    elif question_type == "process_guidance":
        if case_id:
            ct = db.get_case_type(case_id)
            if ct:
                case_name = ct["case_name"]
                frameworks = db.get_frameworks(case_id)

                lines.append(f"**{case_name}**的办理流程（六段式框架）：\n")

                if frameworks:
                    for fw in frameworks:
                        pn = fw["part_number"]
                        part_name = fw.get("part_name", FRAMEWORK_PARTS.get(pn, ""))
                        lines.append(f"### 第{pn}部分：{part_name}\n")

                        # Source DB stores part_number as framework_id in review_points
                        review_points = db.get_review_points(case_id, pn)
                        if review_points:
                            for rp in review_points[:5]:
                                core = " **[核心]**" if rp.get("is_core") else ""
                                lines.append(f"- {rp['point_name']}{core}")
                                if rp.get("review_content"):
                                    lines.append(f"  - {rp['review_content'][:80]}")
                        else:
                            lines.append("（暂无审查要点数据）")
                        lines.append("")
                else:
                    lines.append("（数据库暂无框架数据，将使用标准六段式框架）\n")
                    for pn, pname in FRAMEWORK_PARTS.items():
                        lines.append(f"### 第{pn}部分：{pname}\n")
                        lines.append("（需通过知识库整理器补充数据）\n")

                lines.append("建议追问：")
                lines.append(f"- 了解「{case_name}」的法律依据")
                lines.append(f"- 查看「{case_name}」需要什么证据")
        else:
            lines.append("未能确定案件类型。请先描述案情或指定案件类型。")

    else:  # general
        results = db.identify_case_type(question, top_k=1)
        if results and results[0]["score"] > 0.3:
            best = results[0]
            lines.append(f"根据您的问题，这可能涉及**{best['case_name']}**。\n")
            lines.append("建议追问：")
            lines.append(f"- 了解「{best['case_name']}」的法律依据")
            lines.append(f"- 查看「{best['case_name']}」需要什么证据")
            lines.append(f"- 了解「{best['case_name']}」的办理流程")
        else:
            lines.append(
                "我了解您的问题。为了更准确地帮助您，能否提供更多细节？\n\n"
                "您可以：\n"
                "1. **描述具体案情**：我会帮您识别案件类型\n"
                "2. **询问法律依据**：了解相关法律规定\n"
                "3. **查看证据清单**：知道需要准备哪些材料\n"
                "4. **了解办理流程**：了解案件处理的完整流程\n\n"
                "例如：\n"
                '- "我借给朋友10万元，他一直不还，该怎么办？"\n'
                '- "建设工程施工合同款怎么讨要？"\n'
                '- "离婚纠纷需要什么证据？"'
            )

    lines.append("\n---")
    lines.append("⚠️ 本回答基于数据库规则生成，仅供参考，不构成法律意见。")

    return _make_response("\n".join(lines))


__all__ = [
    "identify_case_type",
    "generate_review_checklist",
    "dual_perspective_analysis",
    "legal_qa_consultation",
]
