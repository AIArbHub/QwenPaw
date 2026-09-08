# -*- coding: utf-8 -*-
# flake8: noqa: E501
# pylint: disable=line-too-long
"""Extended case analysis tools for aiarb.

Additional tools that bring the remaining case-type-guide capabilities:

5. ``analyze_award_document``  — structured extraction from arbitration awards
6. ``extract_case_materials``  — multi-format document processing & key info extraction
7. ``generate_case_graph``     — Mermaid knowledge graph / mindmap / flowchart
8. ``identify_gaps_and_advice`` — gap identification + reinforcement matching

All tools are async, sandbox-safe, and auto-registered via ``@tool_descriptor``.
"""

from __future__ import annotations

import json
import logging
import os
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


def _make_response(text: str) -> ToolChunk:
    """Build a success ToolChunk with a single text block."""
    return ToolChunk(
        is_last=True,
        state=ToolResultState.SUCCESS,
        content=[TextBlock(type="text", text=text)],
    )


# ── Arbitration terminology adaptation ─────────────────────────────────

_TERM_SUBS: list[tuple[str, str]] = [
    ("原告", "申请人"),
    ("被告", "被申请人"),
    ("裁判", "裁决"),
    ("判决", "裁决"),
    ("庭审", "开庭"),
    ("合议庭", "仲裁庭"),
    ("人民法院", "仲裁机构"),
    ("民事判决", "仲裁裁决"),
    ("审判长", "首席仲裁员"),
    ("审判员", "仲裁员"),
    ("书记员", "仲裁秘书"),
    ("一审", ""),
    ("二审", ""),
    ("上诉", "申请撤销"),
    ("上诉人", "申请人"),
    ("被上诉人", "被申请人"),
]


def _arb_adapt(text: str) -> str:
    """Apply arbitration terminology substitutions."""
    if not text:
        return text
    for old, new in _TERM_SUBS:
        text = text.replace(old, new)
    return text


# ── Tool 5: analyze_award_document ─────────────────────────────────────

# Regex patterns for award document extraction
_AWARD_PATTERNS = {
    "case_number": r"(?P<year>\d{4})[^\d]*(?P<court>[^\d]+)刑?民?仲?裁?初?字?第(?P<number>\d+)号",
    "tribunal": r"(审理仲裁机构|仲裁机构|仲裁委员会)[：:]\s*(?P<name>[^\n]+?)(?=\n|裁决|裁定)",
    "case_reason": r"案由[：:]\s*(?P<reason>[^\n]+)",
    "applicant": r"(申请人|原告)[：:]\s*(?P<name>[^\n]+)",
    "respondent": r"(被申请人|被告)[：:]\s*(?P<name>[^\n]+)",
    "award_date": r"(裁决|裁定)日期[：:]\s*(?P<date>\d{4}年\d{1,2}月\d{1,2}日)",
    "award_result": r"(裁决|裁定)如下[：:](?P<result>.*?)(?=首席仲裁员|仲裁员|仲裁秘书|$)",
}


