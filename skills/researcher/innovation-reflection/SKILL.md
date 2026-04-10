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
- distilled retained-vs-discarded experiment memory from `{PROJ}/researcher/papernexus/EXPERIMENT_MEMORY_PACKET.json` when available
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
- `{PROJ}/researcher/papernexus/EXPERIMENT_MEMORY_PACKET.json` if it exists

## PaperNexus Reflection Loop

1. Resolve the current topic, active track, or next-idea question.
2. Inspect experiment memory first:
   - identify the newest reflectable experiments
   - note what changed the innovation picture
   - note repeated failures, weak assumptions, and strongest wins
   - distinguish what merely happened from what was retained on the incumbent git lineage
3. Confirm the PaperNexus corpus is usable enough for reasoning:
   - if the corpus is stale or key papers are missing, refresh graph state before trusting the reflection
   - if new material arrived through the dashboard or Web/API upload path, prefer the queued import-task route and task logs instead of manually moving files into the shared source tree
   - queued import-task route here means `pn_stage_sync.py`, `pn_import_submit.py`, `pn_import_queue.py`, or `pn_batch_import.py`, all treated as `import_workflow` adapters rather than a separate live-graph control plane
4. Run a graph-backed reflection pass with PaperNexus through the remote HTTP MCP control plane:

```bash
research_lookup ... query/context/impact/ideas/brainstorm
research_briefing ... evidence-chain/research-brief/brainstorm-brief
idea_catalyst ... when cross-domain transfer is part of the reflection question
```

5. Compare the graph with the experiment evidence:
   - which graph-backed opportunities were validated
   - which ones were contradicted
   - which failures imply a new constraint, composition path, or transfer path
   - prefer brainstorm-quality anchors over raw graph prominence when deciding which opportunities are worth carrying forward
6. Write `{PROJ}/researcher/INNOVATION_REFLECTION.md`.
7. Immediately call `research_workflow.record_innovation_reflection` with the new path and refreshed experiment coverage.
8. If this reflection materially changes the next ideation round, make sure the reusable constraints are visible to the graph-backed memory layer that ideation already consumes:
   - `brainstorm_cycle.working_memory_path`
   - `brainstorm_cycle.reflection_chain_path`
   - `TRACK_REGISTRY.json`
   so the later `materialize_ideation_contract` step reuses the same lesson set instead of inventing a parallel memory packet

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
- Treat the graph-backed experiment memory packet as the distilled explanation of what should still matter to later planning and ideation.
- Keep claims tied to either experiment evidence or PaperNexus graph evidence.
- Use the reflection to tighten the next brainstorm, not to retroactively justify a weak idea.
- Surface retained wins and discarded-but-instructive failures separately. A candidate that reduced the gap but did not earn promotion should usually become a cautionary lesson, not a success claim.
- If reflection support is thin, say so explicitly and keep the next idea scope narrow.
- If a previous reflection already covers the newest experiments, reuse it instead of rewriting it without new evidence.
- If remote PaperNexus evidence is needed, use the MCP-first tool families (`research_lookup`, `research_briefing`, `idea_catalyst`) or the thin wrappers backed by them so auth and request shape are resolved consistently.
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
