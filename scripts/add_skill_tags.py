#!/usr/bin/env python3
"""Add category tags to all builtin skill SKILL.md frontmatter files.

This script reads each skill directory under src/aiarb/agents/skills/,
determines the appropriate category tag(s) based on a mapping, and inserts
a ``tags`` field into the YAML frontmatter if it is not already present.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

# ── Category mapping ──────────────────────────────────────────────────────

SKILL_CATEGORY_MAP: dict[str, list[str]] = {
    # 仲裁核心
    "arb_award_review": ["仲裁核心"],
    "arb_case_analysis": ["仲裁核心"],
    "arb_document_draft": ["仲裁核心", "文书起草"],
    "arb_kb_curate": ["仲裁核心", "知识管理"],
    "arb_ldir": ["仲裁核心"],
    "kb_arbitration": ["仲裁核心", "知识管理"],
    "legal_ai_disclosure": ["仲裁核心", "合规与风险"],
    "arb-award-search": ["仲裁核心", "法律检索"],
    "arb-gutachten-case": ["仲裁核心", "案件分析"],
    "arb-litigation-viz": ["仲裁核心"],
    "arb-notice-handler": ["仲裁核心"],
    "plaintiff_perspective": ["仲裁核心", "案件分析"],
    "defendant_perspective": ["仲裁核心", "案件分析"],

    # 案件分析
    "case_analysis_framework": ["案件分析"],
    "case_lifecycle_planning": ["案件管理"],
    "case_management": ["案件管理"],
    "case_notebook": ["案件管理"],
    "case_retrieval": ["法律检索"],
    "dispute_and_performance_risk": ["案件分析", "合规与风险"],
    "dispute_issue_identification": ["案件分析"],
    "fact_extraction": ["案件分析", "证据与事实"],
    "formal_legal_consequence": ["案件分析"],
    "legal-case-analysis": ["案件分析"],
    "legal-case-analysis-template": ["案件分析"],
    "legal-assessment-report-skill": ["案件分析"],
    "legal_judgment_prediction": ["案件分析"],
    "structured_element_extraction": ["案件分析", "证据与事实"],
    "legal_element_extraction": ["案件分析", "证据与事实"],
    "zheng-ju-cai-liao-zheng-li": ["证据与事实"],

    # 文书起草
    "document_drafting": ["文书起草"],
    "judgment_document_generation": ["文书起草"],
    "legal-academic-writing": ["文书起草"],
    "legal-memo-generator": ["文书起草"],
    "legal-thesis-writing": ["文书起草"],
    "legal-thesis-ideation": ["文书起草"],
    "legal_document_formatting": ["文书起草"],
    "legal-visualization": ["文书起草"],
    "legal-paper-anti-ai-traces": ["文书起草"],
    "open-kimi-ppt": ["文书起草"],

    # 证据与事实
    "evidence-catalog": ["证据与事实"],
    "evidence_argument_chain": ["证据与事实"],
    "evidence_evaluation": ["证据与事实"],
    "argument_chain_construction": ["证据与事实", "法律推理"],
    "argument_strength_evaluation": ["证据与事实", "法律推理"],
    "timeline_generation": ["证据与事实", "案件管理"],

    # 法律检索
    "legal_research": ["法律检索"],
    "lawcase-search": ["法律检索"],
    "chinese-legal-citation": ["法律检索"],
    "chinese_law_verifier": ["法律检索"],
    "legal-source-verifier": ["法律检索"],
    "legal_article_retrieval": ["法律检索"],
    "other_legal_retrieval": ["法律检索"],
    "yuandian-law-search": ["法律检索"],
    "legal-qa-extractor": ["法律检索"],
    "legal_qa_consultant": ["法律检索"],
    "deep-research": ["法律检索"],
    "new_legislation_analysis": ["法律检索"],
    "legal_concept_comprehension": ["法律检索"],
    "legal_terminology": ["法律检索"],

    # 法律推理
    "analogical_reasoning": ["法律推理"],
    "counterfactual_reasoning": ["法律推理"],
    "deductive_reasoning": ["法律推理"],
    "inductive_reasoning": ["法律推理"],
    "legal_abductive_reasoning": ["法律推理"],
    "normative_meaning_argumentation": ["法律推理"],
    "systematic_interpretation": ["法律推理"],
    "teleological_interpretation": ["法律推理"],
    "legal_interpretation_argument": ["法律推理"],
    "legal_norm_validity_check": ["法律推理"],
    "administrative_value_judgment": ["法律推理"],
    "judicial_value_judgment": ["法律推理"],

    # 合规与风险
    "compliance_review": ["合规与风险"],
    "contract_risk_review": ["合规与风险"],
    "internal_compliance_risk_identification": ["合规与风险"],
    "legal_risk_assessment": ["合规与风险"],
    "strategic_risk_prioritization": ["合规与风险"],
    "conflict_resolution": ["合规与风险"],
    "due_diligence": ["合规与风险"],
    "presidio-data-compliance": ["合规与风险", "数据合规"],
    "data-compliance-ai-rd": ["数据合规"],
    "redaction": ["数据合规"],
    "court-sms": ["案件管理"],
    "creator-rights-assistant": ["合规与风险"],

    # 知识产权
    "code2patent": ["知识产权"],
    "patent-analysis": ["知识产权"],
    "patent-download": ["知识产权"],
    "trademark-assistant": ["知识产权"],

    # 文档处理
    "ocr_extraction": ["文档处理"],
    "wps-case-file-organizer": ["文档处理", "案件管理"],
    "legal_document_summarization": ["文档处理"],
    "multi_document_summarization": ["文档处理"],

    # 案件管理
    "billing_and_litigation_budget": ["案件管理"],
    "trial_scheduling_and_deadline_monitoring": ["案件管理"],
    "legal_time_management": ["案件管理"],
    "meeting_minutes": ["案件管理"],
    "litigation-prep": ["案件管理"],

    # 沟通协作
    "client_communication": ["沟通协作"],
    "team_knowledge_sharing": ["沟通协作", "知识管理"],
    "legal_professional_growth": ["沟通协作"],
    "legal_professional_philosophy": ["沟通协作"],

    # 知识管理
    "find-skills": ["知识管理"],
    "skill-creator": ["知识管理"],
    "legal_professional_growth": ["沟通协作", "知识管理"],

    # 系统工具
    "guidance": ["系统工具"],
    "QA_source_index": ["系统工具"],
    "make-skill": ["系统工具", "知识管理"],
    "make_plan": ["系统工具"],
    "browser": ["系统工具"],
    "file_reader": ["系统工具"],
    "pdf": ["系统工具", "文档处理"],
    "docx": ["系统工具", "文档处理"],
    "xlsx": ["系统工具", "文档处理"],
    "pptx": ["系统工具", "文档处理"],
    "web-access": ["系统工具"],
    "web-content-fetcher": ["系统工具"],
    "watch": ["系统工具"],
    "cron": ["系统工具"],
    "channel_message": ["系统工具"],
    "chat_with_agent": ["系统工具"],
    "dingtalk_channel": ["系统工具"],
    "mailbox": ["系统工具"],
    "multi_agent_collaboration": ["系统工具"],
    "yd-enterprise-info": ["系统工具", "合规与风险"],
    "opc-legal-counsel": ["合规与风险"],
}

# ── Frontmatter patching ──────────────────────────────────────────────────

_FRONTMATTER_RE = re.compile(r"^---\n(.*?\n)---\n", re.DOTALL)


def _insert_tags_into_frontmatter(
    content: str,
    tags: list[str],
) -> str:
    """Insert a ``tags`` field into the YAML frontmatter if absent."""
    match = _FRONTMATTER_RE.match(content)
    if not match:
        return content

    frontmatter = match.group(1)
    # Already has tags?
    if re.search(r"^tags\s*:", frontmatter, re.MULTILINE):
        return content

    tags_yaml = f"tags: {tags}\n"
    # Insert before the closing --- by appending to the frontmatter block
    new_frontmatter = frontmatter + tags_yaml
    return content[: match.start(1)] + new_frontmatter + content[match.end(1):]


def main() -> int:
    skills_dir = Path(__file__).resolve().parent.parent / "src" / "aiarb" / "agents" / "skills"
    if not skills_dir.is_dir():
        print(f"Skills directory not found: {skills_dir}", file=sys.stderr)
        return 1

    patched = 0
    skipped = 0

    for skill_dir in sorted(skills_dir.iterdir()):
        if not skill_dir.is_dir():
            continue
        skill_md = skill_dir / "SKILL.md"
        if not skill_md.exists():
            continue

        # Extract canonical name (strip -zh/-en suffix)
        name = skill_dir.name
        match = re.match(r"^(.+)-(en|zh)$", name)
        canonical = match.group(1) if match else name

        tags = SKILL_CATEGORY_MAP.get(canonical)
        if not tags:
            print(f"  [SKIP] No category mapping for: {canonical}")
            skipped += 1
            continue

        content = skill_md.read_text(encoding="utf-8")
        new_content = _insert_tags_into_frontmatter(content, tags)
        if new_content != content:
            skill_md.write_text(new_content, encoding="utf-8")
            print(f"  [PATCH] {name}: tags={tags}")
            patched += 1
        else:
            print(f"  [OK]    {name}: already has tags or no frontmatter")
            skipped += 1

    print(f"\nDone: {patched} patched, {skipped} skipped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