@tool_descriptor(
    name="analyze_award_document",
    requires_sandbox=("file_read",),
    async_execution=True,
    tool_type="internal",
    policy_name="AnalyzeAwardDocument",
    default_policy="allow",
    policy_reason="Award document analysis (regex extraction, read-only)",
    ui_description="裁决文书结构化分析：提取基本信息、法律依据、关键事实",
    ui_icon="📄",
)
async def analyze_award_document(
    document_text: str,
    case_type: Optional[str] = None,
) -> ToolChunk:
    """裁决文书智能分析。

    对仲裁裁决书/法院判决书进行结构化信息提取，包括：
    - 案号、仲裁机构、当事人等基本信息
    - 适用法律条文
    - 经查明/认定的关键事实
    - 裁决结果摘要

    Args:
        document_text (`str`):
            裁判文书全文文本。
        case_type (`str`, optional):
            已知案件类型名称，用于类案匹配。
    """
    if not document_text or not document_text.strip():
        return _make_response("错误：未提供文书文本。")

    text = document_text

    # Extract basic info
    basic_info: dict[str, Any] = {
        "case_number": None,
        "tribunal": None,
        "case_reason": None,
        "applicants": [],
        "respondents": [],
        "award_date": None,
        "award_result": None,
    }

    cn_match = re.search(_AWARD_PATTERNS["case_number"], text)
    if cn_match:
        basic_info["case_number"] = cn_match.group(0)

    tribunal_match = re.search(_AWARD_PATTERNS["tribunal"], text)
    if tribunal_match:
        basic_info["tribunal"] = _arb_adapt(tribunal_match.group("name").strip())

    reason_match = re.search(_AWARD_PATTERNS["case_reason"], text)
    if reason_match:
        basic_info["case_reason"] = reason_match.group("reason").strip()

    applicant_matches = re.findall(_AWARD_PATTERNS["applicant"], text)
    for match in applicant_matches:
        basic_info["applicants"].append(_arb_adapt(match[1].strip()))

    respondent_matches = re.findall(_AWARD_PATTERNS["respondent"], text)
    for match in respondent_matches:
        basic_info["respondents"].append(_arb_adapt(match[1].strip()))

    date_match = re.search(_AWARD_PATTERNS["award_date"], text)
    if date_match:
        basic_info["award_date"] = date_match.group("date")

    result_match = re.search(_AWARD_PATTERNS["award_result"], text, re.DOTALL)
    if result_match:
        result_text = result_match.group("result").strip()
        basic_info["award_result"] = result_text[:300] + "..." if len(result_text) > 300 else result_text

    # Extract legal basis
    legal_basis: list[str] = []
    law_patterns = [
        r"《([^》]+)》",
        r"第[一二三四五六七八九十百千]+[条款项款]",
        r"[^\n]{0,50}法第[一二三四五六七八九十百千]+[条款项款]",
    ]
    for pattern in law_patterns:
        matches = re.findall(pattern, text)
        legal_basis.extend(matches)
    legal_basis = list(set(legal_basis))[:10]

    # Extract key facts
    key_facts: list[str] = []
    fact_patterns = [
        r"查明[：:，,]\s*([^\n]{20,200}?)(?=；|。|\.|另查明|本会认为|仲裁庭认为)",
        r"认定[：:，,]\s*([^\n]{20,200}?)(?=；|。|\.|另认定|本会认为|仲裁庭认为)",
    ]
    for pattern in fact_patterns:
        matches = re.findall(pattern, text)
        key_facts.extend([_arb_adapt(m.strip()) for m in matches if len(m.strip()) > 10])
    key_facts = key_facts[:5]

    # Identify case type from text if not provided
    db = get_case_framework_db()
    identified_case_type = case_type
    if not identified_case_type:
        results = db.identify_case_type(text[:500], top_k=1)
        if results and results[0]["score"] > 0.05:
            identified_case_type = results[0]["case_name"]

    # Build output
    lines = ["## 裁决文书分析报告\n"]

    # Basic info
    lines.append("### 基本信息\n")
    if basic_info["case_number"]:
        lines.append(f"- **案号**: {basic_info['case_number']}")
    if basic_info["tribunal"]:
        lines.append(f"- **仲裁机构**: {basic_info['tribunal']}")
    if basic_info["case_reason"]:
        lines.append(f"- **案由**: {basic_info['case_reason']}")
    if basic_info["applicants"]:
        lines.append(f"- **申请人**: {', '.join(basic_info['applicants'][:3])}")
    if basic_info["respondents"]:
        lines.append(f"- **被申请人**: {', '.join(basic_info['respondents'][:3])}")
    if basic_info["award_date"]:
        lines.append(f"- **裁决日期**: {basic_info['award_date']}")
    if identified_case_type:
        lines.append(f"- **识别案件类型**: {identified_case_type}")
    lines.append("")

    # Legal basis
    lines.append("### 适用法律\n")
    if legal_basis:
        for law in legal_basis[:5]:
            lines.append(f"- {law}")
    else:
        lines.append("- （未提取到法律条文）")
    lines.append("")

    # Key facts
    lines.append("### 关键事实\n")
    if key_facts:
        for i, fact in enumerate(key_facts, 1):
            lines.append(f"{i}. {fact}")
    else:
        lines.append("- （未提取到关键事实）")
    lines.append("")

    # Award result
    lines.append("### 裁决结果\n")
    if basic_info["award_result"]:
        lines.append(f"> {_arb_adapt(basic_info['award_result'])}")
    else:
        lines.append("> （未提取到裁决结果）")
    lines.append("")

    # Summary
    lines.append("### 分析摘要\n")
    summary_parts = []
    if basic_info["case_number"]:
        summary_parts.append(f"案号 {basic_info['case_number']}")
    if identified_case_type:
        summary_parts.append(f"案件类型「{identified_case_type}」")
    if legal_basis:
        summary_parts.append(f"适用 {len(legal_basis)} 项法律")
    if key_facts:
        summary_parts.append(f"{len(key_facts)} 项关键事实")
    lines.append(f"> {' | '.join(summary_parts)}")
    lines.append("")

    lines.append("---")
    lines.append("⚠️ 本分析基于正则表达式提取，仅供参考。")

    return _make_response("\n".join(lines))


