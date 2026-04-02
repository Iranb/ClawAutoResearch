---
name: scientific-brainstorming
description: Use when graph-grounded ideation needs a bounded divergent-thinking pass after frontier mapping or brainstorm bundle refresh, especially for generating hypotheses, stress-testing assumptions, and exploring cross-domain research directions.
---

# Scientific Brainstorming

Use this skill only after the project already has graph-grounded context.

## Preconditions

Before using this skill, Researcher should already have:

- `{PROJ}/researcher/FRONTIER_REPORT.md`
- a fresh brainstorm bundle from `research_workflow.run_brainstorm_cycle`
- current track constraints from `TRACK_REGISTRY.json`

Do not use this skill as a blank-page brainstorm replacement.

## Purpose

This pass is for:

- generating non-obvious hypotheses
- challenging hidden assumptions
- exploring cross-domain transfers
- proposing falsifiers and fast pilots

## Workflow Fit

Recommended order:

```text
/research-lit -> /literature-review -> /graph-build -> /frontier-mapping -> /scientific-brainstorming -> /idea-phase
```

## Required Guardrails

- Stay anchored to graph evidence and current scope.
- Produce ideas that can map to explicit `question`, `hypothesis`, and `novelty_basis`.
- For each promising direction, record:
  - why it matters
  - what prior work it challenges or extends
  - one small falsifier
  - one baseline-aware pilot

## Output

Append or refresh bounded ideation notes under:

- `{PROJ}/researcher/IDEA_REPORT.md`
- `{PROJ}/researcher/reasoning/<track-id>/SYNTHESIS_PACKET.md`

Do not treat free-form brainstorm chat as durable output.
