---
name: peer-review
description: "Integrated formal reviewer voice for a manuscript or review packet. Use after rigor and score lenses when the workflow needs a coherent peer-review report with strengths, weaknesses, questions, and verdict."
argument-hint: "[manuscript or review packet]"
allowed-tools:
  - Read
  - Grep
  - Glob
  - research_workflow
---

# Peer Review

Use this skill for the final integrated reviewer voice. It should synthesize, not replace, the methodology audit and structured scorecard.

## Review Structure

Produce:

1. Summary of the paper's claimed contribution.
2. Strengths grounded in actual evidence.
3. Major weaknesses ordered by severity.
4. Minor weaknesses and clarity issues.
5. Questions for authors.
6. Recommendation and confidence.

## Verdict Discipline

- Lead with defects that could change the decision.
- Separate missing evidence from weak writing.
- Do not accept claims that are not tied to experiments, citations, or a claim-evidence matrix.
- If the workflow has `analysis_gate.decision != "ready_for_analysis"`, treat empirical claims as provisional.
- If using this during internal review, make repairs owner-routable: Writer, Analyzer, Researcher, Coder, or Reviewer.

## Output

Write in a formal reviewer style, but keep the final section actionable:

- `recommendation`
- `confidence`
- `required_changes_before_submission`
- `optional_improvements`

Do not fabricate paper details, citations, or results.