# ── Tool 6: extract_case_materials ─────────────────────────────────────

_KEY_INFO_PATTERNS = {
    "parties": [
        r"申请人[：:]\s*([^\n，。；]{2,10})",
        r"被申请人[：:]\s*([^\n，。；]{2,10})",
        r"原告[：:]\s*([^\n，。；]{2,10})",
        r"被告[：:]\s*([^\n，。；]{2,10})",
    ],
    "amounts": [
        r"(\d+(?:\.\d+)?)\s*[万千百]*元",
        r"[人民币]?\s*(\d+(?:\.\d+)?)\s*元",
        r"￥\$?\s*(\d+(?:\.\d+)?)",
    ],
    "dates": [
        r"(\d{4})[年\-](\d{1,2})[月\-](\d{1,2})[日]?",
        r"(\d{4})[年\-](\d{1,2})[月\-]",
    ],
    "contracts": [
        r"([^《\n]{2,15})(?:合同|协议|协议书)",
        r"《([^《\n]{2,15})(?:合同|协议|协议书)》",
    ],
}


@tool_descriptor(
    name="extract_case_materials",
    requires_sandbox=("file_read",),
    async_execution=True,
    tool_type="internal",
    policy_name="ExtractCaseMaterials",
    default_policy="allow",
    policy_reason="Case materials extraction (regex, read-only)",
    ui_description="案件材料关键信息提取：当事人、金额、日期、合同",
    ui_icon="📎",
)
async def extract_case_materials(
    materials_text: str,
    file_names: Optional[str] = None,
) -> ToolChunk:
    """案件材料关键信息提取。

    从案件材料文本中提取结构化关键信息：
    - 当事人（申请人/被申请人/原告/被告）
    - 金额（借款金额、诉讼标的等）
    - 日期（合同签订日期、履行期限等）
    - 合同/协议名称

    Args:
        materials_text (`str`):
            案件材料文本内容（可从PDF/Word等提取后传入）。
        file_names (`str`, optional):
            涉及的文件名列表（JSON数组），用于溯源。
    """
    if not materials_text or not materials_text.strip():
        return _make_response("错误：未提供材料文本。")

    text = materials_text

    # Parse file names
    files: list[str] = []
    if file_names:
        try:
            files = json.loads(file_names) if isinstance(file_names, str) else file_names
        except (json.JSONDecodeError, TypeError):
            files = [file_names]

    # Extract key info
    key_info: dict[str, list[Any]] = {
        "parties": [],
        "amounts": [],
        "dates": [],
        "contracts": [],
    }

    # Parties
    for pattern in _KEY_INFO_PATTERNS["parties"]:
        matches = re.findall(pattern, text)
        key_info["parties"].extend([_arb_adapt(m) for m in matches])

    # Amounts
    for pattern in _KEY_INFO_PATTERNS["amounts"]:
        matches = re.findall(pattern, text)
        key_info["amounts"].extend(matches)

    # Dates
    for pattern in _KEY_INFO_PATTERNS["dates"]:
        matches = re.findall(pattern, text)
        key_info["dates"].extend(matches)

    # Contracts
    for pattern in _KEY_INFO_PATTERNS["contracts"]:
        matches = re.findall(pattern, text)
        key_info["contracts"].extend(matches)

    # Deduplicate
    for key in key_info:
        key_info[key] = list(set(key_info[key]))

    # Build output
    lines = ["## 案件材料关键信息提取报告\n"]

    if files:
        lines.append(f"**材料来源**: {', '.join(files[:5])}\n")

    lines.append(f"**文本长度**: {len(text)} 字符\n")

    # Parties
    lines.append("### 当事人\n")
    if key_info["parties"]:
        for p in key_info["parties"][:10]:
            lines.append(f"- {p}")
    else:
        lines.append("- （未提取到当事人信息）")
    lines.append("")

    # Amounts
    lines.append("### 金额\n")
    if key_info["amounts"]:
        for a in key_info["amounts"][:10]:
            lines.append(f"- {a} 元")
    else:
        lines.append("- （未提取到金额信息）")
    lines.append("")

    # Dates
    lines.append("### 日期\n")
    if key_info["dates"]:
        for d in key_info["dates"][:10]:
            if isinstance(d, tuple):
                lines.append(f"- {'-'.join(d)}")
            else:
                lines.append(f"- {d}")
    else:
        lines.append("- （未提取到日期信息）")
    lines.append("")

    # Contracts
    lines.append("### 合同/协议\n")
    if key_info["contracts"]:
        for c in key_info["contracts"][:10]:
            lines.append(f"- {c}")
    else:
        lines.append("- （未提取到合同/协议信息）")
    lines.append("")

    # Try to identify case type
    db = get_case_framework_db()
    results = db.identify_case_type(text[:500], top_k=3)
    lines.append("### 可能的案件类型\n")
    if results:
        for r in results:
            lines.append(f"- **{r['case_name']}** (置信度: {r['score']:.1%})")
    else:
        lines.append("- （未能识别案件类型，请提供更多材料细节）")
    lines.append("")

    # Suggestions
    lines.append("### 建议下一步操作\n")
    if results:
        best = results[0]
        lines.append(f"1. 使用 `generate_review_checklist` 查看「{best['case_name']}」的审查要点清单")
        lines.append(f"2. 使用 `dual_perspective_analysis` 进行「{best['case_name']}」的双向视角分析")
        lines.append(f"3. 使用 `identify_gaps_and_advice` 识别缺失要素并获取补强建议")
    else:
        lines.append("1. 补充更多案情描述以便识别案件类型")
        lines.append("2. 使用 `identify_case_type` 工具尝试识别")

    lines.append("\n---")
    lines.append("⚠️ 本提取基于正则表达式，可能存在遗漏或误判。")

    return _make_response("\n".join(lines))


