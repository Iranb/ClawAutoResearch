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
  - research_workflow
  - lobster
---

# Paper Phase

Full pipeline from analysis results to compiled PDF, with Cross-Reviewer quality gates at each stage.

## Pipeline

```
/paper-plan ──────► KG storyline contract ──► Cross-Reviewer (outline) ──► fix blockers
     ↓
/paper-write ─────► Cross-Reviewer (per section) ──► revise
     ↓
/citation-preflight ─► clean refs.bib / remove suspicious refs
     ↓
/paper-compile ───► fix LaTeX errors ──► verify page count
     ↓
Citation Gate ────► Reviewer /citation-integrity-gate
     ↓
Final Polish Pass ► Cross-Reviewer (full draft) ──► final edits
     ↓
main_final.pdf
```

## Phase 1: Paper Plan

```
/paper-plan
```

Validates the Analyzer's `CLAIM_EVIDENCE_MATRIX.md`, `TRACK_VERDICTS.md`, `CLAIM_POLICY.md`, and advisory `THEORY_SUPPORT_NOTE.md`, then builds section outline, theory appendix plan, and figure plan.
If `THEORY_APPENDIX_PLAN.md` or `appendix_theory.tex` are missing, first run `/theory-phase` or `research_workflow.materialize_theory_appendix`.
Cross-Reviewer validates outline **before** writing begins.
If `writing_contract.template_required = true`, the template must be readable before this phase starts; otherwise stop and restore it through `research_workflow.set_writing_contract`.
If a template is configured, the active path should be the project-local copied template, not the external source template.
If `writing_contract.kg_storyline_required = true`, produce `KG_STORYLINE_PACKET.md` and mark it `ready` before expanding prose.

Only hard blockers (missing experiments flagged by Cross-Reviewer, or unresolved unsupported primary claims) must be resolved before Phase 2.
`theory`, `storyline`, or `paragraph_logic` marked `RED` are advisory only and must not block Phase 2.
If multiple tracks survived review, narrow to the winning narrative before drafting prose.

**Output**: a durable writing scaffold, not a brittle file checklist. Typical outputs include `{PROJ}/academic_writer/PAPER_PLAN.md`, `{PROJ}/academic_writer/STORYLINE_SKETCH.md`, `{PROJ}/academic_writer/THEORY_APPENDIX_PLAN.md`, `{PROJ}/academic_writer/paper/sections/appendix_theory.tex`, `{PROJ}/academic_writer/KG_STORYLINE_PACKET.md`, `{PROJ}/academic_writer/TEMPLATE_MAPPING.md` when applicable, and initial `{PROJ}/academic_writer/WRITING_SIGNALS.md`, with Cross-Reviewer assessment appended. Save outline review to `{PROJ}/cross-reviewer/outline/{date}.md`.

If one helper file is missing but `writing_session`, `paper_story_state`, and the section packets remain recoverable, do **not** treat that as a full draft wipe. Rebuild only the missing scaffold pieces and continue the process.

## Phase 2: Paper Write

```
/paper-write [section or 'all']
```

Writes LaTeX section-by-section with Cross-Reviewer prose gate after each section.
See `/paper-write` for per-section protocol.

Primary claims marked `UNSUPPORTED` must not appear as headline contributions. They must be:
- removed
- sent back for more experiments
- or rewritten with explicit exploratory language

Only tracks recommended as `advance` or equivalent by `TRACK_VERDICTS.md` may be treated as core paper narrative.
If theory / storyline / paragraph logic are `RED`, continue drafting but preserve the red signal in `{PROJ}/academic_writer/WRITING_SIGNALS.md` for human review.
Template adherence is not optional when configured: section structure and paragraph patterns should be adapted from the project-local template copy before style polishing.
When proof-aware writing is enabled, the main text should keep concise theorem / lemma statements and final implications, while full derivations are maintained in the appendix path.

