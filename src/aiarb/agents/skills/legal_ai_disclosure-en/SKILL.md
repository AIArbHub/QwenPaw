---
name: legal_ai_disclosure
description: "End-to-end verify, disclose and manage risk for AI-generated materials in legal work (Verify–Disclose–Responsibility gate + AI-hallucination-specific checking + risk-tiered handling + full audit trail). Based on SPC Opinion on AI-related Cases (Fa Fa [2026] No.10) Art.19. Applies at any point where AI drafts/polishes submissions, generates case-retrieval reports or evidence, summarises case files before assertion, or AI-cited statutes/precedents/interpretations enter a deliverable."
metadata:
  builtin_skill_version: "2.0"
  aiarb:
    emoji: "🛡️"
    requires:
      - arb_award_review
      - arb_document_draft
tags: ['仲裁核心', '合规与风险']
---

# Legal AI Disclosure (法律 AI 材料核实与披露)

In litigation / arbitration / non-contentious work, before any AI-generated or AI-assisted content enters a **formal deliverable** (filed submissions, retrieval reports, evidence, client advice, shared team conclusions), run this skill's three gates — **Verify → Disclose → Take Responsibility** — then handle by risk tier and keep an audit trail.

This is not "one caution note" but an **executable, auditable, reviewable workflow**.

---

## 0. Legal Basis and Scope

**SPC "Opinion on Lawfully Hearing AI-related Dispute Cases" (Fa Fa [2026] No.10), Art.19** (essentials):
- Before filing AI-generated submissions, case-retrieval reports, etc., **carefully verify** the authenticity and accuracy of cited laws, judicial interpretations and cases;
- At filing, **state the extent of AI assistance**;
- **Bear legal responsibility** for the truthfulness and accuracy of the content.
- Fabricating evidence with AI, sham litigation, or obtaining false evidence through human intervention → reject + fine/detention; criminal liability if a crime.

**Procedural applicability**: Arbitration applies the good-faith principle rather than the direct penalty of Art.114 of the Civil Procedure Law, but the verification duty is identical; Chinese arbitral institutions apply strict disciplinary consequences for fabricated materials. Non-contentious work (due diligence, contract review, memos) applies equally — errors in client advice also attract liability. Cross-border matters add local disclosure rules (see §8).

**Relation to other project constraints**: this skill is the procedural entry gate; `CITATION.md` (citation rules), `arb_award_review` (content review), and `arb_document_draft` (drafting quality) are complementary. This skill governs the compliance boundary of AI participation.

---

## 1. Trigger: Case-Level AI Touchpoint Map

Do not think of this skill only "at the moment of filing". For each case / engagement, scan all AI touchpoints first:

| # | Stage | Common AI use | Risk |
|---|---|---|---|
| 1 | Engagement & strategy | AI summary, risk preview, strategy advice | Medium |
| 2 | Fact investigation | AI timeline, document catalogue | Medium |
| 3 | Legal research | AI "relevant statutes/precedents/interpretations" list | **High (precedent hallucination)** |
| 4 | Document drafting | AI drafts applications/defences/submissions/opinions | High (statutes/facts) |
| 5 | Evidence organisation | AI evidence lists, examination opinions, "evidence summaries" | Med-High |
| 6 | Client communication | AI client messages, legal analysis | Medium |
| 7 | Team collaboration | AI meeting summary, shared minutes | Low |
| 8 | Filing / disclosure | AI-generated submissions, retrieval reports formally filed | **Very high (core)** |
| 9 | Reviewing other party's materials | AI review/summary of counterparty materials then rebut | High |
| 10 | Translation | AI contract/award translation | Medium (terminology) |

**Trigger rule**: stages 3/4/5/8/9 → run full §2–§7. Stages 1/2/6/7/10 → at least run §3 verify + risk tier.

---

## 2. Three Gates: V–D–R

### Gate 1: Verify — authenticity check

For each **falsifiable item** AI outputs, verify item-by-item against an independent source. A falsifiable item = a statement whose truth can be independently confirmed or refuted.

| Type | What to verify | Reliable source | Pass criterion |
|---|---|---|---|
| **Statutes** | article no./paragraph + **current version** | local KB, official (NPC/court) | verbatim with current version; mind law transitions (Arbitration Law 2025 rev. eff. 2026, Company Law 2024, LPR ×4) |
| **Judicial interpretations** | doc number + effective date + **current validity** | official, local KB | current effective; never cite repealed/draft (e.g. new Company Law interpretation not yet issued) |
| **Precedents/cases** | docket no. + holding + actual existence | People's Court Case Database, authoritative databases | docket traceable, holding verifiable; **most hallucination-prone** |
| **Facts** | time/place/amount/parties | user source documents | traceable to user material page/para |
| **Amounts/calculations** | figure + method | user materials, re-computable | independent recalculation matches |
| **Cited data** | data source authenticity | original reports/working papers | consistent with analysis report, blockchain records, etc. |
| **Institutional rules** | rule name + clause + version | institution website, local rules/ | current rules version |

