---
name: arb_award_review
description: "Line-by-line review of arbitral award drafts: cross-check facts against submissions and evidence, verify legal reasoning, cite sources to page/paragraph/line, embed comments into the original DOCX and deliver an actually-revised version."
metadata:
  builtin_skill_version: "1.0"
  aiarb:
    emoji: "⚖️"
    requires: {}
tags: ['仲裁核心']
---

# Arbitral Award Review

Perform a **line-by-line** review of an award draft and deliver annotated plus revised versions.

For citation and anti-hallucination rules see `CITATION.md` in the knowledge base. Always search the shared knowledge base before citing any statute or institutional rule — never rely on memory.

## Scope

- Arbitrators reviewing their own draft awards
- Tribunal secretaries checking procedure sections and formatting
- Counsel stress-testing the reasoning of an expected award

## Core principles

1. **Line by line.** No skimming. Every sentence must be checked against the record.
2. **Accuracy over speed.** Mark anything uncertain as "to be verified" rather than guessing.
3. **Precise sources.** Facts to PDF page/paragraph; hearing content to transcript line; law to article number.
4. **Cross-check.** Three correspondence pairs must be verified individually, never assumed consistent.
5. **Substantive revision.** Deliver an *actually revised* document, not just a list of suggestions.
6. **Zero tolerance for AI fabrication.** If the reviewed material is AI-drafted or cites apparently AI-generated precedents/statutes, first run the red-flag checks of the `legal_ai_disclosure` skill (§3); content not verified to source must not be relied on. Review is itself the last gate that keeps AI hallucinations out of an award.

## Procedure

### 1. Build a material index

Identify document type, case name, case number, tribunal composition. List every item on record (statement of claim, defence, evidence bundles, transcripts, post-hearing submissions) and build a **location index** (page, paragraph, line). All later citations depend on it.

### 2. Structure check

Header · Procedure · Parties' claims · Findings of fact · Tribunal's opinion · Operative part · Footer (costs, time for performance, signatures, date). Verify completeness, order, and internal consistency.

### 3. Cross-check facts and claims

1. **Claimant's assertions** ↔ claimant's submissions
2. **Respondent's assertions** ↔ respondent's submissions
3. **Tribunal's findings** ↔ both parties' claims and evidence on record

Flag every mismatch with its location. Watch for: claims raised but not addressed, findings exceeding the evidence, amounts inconsistent with the record.

### 4. Legal reasoning check

- Procedural matters cite the **Arbitration Law and institutional rules**, not civil procedure rules (civil procedure applies only to set-aside, enforcement, interim measures).
- Chain completeness: evidence → fact → legal basis → conclusion.
- Every issue in dispute answered; no issue omitted or answered off-target.
- Material evidence addressed; missing evaluations flagged.
- No internal contradictions.
- **Suspected AI-fabricated citations:** where cited precedents/statutes/interpretations show red flags (vague/incomplete docket numbers, not findable in case databases, holdings that do not match, article numbers that do not exist in the law, superseded-version mix-ups, fabricated doc numbers, or unnaturally slogan-like "holdings"), run the `legal_ai_disclosure` red-flag checks (§3). Any unflagged-but-unverified citation must not be used as the basis for a finding; flag it in a comment for source verification or deletion.

### 5. Formatting and consistency

Numbering hierarchy, alignment, font sizes, party designations (consistent throughout), figures and currency, citation format per `CITATION.md` §2.

### 6. Deliverables

All three required:

1. **Annotated DOCX** — comments **embedded in the original document** (OOXML `comments.xml`, anchored to specific paragraphs), not a separate memo.
2. **Revised DOCX** — all "must fix" items **actually corrected**.
3. **Issue table** — No. / Location / Issue type / Severity / Suggested revision, with severity as **must fix** or **suggested**.

## Comment writing rules

1. **No placeholder comments.** "Please review the whole document" is unacceptable.
2. Each comment needs: where the problem is, what it is, and the concrete replacement text.
3. Quote the original with its source location.
4. If a problem recurs, list every occurrence.

## Effort allocation

- **Brief**: procedural recitals, uncontested party details, boilerplate.
- **Detailed**: findings of fact, evidence evaluation, tribunal's opinion and legal reasoning.

## Self-check before delivery

- [ ] Every factual statement traceable to page/paragraph/line
- [ ] All three cross-checks completed, mismatches flagged
- [ ] Every issue in dispute answered
- [ ] No arbitration/litigation law mix-up
- [ ] Suspected AI-fabricated precedents/statutes/interpretations red-flag-checked per `legal_ai_disclosure`; unverified ones not relied on
- [ ] Numbering, alignment, fonts, designations, amounts consistent
- [ ] Comments embedded at the right anchors, no placeholders
- [ ] Revised version actually revised
- [ ] Severities correctly graded

## Prohibitions

- No statutes or rule provisions from memory
- No "please verify" in place of a concrete fix
- No skipping sections because the file is long (split and cover everything)
- No contradicting the source without flagging it
