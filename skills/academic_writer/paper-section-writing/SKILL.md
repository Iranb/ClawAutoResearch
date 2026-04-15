---
name: paper-section-writing
description: "Section-by-section English research paper writing guide. Use when drafting or revising a specific manuscript section such as title, abstract, introduction, related work, method, results, discussion, limitations, conclusion, figures/captions, or reviewer response."
argument-hint: "[section name or writing task]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - research_workflow
---

# Paper Section Writing

Use this skill when the task is to write or revise a **specific English paper section**.
Load only the reference file for the current section. Do not load every reference by default.

This skill turns high-level writing advice into section-local moves the Writer can follow.

## Before writing

Always ground the section in workflow artifacts when available:

- `academic_writer/PAPER_PLAN.md`
- `academic_writer/story/STORY_SPINE.md`
- `academic_writer/story/CLAIM_TO_EXPERIMENT_MAP.md`
- `academic_writer/FIGURE_ANCHOR_PLAN.md`
- `analyzer/CLAIM_EVIDENCE_MATRIX.md`
- `analyzer/TRACK_VERDICTS.md`
- `analyzer/UNSUPPORTED_CLAIMS.md`
- `research_workflow.get_writing_contract`

If the section carries headline claims, also apply `writing-hard-constraints`.

## Section guide map

Read exactly one or two relevant files:

- Title and Abstract: `references/title-and-abstract.md`
- Introduction: `references/introduction.md`
- Related Work: `references/related-work.md`
- Method / Approach: `references/method.md`
- Results / Experiments: `references/results-experiments.md`
- Discussion, Limitations, Conclusion: `references/discussion-limitations-conclusion.md`
- Figures, Tables, Captions: `references/figures-captions.md`
- Revision and Rebuttal: `references/revision-and-rebuttal.md`
- Venue and Collaboration: `references/venue-and-collaboration.md`

## Universal section protocol

For every section:

1. State the section job in one sentence.
2. Identify the section's local claim.
3. Map the local claim to evidence, citation, figure, or boundary.
4. Draft with one paragraph per job.
5. Reverse-outline the section after drafting.
6. Remove any sentence that sounds strong but cannot be defended.

## Output contract

When drafting or revising, produce:

1. section job
2. compact outline
3. revised prose or starter paragraphs
4. claim-evidence notes
5. unresolved risks

Keep prose in English unless the user explicitly asks otherwise.
