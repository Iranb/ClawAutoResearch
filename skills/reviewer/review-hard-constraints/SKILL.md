---
name: review-hard-constraints
description: "Compact hard-constraint constitution for Reviewer. Use whenever reviewing an English research paper draft, section, or hook audit target that must be judged for evidence alignment, section integrity, and submission safety."
argument-hint: "[section, draft, or hook target]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - research_workflow
---

# Review Hard Constraints

Use this skill as the compact reviewer constitution for manuscript-quality gates.
It complements `paper-review`, `review-phase`, and workflow `file_audit` hooks.
It is not a general peer-review handbook; it is the short list of things that should trigger `pass`, `revise`, or `block`.

For section-specific review gates, use `paper-section-review` and load only the relevant reference file.

## When to use

Use this skill when:

- reviewing `abstract`, `introduction`, `results`, `related_work`, or `conclusion`
- checking title, figure/caption, venue fit, or rebuttal readiness
- running story-pressure review before `write -> submit`
- writing a workflow hook requirement prompt
- deciding whether a section or draft is safe to hand off

## Required inputs

Prefer reading these artifacts before issuing a strong verdict:

- `analyzer/CLAIM_EVIDENCE_MATRIX.md`
- `analyzer/TRACK_VERDICTS.md`
- `analyzer/UNSUPPORTED_CLAIMS.md`
- `academic_writer/PAPER_PLAN.md`
- `academic_writer/story/STORY_SPINE.md`
- `academic_writer/story/CLAIM_TO_EXPERIMENT_MAP.md`
- the target draft file itself

If the judgment depends on claim support and the claim-evidence packet is missing, do not fake certainty.

## Reviewer lenses

Always evaluate through these three lenses:

### 1. Internal validity

- Does the evidence actually support the claim?
- Is the warrant between evidence and conclusion explicit enough?
- If a key result disappears, does the argument collapse?

### 2. External validity

- Is the scope of the conclusion honest?
- Are deployment or generalization claims wider than the data supports?
- Are the boundary conditions explicit?

### 3. Contribution

- What does the reader know after reading this paper that they did not know before?
- Is the delta meaningful, or merely nonzero?
- Is novelty specific, or just rhetorical?

## Hard review rules

### 1. Unsupported headline claims are a block

Block when:

- an abstract, introduction, results, or conclusion headline claim is unsupported
- the prose quietly upgrades a `PARTIAL` or `UNSUPPORTED` claim into a headline result

### 2. Abstract / intro / results / conclusion inconsistency is a block

Block when:

- the abstract promises something the results do not prove
- the introduction frames a contribution that the paper never actually delivers
- the conclusion goes broader than the evidence

### 3. Fabricated or suspicious citation behavior is a block

Block when:

- citations appear invented
- placeholders are disguised as real references
- the paper leans on nonexistent or unverifiable prior work claims

### 4. Major evidence distortion is a block

Block when:

- the prose claims a strong comparative win that the table does not support
- the reader would come away with a materially false interpretation of the evidence

### 5. Related Work as catalog is a revise

Revise when:

- Related Work lists papers without positioning the contribution
- the section fails to explain the relevant prior-work gap

### 6. Paragraph logic failure is a revise

Revise when:

- a paragraph has no clear role
- the first sentence does not orient the reader
- transitions are weak enough that the section feels disconnected

### 7. Missing limitation / boundary is a revise

Revise when:

- the claims may be defensible, but the manuscript hides the true boundary
- the conclusion or discussion does not admit meaningful scope limits

### 8. Figure caption weakness is a revise

Revise when:

- the figure does not make its own question or takeaway visible
- the caption and body text tell different stories

### 9. Vague title or misleading title is a revise

Revise when:

- the title is too generic to reveal the paper's contribution
- the title promises a broader result than the paper supports
- the title is jargon-heavy without a clear object or mechanism

### 10. Main-text dependence on appendix is a block for central claims

Block when:

- a central claim depends on appendix-only evidence
- the main text cannot stand alone for reviewer judgment

### 11. Rebuttal readiness failure is a revise

Revise when:

- likely reviewer objections cannot be answered with manuscript changes
- the paper has no clear response for novelty, baseline, limitation, or evidence questions

## Section-specific expectations

### Abstract

Expect:

- problem
- gap
- action
- strongest result
- implication

Block if the strongest claim is not backed by the paper.

### Title

Expect:

- specific object
- specific action or mechanism
- no unsupported breadth

Revise if it reads like `A Study of ...` or `Towards ...` without meaningful specificity.

### Introduction

Expect:

- urgency
- clear gap
- clear paper action
- concrete contribution list

Revise if it reads like generic background.

### Results

Expect:

- question-first organization
- explicit comparison
- interpretation after evidence
- caveats where needed

Block if the prose materially overstates what the evidence shows.

### Related Work

Expect:

- grouping
- comparison
- positioning

Revise if it is mostly catalog.

### Conclusion

Expect:

- return to the original problem
- restate the strongest supported takeaway
- explicit boundary

Revise or block depending on how far it exceeds the evidence.

### Venue readiness

Expect:

- conference drafts to keep the main text self-contained
- journal drafts to make broad significance readable
- all drafts to preserve evidence transparency

Revise or block depending on whether the issue prevents fair review.

### Rebuttal readiness

Expect:

- likely objections are anticipated
- fixes map to manuscript locations
- disagreement is evidence-backed, not defensive

## Verdict mapping

### `pass`

Use `pass` when:

- no unsupported headline claims remain
- no major evidence distortion remains
- the section is coherent enough that a reviewer can follow the logic
- citations and comparisons look trustworthy

### `revise`

Use `revise` when:

- the core claim is still defensible
- the manuscript has local but important problems
- the fix is mainly structural, wording, positioning, or boundary-setting

Typical `revise` triggers:

- weak introduction gap
- catalog-style related work
- weak paragraph transitions
- vague caption
- missing limitation paragraph
- vague title
- weak rebuttal readiness

### `block`

Use `block` when:

- headline claims are unsupported
- the abstract or conclusion materially misrepresents the evidence
- the paper contains fabricated or noncredible citation behavior
- the main result narrative is scientifically misleading
- central evidence is hidden outside the main text

## Output contract

When using this skill for a review or hook audit, return:

1. `verdict`: `pass`, `revise`, or `block`
2. `summary`: one short paragraph
3. `violations`: specific rule breaches with severity and location when possible
4. `required_fixes`: bounded, concrete fixes

Good review output is:

- explicit
- evidence-bound
- localizable
- fix-oriented

Bad review output is:

- generic
- rhetorical
- vague about where the issue lives

## Reviewer discipline

- Do not downgrade a serious evidence problem into a style suggestion.
- Do not upgrade a style preference into a scientific blocker.
- Do not ask for broader claims when the safer move is to narrow them.
- Prefer narrow, defensible prose over ambitious, weakly supported prose.
