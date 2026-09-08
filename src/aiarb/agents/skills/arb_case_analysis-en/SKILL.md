---
name: arb_case_analysis
description: "Structure arbitration case materials: extract key facts, build a timeline, distil issues in dispute, map evidence to issues and reveal gaps and contradictions — every fact cited to page, paragraph or line."
metadata:
  builtin_skill_version: "1.0"
  aiarb:
    emoji: "🔎"
    requires: {}
tags: ['仲裁核心']
---

# Arbitration Case Analysis

Turn a pile of case materials into a structured analysis ready for use.

See `CITATION.md` for citation rules. Search the shared knowledge base before citing any statute or rule.

## When to use

- Taking over a case and needing a fast overview
- Large volumes of material (dozens of PDFs, contracts, chat records)
- Locating key evidence and spotting contradictions
- Preparing to draft a claim, defence or award

## Core principles

1. Every conclusion carries a source reference (page/paragraph/line).
2. **Do not fill gaps in facts.** If it is not in the record, write "not in the materials".
3. **Surface contradictions** side by side; never silently choose one version.
4. **Separate facts from assertions.** What a party says is not an established fact.

## Procedure

### 1. Inventory

| No. | Document | Type | Submitted by | Pages | Date |
|---|---|---|---|---|---|

Note who submitted each item — it reveals the evidential standpoint. Read large batches in chunks; do not skip.

### 2. Extract key facts

Objective facts only: who, what, when, how much, what documentary support. Cite each: `(Exhibit 3, PDF p.12 ¶2)`.

### 3. Build a timeline

Order key events with their supporting material. A timeline is the most effective contradiction detector — once both parties' accounts are placed on it, conflicts surface.

### 4. Distil the issues in dispute

An issue = a point on which the parties differ **and** which affects the outcome.

- Phrase as a **question** ("Is the liquidated damages clause excessive?"), not a statement.
- For each: claimant's position / respondent's position /各自的 basis.
- Order by **weight**; separate issues of fact from issues of law.

### 5. Map the evidence

| Issue | Claimant's evidence | Respondent's evidence | Gaps | How to strengthen |
|---|---|---|---|---|

Evidence gaps are the most valuable output — they show what is still needed to win.

### 6. Contradictions and doubts

List separately: conflicts between materials (both versions with sources), assertions with no supporting evidence, illogical sequences, items needing verification.

## Output structure

1. Case overview (three sentences: who sues whom, why, what is contested)
2. Key facts (with sources)
3. Timeline
4. Issues in dispute (ordered by weight, with both positions)
5. Evidence map (gaps and reinforcement)
6. Contradictions and doubts
7. Next steps

## Quality requirements

- Every factual statement sourced; unverifiable ones marked "to be verified".
- Issues must be **actionable** — not "contract validity", but "whether art. 8 of the contract (liquidated damages) is enforceable".
- Cover **all** materials, even in batches.
- Unredacted client material stays local; it must not enter the shared knowledge base.

## Prohibitions

- No inferring facts absent from the record
- No treating a party's assertion as an established fact
- No statutes from memory
- No legal conclusions ("clearly a breach") — that is for the tribunal; this task produces structured facts and issues only