# ── Tool 7: generate_case_graph ────────────────────────────────────────

_NODE_STYLES = {
    "case_type": "fill:#FF6B6B,stroke:#C92A2A,stroke-width:2px,color:#FFF",
    "framework": "fill:#4ECDC4,stroke:#20A4A3,stroke-width:2px,color:#FFF",
    "review_point": "fill:#95E1D3,stroke:#1DB9B3,stroke-width:1px,color:#333",
    "evidence": "fill:#FFE66D,stroke:#F4B942,stroke-width:1px,color:#333",
}


@tool_descriptor(
    name="generate_case_graph",
    requires_sandbox=("file_read",),
    async_execution=True,
    tool_type="internal",
    policy_name="GenerateCaseGraph",
    default_policy="allow",
    policy_reason="Case graph generation (read-only DB query, Mermaid output)",
    ui_description="生成案件知识图谱（Mermaid格式）",
    ui_icon="🕸️",
)
async def generate_case_graph(
    case_type: str,
    graph_type: str = "knowledge_graph",
) -> ToolChunk:
    """生成案件知识图谱可视化。

    基于数据库中的案件框架、审查要点和证据清单数据，
    生成 Mermaid 格式的可视化图谱。

    支持三种图谱类型：
    1. ``knowledge_graph`` — 完整知识图谱（案件→框架→要点→证据）
    2. ``mindmap`` — 思维导图（层级结构）
    3. ``flowchart`` — 办案流程图

    Args:
        case_type (`str`):
            案件类型名称（如"民间借贷"）。
        graph_type (`str`, optional):
            图谱类型：``knowledge_graph``（默认）、
            ``mindmap`` 或 ``flowchart``。
    """
    if not case_type or not case_type.strip():
        return _make_response("错误：未提供案件类型名称。")

    valid_types = {"knowledge_graph", "mindmap", "flowchart"}
    if graph_type not in valid_types:
        return _make_response(
            f"错误：图谱类型 '{graph_type}' 无效。"
            f"请使用 knowledge_graph/mindmap/flowchart。"
        )

    db = get_case_framework_db()
    ct = db.get_case_type_by_name(case_type)
    if not ct:
        return _make_response(
            f"未找到案件类型「{case_type}」。\n"
            f"请先使用 identify_case_type 工具识别案件类型。"
        )

    case_id = ct["case_id"]
    case_name = ct["case_name"]

    # Get data
    frameworks = db.get_frameworks(case_id)
    if not frameworks:
        frameworks = [
            {"framework_id": p, "part_number": p, "part_name": name, "part_content": ""}
            for p, name in FRAMEWORK_PARTS.items()
        ]

    applicant_evidence = db.get_evidence_checklist(case_id, "applicant")
    respondent_evidence = db.get_evidence_checklist(case_id, "respondent")

    if graph_type == "mindmap":
        return _make_response(_build_mindmap(case_name, case_id, frameworks, db))
    elif graph_type == "flowchart":
        return _make_response(_build_flowchart(case_name, case_id, db))
    else:
        return _make_response(
            _build_knowledge_graph(
                case_name, case_id, frameworks, db,
                applicant_evidence, respondent_evidence,
            )
        )


