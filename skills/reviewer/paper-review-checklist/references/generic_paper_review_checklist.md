# Generic Paper Review Checklist for Agent

Intended for: a review agent evaluating an academic paper draft.

Goal: identify the highest-impact weaknesses in the manuscript and provide a reviewer-style assessment that is specific, prioritized, and actionable.

## Mission

You are reviewing the actual manuscript, not the paper idea in the abstract.

Your task is to determine whether the draft is coherent, credible, and submission-ready. Focus first on contradictions, unsupported claims, unfair comparisons, and unfinished-manuscript signals. Only then comment on wording and polish.

## Priority Rules

Use these severity levels:

- `P0`: fatal issue; enough to block submission
- `P1`: major issue; seriously weakens validity, clarity, or trustworthiness
- `P2`: moderate issue; lowers quality but is fixable without redefining the paper
- `P3`: minor issue; mainly wording, style, or formatting

If a `P0` issue exists, lead with it.

## Review Workflow

### Step 1: Check Paper Identity and Central Thread

- [ ] Does the title match the abstract?
- [ ] Does the abstract match the main body?
- [ ] Does the paper present one coherent method, framework, or thesis?
- [ ] Do figures, equations, and algorithms match the text?
- [ ] Is there evidence that multiple draft directions were merged without full cleanup?

If the manuscript appears to mix incompatible paper identities, raise this as `P0`.

### Step 2: Check Scope Stability

- [ ] Is the paper scope stable across sections?
- [ ] Are all datasets, tasks, case studies, or theoretical objects named consistently?
- [ ] Does the conclusion stay within the scope established earlier?
- [ ] Do ethics, licensing, code, or appendix sections refer to the same paper scope?

If the scope changes across sections, raise this as `P0` or `P1` depending on severity.

### Step 3: Check Numerical and Comparative Integrity

- [ ] Are reported gains numerically correct?
- [ ] Are baseline values stable across setup, tables, and discussion?
- [ ] Are mean, variance, best-case, and single-run numbers clearly separated?
- [ ] Are comparisons fair with respect to protocol, backbone, model family, or evaluation setting?
- [ ] Is the manuscript transparent about which numbers are reproduced versus borrowed from prior work?

Unfair or internally inconsistent comparisons should be raised as `P0` or `P1`.

### Step 4: Check Claim Strength Versus Evidence

- [ ] Do the results support the headline claims?
- [ ] Are significance claims handled honestly?
- [ ] Are limitations acknowledged when needed?
- [ ] Are ablation or analysis claims stronger than the evidence justifies?
- [ ] Does the conclusion overstate what the paper actually establishes?

### Step 5: Check Submission Readiness

- [ ] Are there unresolved placeholders such as `Table ??`, `Figure ??`, or `citation needed`?
- [ ] Are appendix references complete and real?
- [ ] Are cross-references resolved?
- [ ] Does the paper still look like a partially edited draft?

Any unresolved placeholder reference is a submission blocker and should be stated explicitly.

## Common High-Risk Areas To Check in Any Draft

Pay special attention to the following recurring failure points:

- [ ] title / abstract / method mismatch
- [ ] shifting terminology for the same concept
- [ ] changed experiment scope across sections
- [ ] conclusion introducing new claims or data
- [ ] unfair baseline comparisons
- [ ] arithmetic mismatch in claimed improvements
- [ ] best-run numbers being mixed with average results
- [ ] strong claims resting on weak or mixed evidence
- [ ] residual text from earlier draft versions

## What To Praise Only If It Truly Holds

Do not praise these automatically. Verify them first.

- [ ] clear problem framing
- [ ] strong and fair experimental design
- [ ] honest limitation discussion
- [ ] useful multi-seed or uncertainty reporting
- [ ] convincing ablation or analytical evidence
- [ ] strong structure and readability

If present, describe the strength precisely and narrowly.

## Optional Type-Specific Checks

### If the paper is a survey or review article

- [ ] Is the scope clearly defined?
- [ ] Do inclusion or selection rules match the actual literature covered?
- [ ] Does the taxonomy or framework have explicit criteria?
- [ ] Are comparison dimensions stable?
- [ ] Do open problems genuinely follow from the evidence?

### If the paper is an empirical methods paper

- [ ] Is the method identity stable?
- [ ] Are baselines appropriate and fairly compared?
- [ ] Are evaluation settings reproducible and clearly stated?
- [ ] Do the main experimental claims survive careful reading?

### If the paper is theoretical or analytical

- [ ] Are assumptions explicit?
- [ ] Are definitions stable and precise?
- [ ] Do proofs or arguments support the stated claims?
- [ ] Does the discussion correctly interpret the formal results?

## Required Output Format

Return the review using this structure.

### 1. Overall Verdict

State briefly:

- what the paper is trying to do
- what currently works best
- what most blocks submission or acceptance quality

### 2. P0/P1 Issues

List the highest-priority issues first.

For each item, use:

- `Issue`
- `Why it matters`
- `Evidence in the manuscript`
- `What the authors should do`

### 3. Section-by-Section Review

Comment on the relevant sections, for example:

- title / abstract
- introduction
- method or framework
- experiments or evaluation
- discussion / conclusion
- appendix / submission readiness

### 4. Minor Issues

Group smaller wording, formatting, or polish issues together.

### 5. Suggested Next Revision Round

Give 3-6 concrete actions the authors should take next.

## Review Style Rules

- Be specific, not generic.
- Quote concrete contradictions when possible.
- Separate trust-breaking issues from polish issues.
- Do not spend most of the review on wording if the core manuscript is inconsistent.
- Do not recommend acceptance if the paper still contains unresolved internal contradictions.

## Final Self-Check

Before finishing, confirm:

- [ ] Did I check consistency before style?
- [ ] Did I prioritize the most trust-damaging issues?
- [ ] Did I distinguish evidence problems from writing problems?
- [ ] Did I identify submission blockers explicitly?
- [ ] Would this review help the authors repair the actual draft, not just comment on the paper idea?
