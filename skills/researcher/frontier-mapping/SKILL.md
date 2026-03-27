---
name: frontier-mapping
description: "Extract graph-grounded idea frontiers from the shared global PaperNexus graph: limitations, contradictions, transfers, and compositions. Use after /graph-build."
argument-hint: "[topic or project direction]"
allowed-tools:
  - Bash(*)
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - lobster
---

# Frontier Mapping

Use PaperNexus graph traversal over the shared global graph, constrained by this project's selected papers, to produce a compact, reusable frontier report for brainstorming.

> **File ownership**: Write ONLY to `{PROJ}/researcher/` and `{PROJ}/graph/`.
> `{PROJ}` = `{PROJECTS_ROOT}/{proj-id}`

## Inputs

- `{PROJ}/graph/PAPERNEXUS_STATUS.json`
- `{PROJ}/PROJECT_MANIFEST.json` if present
- project topic / user direction
- optional `{PROJ}/researcher/LITERATURE.md` if it already exists
- optional `{PROJ}/researcher/RESEARCH_BRAINSTORM.md` if it already exists

## Query Passes

For the current topic, run a minimum of these PaperNexus passes against the shared global graph:

```bash
node <PAPERNEXUS_ROOT>/src/cli/index.js status
node <PAPERNEXUS_ROOT>/src/cli/index.js query "<topic>"
node <PAPERNEXUS_ROOT>/src/cli/index.js brainstorm "<topic>" --mode diverge --hops 2
node <PAPERNEXUS_ROOT>/src/cli/index.js ideas "<topic>"
```

Then inspect at least one neighborhood for each promising anchor:

```bash
node <PAPERNEXUS_ROOT>/src/cli/index.js context "<anchor>"
node <PAPERNEXUS_ROOT>/src/cli/index.js impact "<anchor>"
```

Use `{PROJ}/researcher/PAPER_SOURCE_INDEX.json` and `{PROJ}/graph/PAPERNEXUS_STATUS.json` to constrain which anchors and papers are treated as in-scope for this project.

Prefer the brainstorm-quality node layer when selecting primary anchors:

- trust `brainstormEligible`, `brainstormScore`, and `brainstormTier` over raw visual prominence on the full graph
- use the full graph for provenance and neighborhood inspection, but use the brainstorm-quality view for ideation-first anchoring
- if a remote PaperNexus `/api/*` call is needed, resolve `Authorization: Bearer <token>` from the configured token source

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

Write compact frontier files directly under `{PROJ}/graph/`:

- `LIMITATION_FRONTIER.md`
- `CONTRADICTION_FRONTIER.md`
- `TRANSFER_FRONTIER.md`
- `COMPOSITION_FRONTIER.md`
- `ANCHOR_INDEX.md`

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

If `{PROJ}/researcher/RESEARCH_BRAINSTORM.md` exists, treat it as mandatory upstream context:

- refine it
- prune weak or duplicate hooks
- convert the best hooks into graph-backed frontier items

Do not ignore earlier research-stage brainstorming and restart from a blank slate.
Do not delete shared graph data or run PaperNexus backup / restore commands during frontier work.

After writing the report, update `{PROJ}/PROJECT_MANIFEST.json` with:

- `frontier_report`
- `current_stage: "frontier_mapping"`
- `current_micro_stage: "frontiers_packaged"`
- `updated_at`

## Stage Closeout

When `FRONTIER_REPORT.md` and the required frontier files under `{PROJ}/graph/` are complete and the project is ready to move into IDEA, Researcher should trigger the Lobster handoff workflow.

Do not hand off if the report still requests graph refresh, key frontier anchors are unresolved, or the current plan is to keep iterating inside frontier mapping.
