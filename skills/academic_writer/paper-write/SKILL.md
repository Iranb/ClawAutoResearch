---
name: paper-write
description: "Write paper sections in LaTeX following PAPER_PLAN. Each section is reviewed by Cross-Reviewer Agent before moving to the next. Fetches real citations from DBLP/CrossRef."
argument-hint: "[section name or 'all']"
allowed-tools:
  - Bash(*)
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - WebSearch
  - WebFetch
  - Agent
  - research_workflow
---

# Paper Write

Section-by-section LaTeX generation with Cross-Reviewer quality gate after each section.

## Input

> **File ownership**: Write ONLY to `{PROJ}/academic_writer/`. Read from `{PROJ}/academic_writer/PAPER_PLAN.md`, `{PROJ}/analyzer/`, `{PROJ}/researcher/`.
> `{PROJ}` = `{PROJECTS_ROOT}/{proj-id}`

- `{PROJ}/academic_writer/PAPER_PLAN.md` — outline, claims, figure assignments
- `{PROJ}/analyzer/NARRATIVE_REPORT.md` — experimental results
- `{PROJ}/analyzer/CLAIM_EVIDENCE_MATRIX.md` — authoritative claim support status
- `{PROJ}/analyzer/TRACK_VERDICTS.md` — which tracks belong in the paper's main arc
- `{PROJ}/analyzer/UNSUPPORTED_CLAIMS.md` — claims that must stay exploratory or be removed
- `{PROJ}/analyzer/THEORY_SUPPORT_NOTE.md` — advisory theory signal for conservative wording
- `{PROJ}/CLAIM_POLICY.md` — support labels and wording rules
- `{PROJ}/academic_writer/STORYLINE_SKETCH.md` — rough thesis and evidence spine
- `{PROJ}/academic_writer/TEMPLATE_MAPPING.md` — template adaptation note if a user template is configured
- `{PROJ}/academic_writer/WRITING_SIGNALS.md` — advisory `green / red` state to update as sections are written
- `{PROJ}/academic_writer/paper/figures/` — figures (copied from `{PROJ}/analyzer/figures/` at paper-phase start)
- `{PROJ}/researcher/LITERATURE.md` — related work for citations
- `research_workflow.get_writing_contract` — template path and paragraph-logic contract
- `research_workflow.get_citation_integrity` — bibliography path, verification expectations, and placeholder budget

## Writing Order

Default drafting order when no user template overrides the section flow:

```
1. Method        (most factual, clearest to write)
2. Experiments   (directly from NARRATIVE_REPORT)
3. Results       (claim/evidence spine)
4. Discussion    (interpretation + boundary)
5. Related Work  (from LITERATURE.md)
6. Introduction  (after contributions are clear)
7. Limitations   (after results/discussion settle)
8. Conclusion    (after full paper is drafted)
9. Abstract      (very last — 4-5 sentence summary)
```

If `writing_contract.section_order` or `TEMPLATE_MAPPING.md` specifies a different final section order, preserve that order in `main.tex`. You may still draft fact-heavy sections first for stability, but the final paper structure must follow the configured template.

## Per-Section Process

### Step A: Write Draft

Before drafting the section, inspect:

```json
{"action":"get_writing_contract"}
```

Then inspect:

```json
{"action":"get_citation_integrity"}
```

If the writing template is required but missing, stop and restore it first.
If a template path is configured, read that template and `{PROJ}/academic_writer/TEMPLATE_MAPPING.md` before writing.

Write the section as valid LaTeX in `{PROJ}/academic_writer/paper/sections/<section>.tex`.

**Claim safety rule**:
- Claims marked `SUPPORTED` may appear as primary contributions
- Claims marked `PARTIAL` must use cautious language
- Claims marked `UNSUPPORTED` must not be promoted as headline results
- Claims from parked / killed tracks must not quietly re-enter the paper as if they were winning contributions
- If `THEORY_SUPPORT_NOTE.md` marks a claim or overall paper `RED`, keep the language empirical / mechanistic and avoid theorem-like phrasing

**Citation rule**: Fetch every citation from real APIs — do not invent BibTeX:
```
# DBLP (preferred for CS papers)
web_fetch https://dblp.org/search/publ/api?q=[author+title keywords]&format=bibtex&h=3

# CrossRef (fallback)
web_fetch https://api.crossref.org/works?query=[title]&rows=3
```

Add each entry to `{PROJ}/academic_writer/paper/refs.bib`. Use `[CITATION NEEDED: author year]` as placeholder if a paper cannot be found — never invent BibTeX.
Respect `allowed_placeholder_count` from citation integrity state. If the budget is `0`, do not leave placeholders in the final draft.

