---
name: arb_kb_curate
description: "Curate the arbitration knowledge base: file public rules, redacted cases and templates per SCHEMA and SOURCES, with redaction, metadata completion, correct placement, source-log registration and a retrieval check."
metadata:
  builtin_skill_version: "1.0"
  aiarb:
    emoji: "🗂️"
    requires: {}
tags: ['仲裁核心', '知识管理']
---

# Arbitration Knowledge Base Curation

File content into the shared knowledge base so it is actually retrievable.

**Read first**: `SCHEMA.md` (metadata), `SOURCES.md` (copyright boundaries), `CITATION.md` (citation rules).

## Procedure

### 1. Decide whether it may be filed

| Content | Disposition |
|---|---|
| Official statutory texts | ✅ Full text |
| Institutional rules published by the body | ✅ Full text, with body/version/source URL |
| Published cases | ⚠️ Structured summary only — **no full-text copying** |
| Articles from blogs or media | ❌ Not filed; use as a lead and verify against the official source |
| Practice books, third-party templates | ❌ Not filed |
| User's own case material | ❌ Not in the shared base (may be filed after redaction) |

**When in doubt, do not file.** Log it as pending and ask the user.

### 2. Redact

Remove party names, ID numbers, unified social credit codes, bank accounts, contact details, arbitrator names and exact amounts (keep magnitude or the calculation logic).

Replace with Claimant / Respondent / Company A / Company B. Cases must carry `redacted: true`.

### 3. Complete the metadata

Per `SCHEMA.md`. Three fields matter most: `source`, `source_type`, `retrieved`. **No source, no filing.**

`confidence`: `verified` when checked word-for-word against the original; `draft` otherwise (citations will carry a warning).

### 4. Place it correctly

| Content | Directory | Naming |
|---|---|---|
| Statutes | `laws/` | `<name>-<year>.md` |
| Institutional rules | `rules/` | `<abbr>-仲裁规则-<year>.md` |
| Case summaries | `cases/` | `<institution>-<case no. or topic>-<year>.md` |
| Templates | `templates/` | `<document type>.md` |

### 5. Register it

Append a row to the log in `SOURCES.md`: file, category, source, type, retrieval date, copyright status, status.

**Unregistered means unauthorised.**

### 6. Verify

Search the newly filed content's keywords with `search_knowledge` or `grep_search` and confirm a hit. If not found, check the filename and metadata.

## Body formatting rules

1. Reproduce provisions **verbatim**, keeping the original numbering.
2. Summarise cases in your own words; do not copy passages.
3. Add locating anchors (page, article number) in long documents.
4. Flag conflicts rather than resolving them: `> Note: conflicts with version X, to be verified`.

## Prohibitions

- No statutes, rule provisions, case numbers or holdings from memory
- No full-text copying of copyrighted material
- No unredacted material in the shared base
- No skipping the registration log

## Suggested order

1. `rules/` first (public, no copyright obstacle, fastest payoff)
2. then `laws/` (official texts)
3. then `templates/` (structures)
4. finally `cases/` (redacted from prior award-review work — highest value, most effort)