**"Verify" is not "looks plausible" but "back-to-source comparison"**: for each falsifiable item record "AI text → source checked → conclusion (consistent/inconsistent/cannot verify)". See §6 log.

### Gate 2: Disclose — truthfully state AI use

Disclose by three elements — **who, what scope, how verified** — in two places:
1. **External disclosure** (at filing): state the AI assistance for the document/report.
2. **Internal disclosure** (when delivering to team/client): state which parts AI-generated, which human-redrafted, and verification level.

Standard wording in §5.

### Gate 3: Take Responsibility — responsibility & defence confirmation

Confirm four things:
1. Content verified true and accurate;
2. AI use truthfully disclosed;
3. Willing to bear responsibility for accuracy;
4. No "improper evidence-gathering" committed (deleting/tampering with content labels, inducing via specific prompts, cherry-picking outputs, adversarial interference) to fabricate evidence.

**Boundary**: AI is the tool; the filer is responsible. **Do not rely on "AI hallucination" or "technological neutrality" as a defence.** For unverifiable high-risk items, delete them or have a human supply evidence.

---

## 3. AI-Hallucination-Specific Checking (focus)

AI hallucination in legal work concentrates in **precedents** and **statute citations**. Detect proactively with red-flag checks rather than waiting for errors.

### 3.1 Precedent hallucination red-flag check

For any precedent/citation AI gives, ask:

- [ ] **Is the docket number complete/well-formed?** Real dockets look like 「（2020）京民终 1234 号」「(2020) SPC Min Shen No.456」. Vague, missing year/court-level, or generic references like "a recent SPC case" → red flag.
- [ ] **Can it be found in the People's Court Case Database / an authoritative database?** If not findable, it cannot be used. AI fabricates authoritative-sounding citations ("Guiding Case No.N", "Gazette case").
- [ ] **Does the holding match the original?** Even with a real docket, AI often attributes A's holding to B, or rewrites the reasoning.
- [ ] **Is the "holding" too smooth/slogan-like?** Real reasoning is plain and case-specific; AI "holdings" are often perfect antithetical abstractions.
- [ ] **References a type of case that has been cleared/abolished?**

**Disposition**: any unflagged-by-exclusion red flag → the precedent **must not be cited** until a human obtains the true full text.

### 3.2 Statute / interpretation hallucination red-flag check

- [ ] **Out-of-sequence / non-existent article numbers**: does the cited article exist in the law (AI cites a non-existent "Art.X") → search the law's article range in the local KB.
- [ ] **New/old law confusion**: cites a superseded version (e.g. 2017 Arbitration Law as current, pre-2024 Company Law, non-current private-lending 24%/36%) → especially check time-sensitive articles.
- [ ] **Fabricated doc numbers**: AI invents SPC document numbers or mismatches them.
- [ ] **Content/heading mismatch**: article's subject matter does not match its text (AI attaches content of Article A to Article B).

### 3.3 Electronic / generated-content evidence special review (when AI content itself is evidence)

If AI-generated content is asserted as evidence (e.g., to prove "the AI indeed said/generated this"):
- record the **prompt and its influence on output**;
- compare similarity between generated content and the claimed right/fact, and **repeated-test consistency**;
- consider model training, algorithm design, content-filter mechanisms (per Art.18 of the Opinion).
- For electronic-data authenticity/integrity or blockchain notarisation, handle under electronic-evidence rules (this skill does not replace them).

---

## 4. Risk-Tier Handling Matrix (risk × action)

| Tier | Criterion | Handling |
|---|---|---|
| 🟢 Low | Pure internal organisation (minutes, drafts, outlines), no falsifiable content going out | normal use; one internal check; log it |
| 🟡 Medium | Goes to client/team but not a final filing (strategy summary, translation) | verify key statutes/facts to source; mark "AI draft, human review"; do not cite unverified precedents externally |
| 🟠 High | Will be filed with a court/arbitral tribunal/regulator — submissions, retrieval reports, evidence | **mandatory** full V-D-R + precedent/statute hallucination check + item-by-item log + disclosure wording |
| 🔴 Forbidden | AI directly generates content that will be asserted as "fact evidence"; or used to fabricate/alter materials | **Do not use** AI to generate evidence that proves facts; obtain real evidence through normal channels |

**One-sentence test**: Will this AI content go somewhere "formally external, possibly relied upon, error-attracting"? Yes → at least 🟠.

---

## 5. Disclosure Wording Templates (copy-ready)

### 5.1 External filing (attach to submission/report)
> This [document / case-retrieval report] was AI-assisted by [tool name]. We/this representative have verified each cited statute, judicial interpretation, case and fact for accuracy and bear legal responsibility for their truthfulness and accuracy.