def _build_knowledge_graph(
    case_name: str,
    case_id: int,
    frameworks: list[dict],
    db: Any,
    applicant_ev: list[dict],
    respondent_ev: list[dict],
) -> str:
    """Build Mermaid knowledge graph."""
    lines = [
        "%%{init: {'theme':'base', 'themeVariables': { 'primaryColor':'#6C5CE7', 'primaryTextColor':'#FFF'}}}%%",
        "graph TD",
        "",
        "    classDef caseType fill:#FF6B6B,stroke:#C92A2A,stroke-width:2px,color:#FFF",
        "    classDef framework fill:#4ECDC4,stroke:#20A4A3,stroke-width:2px,color:#FFF",
        "    classDef reviewPoint fill:#95E1D3,stroke:#1DB9B3,stroke-width:1px,color:#333",
        "    classDef evidence fill:#FFE66D,stroke:#F4B942,stroke-width:1px,color:#333",
        "",
    ]

    # Center node
    case_node_id = f"case{case_id}"
    lines.append(f'    {case_node_id}["{case_name}"]')
    lines.append(f"    class {case_node_id} caseType")
    lines.append("")

    # Framework nodes
    for fw in frameworks:
        pn = fw["part_number"]
        part_name = fw.get("part_name", FRAMEWORK_PARTS.get(pn, f"Part {pn}"))
        part_id = f"part{case_id}_{pn}"
        label = part_name[:20] + "..." if len(part_name) > 20 else part_name
        lines.append(f'    {part_id}["{label}"]')
        lines.append(f'    {case_node_id} -->|包含| {part_id}')
        lines.append(f"    class {part_id} framework")

        # Review points for this part
        rps = db.get_review_points(case_id, pn)
        for j, rp in enumerate(rps[:5]):  # Limit to 5 per part
            rp_id = f"rp{case_id}_{pn}_{j}"
            rp_label = rp["point_name"][:15] + "..." if len(rp["point_name"]) > 15 else rp["point_name"]
            lines.append(f'    {rp_id}["{rp_label}"]')
            lines.append(f'    {part_id} -->|审查| {rp_id}')
            lines.append(f"    class {rp_id} reviewPoint")

        lines.append("")

    # Evidence nodes
    for ev in applicant_ev[:5]:
        ev_id = f"ev_app_{ev['evidence_id']}"
        label = ev["evidence_name"][:15] + "..." if len(ev["evidence_name"]) > 15 else ev["evidence_name"]
        lines.append(f'    {ev_id}["{label}"]')
        lines.append(f'    {case_node_id} -->|申请人证据| {ev_id}')
        lines.append(f"    class {ev_id} evidence")

    for ev in respondent_ev[:5]:
        ev_id = f"ev_res_{ev['evidence_id']}"
        label = ev["evidence_name"][:15] + "..." if len(ev["evidence_name"]) > 15 else ev["evidence_name"]
        lines.append(f'    {ev_id}["{label}"]')
        lines.append(f'    {case_node_id} -->|被申请人证据| {ev_id}')
        lines.append(f"    class {ev_id} evidence")

    lines.append("")
    lines.append(f"%% 案件: {case_name} (ID: {case_id})")
    lines.append(f"%% 框架部分: {len(frameworks)}")
    lines.append(f"%% 申请人证据: {len(applicant_ev)}, 被申请人证据: {len(respondent_ev)}")

    return "\n".join(lines)


