---
name: frontier-mapping
description: "Extract graph-grounded idea frontiers from a PaperNexus corpus: limitations, contradictions, transfers, and compositions. Use after /graph-build."
argument-hint: "[topic or project direction]"
allowed-tools:
  - Bash(*)
  - Read
  - Write
  - Edit
  - Grep
  - Glob
---

# Frontier Mapping

Use PaperNexus graph traversal to produce a compact, reusable frontier report for brainstorming.

> **File ownership**: Write ONLY to `{PROJ}/researcher/` and `{PROJ}/graph/subgraphs/`.
> `{PROJ}` = `{PROJECTS_ROOT}/{proj-id}`

## Inputs

- `{PROJ}/graph/PAPERNEXUS_STATUS.json`
- `{PROJ}/PROJECT_MANIFEST.json` if present
- project topic / user direction
- optional `{PROJ}/researcher/LITERATURE.md` if it already exists

## Query Passes

For the current topic, run a minimum of these PaperNexus passes:

```bash
node <PAPERNEXUS_ROOT>/src/cli/index.js status --corpus <proj-id>
node <PAPERNEXUS_ROOT>/src/cli/index.js query "<topic>" --corpus <proj-id>
node <PAPERNEXUS_ROOT>/src/cli/index.js brainstorm "<topic>" --corpus <proj-id> --mode diverge --hops 2
node <PAPERNEXUS_ROOT>/src/cli/index.js ideas "<topic>" --corpus <proj-id>
```

Then inspect at least one neighborhood for each promising anchor:

```bash
node <PAPERNEXUS_ROOT>/src/cli/index.js context "<anchor>" --corpus <proj-id>
node <PAPERNEXUS_ROOT>/src/cli/index.js impact "<anchor>" --corpus <proj-id>
```

## Required Frontier Lenses

Build four sections:

1. **Limitation Frontier**
   - recurring limitations across the corpus
   - methods that might address those limitations

2. **Contradiction Frontier**
   - claims or findings that do not align cleanly
   - where stronger evidence or a resolving method could matter

3. **Transfer Frontier**
   - methods that may transfer across tasks, domains, or benchmarks
   - where the graph suggests under-explored applications

4. **Composition Frontier**
   - methods or mechanisms that appear compatible
   - candidate combinations worth piloting together

## Output Files

Write compact markdown snapshots under `{PROJ}/graph/subgraphs/`:

- `limitation_frontier.md`
- `contradiction_frontier.md`
- `transfer_frontier.md`
- `composition_frontier.md`
- `anchor_index.md`

Write `{PROJ}/researcher/FRONTIER_REPORT.md`:

```markdown
# Frontier Report

## Topic
[topic]

## Limitation Frontier
- [frontier item]

## Contradiction Frontier
- [frontier item]

## Transfer Frontier
- [frontier item]

## Composition Frontier
- [frontier item]

## Brainstorm Prompts for /idea-generator
1. [prompt grounded in graph nodes]
2. [prompt grounded in graph nodes]
3. [prompt grounded in graph nodes]
```

## Quality Bar

`FRONTIER_REPORT.md` should not be a generic prose summary. Each frontier item should be grounded in:
- a concrete problem, method, limitation, claim, or evidence anchor from the graph
- the node types / relation pattern that made the item visible
- a reason the frontier matters
- one plausible pilot direction
- one plausible falsifier / failure condition

Prefer using current graph semantics when available, for example:
- `HAS_LIMITATION + MAY_BE_ADDRESSED_BY`
- `CONTRADICTS`
- `TRANSFERABLE_TO`
- `COMPATIBLE_WITH + COMBINES_WITH`
- `SUPPORTED_BY`
- `FAILS_UNDER`

After writing the report, update `{PROJ}/PROJECT_MANIFEST.json` with:

- `frontier_report`
- `current_stage: "frontier_mapping"`
- `current_micro_stage: "frontiers_packaged"`
- `updated_at`
