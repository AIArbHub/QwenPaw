# -*- coding: utf-8 -*-
"""Document type inference for arbitration documents.

Extends LegalWork's _infer_doc_type() with arbitration-specific types.
All functions are pure — no I/O, no side effects.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional


# -- Document type constants -------------------------------------------------

ARBITRATION_AWARD = "arbitration_award"
ARBITRATION_APPLICATION = "arbitration_application"
ARBITRATION_DEFENSE = "arbitration_defense"
ARBITRATION_COUNTERCLAIM = "arbitration_counterclaim"
ARBITRATION_RULING = "arbitration_ruling"          # 程序令
ARBITRATION_INTERIM = "arbitration_interim_measure"  # 临时措施
COURT_JUDGMENT = "court_judgment"                    # 法院判决
COURT_RULING = "court_ruling"                        # 法院裁定
CONTRACT = "contract"
LEGAL_OPINION = "legal_opinion"
EVIDENCE = "evidence"
OTHER = "other"

# -- Keyword scoring --------------------------------------------------------

# Arbitration-specific keywords (权重 2)
_ARBITRATION_KEYWORDS = {
    "裁决书": (ARBITRATION_AWARD, 3),
    "仲裁庭": (ARBITRATION_AWARD, 2),
    "申请人": (ARBITRATION_AWARD, 2),
    "被申请人": (ARBITRATION_AWARD, 2),
    "独任仲裁员": (ARBITRATION_AWARD, 3),
    "首席仲裁员": (ARBITRATION_AWARD, 3),
    "组庭": (ARBITRATION_AWARD, 2),
    "开庭": (ARBITRATION_AWARD, 1),
    "仲裁规则": (ARBITRATION_AWARD, 1),
    "仲裁协议": (ARBITRATION_AWARD, 1),
    "仲裁请求": (ARBITRATION_APPLICATION, 2),
    "反请求": (ARBITRATION_COUNTERCLAIM, 3),
    "答辩": (ARBITRATION_DEFENSE, 2),
    "程序令": (ARBITRATION_RULING, 3),
    "临时措施": (ARBITRATION_INTERIM, 3),
    "保全": (ARBITRATION_INTERIM, 1),
}

# Court keywords (legalwork original, 权重 2)
_COURT_KEYWORDS = {
    "判决书": (COURT_JUDGMENT, 3),
    "裁定书": (COURT_RULING, 3),
    "本院认为": (COURT_JUDGMENT, 2),
    "审判长": (COURT_JUDGMENT, 2),
    "书记员": (COURT_JUDGMENT, 1),
    "原告": (COURT_JUDGMENT, 1),
    "被告": (COURT_JUDGMENT, 1),
    "上诉人": (COURT_JUDGMENT, 1),
    "被上诉人": (COURT_JUDGMENT, 1),
    "第三人": (COURT_JUDGMENT, 1),
    "合议庭": (COURT_JUDGMENT, 2),
    "本院依照": (COURT_JUDGMENT, 2),
    "本院依照": (COURT_JUDGMENT, 2),
}

# Contract keywords
_CONTRACT_KEYWORDS = {
    "合同": (CONTRACT, 1),
    "甲方": (CONTRACT, 1),
    "乙方": (CONTRACT, 1),
    "协议": (CONTRACT, 1),
    "约定": (CONTRACT, 1),
    "标的": (CONTRACT, 1),
    "违约": (CONTRACT, 1),
    "履行": (CONTRACT, 1),
    "解除": (CONTRACT, 1),
}

# Legal opinion keywords
_OPINION_KEYWORDS = {
    "法律意见": (LEGAL_OPINION, 3),
    "代理意见": (LEGAL_OPINION, 3),
    "律师意见": (LEGAL_OPINION, 3),
    "法律分析": (LEGAL_OPINION, 2),
    "法律建议": (LEGAL_OPINION, 2),
}

# Evidence keywords
_EVIDENCE_KEYWORDS = {
    "证据目录": (EVIDENCE, 3),
    "证据清单": (EVIDENCE, 3),
    "证据材料": (EVIDENCE, 2),
    "举证": (EVIDENCE, 1),
    "质证": (EVIDENCE, 1),
}

_ALL_KEYWORD_MAPS = [
    _ARBITRATION_KEYWORDS,
    _COURT_KEYWORDS,
    _CONTRACT_KEYWORDS,
    _OPINION_KEYWORDS,
    _EVIDENCE_KEYWORDS,
]


@dataclass
class DocTypeResult:
    """Result of document type inference.

    All functions are pure — no I/O, no side effects.
    """
    doc_type: str = OTHER
    confidence: float = 0.0
    matched_keywords: list[tuple[str, str, int]] | None = None

    def __post_init__(self):
        if self.matched_keywords is None:
            self.matched_keywords = []


def infer_doc_type(text: str) -> DocTypeResult:
    """Infer document type from text content using keyword scoring.

    Args:
        text: The full text content of the document.

    Returns:
        DocTypeResult with type, confidence, and matched keywords.

    Pure function — no I/O, no side effects.
    """
    if not text or not text.strip():
        return DocTypeResult()

    # Score each document type
    scores: dict[str, float] = {}
    matched: list[tuple[str, str, int]] = []

    for kw_map in _ALL_KEYWORD_MAPS:
        for keyword, (doc_type, weight) in kw_map.items():
            count = text.count(keyword)
            if count > 0:
                scores[doc_type] = scores.get(doc_type, 0.0) + count * weight
                matched.append((keyword, doc_type, count))

    if not scores:
        return DocTypeResult()

    # Pick the highest-scoring type
    best_type = max(scores, key=scores.get)
    best_score = scores[best_type]

    # Confidence = score / (score + 8) — saturating function,
    # so a score of 8 gives 50% confidence, 24 gives 75%
    confidence = min(best_score / (best_score + 8.0), 0.99)

    # Top 5 matched keywords (by score contribution)
    matched.sort(key=lambda x: x[2], reverse=True)
    top_matched = matched[:5]

    return DocTypeResult(
        doc_type=best_type,
        confidence=confidence,
        matched_keywords=top_matched,
    )


def is_arbitration_doc(doc_type: str) -> bool:
    """Check if a document type is arbitration-specific."""
    return doc_type in {
        ARBITRATION_AWARD,
        ARBITRATION_APPLICATION,
        ARBITRATION_DEFENSE,
        ARBITRATION_COUNTERCLAIM,
        ARBITRATION_RULING,
        ARBITRATION_INTERIM,
    }


def doc_type_label(doc_type: str) -> str:
    """Human-readable label for a document type."""
    labels = {
        ARBITRATION_AWARD: "仲裁裁决书",
        ARBITRATION_APPLICATION: "仲裁申请书",
        ARBITRATION_DEFENSE: "仲裁答辩书",
        ARBITRATION_COUNTERCLAIM: "仲裁反请求书",
        ARBITRATION_RULING: "仲裁程序令",
        ARBITRATION_INTERIM: "仲裁临时措施",
        COURT_JUDGMENT: "法院判决书",
        COURT_RULING: "法院裁定书",
        CONTRACT: "合同",
        LEGAL_OPINION: "法律意见书",
        EVIDENCE: "证据材料",
        OTHER: "其他",
    }
    return labels.get(doc_type, doc_type)


__all__ = [
    "ARBITRATION_AWARD",
    "ARBITRATION_APPLICATION",
    "ARBITRATION_DEFENSE",
    "ARBITRATION_COUNTERCLAIM",
    "ARBITRATION_RULING",
    "ARBITRATION_INTERIM",
    "COURT_JUDGMENT",
    "COURT_RULING",
    "CONTRACT",
    "LEGAL_OPINION",
    "EVIDENCE",
    "OTHER",
    "DocTypeResult",
    "infer_doc_type",
    "is_arbitration_doc",
    "doc_type_label",
]
