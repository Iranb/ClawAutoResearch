# Logic Check and Review

## Purpose

Find substantive reasoning problems in research writing and produce reviewer-style feedback when the user needs critique rather than rewriting.

This spec supports two main modes:

- `logic_check` for passage-level consistency checks
- `paper_review` for manuscript-level critique

## When to Use

Use this spec when the user wants issues surfaced, not prose rewritten first.

- Choose `logic_check` for short excerpts, section drafts, or final red-flag screening.
- Choose `paper_review` for a draft paper, PDF, or long-form manuscript review.

## Input Contract

Collect or infer:

- `mode`: `logic_check` or `paper_review`
- `artifact`: passage, section, full draft, or PDF-derived content
- `venue_target`: optional but useful for reviewer-style critique
- `review_depth`: `light`, `standard`, or `harsh`
- `focus`: optional set such as novelty, baselines, logic, clarity, figures, or citations

Defaults:

- Default to `standard` review depth.
- Default to `logic_check` for short excerpts.
- Default to `paper_review` when the user references a full paper, PDF, or submission decision.

## Output Contract

For `logic_check`:

- If no substantive issues are found, say so directly.
- Otherwise, list only the real issues, each with a short explanation and a concrete fix direction.

For `paper_review`:

- Start with the findings.
- Include severity when possible: `critical`, `high`, `medium`, or `low`.
- Cover the main review dimensions that matter for technical papers:
  - novelty
  - soundness
  - experimental support
  - claim-to-evidence consistency
  - presentation clarity
- End with a concise overall recommendation or likely review stance.

## Hard Constraints

- Do not nitpick style when the user asked for logic or review.
- Do not invent missing experiments or results as if they already exist.
- Do not criticize the paper for lacking content that is simply absent from the provided excerpt unless you clearly label it as a missing-context limitation.
- Prefer a small number of high-signal findings over a long list of weak comments.
- Separate verified issues from guesses.

## Procedure

1. Determine whether the task is passage-level checking or full-paper review.
2. Identify the intended claims, terminology, scope, and evidence in the provided material.
3. Search for substantive failures:
   - contradictions
   - unsupported claims
   - unclear causal links
   - inconsistent terminology
   - missing experimental support for major claims
   - over-claimed novelty
4. Write findings in descending severity.
5. Add concrete fix directions rather than generic advice.
6. If context is insufficient, say what is missing instead of over-claiming.

## Failure Modes

- Reporting stylistic preferences as if they were critical defects.
- Missing claim-evidence mismatches because the wording sounds polished.
- Treating absent context as proof of a flaw instead of acknowledging uncertainty.
- Producing vague comments such as `experiments are weak` without naming the missing support.
- Giving a friendly summary before the actual problems, which hides the signal.