def _build_mindmap(
    case_name: str,
    case_id: int,
    frameworks: list[dict],
    db: Any,
) -> str:
    """Build Mermaid mindmap."""
    lines = ["mindmap", f"  root(({case_name}))", ""]

    for fw in frameworks:
        pn = fw["part_number"]
        part_name = fw.get("part_name", FRAMEWORK_PARTS.get(pn, f"Part {pn}"))
        lines.append(f"    {part_name}")

        rps = db.get_review_points(case_id, pn)
        for rp in rps[:5]:
            core = "**" if rp.get("is_core") else ""
            lines.append(f"      {core}{rp['point_name']}{core}")

        lines.append("")

    return "\n".join(lines)


def _build_flowchart(case_name: str, case_id: int, db: Any) -> str:
    """Build Mermaid flowchart."""
    core_points = db.get_core_review_points(case_id)
    count = len(core_points)

    lines = [
        "flowchart TD",
        f'    Start(["开始: {case_name}"]) --> Review["要素审查"]',
        "",
    ]

    # Dynamic element nodes
    for i in range(1, min(count + 1, 4)):
        element_name = core_points[i-1]["point_name"] if i <= count else f"要素{i}"
        label = element_name[:15] + "..." if len(element_name) > 15 else element_name
        lines.append(f'    Review --> Element{i}["{label}"]')

    lines.extend([
        f'    Element1 --> Evidence{{"证据充分?"}}',
        '    Evidence -->|是| Success["胜诉概率高"]',
        '    Evidence -->|否| Reinforce["材料补强"]',
        '    Reinforce --> Evidence',
        '    Success --> End(["结案"])',
        "",
        f"%% 核心审查要点: {count} 项",
    ])

    return "\n".join(lines)


# ── Tool 8: identify_gaps_and_advice ────────────────────────────────────

