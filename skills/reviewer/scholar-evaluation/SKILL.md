---
name: scholar-evaluation
description: "Structured reviewer scoring for originality, significance, soundness, evidence sufficiency, clarity, and reproducibility. Use when the workflow needs calibrated scores instead of free-form critique."
argument-hint: "[review packet or manuscript]"
allowed-tools:
  - Read
  - Grep
  - Glob
  - research_workflow
---

# Scholar Evaluation

Use this skill to convert reviewer judgment into a stable scorecard. It complements `scientific-critical-thinking` and `peer-review`.

## Score Dimensions

Score each dimension from 1 to 5 and include one sentence of evidence:

- `originality`
- `significance`
- `soundness`
- `evidence_sufficiency`
- `clarity`
- `reproducibility`

## Calibration Rules

- A paper with unsupported headline claims cannot score above 2 on soundness.
- A paper without traceable experiment or literature evidence cannot score above 2 on evidence sufficiency.
- A result with no retained primary-metric gain should not be treated as a positive empirical contribution.
- Strong writing does not compensate for weak evidence.

## Output

Return:

- `overall_recommendation`: `accept`, `weak_accept`, `borderline`, `weak_reject`, or `reject`
- per-dimension scores and rationales
- `deal_breakers`
- `highest_leverage_repairs`
- `confidence`

Keep the scorecard concise and grounded in artifacts already present in the project.
