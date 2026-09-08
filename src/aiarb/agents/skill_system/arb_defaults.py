"""Built-in skills shipped with AIArb.

Skills listed here are *always* materialised into the default workspace
during ``aiarb init`` and enabled, so a fresh install has them working
out of the box — the user never has to import them manually from the
skill pool UI.

Adding a new skill: drop ``<name>-zh/`` and ``<name>-en/``
under ``src/aiarb/agents/skills/`` and add the canonical name here.
"""

from __future__ import annotations

# Canonical skill names (no language suffix). The skill system resolves the
# language variant from the user's builtin language preference.

# --- Core arbitration skills (zh + en variants) ---
ARB_BUILTIN_SKILLS: tuple[str, ...] = (
    "arb_award_review",
    "arb_case_analysis",
    "arb_document_draft",
    "arb_kb_curate",
    "arb_ldir",
    "kb_arbitration",
    "legal_ai_disclosure",
)

# --- Legal practice skills (zh-only variants) ---
LEGALWORK_BUILTIN_SKILLS: tuple[str, ...] = (
    "administrative_value_judgment",
    "analogical_reasoning",
    "argument_chain_construction",
    "argument_strength_evaluation",
    "billing_and_litigation_budget",
    "case_lifecycle_planning",
    "case_management",
    "case_notebook",
    "case_retrieval",
    "chinese-legal-citation",
    "chinese_law_verifier",
    "client_communication",
    "code2patent",
    "compliance_review",
    "conflict_resolution",
    "contract_risk_review",
    "counterfactual_reasoning",
    "court-sms",
    "creator-rights-assistant",
    "data-compliance-ai-rd",
    "deductive_reasoning",
    "deep-research",
    "dispute_and_performance_risk",
    "dispute_issue_identification",
    "document_drafting",
    "due_diligence",
    "evidence-catalog",
    "evidence_argument_chain",
    "evidence_evaluation",
    "fact_extraction",
    "find-skills",
    "formal_legal_consequence",
    "inductive_reasoning",
    "internal_compliance_risk_identification",
    "judgment_document_generation",
    "judicial_value_judgment",
    "lawcase-search",
    "legal-academic-writing",
    "legal-assessment-report-skill",
    "legal-case-analysis",
    "legal-case-analysis-template",
    "legal-memo-generator",
    "legal-paper-anti-ai-traces",
    "legal-qa-extractor",
    "legal-source-verifier",
    "legal-thesis-ideation",
    "legal-thesis-writing",
    "legal-visualization",
    "legal_abductive_reasoning",
    "legal_article_retrieval",
    "legal_concept_comprehension",
    "legal_document_formatting",
    "legal_document_summarization",
    "legal_element_extraction",
    "legal_interpretation_argument",
    "legal_judgment_prediction",
    "legal_norm_validity_check",
    "legal_professional_growth",
    "legal_professional_philosophy",
    "legal_research",
    "legal_risk_assessment",
    "legal_terminology",
    "legal_time_management",
    "litigation-prep",
    "meeting_minutes",
    "multi_document_summarization",
    "new_legislation_analysis",
    "normative_meaning_argumentation",
    "ocr_extraction",
    "opc-legal-counsel",
    "open-kimi-ppt",
    "other_legal_retrieval",
    "patent-analysis",
    "patent-download",
    "presidio-data-compliance",
    "redaction",
    "skill-creator",
    "strategic_risk_prioritization",
    "structured_element_extraction",
    "systematic_interpretation",
    "team_knowledge_sharing",
    "teleological_interpretation",
    "timeline_generation",
    "trademark-assistant",
    "trial_scheduling_and_deadline_monitoring",
    "watch",
    "web-access",
    "web-content-fetcher",
    "wps-case-file-organizer",
    "yuandian-law-search",
    "zheng-ju-cai-liao-zheng-li",
)

# Additional arbitration-specific skills (zh-only)
ARB_EXTRA_BUILTIN_SKILLS: tuple[str, ...] = (
    "arb-award-search",
    "arb-gutachten-case",
    "arb-litigation-viz",
    "arb-notice-handler",
    "defendant_perspective",
    "plaintiff_perspective",
)

# Combined list of all builtin skills.
ALL_BUILTIN_SKILLS: tuple[str, ...] = (
    *ARB_BUILTIN_SKILLS,
    *LEGALWORK_BUILTIN_SKILLS,
    *ARB_EXTRA_BUILTIN_SKILLS,
)

# --- Skills broadcast to builtin agent templates ---
# These skills are auto-installed and enabled on the corresponding builtin
# agent templates so they are available out of the box.

# Arbitrator: neutral adjudicator needs redaction, case analysis, evidence evaluation, LDIR
ARBITRATOR_BROADCAST_SKILLS: tuple[str, ...] = (
    "redaction",
    "arb_ldir",
    "legal-case-analysis",
    "evidence_evaluation",
)

# Claimant: the applicant needs document drafting, evidence catalog, contract review, LDIR
CLAIMANT_BROADCAST_SKILLS: tuple[str, ...] = (
    "document_drafting",
    "evidence-catalog",
    "contract_risk_review",
    "arb_ldir",
)

# Respondent: the respondent needs document drafting, evidence evaluation, compliance, LDIR
RESPONDENT_BROADCAST_SKILLS: tuple[str, ...] = (
    "document_drafting",
    "evidence_evaluation",
    "compliance_review",
    "arb_ldir",
)

# Secretary: the secretary needs meeting minutes, timeline, scheduling
SECRETARY_BROADCAST_SKILLS: tuple[str, ...] = (
    "meeting_minutes",
    "timeline_generation",
    "trial_scheduling_and_deadline_monitoring",
)

# Default agent template: redaction + LDIR are universally useful
DEFAULT_BROADCAST_SKILLS: tuple[str, ...] = (
    "redaction",
    "arb_ldir",
)

__all__ = [
    "ARB_BUILTIN_SKILLS",
    "LEGALWORK_BUILTIN_SKILLS",
    "ARB_EXTRA_BUILTIN_SKILLS",
    "ALL_BUILTIN_SKILLS",
    "ARBITRATOR_BROADCAST_SKILLS",
    "CLAIMANT_BROADCAST_SKILLS",
    "RESPONDENT_BROADCAST_SKILLS",
    "SECRETARY_BROADCAST_SKILLS",
    "DEFAULT_BROADCAST_SKILLS",
]
