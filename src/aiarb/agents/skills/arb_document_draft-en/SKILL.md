---
name: arb_document_draft
description: "Draft arbitration documents (statement of claim, defence, counterclaim, submissions, procedural orders) from knowledge-base templates, with mandatory checks on numbering, alignment, font consistency and correctness of legal basis."
metadata:
  builtin_skill_version: "1.0"
  aiarb:
    emoji: "📝"
    requires: {}
tags: ['仲裁核心', '文书起草']
---

# Arbitration Document Drafting

Produce a ready-to-use first draft from knowledge-base templates.

See `CITATION.md` for citation rules; templates live in `knowledge_base/templates/`.

## Procedure

### 1. Confirm the required elements

Ask before drafting — never assume:

| Element | Note |
|---|---|
| Document type | claim / defence / counterclaim / submission / procedural order |
| Institution | determines applicable rules and format |
| Parties | full names, addresses, legal representatives, counsel |
| Relief sought | itemised, with currency and calculation method |
| Facts and grounds | materials that can be cited |
| Deadlines | time limits for defence or evidence |

If an element is missing, **ask**. Never invent amounts, dates or party names.

### 2. Retrieve and apply a template

`search_knowledge(query="<document type>", scope="templates")`. Follow its required elements and suggested structure. If no template exists, say so, use a generic structure, and propose adding a template.

### 3. Draft

- **Relief sought**: specific and enforceable; avoid vague formulas.
- **Facts**: chronological; every sentence traceable to material.
- **Grounds**: complete chain — evidence → fact → legal basis → conclusion.
- **Legal basis**: procedural matters cite the Arbitration Law and institutional rules; civil procedure rules apply only at the judicial review stage. **Verify article numbers by search** before citing.

### 4. Self-check before delivery

**Formatting:**

- [ ] Numbering hierarchy consistent, no level mixing
- [ ] Same-level headings aligned; body indentation uniform
- [ ] Uniform font size per heading level
- [ ] Party designations consistent throughout
- [ ] Currency, capitalisation and amounts consistent; calculations reproducible
- [ ] Citations follow `CITATION.md`

**Content:**

- [ ] All facts sourced; nothing invented
- [ ] Article numbers verified
- [ ] Relief sought consistent with facts and grounds
- [ ] No required element missing

## Output

1. The document (Markdown or DOCX as requested)
2. An element checklist (what was filled, from where)
3. Items awaiting confirmation

## Quality requirements

- No invented party details, amounts, dates or article numbers
- No boilerplate padding; every sentence carries information
- Brief on procedure, detailed on issues and legal reasoning
- DOCX output keeps an editable structure

## Prohibitions

- No article numbers from memory
- No assuming facts the user did not supply
- No mixing formatting requirements of different institutions
- No delivering an unchecked draft
