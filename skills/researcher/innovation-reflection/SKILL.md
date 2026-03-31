---
name: innovation-reflection
description: "Experiment-informed ideation reflection: use PaperNexus plus the experiment ledger to extract what worked, what failed, and what the next innovation proposal must respect."
argument-hint: "[topic, track id, or next-idea question]"
allowed-tools:
  - Bash(*)
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - Skill
  - research_workflow
---

# Innovation Reflection

Use this skill when the project already has experiment evidence and the next innovation proposal should be informed by that evidence instead of restarting from a blank brainstorm.

## Goal

Produce a PaperNexus-grounded reflection packet that connects:

- latest experiment evidence from `{PROJ}/researcher/EXPERIMENT_LEDGER.json`
- current graph frontier from the shared global PaperNexus graph constrained by this project's selected papers
- reusable lessons and "do not repeat" constraints for the next idea round

The authoritative output is:

- `{PROJ}/researcher/INNOVATION_REFLECTION.md`

The authoritative state update must go through:

- `research_workflow.record_innovation_reflection`

Do not hand-edit `PROJECT_MANIFEST.json.innovation_reflection`.

## Read First

- `{PROJ}/PROJECT_MANIFEST.json`
- `{PROJ}/TRACK_REGISTRY.json`
- `{PROJ}/researcher/FRONTIER_REPORT.md` if it exists
- `{PROJ}/researcher/INNOVATION_REFLECTION.md` if it exists
- `research_workflow.get_experiment_memory`
- `research_workflow.get_innovation_reflection`

## PaperNexus Reflection Loop

1. Resolve the current topic, active track, or next-idea question.
2. Inspect experiment memory first:
   - identify the newest reflectable experiments
   - note what changed the innovation picture
   - note repeated failures, weak assumptions, and strongest wins
3. Confirm the PaperNexus corpus is usable enough for reasoning:
   - if the corpus is stale or key papers are missing, refresh graph state before trusting the reflection
   - if new material arrived through the dashboard or Web/API upload path, prefer the queued import-task route and task logs instead of manually moving files into the shared source tree
4. Run a graph-backed reflection pass with PaperNexus through the workflow wrapper runtime:

```bash
research_workflow.run_papernexus_wrapper -> pn_graph_query.py ... query/context/impact/ideas/brainstorm
research_workflow.run_papernexus_wrapper -> pn_research_chains.py ... evidence-chain/research-brief/brainstorm-brief
```

5. Compare the graph with the experiment evidence:
   - which graph-backed opportunities were validated
   - which ones were contradicted
   - which failures imply a new constraint, composition path, or transfer path
   - prefer brainstorm-quality anchors over raw graph prominence when deciding which opportunities are worth carrying forward
6. Write `{PROJ}/researcher/INNOVATION_REFLECTION.md`.
7. Immediately call `research_workflow.record_innovation_reflection` with the new path and refreshed experiment coverage.

## Required Output Structure

Use this section order:

```markdown
# Innovation Reflection

## Basis
- Topic / track:
- Reflection time:
- Experiments reflected:
- Latest experiment update:

## What Worked
- ...

## What Failed Or Weakened
- ...

## Transferable Lessons
- ...

## Brainstorm Anchors For The Next Round
- graph anchors
- promising compositions
- contradiction or limitation hooks

## Do-Not-Repeat Constraints
- ...

## Proposed Innovation Adjustments
- keep
- modify
- discard

## Open Risks
- ...
```

## Rules

- Treat the experiment ledger as the source of truth for what was run.
- Keep claims tied to either experiment evidence or PaperNexus graph evidence.
- Use the reflection to tighten the next brainstorm, not to retroactively justify a weak idea.
- If reflection support is thin, say so explicitly and keep the next idea scope narrow.
- If a previous reflection already covers the newest experiments, reuse it instead of rewriting it without new evidence.
- If remote PaperNexus evidence is needed, launch `pn_graph_query.py` or `pn_research_chains.py` through `research_workflow.run_papernexus_wrapper` so auth, queueing, and request shape are resolved consistently.
- Do not delete shared graph data or run `backup-export`, `backup-unpack`, or `backup-load` during normal reflection work.

## Completion

After writing the file, record it:

```json
{
  "action": "record_innovation_reflection",
  "innovationReflection": {
    "status": "fresh",
    "last_reflection_path": "researcher/INNOVATION_REFLECTION.md"
  }
}
```

The next ideation step should read this file before proposing or locking new innovation directions.
