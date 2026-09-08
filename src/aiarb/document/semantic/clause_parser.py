# -*- coding: utf-8 -*-
"""Clause Parser — legal article/clause/item numbering parser.

Parses Chinese legal text to extract and build a tree of:
- Article references: 第X条 (第十六条 / 第16条)
- Clause references: 第X款 (第一款 / 第2款)
- Item references: 第X项 (第一项 / 第3项)
- Chapter/Section references: 第X章 / 第X节 / 第X编

Supports:
- Parsing inline references (e.g. "依据《仲裁法》第十六条第二款第一项")
- Building a clause tree from structured legal text
- Extracting condition sentences (条件句) and applicable situations (适用情形)

All functions are pure — no I/O, no side effects.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Optional


# -- Chinese number conversion ---------------------------------------------

_CN_NUM_MAP = {
    "零": 0, "〇": 0, "○": 0,
    "一": 1, "二": 2, "三": 3, "四": 4, "五": 5,
    "六": 6, "七": 7, "八": 8, "九": 9, "十": 10,
    "百": 100, "千": 1000,
}


def cn_num_to_int(text: str) -> int:
    """Convert a Chinese numeral string to an integer.

    Examples: "十六" -> 16, "一百二十三" -> 123, "三" -> 3
    Pure function.
    """
    if not text:
        return 0

    # Try Arabic numeral first
    if text.isdigit():
        return int(text)

    result = 0
    current = 0
    for ch in text:
        if ch not in _CN_NUM_MAP:
            return -1
        val = _CN_NUM_MAP[ch]
        if val >= 10:  # 十, 百, 千 are multipliers
            if current == 0:
                current = 1
            result += current * val
            current = 0
        else:
            current = val

    result += current
    return result


def int_to_cn_num(n: int) -> str:
    """Convert an integer to a Chinese numeral string.

    Examples: 16 -> "十六", 123 -> "一百二十三", 3 -> "三"
    Pure function.
    """
    if n <= 0:
        return "零"
    if n <= 9:
        return "一二三四五六七八九"[n - 1]

    digits = "零一二三四五六七八九"
    parts = []
    if n >= 1000:
        parts.append(f"{digits[n // 1000]}千")
        n %= 1000
    if n >= 100:
        if n >= 100:
            parts.append(f"{digits[n // 100]}百")
        n %= 100
    if n >= 10:
        if n // 10 > 1 or parts:  # Omit leading 一 for 十
            parts.append(f"{digits[n // 10]}十")
        else:
            parts.append("十")
        n %= 10
    if n > 0:
        parts.append(digits[n])
    return "".join(parts)


# -- Clause reference parsing ----------------------------------------------

@dataclass
class ClauseReference:
    """A parsed legal clause reference.

    Attributes:
        law_name: Name of the law (e.g. "仲裁法", empty if not specified).
        article_num: Article number as int (e.g. 16 for 第十六条).
        article_cn: Article number in Chinese (e.g. "十六").
        clause_num: Clause (款) number as int, 0 if not specified.
        item_num: Item (项) number as int, 0 if not specified.
        chapter_num: Chapter (章) number as int, 0 if not specified.
        section_num: Section (节) number as int, 0 if not specified.
        raw_text: The original matched text.
    """
    law_name: str = ""
    article_num: int = 0
    article_cn: str = ""
    clause_num: int = 0
    item_num: int = 0
    chapter_num: int = 0
    section_num: int = 0
    raw_text: str = ""

    def to_string(self) -> str:
        """Render as a normalized clause reference string."""
        parts = []
        if self.law_name:
            parts.append(f"《{self.law_name}》")
        if self.chapter_num > 0:
            parts.append(f"第{int_to_cn_num(self.chapter_num)}章")
        if self.section_num > 0:
            parts.append(f"第{int_to_cn_num(self.section_num)}节")
        if self.article_num > 0:
            parts.append(f"第{int_to_cn_num(self.article_num)}条")
        if self.clause_num > 0:
            parts.append(f"第{int_to_cn_num(self.clause_num)}款")
        if self.item_num > 0:
            parts.append(f"第{int_to_cn_num(self.item_num)}项")
        return "".join(parts)

    def to_dict(self) -> dict[str, Any]:
        """Serialize to a JSON-compatible dict."""
        return {
            "law_name": self.law_name,
            "article_num": self.article_num,
            "article_cn": self.article_cn,
            "clause_num": self.clause_num,
            "item_num": self.item_num,
            "chapter_num": self.chapter_num,
            "section_num": self.section_num,
            "raw_text": self.raw_text,
            "normalized": self.to_string(),
        }


# Pattern for inline clause references: 《法律名》第X条/款/项
# Matches: 依据《仲裁法》第十六条第二款第一项 / 根据《民法典》第533条
_CLAUSE_REF_PATTERN = re.compile(
    r"(?:依据|根据|按照|参照|依照|参见)?\s*"
    r"[《〈<]\s*([^》〉>]{2,30})\s*[》〉>]\s*"
    r"(第[一二三四五六七八九十百千零〇○\d]+[条章编节款项])"
    r"((?:第[一二三四五六七八九十百千零〇○\d]+[条款项])*)"
)

# Pattern for standalone article numbers at start of a line (for clause tree)
_ARTICLE_START_PATTERN = re.compile(
    r"^第([一二三四五六七八九十百千零〇○\d]+)条\s*"
)

# Pattern for clause/item numbers (for clause tree sub-items)
_CLAUSE_PATTERN = re.compile(
    r"第([一二三四五六七八九十百千零〇○\d]+)款"
)
_ITEM_PATTERN = re.compile(
    r"第([一二三四五六七八九十百千零〇○\d]+)项"
)

# Pattern for chapter/section starts
_CHAPTER_PATTERN = re.compile(
    r"^第([一二三四五六七八九十百千零〇○\d]+)章\s*"
)
_SECTION_PATTERN = re.compile(
    r"^第([一二三四五六七八九十百千零〇○\d]+)节\s*"
)

# Condition sentence patterns (条件句)
_CONDITION_PATTERNS = [
    re.compile(r"(?:如果|若|当|在.{2,20}情形下|在.{2,20}时)"),
    re.compile(r"(?:有下列情形之一.{0,10}[:：])"),
    re.compile(r"(?:具备.{2,20}条件)"),
    re.compile(r"(?:符合.{2,20}规定)"),
]


@dataclass
class ClauseNode:
    """A node in a clause tree.

    Represents a hierarchical structure of a legal document:
    Chapter -> Section -> Article -> Clause -> Item

    Attributes:
        node_type: chapter / section / article / clause / item.
        number: The numeric identifier (as int).
        cn_number: The Chinese numeral form.
        title: Optional title text (for chapters/sections).
        text: Full text of this node.
        children: Sub-nodes (clauses under article, items under clause).
        page_number: Source page if known.
    """
    node_type: str = "article"
    number: int = 0
    cn_number: str = ""
    title: str = ""
    text: str = ""
    children: list[ClauseNode] = field(default_factory=list)
    page_number: Optional[int] = None

    def to_dict(self) -> dict[str, Any]:
        """Serialize to a JSON-compatible dict."""
        return {
            "node_type": self.node_type,
            "number": self.number,
            "cn_number": self.cn_number,
            "title": self.title,
            "text": self.text[:200] + "..." if len(self.text) > 200 else self.text,
            "page_number": self.page_number,
            "children": [c.to_dict() for c in self.children],
        }


class ClauseParser:
    """Legal clause parser.

    Provides two main capabilities:
    1. extract_references(): Extract all inline clause references from text.
    2. build_clause_tree(): Build a hierarchical tree from structured legal text.
    """

    def extract_references(self, text: str) -> list[ClauseReference]:
        """Extract all clause references from text.

        Finds patterns like:
        - 依据《仲裁法》第十六条第二款第一项
        - 根据《民法典》第533条
        - 按照《民事诉讼法》第一百二十四条

        Pure function — no I/O, no side effects.
        """
        if not text:
            return []

        refs: list[ClauseReference] = []

        for match in _CLAUSE_REF_PATTERN.finditer(text):
            law_name = match.group(1).strip()
            article_match = match.group(2)  # e.g. "第十六条" or "第533条"
            remaining = match.group(3) or ""  # e.g. "第二款第一项"

            article_cn = ""
            article_num = 0

            # Extract article number
            am = re.match(r"第([一二三四五六七八九十百千零〇○\d]+)条", article_match)
            if am:
                article_cn = am.group(1)
                article_num = cn_num_to_int(am.group(1))

            # Parse remaining clause/item references
            clause_num = 0
            item_num = 0

            cm = _CLAUSE_PATTERN.search(remaining)
            if cm:
                clause_num = cn_num_to_int(cm.group(1))

            im = _ITEM_PATTERN.search(remaining)
            if im:
                item_num = cn_num_to_int(im.group(1))

            refs.append(ClauseReference(
                law_name=law_name,
                article_num=article_num,
                article_cn=article_cn,
                clause_num=clause_num,
                item_num=item_num,
                raw_text=match.group(0),
            ))

        return refs

    def build_clause_tree(
        self,
        chunks: list[dict[str, Any]],
    ) -> list[ClauseNode]:
        """Build a hierarchical clause tree from semantic chunks.

        Args:
            chunks: List of chunk dicts with "text", "chunk_type", "page_number".

        Returns:
            List of top-level ClauseNode objects (chapters or articles).

        Pure function.
        """
        roots: list[ClauseNode] = []
        current_chapter: ClauseNode | None = None
        current_section: ClauseNode | None = None
        current_article: ClauseNode | None = None

        for chunk in chunks:
            text = chunk.get("text", "").strip()
            if not text:
                continue

            chunk_type = chunk.get("chunk_type", "paragraph")
            page_number = chunk.get("page_number")

            # Chapter
            cm = _CHAPTER_PATTERN.match(text)
            if cm:
                cn_num = cm.group(1)
                num = cn_num_to_int(cn_num)
                # Title is the rest of the first line
                title = text.split("\n", 1)[0].strip()
                current_chapter = ClauseNode(
                    node_type="chapter",
                    number=num,
                    cn_number=cn_num,
                    title=title,
                    text=text,
                    page_number=page_number,
                )
                roots.append(current_chapter)
                current_section = None
                current_article = None
                continue

            # Section
            sm = _SECTION_PATTERN.match(text)
            if sm:
                cn_num = sm.group(1)
                num = cn_num_to_int(cn_num)
                title = text.split("\n", 1)[0].strip()
                current_section = ClauseNode(
                    node_type="section",
                    number=num,
                    cn_number=cn_num,
                    title=title,
                    text=text,
                    page_number=page_number,
                )
                if current_chapter:
                    current_chapter.children.append(current_section)
                else:
                    roots.append(current_section)
                current_article = None
                continue

            # Article
            am = _ARTICLE_START_PATTERN.match(text)
            if am:
                cn_num = am.group(1)
                num = cn_num_to_int(cn_num)
                current_article = ClauseNode(
                    node_type="article",
                    number=num,
                    cn_number=cn_num,
                    text=text,
                    page_number=page_number,
                )
                # Attach to the deepest available container
                if current_section:
                    current_section.children.append(current_article)
                elif current_chapter:
                    current_chapter.children.append(current_article)
                else:
                    roots.append(current_article)
                continue

            # Clause/Item: attach to current article
            if current_article is not None:
                # Check if it's a sub-clause (第X款/第X项)
                clause_m = _CLAUSE_PATTERN.match(text)
                item_m = _ITEM_PATTERN.match(text)

                if clause_m:
                    cn_num = clause_m.group(1)
                    num = cn_num_to_int(cn_num)
                    clause_node = ClauseNode(
                        node_type="clause",
                        number=num,
                        cn_number=cn_num,
                        text=text,
                        page_number=page_number,
                    )
                    current_article.children.append(clause_node)
                elif item_m:
                    cn_num = item_m.group(1)
                    num = cn_num_to_int(cn_num)
                    item_node = ClauseNode(
                        node_type="item",
                        number=num,
                        cn_number=cn_num,
                        text=text,
                        page_number=page_number,
                    )
                    current_article.children.append(item_node)
                else:
                    # Regular text — append to current article's text
                    current_article.text += "\n" + text
            else:
                # No current article — might be preamble text
                if current_chapter is None and current_section is None:
                    # Top-level preamble, create a pseudo-article
                    current_article = ClauseNode(
                        node_type="article",
                        number=0,
                        cn_number="",
                        title="(前言)",
                        text=text,
                        page_number=page_number,
                    )
                    roots.append(current_article)

        return roots

    def extract_conditions(self, text: str) -> list[str]:
        """Extract condition sentences from text.

        Identifies sentences that describe applicable conditions,
        such as "如果有下列情形..." or "具备下列条件...".

        Pure function.
        """
        if not text:
            return []

        conditions: list[str] = []

        # Split into sentences
        sentences = re.split(r"[。；]", text)

        for sent in sentences:
            sent = sent.strip()
            if not sent:
                continue
            for pattern in _CONDITION_PATTERNS:
                if pattern.search(sent):
                    conditions.append(sent)
                    break

        return conditions


__all__ = [
    "ClauseReference",
    "ClauseNode",
    "ClauseParser",
    "cn_num_to_int",
    "int_to_cn_num",
]
