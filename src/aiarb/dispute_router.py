# -*- coding: utf-8 -*-
"""Dispute type router for arbitration case rules.

Routes user queries to the appropriate dispute type rule file,
similar to 8203's case-cause indexing. Each dispute type has
a rule file with:
  - Dispute overview
  - Common issues
  - Adjudication rules (with source)
  - Burden of proof
  - Common mistakes
  - Plain-language explanation

The router now auto-discovers DT rule files from the knowledge base
directory at startup, supplementing the manually indexed high-frequency
keywords with a filename-based fallback. This ensures all 257 dispute
type files (DT-001 ~ DT-263) are routable.

Pure functions — no I/O, no side effects (except file reading on demand).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional


@dataclass
class DisputeTypeMatch:
    """A matched dispute type for a user query."""
    dispute_type: str = ""
    title: str = ""
    file_name: str = ""
    score: float = 0.0
    matched_keywords: list[str] = field(default_factory=list)


# ── Manually indexed high-frequency keywords (DT-001 ~ DT-020) ────────
# These are the core arbitration dispute types with hand-tuned keywords
# for maximum matching accuracy. Lower-frequency types (DT-021+) are
# auto-discovered from their rule files and routed via filename keywords.

DISPUTE_TYPE_KEYWORDS: dict[str, list[str]] = {
    "DT-001": [
        "适当性", "资管", "理财", "风险测评", "投资者适当",
        "银行理财", "私募基金", "信托产品", "资管产品",
        "适当性义务", "了解客户", "风险匹配",
    ],
    "DT-002": [
        "增信", "差额补足", "安慰函", "承诺函", "担保函",
        "保证", "债务加入", "增信措施", "信用增级",
    ],
    "DT-003": [
        "建设工程", "工期", "逾期竣工", "施工合同",
        "工期顺延", "工程延期", "施工延误",
        "开工日期", "竣工日期", "竣工验收",
    ],
    "DT-004": [
        "对赌", "业绩补偿", "股权回购", "估值调整",
        "业绩承诺", "对赌协议", "VAM",
        "股权转让", "回购权",
    ],
    "DT-005": [
        "违约金", "违约金调整", "违约金过高",
        "实际损失", "过分高于", "违约金扣减",
    ],
    "DT-006": [
        "仲裁协议", "仲裁条款", "仲裁效力",
        "仲裁协议无效", "仲裁协议不成立",
        "确认仲裁协议效力", "仲裁主管",
    ],
    "DT-007": [
        "人格权", "一般人格权", "人格尊严", "人身自由",
        "人格利益", "精神损害", "赔礼道歉",
    ],
    "DT-008": [
        "不当得利", "无合法根据", "取得利益", "受损",
        "返还", "得利返还", "恶意得利",
    ],
    "DT-009": [
        "不正当竞争", "商业混淆", "虚假宣传", "商业诋毁",
        "网络不正当竞争", "竞争关系",
    ],
    "DT-010": [
        "公司纠纷", "股权确认", "股东资格", "公司治理",
        "股东权利", "股东义务", "公司利益",
    ],
    "DT-011": [
        "破产", "破产申请", "破产管理人", "破产债权",
        "破产财产", "债权人会议", "重整", "和解",
    ],
    "DT-012": [
        "专利合同", "专利转让", "专利许可", "专利权转让",
        "专利实施许可", "技术合同",
    ],
    "DT-013": [
        "专利权无效", "返还费用", "专利无效后", "无效宣告",
    ],
    "DT-014": [
        "专利权权属", "专利侵权", "专利权属纠纷",
        "发明创造", "职务发明", "专利权人",
    ],
    "DT-015": [
        "业主撤销权", "业主委员会", "业主大会", "物业管理",
        "业主自治", "业主撤销",
    ],
    "DT-016": [
        "中介合同", "中介服务", "居间", "中介费",
        "居间合同", "中介报酬", "居间费",
    ],
    "DT-017": [
        "串通投标", "围标", "招标投标", "不正当竞争",
        "招投标", "投标串通",
    ],
    "DT-018": [
        "买卖合同", "买卖", "购销", "交付", "验收",
        "质量异议", "违约交货", "标的物", "买受人", "出卖人",
    ],
    "DT-019": [
        "产品责任", "产品缺陷", "产品质量", "产品侵权",
        "销售者责任", "生产者责任", "召回",
    ],
    "DT-020": [
        "亲子关系", "亲子鉴定", "血缘关系", "确认亲子",
        "否认亲子", "亲子关系确认",
    ],
    # ── DT-021 ~ DT-050: Auto-discovered via file scanning ──
}

# Dispute type titles (manually maintained for core types)
DISPUTE_TYPE_TITLES: dict[str, str] = {
    "DT-001": "资管产品适当性争议",
    "DT-002": "增信措施效力争议",
    "DT-003": "建设工程工期争议",
    "DT-004": "股权转让对赌争议",
    "DT-005": "合同违约金调整争议",
    "DT-006": "仲裁协议效力争议",
    "DT-007": "一般人格权纠纷",
    "DT-008": "不当得利纠纷",
    "DT-009": "不正当竞争纠纷",
    "DT-010": "与公司有关的纠纷",
    "DT-011": "与破产有关的纠纷",
    "DT-012": "专利合同纠纷",
    "DT-013": "专利权宣告无效后返还费用纠纷",
    "DT-014": "专利权权属、侵权纠纷",
    "DT-015": "业主撤销权纠纷",
    "DT-016": "中介合同纠纷",
    "DT-017": "串通投标不正当竞争纠纷",
    "DT-018": "买卖合同纠纷",
    "DT-019": "产品责任纠纷",
    "DT-020": "亲子关系纠纷",
}

# Dispute type file names (will be auto-populated for unregistered types)
DISPUTE_TYPE_FILES: dict[str, str] = {
    "DT-001": "DT-001-资管产品适当性.md",
    "DT-002": "DT-002-增信措施效力.md",
    "DT-003": "DT-003-建设工程工期.md",
    "DT-004": "DT-004-股权转让对赌.md",
    "DT-005": "DT-005-违约金调整.md",
    "DT-006": "DT-006-仲裁协议效力.md",
    "DT-007": "DT-007-一般人格权纠纷.md",
    "DT-008": "DT-008-不当得利纠纷.md",
    "DT-009": "DT-009-不正当竞争纠纷.md",
    "DT-010": "DT-010-与公司有关的纠纷.md",
    "DT-011": "DT-011-与破产有关的纠纷.md",
    "DT-012": "DT-012-专利合同纠纷.md",
    "DT-013": "DT-013-专利权宣告无效后返还费用纠纷.md",
    "DT-014": "DT-014-专利权权属、侵权纠纷.md",
    "DT-015": "DT-015-业主撤销权纠纷.md",
    "DT-016": "DT-016-中介合同纠纷.md",
    "DT-017": "DT-017-串通投标不正当竞争纠纷.md",
    "DT-018": "DT-018-买卖合同纠纷.md",
    "DT-019": "DT-019-产品责任纠纷.md",
    "DT-020": "DT-020-亲子关系纠纷.md",
}

# ── Auto-discovery cache ───────────────────────────────────────────────
_auto_discovered: dict[str, tuple[str, list[str]]] = {}
_auto_discovered_initialized = False


def _ensure_auto_discovered() -> None:
    """Scan the dispute_types directory and populate the auto-discovery cache.

    For each file named ``DT-XXX-标题.md``, the title portion is
    split into keywords. This provides fallback routing for types
    that don't have manually tuned keyword indexes.
    """
    global _auto_discovered_initialized
    if _auto_discovered_initialized:
        return
    _auto_discovered_initialized = True

    dt_dir = get_dispute_type_dir()
    if not dt_dir.is_dir():
        return

    pattern = re.compile(r"^(DT-\d{3})-(.+)\.md$", re.IGNORECASE)

    for f in sorted(dt_dir.iterdir()):
        if not f.is_file():
            continue
        match = pattern.match(f.name)
        if not match:
            continue
        dt_id = match.group(1)
        title = match.group(2)

        # Skip already manually indexed types
        if dt_id in DISPUTE_TYPE_KEYWORDS:
            if dt_id not in DISPUTE_TYPE_TITLES:
                DISPUTE_TYPE_TITLES[dt_id] = title
            if dt_id not in DISPUTE_TYPE_FILES:
                DISPUTE_TYPE_FILES[dt_id] = f.name
            continue

        # Register file mapping
        DISPUTE_TYPE_FILES[dt_id] = f.name
        DISPUTE_TYPE_TITLES[dt_id] = title

        # Extract keywords from title: split on non-alphanumeric CJK boundaries
        # Simple heuristic: use the title itself as a keyword, plus
        # split on common separators and extract 2+ char segments
        keywords = _extract_title_keywords(title)
        _auto_discovered[dt_id] = (title, keywords)


def _extract_title_keywords(title: str) -> list[str]:
    """Extract searchable keywords from a dispute type title.

    Splits the title into meaningful Chinese segments.
    """
    # Remove common suffixes
    cleaned = title
    for suffix in ("纠纷", "争议", "案件", "案件纠纷"):
        if cleaned.endswith(suffix):
            cleaned = cleaned[: -len(suffix)]
            break

    keywords: list[str] = []
    # The full title (minus suffix) is always a keyword
    if cleaned and len(cleaned) >= 2:
        keywords.append(cleaned)

    # Split on punctuation and common separators
    parts = re.split(r"[，,、；;（）\(\)\s]+", title)
    for part in parts:
        part = part.strip()
        if len(part) >= 2 and part not in keywords:
            # Remove suffixes from individual parts too
            for suffix in ("纠纷", "争议", "案件"):
                if part.endswith(suffix) and len(part) > len(suffix):
                    stripped = part[: -len(suffix)]
                    if stripped and stripped not in keywords:
                        keywords.append(stripped)
                    break
            if part not in keywords:
                keywords.append(part)

    return keywords


def _get_keywords_for(dt_id: str) -> list[str]:
    """Get keywords for a dispute type, from manual index or auto-discovery."""
    if dt_id in DISPUTE_TYPE_KEYWORDS:
        return DISPUTE_TYPE_KEYWORDS[dt_id]
    if dt_id in _auto_discovered:
        return _auto_discovered[dt_id][1]
    return []


def route_dispute_type(query: str) -> list[DisputeTypeMatch]:
    """Route a user query to matching dispute types.

    Pure function — no I/O, no side effects (except lazy auto-discovery
    on first call).

    Args:
        query: Natural language query from user.

    Returns:
        List of DisputeTypeMatch, sorted by score (highest first).
    """
    if not query or not query.strip():
        return []

    # Ensure auto-discovery has run
    _ensure_auto_discovered()

    # Build the full set of dt_ids to check
    all_dt_ids: set[str] = set(DISPUTE_TYPE_KEYWORDS.keys())
    all_dt_ids.update(_auto_discovered.keys())
    all_dt_ids.update(DISPUTE_TYPE_FILES.keys())

    matches: list[DisputeTypeMatch] = []

    for dt_id in all_dt_ids:
        keywords = _get_keywords_for(dt_id)
        if not keywords:
            continue

        matched = []
        score = 0.0
        for kw in keywords:
            count = query.count(kw)
            if count > 0:
                matched.append(kw)
                score += count * (1.0 / len(kw))  # longer keywords weigh more

        if matched:
            matches.append(DisputeTypeMatch(
                dispute_type=dt_id,
                title=DISPUTE_TYPE_TITLES.get(dt_id, dt_id),
                file_name=DISPUTE_TYPE_FILES.get(dt_id, ""),
                score=score,
                matched_keywords=matched,
            ))

    matches.sort(key=lambda m: m.score, reverse=True)
    return matches


def get_dispute_type_dir() -> Path:
    """Return the directory containing dispute type rule files."""
    return Path(__file__).resolve().parent / "knowledge_base" / "cases" / "dispute_types"


def load_dispute_type_rule(dt_id: str) -> Optional[str]:
    """Load the full text of a dispute type rule file.

    Args:
        dt_id: Dispute type ID (e.g., "DT-001").

    Returns:
        File content as string, or None if not found.
    """
    # Ensure files are discovered
    _ensure_auto_discovered()

    file_name = DISPUTE_TYPE_FILES.get(dt_id)
    if not file_name:
        return None

    rule_path = get_dispute_type_dir() / file_name
    if not rule_path.exists():
        return None

    return rule_path.read_text(encoding="utf-8")


def list_all_dispute_types() -> list[DisputeTypeMatch]:
    """List all available dispute types.

    Returns:
        List of DisputeTypeMatch with all registered types.
    """
    _ensure_auto_discovered()

    all_dt_ids: set[str] = set(DISPUTE_TYPE_KEYWORDS.keys())
    all_dt_ids.update(_auto_discovered.keys())
    all_dt_ids.update(DISPUTE_TYPE_FILES.keys())

    return [
        DisputeTypeMatch(
            dispute_type=dt_id,
            title=DISPUTE_TYPE_TITLES.get(dt_id, dt_id),
            file_name=DISPUTE_TYPE_FILES.get(dt_id, ""),
            score=0.0,
            matched_keywords=_get_keywords_for(dt_id),
        )
        for dt_id in sorted(all_dt_ids)
    ]


__all__ = [
    "DisputeTypeMatch",
    "DISPUTE_TYPE_KEYWORDS",
    "DISPUTE_TYPE_TITLES",
    "DISPUTE_TYPE_FILES",
    "route_dispute_type",
    "get_dispute_type_dir",
    "load_dispute_type_rule",
    "list_all_dispute_types",
]
