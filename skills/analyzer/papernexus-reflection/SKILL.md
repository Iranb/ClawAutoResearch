---
name: papernexus-reflection
description: "Inspect PaperNexus reflection overlays to summarize innovation, experiment, outcome, and reflection chains for completed tracks and failed attempts."
argument-hint: "[paper, topic, or active track]"
allowed-tools:
  - Bash(*)
  - Read
  - Write
  - Edit
  - Grep
  - Glob
---

# PaperNexus Reflection

Use this skill when Analyzer needs graph-backed reflection, not only metric aggregation.

## What This Skill Covers

- `Innovation`: the paper or track's core novelty
- `Experiment`: the evaluation or failed attempt that tested it
- `Outcome`: the result, labeled as success, failure, mixed, or inconclusive
- `Reflection`: the lesson, limit, takeaway, or future-facing implication

## When To Use

- summarize why a track succeeded, failed, or stayed inconclusive
- compare reflected lessons across nearby papers
- refresh reflection overlays after the corpus changed

## How The Data Updates

Reflection data is refreshed through the normal incremental enhancement workflow.

## Default Workflow

```bash
papernexus status --corpus <name>
papernexus analyze --force --corpus <name>
papernexus enhance --once --corpus <name>
```

For ongoing updates:

```bash
papernexus service status --services watch,serve
```

## What To Read First

If implementation context is needed, read:

- `src/core/enhancements/extract.js`
- `src/storage/enhancement-store.js`
- `src/core/enhancements/worker.js`
- `src/server/api.js`

Then inspect the reflection overlay in this order:

- innovation
- experiment
- outcome
- reflection

At the paper level, inspect:

- `overlays.reflection.cards`
- `overlays.reflection.slots.innovations`
- `overlays.reflection.slots.experiments`
- `overlays.reflection.slots.outcomes`
- `overlays.reflection.slots.reflections`
- `overlays.reflection.links`
- `overlays.reflection.verdictCounts`
- `overlays.reflection.risks`

## Recommended Reflection Workflow

1. confirm the paper source is current
2. rerun `analyze` if the Markdown changed
3. rerun `enhance --once` or verify the background worker refreshed it
4. read the reflection overlay
5. summarize in this order: innovation, experiment, outcome, reflection

## Output Contract

Fold the reflection summary into:

- `{PROJ}/analyzer/NARRATIVE_REPORT.md`
- `{PROJ}/analyzer/TRACK_VERDICTS.md`
- `{PROJ}/analyzer/THEORY_SUPPORT_NOTE.md`

Surface failure conditions explicitly and distinguish success, failure, mixed, and inconclusive outcomes.

When writing the reflection summary, prefer this compact structure:

```text
Innovation:
Experiment:
Outcome:
Reflection:
Open risk:
```

Guidelines:

- keep claims tied to extracted evidence
- distinguish clear wins from mixed or inconclusive results
- mention when the reflection is thin or weakly supported

## When Reflection Should Modify The Graph

Reflection findings do not automatically mean the main graph should be edited.

Default stance:

- do not edit existing graph structure unless reflection exposes a clear factual error
- additive graph changes are acceptable when reflection reveals a source-backed missing node or missing relation

Prefer graph mutation only when reflection reveals a clear, local, high-confidence graph error, such as:

- an obviously wrong node label
- a duplicated node that should be unified
- a missing relationship with direct textual support
- a relationship that points to the wrong paper, claim, method, or finding
- a missing reflection-related node or edge that is directly supported by the paper or overlay output

What reflection work should usually not do:

- rewrite the graph based on a weak interpretation
- treat a tentative takeaway as a confirmed graph fact
- promote a thin reflection into permanent canonical truth
- rewrite existing nodes or relations just to match a preferred narrative

If support is weak or interpretive, prefer recording:

- `Open risk`
- a reflection note
- a limitation
- an uncertainty for later review

Use `dryRun: true` first when applying mutation through MCP, and remember that a later `papernexus analyze --force` can overwrite graph edits.

When mutation is justified, prefer:

- adding a new node
- adding a missing edge

Only edit or delete an existing node or edge when the current graph is clearly wrong.

## Dynamic-Update Notes

If the overlay looks stale, suspect:

- the Markdown changed but `analyze` was not rerun
- enhancement jobs are still pending
- the background `serve` worker is not running
- the selected corpus is not the one you expect

Useful commands:

```bash
papernexus status --corpus <name>
papernexus enhance --once --corpus <name>
papernexus service status
```
