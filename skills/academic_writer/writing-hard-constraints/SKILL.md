---
name: writing-hard-constraints
description: "Compact hard-constraint constitution for Academic Writer. Use whenever drafting or revising an English research paper section that must stay aligned with evidence, story, and workflow gates."
argument-hint: "[section name or draft target]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - research_workflow
---

# Writing Hard Constraints

Use this skill as the short list of **non-negotiable** writing requirements.
It complements `paper-plan`, `paper-write`, and `research-paper-writing`.
It is not a full pipeline; it is the compact constitution that the Writer should obey before calling a section stable.

For section-specific drafting moves, use `paper-section-writing` and load only the relevant reference file.

## When to use

Use this skill when:

- drafting or rewriting `abstract`, `introduction`, `related_work`, `method`, `results`, `discussion`, `limitations`, or `conclusion`
- preparing a section for reviewer audit or workflow hook audit
- checking whether a section is safe to hand off

## Required inputs

Before broad drafting, read the current writing packet when it exists:

- `academic_writer/PAPER_PLAN.md`
- `academic_writer/story/STORY_SPINE.md`
- `academic_writer/story/CLAIM_TO_EXPERIMENT_MAP.md`
- `academic_writer/story/FALLBACK_NARRATIVE.md`
- `academic_writer/FIGURE_ANCHOR_PLAN.md`
- `academic_writer/PREWRITE_REJECTION_SIMULATION.md`
- `academic_writer/WRITING_REFERENCE_BUNDLE.json`
- `analyzer/CLAIM_EVIDENCE_MATRIX.md`
- `analyzer/TRACK_VERDICTS.md`
- `analyzer/UNSUPPORTED_CLAIMS.md`
- `research_workflow.get_writing_contract`

If the story packet or writing contract is missing, repair that first instead of free-writing.

## Non-negotiable rules

### 1. One thesis, one evidence spine

- The draft must center on one main claim arc.
- Headline claims must stay few, explicit, and memorable.
- Do not let side tracks quietly become co-equal contributions.

### 2. Every headline claim must map to evidence

- `SUPPORTED` claims may appear as headline contributions.
- `PARTIAL` claims must be softened.
- `UNSUPPORTED` claims must not remain in the headline arc.

Do not write:

- broad claims with no direct evidence
- inflated novelty wording to compensate for weak support

### 3. Abstract must follow the problem-gap-action-result-implication arc

The abstract must answer:

1. What problem matters?
2. What gap remains?
3. What does this paper do?
4. What is the strongest result?
5. What does that result imply?

If one of these is missing, the abstract is not ready.

### 4. Introduction must establish the gap before detail

The introduction must:

- explain why the problem matters now
- identify what prior work still misses
- explain why the gap is non-trivial
- say what this paper does before drowning in detail
- end with a concrete contribution list

If the reader still cannot state the gap after two paragraphs, the introduction is not ready.

### 5. Related Work must position, not catalog

Related Work must:

- group prior work into lines or families
- explain their common strengths and limits
- make the paper's difference explicit

Do not write paper-by-paper summaries as the dominant structure.

### 6. Method must justify design, not just describe modules

Each methods subsection should answer:

- what problem does this component solve?
- why is it designed this way?
- what later evidence validates it?

If a design choice has no later validation path, either justify it better or shrink its role.

### 7. Results must be question-first and interpretation-first

Each results subsection should answer one question.

Recommended local move:

1. state the question
2. show the figure or table
3. explain the comparison
4. interpret the result
5. state the boundary or caveat when needed

Do not write:

- "As shown in Figure X ..." without first saying what the reader should look for
- bare metric repetition with no interpretation
- a conclusion that exceeds the evidence

### 8. Figures and captions must carry argument load

- Each figure should answer one main question.
- Figure titles and captions should be largely self-explanatory.
- The reader should be able to understand the figure's takeaway without hunting across the whole paper.

### 9. One paragraph, one job

For every paragraph:

- the first sentence should state the paragraph role or claim
- the paragraph should carry one main message
- the evidence and interpretation should be clearly connected
- the paragraph should help the next paragraph feel necessary

If a paragraph cannot be reverse-outlined cleanly, rewrite it.

### 10. Limitations are mandatory, not optional

- State where the conclusions apply.
- State where they do not yet apply.
- Do not hide uncertainty under optimistic wording.

### 11. No filler, no hype, no fake confidence

Avoid:

- empty intensifiers
- throat-clearing openings
- generic trend language
- sentences that sound important but say nothing precise

Prefer:

- specific evidence
- bounded wording
- stable terminology
- direct causal or comparative interpretation

### 12. Real citations only

- Never invent citations or BibTeX.
- Placeholder citations may be used only within policy and must remain explicit placeholders.

## Section-specific hard checks

### Abstract

Block yourself if:

- the strongest claim is not evidence-backed
- the result sentence is vague
- the last sentence is just marketing

For title and abstract drafting details, use `paper-section-writing/references/title-and-abstract.md`.

### Introduction

Revise if:

- the gap is still fuzzy
- the contribution list is generic
- the introduction reads like background notes instead of a paper opening

For introduction drafting details, use `paper-section-writing/references/introduction.md`.

### Results

Block yourself if:

- a headline result is unsupported
- the text claims more than the table or figure shows
- failure cases or caveats are hidden when they materially affect interpretation

For results and experiment prose details, use `paper-section-writing/references/results-experiments.md`.

### Conclusion

Revise if:

- it only repeats the abstract
- it introduces new results
- it quietly broadens the scope

For discussion, limitations, and conclusion details, use `paper-section-writing/references/discussion-limitations-conclusion.md`.

## Missing-risk reminders from the full writing guide

- Title must be specific, not vague.
- Main text must be self-contained for central claims; do not hide core evidence in the appendix.
- Conference drafts must respect page pressure and compress around the evidence spine.
- Journal drafts must make broader significance readable to adjacent-field readers.
- Multi-author drafts need a consistency pass across Abstract, Introduction, Results, and Conclusion.
- Rebuttal responses must point to concrete manuscript changes, not just defend the old text.

## Section-ready checklist

A section is not ready until:

- its local claim is explicit
- that claim is evidence-aligned
- paragraph flow is clean enough for reverse outlining
- terminology is stable
- any needed limitation or caution language is present

## Output discipline

When using this skill during rewriting, prefer outputs that are easy to audit:

- short section outline
- revised prose
- claim -> evidence map
- list of unresolved risks

If you cannot defend a sentence, do not keep it just because it sounds good.
