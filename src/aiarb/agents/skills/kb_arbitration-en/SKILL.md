---
name: kb_arbitration
description: "Guidance for arbitration / dispute-resolution questions: for statutes, arbitration rules, cases, or document templates, search the shared knowledge base first (it is merged into grep_search/read_file scope; search_knowledge remains for category-scoped search) and never fabricate legal provisions or rules."
metadata:
  builtin_skill_version: "1.0"
  aiarb:
    emoji: "📚"
    requires: {}
---

# Arbitration Knowledge Base Retrieval

When handling **arbitration / dispute-resolution** questions (statutes, arbitration rules, institutional procedure, cases, document templates), follow these rules.

## Core principles

1. **Search before answering**: for specific statutes, rule clauses, institution names, time limits, fees, procedures, or document formats, search the shared knowledge base first and answer from the results. It is merged into your file-search scope — use `grep_search` / `read_file` directly (no need to distinguish shared vs. own files); use `search_knowledge` when you want category-scoped search.
2. **Never fabricate**: do not invent statute numbers, clause text, rule provisions, deadlines, or institution names. If nothing is found, say so and suggest adding the source.
3. **Cite sources**: state the origin (file / clause / institution) where possible.

## Steps

1. Extract keywords from the question (e.g. "validity of arbitration agreement", "setting aside an award", "CIETAC summary procedure").
2. Search with `grep_search(pattern=keywords)` directly (the search scope already covers the shared knowledge base and your workspace); or call `search_knowledge(query=keywords)` and narrow with `scope` when clearly one category:
   - `laws` — statutes
   - `rules` — arbitration rules
   - `cases` — case library
   - `templates` — document templates
3. If few hits, retry with synonyms or split keywords.
4. Open the hit file with `read_file` to verify context before answering.

## Notes

- This skill is retrieval guidance; it does not replace `grep_search`, `read_file`, or `search_knowledge`.
- Knowledge base content is authoritative; prefer the current local files over stale memory.