### 5.2 Internal delivery (to client/partner working note)
> In this [memo/summary], part [XX] is an AI draft; part [YY] was human-redrafted after verification. Precedents and statutes cited by AI were back-to-source verified (log attached); unverified items were removed.

### 5.3 Full disclosure of "scope of AI use"
> Scope of AI use: ①retrieval assistance ②initial document drafting ③case-file/material summarisation ④translation ⑤formatting. All output was adopted only after item-by-item human verification.

---

## 6. Audit Log (per deliverable)

For each AI-assisted deliverable, fill a record kept in the case file:

```
Material name:
Intended recipient (court/tribunal/client):
AI tool & version:
AI-use stage (retrieval/draft/summary/translation/formatting):
──────────────────────────────────────────
[Verification table]
Falsifiable item | AI text | source checked | conclusion (consistent/inconsistent/cannot verify) | disposition
statute:         |         |               |                                              |
interpretation:  |         |               |                                              |
docket no.:      |         |               |                                              |
fact/amount:     |         |               |                                              |
...
──────────────────────────────────────────
[Disclosure] external wording: □attached  internal: □attached
[Tier] handling tier: 🟢/🟡/🟠/🔴
[Responsibility] verified true□ disclosed□ bear responsibility□ no improper gathering□
[Reviewer signature / date]
```

Purpose: ①self-certify diligence ②traceable (locate errors) ③uniform team standard.

---

## 7. Full-Workflow Operating Template

When asked "use AI to do X and deliver":

1. **Locate stage** → §1 touchpoint table: 3/4/5/8/9 (full process) vs 1/2/6/7/10 (simplified).
2. **Risk initial assessment** → §4 tier. If 🔴 stop that AI use immediately.
3. **Before AI use** (optional) → instruct AI: assist only; do not fabricate docket numbers/statutes; say so if uncertain.
4. **Verify AI output** → run §2 Gate1 item-by-item + §3 hallucination checks; fill §6 log.
5. **Tiered handling** → §4: delete/human-rework/mark-to-verify for high-risk items.
6. **Disclose** → attach §5 wording (external & internal).
7. **Take responsibility** → §2 Gate3 four checks all ticked.
8. **Archive** → §6 log into case file.
9. **Cross-review** → if award review is involved, run `arb_award_review` for full-text consistency + fact-source verification.

---

## 8. Advanced: Extra Disclosure Requirements in Cross-Border Matters

AI compliance is a global topic. Cross-border matters stack additional rules:

| Scenario | Extra attention |
|---|---|
| US courts (some jurisdictions) | multiple lawyer-sanction cases for AI-fabricated precedents; some courts require AI-use disclosure |
| Seats in Singapore/HK/London etc. | institutions/courts scrutinise AI-generated materials and evidence authenticity; expert-witness AI use needs care |
| Cross-border evidence | data-outbound compliance (PIPL, GDPR, etc.) — AI processing of counterparty/client data needs authority |

**General principle**: verification + disclosure + responsibility is the international-consensus floor wherever AI-generated material enters a formal proceeding; stricter local rules prevail.

---

## 9. Red Lines (non-negotiable)

1. **Precedents, statutes and judicial interpretations are AI's highest hallucination zones** — verify each against the current version; better to cite less than to cite wrongly.
2. **"AI-generated" ≠ "correct"** — AI produces a draft/summary; the ultimate accuracy responsibility is on the filer.
3. **Disclosure is protection, not burden** — truthful disclosure + verified content is the best defence under the new rule and good-faith principle; concealment is riskier.
4. **Never use AI to fabricate** — no false evidence, no prompting AI to produce a "desired fact", no deleting/altering content labels.
5. **Unverifiable = unusable** — any high-falsifiability item that cannot be back-to-source verified is deleted or obtained by human evidence-gathering; never deliver sick.

---

## 10. Linkage Matrix with Existing Skills/Files

| Skill/file | Relation | When to link |
|---|---|---|
| `arb_award_review` | content review (downstream) | when reviewing others' materials/awards, specifically check suspected AI-fabricated precedents/statutes |
| `arb_document_draft` / `document_drafting` | drafting (upstream) | after drafting, trigger this skill to verify & disclose |
| `case_retrieval` / `lawcase-search` / `chinese_law_verifier` | retrieval tools | use these to back-to-source verify AI-provided precedents/statutes |
| `redaction` | desensitisation (parallel) | desensitise before AI uses case files; disclose AI processing scope |
| `compliance_review` / `data-compliance-ai-rd` | compliance (parallel) | stack for data/AI-R&D scenarios |
| `knowledge_base/CITATION.md` | citation rules | after verification, cite with source granularity per CITATION.md |
| `knowledge_base/SCHEMA.md` | doc header | when adding any regulation to KB, include source/source_url |