**Output**: process-first draft progress. In practice this usually means `{PROJ}/academic_writer/paper/sections/*.tex`, `main.tex`, progressively improved section packets / review notes, and updated `{PROJ}/academic_writer/WRITING_SIGNALS.md`. `refs.bib`, `main.pdf`, and full submit-ready cleanup can arrive later; they are not required just to keep drafting forward. Save prose reviews to `{PROJ}/cross-reviewer/prose/{section}-{date}.md`.

When a section or support artifact is long, use the `long-text-write` skill pattern. Write it through `research_workflow` action `write_text_artifact` instead of Bash heredocs. Long prose belongs in workflow-owned text artifacts, not in raw `exec` command strings.

## Phase 3: Citation Preflight

Before compiling the final paper, Writer should run:

```
/citation-preflight
```

This step must:

- verify that `refs.bib` entries come from real sources of truth
- remove or downgrade suspicious citations before Reviewer sees the draft
- keep placeholders within the configured budget
- update citation integrity state, but leave final verification to Reviewer

## Phase 4: Paper Compile

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
- Page count within the configured writing mode limit (`conference` = `9+2`, `journal` = `12+2`)
- All figures referenced in text
- No `[CITATION NEEDED]` markers remaining

**Output**: `{PROJ}/academic_writer/paper/main.pdf`

## Phase 5: Citation Gate

Before the final full-paper polish, run reviewer `/citation-integrity-gate`.
Do not proceed to submission packaging while citation verification is not `verified`.

## Phase 6: Final Polish Pass

Send the full compiled draft (as text, not PDF) to **Cross-Reviewer Agent** for holistic review:

```
sessions_send agent="cross-reviewer":

CROSS_REVIEW_REQUEST
mode: prose
context: [domain, target venue, stage: final pre-submission polish]

Section: FULL PAPER (final pass)
Key claims (all):
[Claims-Evidence Matrix from PAPER_PLAN.md, preserving Analyzer support labels]

LaTeX source (all sections concatenated):
[content of all sections/*.tex]

Focus on:
1. Abstract — does it accurately represent the paper?
2. Introduction contributions — do they match actual results?
3. Cross-section consistency (method description ↔ experiments ↔ conclusion)
4. Any remaining vague claims ("significantly", "large improvement")
5. Whether the paper scope is tighter than the full internal track portfolio
6. Advisory signals only: Theory / Storyline / Paragraph logic → return each as `GREEN` or `RED`

END_REQUEST
```

Parse the full-paper Cross-Reviewer response:
- Apply all remaining line-level edits
- Fix any cross-section inconsistencies
- Recompile after changes

## Phase 7: Final Compile

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
Citation integrity: verified / needs_revision
Cross-Reviewer final assessment: PUBLICATION_READY / NEEDS_REVISION
Advisory writing signals: theory={GREEN/RED}, storyline={GREEN/RED}, paragraph_logic={GREEN/RED}

Cross-Reviewer top concerns (if any):
1. [concern]
2. [concern]

Recommended: [submit / one more revision pass]
```

`AUTO_PROCEED=false`: wait for user to review PDF before marking complete.
`AUTO_PROCEED=true`: if Cross-Reviewer says PUBLICATION_READY and all checks pass → auto-complete.

When WRITE is complete and the project is truly ready to move into SUBMIT, use the shared `workflow-handoff-signal` skill and call `research_workflow.prepare_stage_handoff` for `write -> submit`.

Do not hand off if Cross-Reviewer says `NEEDS_REVISION`, Reviewer asks for another writing pass, the user asks for changes, or citation integrity is not yet `verified`.

## Error Recovery

| Scenario | Response |
|----------|---------|
| LaTeX compile fails repeatedly | Isolate failing section, simplify, ask user for guidance |
| Cross-Reviewer unavailable | Continue without gate, add manual review note in TODOS.md |
| Page limit exceeded | Identify longest section, request Academic Writer Agent to condense |
| Missing citations after full search | Use `[CITATION NEEDED: author year]` and flag in completion report |
| Theory / storyline / paragraph signal is RED | Continue drafting, record it in `WRITING_SIGNALS.md`, and surface it in the completion report for human review |
