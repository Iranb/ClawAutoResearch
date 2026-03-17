---
name: paper-phase
description: "Paper writing pipeline: plan → write (with Cross-Reviewer per section) → compile → final polish pass. Use after review phase passes."
argument-hint: "[paper topic or empty to infer from NARRATIVE_REPORT.md]"
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
  - Skill
---

# Paper Phase

Full pipeline from analysis results to compiled PDF, with Cross-Reviewer quality gates at each stage.

## Pipeline

```
/paper-plan ──────► Cross-Reviewer (outline) ──► fix blockers
     ↓
/paper-write ─────► Cross-Reviewer (per section) ──► revise
     ↓
/paper-compile ───► fix LaTeX errors ──► verify page count
     ↓
Final Polish Pass ► Cross-Reviewer (full draft) ──► final edits
     ↓
main_final.pdf
```

## Phase 1: Paper Plan

```
/paper-plan
```

Builds claims-evidence matrix, section outline, and figure plan.
Cross-Reviewer validates outline **before** writing begins.

Blockers (missing experiments flagged by Cross-Reviewer) must be resolved before Phase 2.

**Output**: `{PROJ}/academic_writer/PAPER_PLAN.md` with Cross-Reviewer assessment appended. Save outline review to `{PROJ}/cross-reviewer/outline/{date}.md`.

## Phase 2: Paper Write

```
/paper-write [section or 'all']
```

Writes LaTeX section-by-section with Cross-Reviewer prose gate after each section.
See `/paper-write` for per-section protocol.

**Output**: `{PROJ}/academic_writer/paper/sections/*.tex` + `refs.bib` + `main.tex`. Save prose reviews to `{PROJ}/cross-reviewer/prose/{section}-{date}.md`.

## Phase 3: Paper Compile

```
/paper-compile
```

```bash
cd {PROJ}/academic_writer/paper && latexmk -pdf -interaction=nonstopmode main.tex
```

Auto-fix common errors:
- Undefined citation: check `refs.bib`, fetch missing BibTeX from DBLP
- Missing package: add `\usepackage{<pkg>}` to preamble
- Overfull hbox: reflow sentence or shorten
- Undefined reference: check `\label` names

Check constraints:
- Page count within venue limit (NeurIPS=9+refs, ICML=8+refs, ICLR=8+refs)
- All figures referenced in text
- No `[CITATION NEEDED]` markers remaining

**Output**: `{PROJ}/academic_writer/paper/main.pdf`

## Phase 4: Final Polish Pass

Send the full compiled draft (as text, not PDF) to **Cross-Reviewer Agent** for holistic review:

```
sessions_send agent="cross-reviewer":

CROSS_REVIEW_REQUEST
mode: prose
context: [domain, target venue, stage: final pre-submission polish]

Section: FULL PAPER (final pass)
Key claims (all):
[Claims-Evidence Matrix from PAPER_PLAN.md]

LaTeX source (all sections concatenated):
[content of all sections/*.tex]

Focus on:
1. Abstract — does it accurately represent the paper?
2. Introduction contributions — do they match actual results?
3. Cross-section consistency (method description ↔ experiments ↔ conclusion)
4. Any remaining vague claims ("significantly", "large improvement")

END_REQUEST
```

Parse the full-paper Cross-Reviewer response:
- Apply all remaining line-level edits
- Fix any cross-section inconsistencies
- Recompile after changes

## Phase 5: Final Compile

```bash
cd {PROJ}/academic_writer/paper && latexmk -pdf -interaction=nonstopmode main.tex
cp main.pdf main_final.pdf
```

## Gate — Submission Check

Present final status to user before handing off:

```
## Paper Phase Complete

File: {PROJ}/academic_writer/paper/main_final.pdf
Pages: X (limit: Y) ✓ / ✗
Figures: N (all referenced) ✓
Citations: N (no [CITATION NEEDED]) ✓
Cross-Reviewer final assessment: PUBLICATION_READY / NEEDS_REVISION

Cross-Reviewer top concerns (if any):
1. [concern]
2. [concern]

Recommended: [submit / one more revision pass]
```

`AUTO_PROCEED=false`: wait for user to review PDF before marking complete.
`AUTO_PROCEED=true`: if Cross-Reviewer says PUBLICATION_READY and all checks pass → auto-complete.

## Error Recovery

| Scenario | Response |
|----------|---------|
| LaTeX compile fails repeatedly | Isolate failing section, simplify, ask user for guidance |
| Cross-Reviewer unavailable | Continue without gate, add manual review note in TODOS.md |
| Page limit exceeded | Identify longest section, request Academic Writer Agent to condense |
| Missing citations after full search | Use `[CITATION NEEDED: author year]` and flag in completion report |
