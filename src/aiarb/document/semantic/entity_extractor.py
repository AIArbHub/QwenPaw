# -*- coding: utf-8 -*-
"""Legal Entity Extractor — identify legal semantic entities in text.

Extracts:
- party: 当事人 (申请人/被申请人/原告/被告/甲方/乙方)
- agent: 代理人/律师
- arbitrator: 仲裁员/仲裁机构
- case_number: 案号/仲裁号
- amount: 金额/数额
- date: 日期/时间
- legal_citation: 法条引用

All extraction functions are pure — no I/O, no side effects.
Uses regex + dictionary matching by default, with optional LLM enhancement.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Optional


@dataclass
class LegalEntity:
    """A legal semantic entity extracted from text.

    Attributes:
        type: Entity type (party / agent / arbitrator / case_number / amount / date / legal_citation).
        text: The matched text.
        normalized: Normalized form (e.g. full company name).
        start: Character offset in source text.
        end: Character offset (exclusive).
        confidence: Extraction confidence (0.0–1.0).
        position: Position info (page_number, bbox if from LDIR).
        extra: Type-specific extra metadata.
    """
    type: str = "party"
    text: str = ""
    normalized: str = ""
    start: int = 0
    end: int = 0
    confidence: float = 0.8
    position: dict[str, Any] = field(default_factory=dict)
    extra: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Serialize to a JSON-compatible dict."""
        return {
            "type": self.type,
            "text": self.text,
            "normalized": self.normalized,
            "start": self.start,
            "end": self.end,
            "confidence": self.confidence,
            "position": self.position,
            "extra": self.extra,
        }


# -- Regex patterns for entity extraction ----------------------------------

# Party patterns: 申请人/被申请人 with optional name
_PARTY_PATTERN = re.compile(
    r"(申请人(?!被)[（(]?[^）)]*[)）]?)"  # 申请人(可能带括号注释)
    r"|(被申请人[（(]?[^）)]*[)）]?)"
    r"|(反请求申请人[（(]?[^）)]*[)）]?)"
    r"|(反请求被申请人[（(]?[^）)]*[)）]?)"
)

# Role-based party patterns (合同角色)
_ROLE_PARTY_PATTERN = re.compile(
    r"(甲方|乙方|丙方|丁方|戊方|己方|庚方|出租人|承租人|"
    r"出卖人|买受人|转让方|受让方|委托人|受托人|"
    r"债权人|债务人|保证人|被保证人|抵押权人|抵押人)"
)

# Court party patterns (for cross-reference with arbitration docs)
_COURT_PARTY_PATTERN = re.compile(
    r"(原告|被告|上诉人|被上诉人|第三人|申请执行人|被执行人)"
)

# Agent/lawyer patterns
_AGENT_PATTERN = re.compile(
    r"(?:委托|指派|聘请)?\s*(?:代理人|代理律师|律师|法律顾问|诉讼代理人)"
    r"[：:]\s*([^，。；\n]{2,30})"
)
_LAWYER_FIRM_PATTERN = re.compile(
    r"([^\s，。；\n]{4,30}(?:律师事务所|法律事务所|律师事务所))"
)

# Arbitrator patterns
_ARBITRATOR_PATTERN = re.compile(
    r"(?:首席仲裁员|独任仲裁员|仲裁员)[：:]\s*([\u4e00-\u9fff]{2,4})"
)
_ARBITRAL_INSTITUTION_PATTERN = re.compile(
    r"([^\s，。；\n]{4,30}(?:仲裁委员会|仲裁中心|国际仲裁中心))"
)

# Case number patterns
_CASE_NUMBER_PATTERN = re.compile(
    r"[\(（]\d{4}[\)）][^\s，。]{1,8}\d{1,6}号"  # (2024)京仲案字第1234号
    r"|\d{4}年[^\s，。]{1,8}\d{1,6}号"  # 2024年京仲案字第1234号
    r"|[A-Z]{4,6}\d{4}\d{4,6}号"  # CIETAC20240001号
)

# Amount patterns
_AMOUNT_PATTERN = re.compile(
    r"(?:人民币|RMB|￥|¥)?\s*"
    r"(\d{1,3}(?:[,，]\d{3})*(?:\.\d{1,2})?)\s*"
    r"(元|万元|亿元|千元|百元)"
)

# Date patterns
_DATE_PATTERN = re.compile(
    r"(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日"
    r"|(\d{4})\s*年\s*(\d{1,2})\s*月"
    r"|(\d{4})\s*年"
)

# Legal citation patterns
_LEGAL_CITATION_PATTERN = re.compile(
    r"[《〈<]\s*([^》〉>]{2,30})\s*[》〉>]\s*"
    r"(第[一二三四五六七八九十百千零〇○\d]+[条章编节款项])"
    r"(?:第[一二三四五六七八九十百千零〇○\d]+[条款项])*"
)


