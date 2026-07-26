# -*- coding: utf-8 -*-
"""知识引用机制 — 借鉴 StaffDeck knowledge/citations.py。

核心功能：
- knowledge_citations_from_results: 从检索结果生成引用
- compact_knowledge_citation_labels: 压缩引用标签

引用类型：concept / evidence / okf
"""

from __future__ import annotations

import re
from typing import Any

# ── 字符限制 ─────────────────────────────────────────────────────────────

CITATION_EXCERPT_CHAR_LIMIT = 6000
CITATION_SUMMARY_CHAR_LIMIT = 800
CONCEPT_EXCERPT_CHAR_LIMIT = 2400

# ── 引用类型常量 ─────────────────────────────────────────────────────────

CITATION_KIND_CONCEPT = "concept"
CITATION_KIND_EVIDENCE = "evidence"
CITATION_KIND_OKF = "okf"


def _truncate(text: str, limit: int) -> str:
    """截断文本到指定长度。"""
    if len(text) <= limit:
        return text
    return text[:limit].rsplit("。", 1)[0] + "…" if "。" in text[:limit] else text[:limit] + "…"


def _make_citation(
    label: str,
    kind: str,
    title: str,
    excerpt: str,
    source: dict[str, Any],
    summary: str = "",
) -> dict[str, Any]:
    """创建一个引用字典。"""
    return {
        "label": label,
        "kind": kind,
        "title": title,
        "excerpt": _truncate(excerpt, CITATION_EXCERPT_CHAR_LIMIT),
        "summary": _truncate(summary, CITATION_SUMMARY_CHAR_LIMIT),
        "source": source,
    }


def knowledge_citations_from_results(
    results: dict[str, Any] | list[dict[str, Any]],
    limit: int = 4,
) -> list[dict[str, Any]]:
    """从检索结果生成引用列表。

    Args:
        results: 检索结果，可以是：
            - dict: {"selected_concepts": [...], "evidence_pack": [...]}
            - list: 证据列表（旧格式兼容）
        limit: 最大引用数量。

    Returns:
        引用列表。
    """
    citations: list[dict[str, Any]] = []

    # 兼容 dict 和 list 输入
    if isinstance(results, dict):
        concepts = results.get("selected_concepts", [])
        evidence = results.get("evidence_pack", [])
    else:
        concepts = []
        evidence = results if isinstance(results, list) else []

    # 从概念生成引用
    for i, concept in enumerate(concepts[:limit]):
        if isinstance(concept, dict):
            concept_id = concept.get("concept_id", "")
            title = concept.get("title", "")
            content = concept.get("content_md", "") or concept.get("description", "")
            doc_id = concept.get("document_id", "")
            source_refs = concept.get("source_refs", [])

            section_id = ""
            if source_refs:
                section_id = source_refs[0].get("section", "")

            citations.append(
                _make_citation(
                    label=f"[{len(citations) + 1}]",
                    kind=CITATION_KIND_CONCEPT,
                    title=title,
                    excerpt=_truncate(content, CONCEPT_EXCERPT_CHAR_LIMIT),
                    source={"doc_id": doc_id, "section_id": section_id, "concept_id": concept_id},
                    summary=concept.get("description", ""),
                )
            )

    # 从证据补充引用
    remaining = limit - len(citations)
    if remaining > 0 and evidence:
        for i, ev in enumerate(evidence[:remaining]):
            if isinstance(ev, dict):
                doc_id = ev.get("document_id", "")
                title = ev.get("document_title", "")
                content = ev.get("chunk_content", "")
                chunk_index = ev.get("metadata", {}).get("chunk_index", i)

                citations.append(
                    _make_citation(
                        label=f"[{len(citations) + 1}]",
                        kind=CITATION_KIND_EVIDENCE,
                        title=title,
                        excerpt=content,
                        source={"doc_id": doc_id, "section_id": f"chunk-{chunk_index}"},
                    )
                )

    return citations


def compact_knowledge_citation_labels(
    content: str,
    citations: list[dict[str, Any]],
) -> tuple[str, list[dict[str, Any]]]:
    """压缩引用标签。

    按回复中 [N] 首次出现顺序重新编号，移除未引用的来源，保持编号连续。

    Args:
        content: 包含 [N] 引用标记的回复文本。
        citations: 引用列表。

    Returns:
        (压缩后文本, 压缩后引用列表)
    """
    # 找出内容中所有 [N] 引用
    pattern = re.compile(r"\[(\d+)\]")
    matches = pattern.findall(content)

    if not matches:
        return content, []

    # 按首次出现顺序去重
    seen_labels: list[str] = []
    seen_set: set[str] = set()
    for m in matches:
        label = f"[{m}]"
        if label not in seen_set:
            seen_set.add(label)
            seen_labels.append(label)

    # 建立旧标签 -> 新标签映射
    label_map: dict[str, str] = {}
    new_citations: list[dict[str, Any]] = []
    for new_idx, old_label in enumerate(seen_labels, 1):
        new_label = f"[{new_idx}]"
        label_map[old_label] = new_label

        # 找到对应的引用
        old_idx = int(old_label.strip("[]"))
        if 0 < old_idx <= len(citations):
            citation = citations[old_idx - 1].copy()
            citation["label"] = new_label
            new_citations.append(citation)

    # 替换内容中的标签
    new_content = content
    for old_label, new_label in label_map.items():
        new_content = new_content.replace(old_label, new_label)

    return new_content, new_citations
