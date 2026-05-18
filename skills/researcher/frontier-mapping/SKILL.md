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

Use PaperNexus graph traversal over the shared global graph, constrained by this project's selected papers, to produce a compact, reusable frontier report for brainstorming. If the project already ran `/literature-review`, treat that systematic review packet as upstream scope control instead of brainstorming from a blank slate.

> **File ownership**: Write ONLY to `{PROJ}/researcher/` and `{PROJ}/graph/`.
> `{PROJ}` = `{PROJECTS_ROOT}/{proj-id}`

## Inputs

- `{PROJ}/graph/PAPERNEXUS_STATUS.json`
- `{PROJ}/PROJECT_MANIFEST.json` if present
- project topic / user direction
- optional `{PROJ}/researcher/LITERATURE.md` if it already exists
- optional `{PROJ}/researcher/LITERATURE_REVIEW.md`, `{PROJ}/researcher/SOTA_MATRIX.md`, and `{PROJ}/researcher/GAP_SYNTHESIS.md` if a systematic review packet already exists
- optional `{PROJ}/researcher/RESEARCH_BRAINSTORM.md` if it already exists

## Query Passes

For the current topic, run a minimum of these PaperNexus passes against the shared global graph through the configured `papernexus-remote` MCP server. Use the shell wrappers only when this skill is executed in a shell-only fallback context:

```bash
research_lookup query "<topic>"
research_lookup brainstorm "<topic>"
research_lookup ideas "<topic>"
```

Then inspect at least one neighborhood for each promising anchor:

```bash
research_lookup context "<anchor>"
research_lookup impact "<anchor>"
```

Use `{PROJ}/researcher/PAPER_SOURCE_INDEX.json` and `{PROJ}/graph/PAPERNEXUS_STATUS.json` to constrain which anchors and papers are treated as in-scope for this project.

Prefer the brainstorm-quality node layer when selecting primary anchors:

- trust `brainstormEligible`, `brainstormScore`, and `brainstormTier` over raw visual prominence on the full graph
- use the full graph for provenance and neighborhood inspection, but use the brainstorm-quality view for ideation-first anchoring
- when you need typed multi-hop chains, evidence bundles, or brief-style synthesis, prefer the dedicated `/papernexus-research-chains` skill rather than hand-assembling long raw query sequences
- if remote PaperNexus auth is needed, let the remote HTTP MCP client or its thin wrappers resolve it from the configured token source; do not hand-write REST requests or auth headers
- do not inspect home-directory shared PaperNexus storage or local PaperNexus CLI helpers in workflow-owned frontier mapping; use the MCP-first control plane for the actual live-graph calls

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
If `{PROJ}/researcher/LITERATURE_REVIEW.md` or `{PROJ}/researcher/GAP_SYNTHESIS.md` exists, treat it as mandatory upstream context as well:

- preserve its included-paper boundaries
- use `SOTA_MATRIX.md` to keep frontier claims anchored to the true baseline family
- turn gap statements into graph-backed frontier items instead of re-inventing generic hooks

Do not delete shared graph data or run PaperNexus backup / restore commands during frontier work.

These frontier outputs are not terminal prose. They are the graph-first basis packet for later workflow-owned ideation materialization:

- `research_workflow.materialize_ideation_contract` will read `FRONTIER_REPORT.md`, the frontier files, `ANCHOR_INDEX.md`, and the current brainstorm chain bundle
- therefore frontier items should stay compact, typed, and reusable enough to survive that later synthesis step
- prefer bullet points that name the challenge / insight / transfer / composition explicitly, because those labels are later reused to build novelty tree and challenge-insight tree contracts

After writing the report, update the frontier evidence/projection state through workflow tools or the relevant manifest evidence fields:

- `frontier_report`
- `updated_at`

Do not hand-edit `current_stage`, `current_micro_stage`, `owner_agent`, or `next_action`. Those are mirrors of canonical `workflow_control`; use `auto_iterator_tick` and `workflow-handoff-signal` when the frontier packet is ready.

## Stage Closeout

When `FRONTIER_REPORT.md` and the required frontier files under `{PROJ}/graph/` are complete and the project is ready to move into IDEA, Researcher should use the shared `workflow-handoff-signal` skill and call `research_workflow.prepare_stage_handoff`.

Do not hand off if the report still requests graph refresh, key frontier anchors are unresolved, or the current plan is to keep iterating inside frontier mapping.
