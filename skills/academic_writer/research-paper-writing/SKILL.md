---
name: research-paper-writing
description: Improve academic paper writing quality for ML/CV/NLP-style papers with clear section structure, paragraph flow, and reviewer-facing presentation. Use when drafting or revising Abstract, Introduction, Related Work, Method, Experiments, or Conclusion; polishing figures/tables; checking claim-support alignment; or performing self-review before submission.
---
# Research Paper Writing

## Overview

Use this skill to rewrite a research paper into a reviewer-friendly, high-clarity draft.
Prioritize first-impression quality (figures/tables/layout), logical flow, and evidence-backed claims.

## Core Workflow

1. Clarify the paper story before sentence-level edits.
2. If planning is still loose, run a thesis crystallization pass before polishing prose.
3. If the user has provided a paper template, read it first and preserve its section logic before adapting the wording.
4. Use section-specific guidance in `references/`, plus the workflow-owned `WRITING_REFERENCE_BUNDLE.json` when it exists.
5. Rewrite paragraph-by-paragraph with one message per paragraph.
6. Run reverse outlining after writing each section.
7. Run a writing-quality sweep and a writing-judgment sweep before calling the section stable.
8. Check every major claim in Abstract/Introduction against experimental evidence.
9. Run final-paper adversarial review with `references/paper-review.md`.

## Global Principles

1. Keep one paragraph for one message only.
2. State the paragraph message in the first sentence.
3. Make nouns self-contained; define new terms before reusing them.
4. Maintain sentence-to-sentence flow (cause, contrast, consequence, or refinement).
5. Maintain paragraph-to-paragraph flow: the end of one paragraph should make the next paragraph feel necessary.
6. Iterate with adversarial self-review: read as a skeptical reviewer.
7. Treat visual quality as core content, not decoration.
8. Use a clean teaser and pipeline figure.
9. Use readable, minimal-ink tables.
10. Keep formatting consistent and tidy.
11. Use formal academic tone and precise terminology throughout.
12. Keep terminology consistent and define new terms before reuse.
13. Final manuscript sections should be proper paragraphs, not bullet dumps, unless the user explicitly asks for outline form.
14. Apply the Clarity Test: identify load-bearing paragraphs and rewrite them more carefully than supporting paragraphs.
15. Keep the Reader's Journey visible: the reader should know where they are, why they are here, what to take away, and what comes next.
16. Run the writing quality check before finalizing: cut throat-clearing, weaken inflated wording, and break templated rhythm.

## Paragraph Clarity Check (Important)

Use this quick test whenever the user asks whether a paragraph "flows" or is clear.

1. Read as an external reader:
   - Does this paragraph have one explicit message?
   - Does the first sentence state what this paragraph will do?
   - Are all key nouns/terms readable without hidden context?
   - Does each sentence connect to the previous one with a clear relation (cause, contrast, consequence, refinement, example)?
2. Run reverse outlining for the current section:
   - Write down thesis/main claim.
   - Write down each paragraph topic sentence.
   - Write down the evidence/explanation points under each paragraph.
   - Check mapping: topic sentence -> thesis, and evidence -> topic sentence.
   - Revise or remove any paragraph that cannot be mapped cleanly.
3. If flow is still weak, add temporary section headers and explicit transition phrases during revision, then remove unnecessary headers before finalizing.

Source reference for this check:

- `references/does-my-writing-flow-source.md`

## Section Guides

Load only the needed section file:

- Introduction: `references/introduction.md`
- Abstract: `references/abstract.md`
- Related Work: `references/related-work.md`
- Method: `references/method.md`
- Experiments: `references/experiments.md`
- Conclusion: `references/conclusion.md`
- Paper review (Paper Rview): `references/paper-review.md`
- Paragraph clarity source: `references/does-my-writing-flow-source.md`
- Thesis crystallization: `references/thesis-crystallization.md`
- Counterintuitive writing rules: `references/counterintuitive-writing.md`
- Story planning rules: `references/story-planning-rules.md`
- Self-attack protocol: `references/self-attack-protocol.md`
- Figure-centric writing: `references/figure-centric-writing.md`
- Writing quality check: `references/writing-quality-check.md`
- Writing judgment framework: `references/writing-judgment-framework.md`
- Review quality lenses: `references/review-quality-lenses.md`
- Claim verification protocol: `references/claim-verification-protocol.md`
- Example bank index: `references/examples/index.md`

## Paper Review Core Points

Use `references/paper-review.md` for the full checklist and workflow.

1. Add an end-of-draft self-review question list in five dimensions:
   - contribution,
   - writing clarity,
   - experimental strength,
   - evaluation completeness,
   - method design soundness.
2. Treat claim-evidence alignment as a hard constraint, especially for Abstract and Introduction.
3. Perform adversarial writing: review as a skeptical reviewer and resolve every high-risk question.
4. Revise until major rejection risks are explicitly addressed.
5. If the workflow has materialized `PREWRITE_REJECTION_SIMULATION.md`, `CONTRIBUTION_TO_STORY_BRIDGE.md`, or `FIGURE_ANCHOR_PLAN.md`, treat them as execution inputs rather than optional notes.
6. Treat `writing-quality-check.md`, `writing-judgment-framework.md`, and `claim-verification-protocol.md` as mandatory execution references when the current section carries headline claims.

## Execution Rules

1. Build a mini-outline before drafting prose.
2. For each subsection, explicitly include motivation, design, and technical advantage when applicable.
3. Avoid writing style that looks like incremental patching of a naive baseline.
4. Keep terminology stable across the full paper.
5. If a claim cannot be supported by results, weaken or remove the claim.
6. Before finalizing, append and answer a five-dimension self-review question list, then revise the paper based on unresolved items.
7. Do not load all section references (Introduction/Abstract/Related Work/Method/Experiments/Conclusion) at once; load only the specific section guide needed for the current edit target.
8. Make paragraph-to-paragraph flow explicit: each paragraph should build on the previous one and use transitions that make the next paragraph feel necessary.
9. Before planning or rewriting an introduction, crystallize the thesis, skeptic response, and contribution delta in one sentence each.
10. Before finalizing any results-facing section, run the claim verification protocol and downgrade any `MAJOR_DISTORTION` or `UNVERIFIABLE` claim.

## Output Contract

When asked to rewrite or draft sections, return:

1. A compact section outline (3-7 bullets).
2. Revised paragraphs with explicit paragraph roles (opening/challenge/method/advantage/evidence/limitation).
3. A short self-review checklist covering clarity, flow, terminology consistency, unsupported claims, missing evidence, and writing-quality warnings.
4. A claim-evidence map for each major claim in the revised text using `Claim: ... | Evidence: ... | Status: supported/needs evidence`.