class LegalEntityExtractor:
    """Extract legal semantic entities from text.

    Default mode uses regex + dictionary matching.
    Optional LLM enhancement can be enabled by passing a model_router.
    """

    def __init__(self, model_router: Optional[Any] = None):
        """Initialize the extractor.

        Args:
            model_router: Optional model router for LLM enhancement.
                         If None, only regex/dictionary extraction is used.
        """
        self.model_router = model_router

    def extract(
        self,
        text: str,
        chunk_id: str = "",
        use_llm: bool = False,
        page_number: Optional[int] = None,
    ) -> list[LegalEntity]:
        """Extract all legal entities from text.

        Args:
            text: Source text.
            chunk_id: Optional chunk identifier for provenance.
            use_llm: Whether to use LLM enhancement (requires model_router).
            page_number: Optional page number for provenance.

        Returns:
            List of LegalEntity objects.

        Note: Regex extraction is always performed first. LLM enhancement,
            if enabled, is additive (it can add entities that regex missed).
        """
        if not text or not text.strip():
            return []

        entities: list[LegalEntity] = []

        # Regex extraction
        entities.extend(self._extract_parties(text, page_number))
        entities.extend(self._extract_agents(text, page_number))
        entities.extend(self._extract_arbitrators(text, page_number))
        entities.extend(self._extract_case_numbers(text, page_number))
        entities.extend(self._extract_amounts(text, page_number))
        entities.extend(self._extract_dates(text, page_number))
        entities.extend(self._extract_legal_citations(text, page_number))

        # LLM enhancement (optional)
        if use_llm and self.model_router:
            llm_entities = self._extract_with_llm(text, chunk_id)
            entities.extend(llm_entities)

        # Deduplicate by (start, end) overlap
        entities = self._deduplicate(entities)

        # Sort by position
        entities.sort(key=lambda e: (e.start, -e.confidence))

        return entities

    def extract_from_ldir(self, ldir_doc: dict[str, Any]) -> list[LegalEntity]:
        """Extract entities from a full LDIR document.

        Processes each page/block and combines results with position info.
        """
        all_entities: list[LegalEntity] = []

        for page in ldir_doc.get("pages", []):
            page_number = page.get("page_number", 1)
            for block in page.get("blocks", []):
                text = block.get("text", "")
                bbox = block.get("bbox")
                if not text:
                    continue

                entities = self.extract(text, page_number=page_number)
                for e in entities:
                    e.position = {"page_number": page_number}
                    if bbox:
                        e.position["bbox"] = bbox
                all_entities.extend(entities)

        return all_entities

    def _extract_parties(
        self, text: str, page_number: Optional[int] = None,
    ) -> list[LegalEntity]:
        """Extract party entities (申请人/被申请人/甲方/乙方/原告/被告)."""
        entities: list[LegalEntity] = []

        # Arbitration parties
        for match in _PARTY_PATTERN.finditer(text):
            matched_text = match.group(0)
            if not matched_text:
                continue
            entities.append(LegalEntity(
                type="party",
                text=matched_text,
                normalized=matched_text,
                start=match.start(),
                end=match.end(),
                confidence=0.85,
                position={"page_number": page_number} if page_number else {},
                extra={"sub_type": "arbitration_party"},
            ))

        # Role-based parties
        for match in _ROLE_PARTY_PATTERN.finditer(text):
            entities.append(LegalEntity(
                type="party",
                text=match.group(0),
                normalized=match.group(0),
                start=match.start(),
                end=match.end(),
                confidence=0.80,
                position={"page_number": page_number} if page_number else {},
                extra={"sub_type": "contract_role"},
            ))

        # Court parties
        for match in _COURT_PARTY_PATTERN.finditer(text):
            entities.append(LegalEntity(
                type="party",
                text=match.group(0),
                normalized=match.group(0),
                start=match.start(),
                end=match.end(),
                confidence=0.80,
                position={"page_number": page_number} if page_number else {},
                extra={"sub_type": "court_party"},
            ))

        return entities

    def _extract_agents(
        self, text: str, page_number: Optional[int] = None,
    ) -> list[LegalEntity]:
        """Extract agent/lawyer entities."""
        entities: list[LegalEntity] = []

        for match in _AGENT_PATTERN.finditer(text):
            entities.append(LegalEntity(
                type="agent",
                text=match.group(1).strip(),
                normalized=match.group(1).strip(),
                start=match.start(1),
                end=match.end(1),
                confidence=0.80,
                position={"page_number": page_number} if page_number else {},
            ))

        for match in _LAWYER_FIRM_PATTERN.finditer(text):
            entities.append(LegalEntity(
                type="agent",
                text=match.group(1),
                normalized=match.group(1),
                start=match.start(1),
                end=match.end(1),
                confidence=0.75,
                position={"page_number": page_number} if page_number else {},
                extra={"sub_type": "law_firm"},
            ))

        return entities

    def _extract_arbitrators(
        self, text: str, page_number: Optional[int] = None,
    ) -> list[LegalEntity]:
        """Extract arbitrator and arbitral institution entities."""
        entities: list[LegalEntity] = []

        for match in _ARBITRATOR_PATTERN.finditer(text):
            entities.append(LegalEntity(
                type="arbitrator",
                text=match.group(1),
                normalized=match.group(1),
                start=match.start(1),
                end=match.end(1),
                confidence=0.85,
                position={"page_number": page_number} if page_number else {},
            ))

        for match in _ARBITRAL_INSTITUTION_PATTERN.finditer(text):
            entities.append(LegalEntity(
                type="arbitrator",
                text=match.group(1),
                normalized=match.group(1),
                start=match.start(1),
                end=match.end(1),
                confidence=0.85,
                position={"page_number": page_number} if page_number else {},
                extra={"sub_type": "arbitral_institution"},
            ))

        return entities

    def _extract_case_numbers(
        self, text: str, page_number: Optional[int] = None,
    ) -> list[LegalEntity]:
        """Extract case number entities."""
        entities: list[LegalEntity] = []

        for match in _CASE_NUMBER_PATTERN.finditer(text):
            entities.append(LegalEntity(
                type="case_number",
                text=match.group(0),
                normalized=match.group(0),
                start=match.start(),
                end=match.end(),
                confidence=0.90,
                position={"page_number": page_number} if page_number else {},
            ))

        return entities

    def _extract_amounts(
        self, text: str, page_number: Optional[int] = None,
    ) -> list[LegalEntity]:
        """Extract monetary amount entities."""
        entities: list[LegalEntity] = []

        for match in _AMOUNT_PATTERN.finditer(text):
            num_str = match.group(1).replace("，", "").replace(",", "")
            unit = match.group(2)
            try:
                value = float(num_str)
                # Normalize to yuan
                if unit == "万元":
                    value *= 10000
                elif unit == "亿元":
                    value *= 100000000
                elif unit == "千元":
                    value *= 1000
                elif unit == "百元":
                    value *= 100
            except ValueError:
                value = 0.0

            entities.append(LegalEntity(
                type="amount",
                text=match.group(0),
                normalized=f"{value:.2f}元",
                start=match.start(),
                end=match.end(),
                confidence=0.85,
                position={"page_number": page_number} if page_number else {},
                extra={"value": value, "unit": unit},
            ))

        return entities

    def _extract_dates(
        self, text: str, page_number: Optional[int] = None,
    ) -> list[LegalEntity]:
        """Extract date entities."""
        entities: list[LegalEntity] = []

        for match in _DATE_PATTERN.finditer(text):
            groups = [g for g in match.groups() if g]
            if not groups:
                continue

            year = groups[0] if len(groups) >= 1 else ""
            month = groups[1] if len(groups) >= 2 else ""
            day = groups[2] if len(groups) >= 3 else ""

            normalized = year
            if month:
                normalized += f"-{int(month):02d}"
            if day:
                normalized += f"-{int(day):02d}"

            entities.append(LegalEntity(
                type="date",
                text=match.group(0),
                normalized=normalized,
                start=match.start(),
                end=match.end(),
                confidence=0.90,
                position={"page_number": page_number} if page_number else {},
                extra={
                    "year": int(year) if year else None,
                    "month": int(month) if month else None,
                    "day": int(day) if day else None,
                },
            ))

        return entities

    def _extract_legal_citations(
        self, text: str, page_number: Optional[int] = None,
    ) -> list[LegalEntity]:
        """Extract legal citation entities (《法律名》第X条)."""
        entities: list[LegalEntity] = []

        for match in _LEGAL_CITATION_PATTERN.finditer(text):
            entities.append(LegalEntity(
                type="legal_citation",
                text=match.group(0),
                normalized=f"《{match.group(1)}》{match.group(2)}",
                start=match.start(),
                end=match.end(),
                confidence=0.90,
                position={"page_number": page_number} if page_number else {},
                extra={
                    "law_name": match.group(1),
                    "clause_ref": match.group(2),
                },
            ))

        return entities

    def _extract_with_llm(self, text: str, chunk_id: str) -> list[LegalEntity]:
        """Extract entities using LLM enhancement.

        This is a placeholder for LLM-based extraction.
        When model_router is available, it can be used to identify entities
        that regex/dictionary matching missed.
        """
        # TODO: Implement LLM-based extraction when model_router is available
        return []

    def _deduplicate(self, entities: list[LegalEntity]) -> list[LegalEntity]:
        """Remove overlapping entities, keeping the higher-confidence ones."""
        if not entities:
            return []

        sorted_entities = sorted(entities, key=lambda e: (e.start, -e.confidence))
        result: list[LegalEntity] = []

        for e in sorted_entities:
            overlap = False
            for kept in result:
                if e.start >= kept.start and e.end <= kept.end:
                    overlap = True
                    break
                if not (e.end <= kept.start or e.start >= kept.end):
                    if e.confidence > kept.confidence:
                        result.remove(kept)
                        result.append(e)
                    overlap = True
                    break
            if not overlap:
                result.append(e)

        return sorted(result, key=lambda e: e.start)


__all__ = [
    "LegalEntity",
    "LegalEntityExtractor",
]
