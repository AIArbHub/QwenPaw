# -*- coding: utf-8 -*-
"""OKF 概念图 — 借鉴 StaffDeck knowledge/okf.py。

适配 QwenPaw 的 JSON 文件存储（不用 SQLModel）。

核心概念：
- 6 种概念类型：Source Document / Source Section / Topic / Playbook / Business Rule / Query Analysis
- 层级路径 ID：如 sources/order-doc/sections/cancel-policy
- 概念间链接关系（有向图边）
- OKF Lint 健康检查：missing_type / broken_link / orphan_concept / duplicate_title
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any


# ── 概念类型常量 ─────────────────────────────────────────────────────────

CONCEPT_TYPE_SOURCE_DOCUMENT = "source_document"
CONCEPT_TYPE_SOURCE_SECTION = "source_section"
CONCEPT_TYPE_TOPIC = "topic"
CONCEPT_TYPE_PLAYBOOK = "playbook"
CONCEPT_TYPE_BUSINESS_RULE = "business_rule"
CONCEPT_TYPE_QUERY_ANALYSIS = "query_analysis"

ALL_CONCEPT_TYPES = {
    CONCEPT_TYPE_SOURCE_DOCUMENT,
    CONCEPT_TYPE_SOURCE_SECTION,
    CONCEPT_TYPE_TOPIC,
    CONCEPT_TYPE_PLAYBOOK,
    CONCEPT_TYPE_BUSINESS_RULE,
    CONCEPT_TYPE_QUERY_ANALYSIS,
}

# 类型标签映射
CONCEPT_TYPE_LABELS: dict[str, str] = {
    CONCEPT_TYPE_SOURCE_DOCUMENT: "源文档",
    CONCEPT_TYPE_SOURCE_SECTION: "文档章节",
    CONCEPT_TYPE_TOPIC: "主题",
    CONCEPT_TYPE_PLAYBOOK: "操作手册",
    CONCEPT_TYPE_BUSINESS_RULE: "业务规则",
    CONCEPT_TYPE_QUERY_ANALYSIS: "查询分析",
}


@dataclass
class OKFConcept:
    """OKF 概念节点。"""

    concept_id: str
    concept_type: str
    title: str
    description: str = ""
    content_md: str = ""
    frontmatter: dict[str, Any] = field(default_factory=dict)
    links: list[dict[str, Any]] = field(default_factory=list)
    citations: list[dict[str, Any]] = field(default_factory=list)
    source_refs: list[dict[str, Any]] = field(default_factory=list)
    document_id: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "concept_id": self.concept_id,
            "concept_type": self.concept_type,
            "title": self.title,
            "description": self.description,
            "content_md": self.content_md,
            "frontmatter": self.frontmatter,
            "links": self.links,
            "citations": self.citations,
            "source_refs": self.source_refs,
            "document_id": self.document_id,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "OKFConcept":
        return cls(
            concept_id=data.get("concept_id", ""),
            concept_type=data.get("concept_type", ""),
            title=data.get("title", ""),
            description=data.get("description", ""),
            content_md=data.get("content_md", ""),
            frontmatter=data.get("frontmatter", {}),
            links=data.get("links", []),
            citations=data.get("citations", []),
            source_refs=data.get("source_refs", []),
            document_id=data.get("document_id", ""),
        )


# ── 搜索评分权重 ─────────────────────────────────────────────────────────

SCORE_TITLE_WEIGHT = 6.0
SCORE_TYPE_WEIGHT = 2.0
SCORE_CONTENT_WEIGHT = 3.0
SCORE_FULL_QUERY_BONUS = 10.0
SCORE_MIN_THRESHOLD = 4.0


def _normalize_text(text: str) -> str:
    """标准化文本用于搜索。"""
    return text.lower().strip()


def _generate_ngrams(text: str, n: int = 2) -> set[str]:
    """生成中文 n-gram（支持无空格匹配）。"""
    text = _normalize_text(text)
    if len(text) < n:
        return {text} if text else set()
    return {text[i : i + n] for i in range(len(text) - n + 1)}


def _score_concept(concept: OKFConcept, query: str) -> float:
    """计算概念与查询的匹配分数。"""
    query_lower = _normalize_text(query)
    if not query_lower:
        return 0.0

    score = 0.0
    title = _normalize_text(concept.title)
    desc = _normalize_text(concept.description)
    content = _normalize_text(concept.content_md)

    # 标题匹配
    if query_lower in title:
        score += SCORE_TITLE_WEIGHT

    # 类型匹配
    if query_lower in _normalize_text(concept.concept_type):
        score += SCORE_TYPE_WEIGHT

    # 正文匹配
    if query_lower in content:
        score += SCORE_CONTENT_WEIGHT

    # 描述完整查询命中
    if query_lower in desc:
        score += SCORE_FULL_QUERY_BONUS

    # 中文 n-gram 匹配（2/3/4 字）
    for n in (2, 3, 4):
        query_ngrams = _generate_ngrams(query, n)
        if not query_ngrams:
            continue
        title_ngrams = _generate_ngrams(concept.title, n)
        content_ngrams = _generate_ngrams(concept.content_md, n)
        desc_ngrams = _generate_ngrams(concept.description, n)

        all_ngrams = title_ngrams | content_ngrams | desc_ngrams
        matched = query_ngrams & all_ngrams
        if matched:
            ratio = len(matched) / len(query_ngrams)
            score += ratio * SCORE_CONTENT_WEIGHT

    return score


def search_concepts(
    concepts: list[OKFConcept],
    query: str,
    top_k: int = 5,
) -> list[tuple[OKFConcept, float]]:
    """搜索概念图，返回 (concept, score) 列表。

    Args:
        concepts: 概念列表。
        query: 搜索查询。
        top_k: 返回数量。

    Returns:
        按 score 降序排列的 (concept, score) 列表。
    """
    scored: list[tuple[OKFConcept, float]] = []
    for concept in concepts:
        score = _score_concept(concept, query)
        if score >= SCORE_MIN_THRESHOLD:
            scored.append((concept, score))

    scored.sort(key=lambda x: x[1], reverse=True)
    return scored[:top_k]


# ── 构建概念图 ───────────────────────────────────────────────────────────


def _slugify(text: str) -> str:
    """将文本转为 URL 安全的 slug。"""
    # 保留中文、字母、数字
    slug = re.sub(r"[^\w\u4e00-\u9fff]+", "-", text.lower()).strip("-")
    return slug or "untitled"


def _split_sections(text: str) -> list[dict[str, str]]:
    """将文本按标题分割为章节。"""
    sections: list[dict[str, str]] = []
    current_title = "概述"
    current_lines: list[str] = []

    for line in text.split("\n"):
        stripped = line.strip()
        # Markdown 标题
        if stripped.startswith("#"):
            if current_lines:
                sections.append(
                    {
                        "title": current_title,
                        "content": "\n".join(current_lines).strip(),
                    }
                )
            current_title = stripped.lstrip("#").strip() or "未命名"
            current_lines = []
        elif stripped.startswith("第") and ("章" in stripped or "节" in stripped):
            if current_lines:
                sections.append(
                    {
                        "title": current_title,
                        "content": "\n".join(current_lines).strip(),
                    }
                )
            current_title = stripped
            current_lines = []
        else:
            current_lines.append(line)

    if current_lines:
        sections.append(
            {
                "title": current_title,
                "content": "\n".join(current_lines).strip(),
            }
        )

    return sections


def _build_buckets(sections: list[dict[str, str]]) -> dict[str, list[dict[str, str]]]:
    """从章节构建知识桶。"""
    buckets: dict[str, list[dict[str, str]]] = {
        "topics": [],
        "playbooks": [],
        "rules": [],
    }

    for section in sections:
        title_lower = section["title"].lower()

        # 规则类
        if any(kw in title_lower for kw in ("规则", "要求", "必须", "禁止", "不得")):
            buckets["rules"].append(section)
        # 操作类
        elif any(kw in title_lower for kw in ("流程", "步骤", "操作", "指南", "手册")):
            buckets["playbooks"].append(section)
        # 主题类
        else:
            buckets["topics"].append(section)

        # 从内容中提取规则
        for line in section["content"].split("\n"):
            line = line.strip()
            if any(kw in line.lower() for kw in ("必须", "禁止", "不得", "应当", "应该")):
                if len(line) > 10:
                    buckets["rules"].append(
                        {"title": line[:50], "content": line}
                    )

    return buckets


def build_okf_for_document(
    doc_id: str,
    title: str,
    sections: list[dict[str, str]] | None = None,
    buckets: dict[str, list[dict[str, str]]] | None = None,
) -> list[OKFConcept]:
    """为文档构建 OKF 概念列表。

    Args:
        doc_id: 文档 ID。
        title: 文档标题。
        sections: 文档章节列表（title + content）。
        buckets: 知识桶（topics/playbooks/rules）。

    Returns:
        OKF 概念列表。
    """
    if sections is None:
        sections = []
    if buckets is None:
        buckets = _build_buckets(sections)

    concepts: list[OKFConcept] = []
    doc_slug = _slugify(title)

    # 1. Source Document
    concepts.append(
        OKFConcept(
            concept_id=f"sources/{doc_slug}",
            concept_type=CONCEPT_TYPE_SOURCE_DOCUMENT,
            title=title,
            description=f"源文档：{title}",
            content_md=f"# {title}\n\n文档 ID: {doc_id}",
            document_id=doc_id,
            source_refs=[{"doc_id": doc_id, "section": "full"}],
        )
    )

    # 2. Source Sections
    for i, section in enumerate(sections):
        sec_slug = _slugify(section["title"]) or f"section-{i}"
        concept_id = f"sources/{doc_slug}/sections/{sec_slug}"
        concepts.append(
            OKFConcept(
                concept_id=concept_id,
                concept_type=CONCEPT_TYPE_SOURCE_SECTION,
                title=section["title"],
                description=section["content"][:200] if section["content"] else "",
                content_md=f"## {section['title']}\n\n{section['content']}",
                document_id=doc_id,
                source_refs=[{"doc_id": doc_id, "section": sec_slug}],
                links=[{"target": f"sources/{doc_slug}", "type": "parent"}],
            )
        )

    # 3. Topics
    for topic in buckets.get("topics", []):
        topic_slug = _slugify(topic["title"])
        concept_id = f"topics/{topic_slug}"
        concepts.append(
            OKFConcept(
                concept_id=concept_id,
                concept_type=CONCEPT_TYPE_TOPIC,
                title=topic["title"],
                description=topic["content"][:200] if topic["content"] else "",
                content_md=f"## {topic['title']}\n\n{topic['content']}",
                document_id=doc_id,
                source_refs=[{"doc_id": doc_id, "section": topic_slug}],
                links=[{"target": f"sources/{doc_slug}", "type": "derived_from"}],
            )
        )

    # 4. Playbooks
    for playbook in buckets.get("playbooks", []):
        pb_slug = _slugify(playbook["title"])
        concept_id = f"playbooks/{pb_slug}"
        concepts.append(
            OKFConcept(
                concept_id=concept_id,
                concept_type=CONCEPT_TYPE_PLAYBOOK,
                title=playbook["title"],
                description=playbook["content"][:200] if playbook["content"] else "",
                content_md=f"## {playbook['title']}\n\n{playbook['content']}",
                document_id=doc_id,
                source_refs=[{"doc_id": doc_id, "section": pb_slug}],
                links=[{"target": f"sources/{doc_slug}", "type": "derived_from"}],
            )
        )

    # 5. Business Rules
    for rule in buckets.get("rules", []):
        rule_slug = _slugify(rule["title"])
        concept_id = f"rules/{rule_slug}"
        concepts.append(
            OKFConcept(
                concept_id=concept_id,
                concept_type=CONCEPT_TYPE_BUSINESS_RULE,
                title=rule["title"],
                description=rule["content"][:200] if rule["content"] else "",
                content_md=f"### 规则：{rule['title']}\n\n{rule['content']}",
                document_id=doc_id,
                source_refs=[{"doc_id": doc_id, "section": rule_slug}],
                links=[{"target": f"sources/{doc_slug}", "type": "derived_from"}],
            )
        )

    return concepts


# ── OKF Lint 健康检查 ─────────────────────────────────────────────────────


def lint_concepts(concepts: list[OKFConcept]) -> list[dict[str, str]]:
    """对概念列表进行健康检查。

    检查项：
    - missing_type: 缺少类型
    - broken_link: 链接目标不存在
    - orphan_concept: 孤立概念（无链接）
    - duplicate_title: 重复标题

    Returns:
        问题列表，每项含 concept_id / issue / detail。
    """
    issues: list[dict[str, str]] = []
    concept_ids = {c.concept_id for c in concepts}
    titles_seen: dict[str, str] = {}

    for concept in concepts:
        # missing_type
        if not concept.concept_type:
            issues.append(
                {
                    "concept_id": concept.concept_id,
                    "issue": "missing_type",
                    "detail": "概念缺少 concept_type",
                }
            )
        elif concept.concept_type not in ALL_CONCEPT_TYPES:
            issues.append(
                {
                    "concept_id": concept.concept_id,
                    "issue": "invalid_type",
                    "detail": f"未知类型: {concept.concept_type}",
                }
            )

        # broken_link
        for link in concept.links:
            target = link.get("target", "")
            if target and target not in concept_ids:
                issues.append(
                    {
                        "concept_id": concept.concept_id,
                        "issue": "broken_link",
                        "detail": f"链接目标不存在: {target}",
                    }
                )

        # orphan_concept（除 Source Document 外，应该有链接）
        if (
            concept.concept_type != CONCEPT_TYPE_SOURCE_DOCUMENT
            and not concept.links
        ):
            issues.append(
                {
                    "concept_id": concept.concept_id,
                    "issue": "orphan_concept",
                    "detail": "概念无任何链接关系",
                }
            )

        # duplicate_title
        if concept.title:
            if concept.title in titles_seen:
                issues.append(
                    {
                        "concept_id": concept.concept_id,
                        "issue": "duplicate_title",
                        "detail": f"标题重复: '{concept.title}' (已存在于 {titles_seen[concept.title]})",
                    }
                )
            else:
                titles_seen[concept.title] = concept.concept_id

    return issues


# ── 辅助函数 ─────────────────────────────────────────────────────────────


def build_sections_from_text(text: str) -> list[dict[str, str]]:
    """从纯文本构建章节列表（供 service.py 调用）。"""
    return _split_sections(text)


def build_buckets_from_sections(
    sections: list[dict[str, str]],
) -> dict[str, list[dict[str, str]]]:
    """从章节构建知识桶（供 service.py 调用）。"""
    return _build_buckets(sections)