**Writing standards** (from Academic Writer Agent SOUL.md):
- Abstract: 4-5 sentences (motivation / problem / method / result / implication)
- Introduction: end with numbered contribution list
- All tables: `\booktabs` package (no vertical rules)
- All figures: vector PDF format
- Avoid: "In this paper, we…", "It is worth noting that…"

**Paragraph logic rule**:
- each paragraph has one explicit role: opening / challenge / method / evidence / limitation / transition
- the first sentence should state that role or claim
- sentence order should make the relation explicit: cause, contrast, consequence, refinement, or example
- the final sentence should bridge to the next paragraph or section when possible
- if a paragraph cannot be reverse-outlined cleanly, rewrite it before sending to Cross-Reviewer

### Step B: Cross-Reviewer Prose Check

After drafting each section, send it to the **Cross-Reviewer Agent**:

```
sessions_send agent="cross-reviewer":

CROSS_REVIEW_REQUEST
mode: prose
context: [paper domain, target venue, section position in paper]

Section: [section name]
Key claims this section must support:
[list from PAPER_PLAN.md Claims-Evidence Matrix, including support labels]

Narrative scope:
[winning tracks only, from TRACK_VERDICTS.md]

Storyline sketch:
[thesis + evidence spine from STORYLINE_SKETCH.md]

LaTeX source:
[full section .tex content]

Please also return two advisory signals only:
- Storyline: GREEN or RED
- Paragraph logic: GREEN or RED

END_REQUEST
```

Wait for response. Parse the structured `## Prose Review` output:

- **PUBLICATION_READY** → save section, move to next
- **NEEDS_REVISION** → apply all line-level edits, re-save (no second review pass)
- **REWRITE_REQUIRED** → use Cross-Reviewer's revised paragraph as starting point, rewrite section
- Regardless of verdict, update `{PROJ}/academic_writer/WRITING_SIGNALS.md` with the returned `Storyline` / `Paragraph logic` signal

### Step C: Apply Edits & Finalize

For each line-level edit from Cross-Reviewer:
1. Apply the edit
2. Mark resolved with `% RESOLVED: [edit description]` comment
3. Add any `[CITATION NEEDED]` markers found to a list for final pass

After all edits: remove all `% RESOLVED` comments before next section.
If `Storyline` or `Paragraph logic` is `RED`, keep the section, but add a short note under `## Human Review Focus` in `{PROJ}/academic_writer/WRITING_SIGNALS.md`.

Before moving to the next section, do one local reverse-outline pass:

- write the thesis of the section in one sentence
- list each paragraph's opening sentence and role
- verify that each paragraph supports the section thesis
- verify that paragraph `n` hands off to paragraph `n+1`

Then update the writing contract:

```json
{
  "action": "set_writing_contract",
  "writingContract": {
    "paragraph_logic_status": "green or red",
    "last_paragraph_logic_audit_at": "<now>"
  }
}
```

## Main File

After all sections are written, generate `{PROJ}/academic_writer/paper/main.tex`:

```latex
\documentclass{article}
\usepackage{booktabs, graphicx, amsmath, hyperref}
% Add venue-specific package here (e.g., neurips_2026)

\title{[Paper Title]}
\author{...}

\begin{document}
\maketitle
% Input order must follow writing_contract.section_order or TEMPLATE_MAPPING.md
\input{sections/<section-1>}
\input{sections/<section-2>}
\input{sections/<section-3>}
\bibliography{refs}
\bibliographystyle{plain}
\end{document}
```

## Completion Signal

```
## Paper Draft Complete

Sections written: abstract, introduction, related_work, method, experiments, results, discussion, limitations, conclusion
Cross-Reviewer status per section:
  - method:       PUBLICATION_READY
  - experiments:  NEEDS_REVISION → revised and finalized
  - results:      PUBLICATION_READY
  - discussion:   PUBLICATION_READY
  - related_work: PUBLICATION_READY
  - introduction: NEEDS_REVISION → revised and finalized
  - limitations:  PUBLICATION_READY
  - conclusion:   PUBLICATION_READY
  - abstract:     PUBLICATION_READY

Pending [CITATION NEEDED] markers: N
Estimated pages: ~X (based on word count)
Writing signals: theory={GREEN/RED}, storyline={GREEN/RED}, paragraph_logic={GREEN/RED}

Next: /paper-compile to verify LaTeX builds without errors, then run reviewer /citation-integrity-gate before submission
```
