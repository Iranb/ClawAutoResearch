---
name: scientific-critical-thinking
description: "Reviewer rigor audit for methodology, confounders, baseline fidelity, metric validity, leakage, and overclaiming. Use before integrated peer review when the packet's scientific soundness is uncertain."
argument-hint: "[analysis packet, experiment packet, or manuscript section]"
allowed-tools:
  - Read
  - Grep
  - Glob
  - research_workflow
---

# Scientific Critical Thinking

Use this lens before writing an integrated review verdict. Its job is to find scientific failure modes, not polish prose.

## Inputs

Read the current workflow guard or `PROJECT_MANIFEST.json.workflow_control`, then inspect the packet named by the handoff. Prefer:

- `analyzer/CLAIM_EVIDENCE_MATRIX.md`
- `analyzer/TRACK_VERDICTS.md`
- `researcher/EXPERIMENT_SEARCH.json`
- `researcher/EXPERIMENT_LEDGER.json`
- `academic_writer/story/CLAIM_TO_EXPERIMENT_MAP.md`
- the current manuscript section

## Audit Order

1. Identify the exact central claim under review.
2. Check whether the claim is supported by a retained experiment, cited literature, or both.
3. Look for confounders: changed data, changed metric, hidden baseline drift, leakage, cherry-picked seed, or budget mismatch.
4. Check attribution: one mechanism per experiment, one-change signature, ablation, and multi-seed evidence when required.
5. Mark each issue as `block`, `revise`, or `note`.

## Output

Return a compact audit with:

- `verdict`: `pass`, `revise`, or `block`
- `blocking_risks`: highest-priority methodology or integrity issues
- `confounders_checked`: the concrete checks performed
- `required_repairs`: bounded repairs and their owner
- `claim_scope`: the strongest claim that is still defensible

Do not invent citations, baselines, metrics, or experimental evidence.
