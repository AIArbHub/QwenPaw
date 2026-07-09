# -*- coding: utf-8 -*-
from __future__ import annotations

from qwenpaw.knowledge.models import FilterRule, KnowledgeDoc


def match_hierarchical(field_value: str, filter_value: str) -> bool:
    if field_value == filter_value:
        return True
    return field_value.startswith(filter_value + "/")


def match_rules(doc: KnowledgeDoc, rules: list[FilterRule]) -> bool:
    for rule in rules:
        val = getattr(doc, rule.field, None)
        if val is None:
            return False
        if rule.op == "eq":
            if val != rule.value:
                return False
        elif rule.op == "prefix":
            if not match_hierarchical(str(val), str(rule.value)):
                return False
        elif rule.op == "contains":
            if isinstance(val, list):
                if rule.value not in val:
                    return False
            elif rule.value not in str(val):
                return False
    return True


def filter_docs(
    docs: list[KnowledgeDoc],
    include_rules: list[FilterRule],
    exclude_rules: list[FilterRule] | None = None,
) -> list[KnowledgeDoc]:
    result = []
    for doc in docs:
        if not match_rules(doc, include_rules):
            continue
        if exclude_rules and match_rules(doc, exclude_rules):
            continue
        result.append(doc)
    return result