@tool_descriptor(
    name="identify_gaps_and_advice",
    requires_sandbox=("file_read",),
    async_execution=True,
    tool_type="internal",
    policy_name="IdentifyGapsAndAdvice",
    default_policy="allow",
    policy_reason="Gap identification and advice matching (read-only DB query)",
    ui_description="缺失要素识别与补强建议匹配",
    ui_icon="🔧",
)
async def identify_gaps_and_advice(
    case_type: str,
    existing_evidence: str,
    party: str = "applicant",
) -> ToolChunk:
    """缺失要素识别与补强建议匹配。

    对比案件类型的标准证据清单与用户现有材料，
    识别缺失的必需证据，并匹配补强建议模板。

    Args:
        case_type (`str`):
            案件类型名称。
        existing_evidence (`str`):
            现有证据列表（JSON数组），每项包含 name 字段。
            例如: '[{"name": "借条"}, {"name": "转账记录"}]'
        party (`str`, optional):
            角色：``applicant``（申请人，默认）或 ``respondent``（被申请人）。
    """
    if not case_type or not case_type.strip():
        return _make_response("错误：未提供案件类型名称。")

    if not existing_evidence or not existing_evidence.strip():
        return _make_response("错误：未提供现有证据信息。")

    # Parse existing evidence
    try:
        existing_list = json.loads(existing_evidence) if isinstance(existing_evidence, str) else existing_evidence
    except (json.JSONDecodeError, TypeError):
        existing_list = [{"name": existing_evidence.strip()}]

    existing_names = [m.get("name", "").lower() for m in existing_list if isinstance(m, dict)]

    # Normalize party
    arb_party = PARTY_TYPE_MAP.get(party, party)

    db = get_case_framework_db()
    ct = db.get_case_type_by_name(case_type)
    if not ct:
        return _make_response(
            f"未找到案件类型「{case_type}」。\n"
            f"请先使用 identify_case_type 工具识别案件类型。"
        )

    case_id = ct["case_id"]
    case_name = ct["case_name"]

    # Get required evidence
    required_evidence = db.get_evidence_checklist(case_id, arb_party)

    # Identify gaps
    gaps: list[dict[str, Any]] = []
    matched: list[dict[str, Any]] = []

    for ev in required_evidence:
        ev_name = ev["evidence_name"]
        ev_name_lower = ev_name.lower()
        is_present = any(
            ev_name_lower in existing_name or existing_name in ev_name_lower
            for existing_name in existing_names
        )

        if is_present:
            matched.append(ev)
        else:
            gaps.append(ev)

    # Get reinforcement templates for gaps
    all_templates = db.get_reinforcement_templates(case_id)

    # Match templates to gaps
    gap_advice: list[dict[str, Any]] = []
    for gap in gaps:
        # Try to find matching template
        matching_templates = [
            t for t in all_templates
            if t.get("point_id") == gap.get("point_id")
        ]

        if matching_templates:
            t = matching_templates[0]
            gap_advice.append({
                "gap_name": gap["evidence_name"],
                "gap_type": t.get("gap_type", "证据缺失"),
                "advice": t.get("reinforcement_advice", "请根据案件情况收集相关材料"),
                "priority": t.get("priority", 2),
                "difficulty": t.get("difficulty", "中等"),
                "time_required": t.get("time_required", "1-2周"),
            })
        else:
            gap_advice.append({
                "gap_name": gap["evidence_name"],
                "gap_type": "证据缺失",
                "advice": "请根据案件情况收集相关材料",
                "priority": 2,
                "difficulty": "中等",
                "time_required": "1-2周",
            })

    # Sort by priority
    gap_advice.sort(key=lambda x: x.get("priority", 2))

    # Build output
    party_label = "申请人" if arb_party == "applicant" else "被申请人"

    lines = [f"## {case_name} — {party_label}缺失要素分析\n"]

    # Summary
    lines.append("### 分析摘要\n")
    lines.append(f"- 标准必需证据: {len(required_evidence)} 项")
    lines.append(f"- 已具备: {len(matched)} 项")
    lines.append(f"- 缺失: {len(gaps)} 项")
    lines.append(f"- 补强建议: {len(gap_advice)} 条")
    lines.append("")

    # Matched evidence
    lines.append("### ✅ 已具备的证据\n")
    if matched:
        for ev in matched:
            lines.append(f"- **{ev['evidence_name']}** ({ev.get('necessity_level', '重要')})")
            if ev.get("description"):
                lines.append(f"  - {ev['description'][:60]}")
    else:
        lines.append("- （未匹配到任何已有证据）")
    lines.append("")

    # Gaps with advice
    lines.append("### ❌ 缺失的必需证据\n")
    if gap_advice:
        for i, ga in enumerate(gap_advice, 1):
            priority_label = "高" if ga["priority"] == 1 else "中" if ga["priority"] == 2 else "低"
            lines.append(f"{i}. **{ga['gap_name']}**")
            lines.append(f"   - 缺失类型: {ga['gap_type']}")
            lines.append(f"   - 补强建议: {ga['advice']}")
            lines.append(f"   - 优先级: {priority_label} | 难度: {ga['difficulty']} | 预计时间: {ga['time_required']}")
            lines.append("")
    else:
        lines.append("✓ 所有必需证据均已具备！")
    lines.append("")

    # Action plan
    lines.append("### 📋 补强行动计划\n")
    if gap_advice:
        high_priority = [g for g in gap_advice if g["priority"] == 1]
        medium_priority = [g for g in gap_advice if g["priority"] == 2]
        low_priority = [g for g in gap_advice if g["priority"] not in (1, 2)]

        if high_priority:
            lines.append("**紧急（优先级: 高）**:")
            for g in high_priority:
                lines.append(f"  - 收集「{g['gap_name']}」 — {g['advice'][:50]}")

        if medium_priority:
            lines.append("\n**重要（优先级: 中）**:")
            for g in medium_priority:
                lines.append(f"  - 收集「{g['gap_name']}」 — {g['advice'][:50]}")

        if low_priority:
            lines.append("\n**建议（优先级: 低）**:")
            for g in low_priority:
                lines.append(f"  - 收集「{g['gap_name']}」 — {g['advice'][:50]}")
    else:
        lines.append("✓ 无需补强，材料已完备。")

    lines.append("\n---")
    lines.append("⚠️ 本分析基于数据库规则生成，仅供参考，不构成法律意见。")

    return _make_response("\n".join(lines))


__all__ = [
    "analyze_award_document",
    "extract_case_materials",
    "generate_case_graph",
    "identify_gaps_and_advice",
]
