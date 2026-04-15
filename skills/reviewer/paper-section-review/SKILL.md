---
name: paper-section-review
description: "Section-by-section English research paper review guide. Use when reviewing title, abstract, introduction, related work, method, results, discussion, limitations, conclusion, figures/captions, rebuttal readiness, or full-paper consistency."
argument-hint: "[section name or review target]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - research_workflow
---

# Paper Section Review

Use this skill when reviewing a **specific English paper section** or a workflow hook audit target.
Load only the reference file for the current target. Do not load every reference by default.

This skill turns writing expectations into section-local review gates.

## Before reviewing

Read the target draft file and, when available, the relevant evidence packet:

- `analyzer/CLAIM_EVIDENCE_MATRIX.md`
- `analyzer/TRACK_VERDICTS.md`
- `analyzer/UNSUPPORTED_CLAIMS.md`
- `academic_writer/PAPER_PLAN.md`
- `academic_writer/story/STORY_SPINE.md`
- `academic_writer/story/CLAIM_TO_EXPERIMENT_MAP.md`
- `academic_writer/FIGURE_ANCHOR_PLAN.md`

If the target has headline claims and the evidence packet is missing, do not issue a strong `pass`.

## Section review map

Read exactly one or two relevant files:

- Title and Abstract: `references/title-and-abstract-review.md`
- Introduction: `references/introduction-review.md`
- Related Work: `references/related-work-review.md`
- Method / Approach: `references/method-review.md`
- Results / Experiments: `references/results-experiments-review.md`
- Discussion, Limitations, Conclusion: `references/discussion-limitations-conclusion-review.md`
- Figures, Tables, Captions: `references/figures-captions-review.md`
- Rebuttal / Response: `references/rebuttal-review.md`
- Full-paper consistency: `references/full-paper-consistency-review.md`

## Universal review protocol

For every target:

1. Identify the local claim.
2. Check whether the claim is supported by evidence.
3. Check whether the section performs its intended job.
4. Check paragraph logic and reader journey.
5. Decide `pass`, `revise`, or `block`.

## Verdict scale

- `pass`: safe to proceed.
- `revise`: defensible content, but section needs local fixes.
- `block`: unsafe to proceed because the section misrepresents evidence, carries unsupported headline claims, or blocks fair review.

## Output contract

Return:

1. `verdict`
2. `summary`
3. `violations`
4. `required_fixes`
5. `evidence_gaps`

For hook audits, keep the output localizable and fix-oriented.
