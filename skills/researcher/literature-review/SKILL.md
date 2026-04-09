---
name: literature-review
description: "Structured literature review with inclusion/exclusion criteria, baseline coverage, SoTA matrix, and gap synthesis. Use after /research-lit when a project needs a durable survey packet before frontier mapping or ideation."
argument-hint: "[research topic or review scope]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - Skill
  - research_workflow
---

# Literature Review

Build a durable, systematic literature-review packet for the current project so downstream frontier mapping, ideation, planning, and code review stay aligned with the real baseline landscape.

> **File ownership**: Write ONLY to `{PROJ}/researcher/`.
> `{PROJ}` = `{PROJECTS_ROOT}/{proj-id}`

## Best Fit In The Workflow

Use this skill in the early Researcher loop:

```text
/research-lit -> /literature-review -> /graph-build -> /frontier-mapping -> /idea-phase
```

This skill is most useful when the project needs one or more of:

- a durable inclusion / exclusion record instead of an informal paper list
- explicit baseline coverage before plan or code work
- a SoTA matrix by task, dataset, setting, and metric
- a gap synthesis packet that can feed graph-grounded brainstorming
- a stronger bridge between literature collection and innovation design
- a durable Zotero-backed included / excluded / baseline packet under `bot/<project-id>`

If the user wants this pass to run as a bounded background continuation, prefer the standalone `/literature-review` workflow command for the current project-bound conversation.

If the topic is tiny, already well-known inside the project, and a recent review packet already exists, you may skip this skill and continue with `/graph-build` or `/frontier-mapping`.

## Required Inputs

- `{PROJ}/researcher/LITERATURE.md`
- `{PROJ}/researcher/PAPER_SOURCE_INDEX.json`
- `{PROJ}/PROJECT_MANIFEST.json`
- optional `{PROJ}/researcher/RESEARCH_BRAINSTORM.md`
- optional `{PROJ}/graph/PAPERNEXUS_STATUS.json`

If the current corpus is still thin, ambiguous, or missing key baselines, first run `/research-lit` again. Do not fake a systematic review from a shallow paper pool.

## Output Packet

Write these files under `{PROJ}/researcher/`:

- `LITERATURE_REVIEW.md` — narrative review packet
- `REVIEW_PROTOCOL.md` — scope, inclusion, exclusion, and search notes
- `INCLUDED_PAPERS.json` — canonical included set
- `EXCLUDED_PAPERS.json` — screened-out papers with reasons
- `SOTA_MATRIX.md` — baseline / method / dataset / metric matrix
- `GAP_SYNTHESIS.md` — unresolved gaps, weak spots, contradictions, and innovation hooks
- `ZOTERO_PACKET.md` — Zotero `bot/<project-id>` sync note when local Zotero MCP is available

These files are intended to become durable upstream context for `/frontier-mapping`, `/idea-phase`, `/plan-research`, and later code / experiment review.

## Review Protocol

### 1. Define scope and screening rules

Write `{PROJ}/researcher/REVIEW_PROTOCOL.md` with:

- topic / question
- task and setting boundaries
- target baselines and benchmark families
- inclusion criteria
- exclusion criteria
- notes on search coverage and known blind spots

At minimum, the protocol must answer:

- which papers count as the closest prior work
- which papers are only peripheral inspiration
- which baselines must appear in later experiment design
- which datasets / metrics define the main comparison axis

### 2. Screen the current corpus

Start from `{PROJ}/researcher/PAPER_SOURCE_INDEX.json` and `{PROJ}/researcher/LITERATURE.md`.

For each candidate paper:

- decide `include`, `exclude`, or `background_only`
- record one concise reason
- preserve canonical identity (`canonical_id`, title, arXiv / DOI if available)

Write:

- `{PROJ}/researcher/INCLUDED_PAPERS.json`
- `{PROJ}/researcher/EXCLUDED_PAPERS.json`

Do not silently drop papers from the project memory. Screening decisions must stay durable.

If a local Zotero MCP connector is available:

- move included papers into `bot/<project-id>/included`
- move excluded papers into `bot/<project-id>/excluded`
- tag baseline-defining papers in `bot/<project-id>/baselines`
- refresh `{PROJ}/researcher/ZOTERO_PACKET.md`

### 3. Build the SoTA matrix

Write `{PROJ}/researcher/SOTA_MATRIX.md` with a structured table that covers:

- paper / baseline
- task / setting
- dataset
- primary metric
- reported strengths
- reported limitations
- relevance to this project

The matrix should make it obvious:

- what the real baselines are
- where the main metric pressure comes from
- which evaluation settings later code must stay compatible with
- where novelty claims are genuinely still open

### 4. Write the gap synthesis

Write `{PROJ}/researcher/GAP_SYNTHESIS.md` with:

- recurring limitations
- contradictions or unresolved findings
- under-tested settings or datasets
- places where the project could improve the main baseline metric
- candidate innovation hooks that remain compatible with the baseline setup

Every candidate hook should include:

- why the gap matters
- which baseline or prior method it is relative to
- one plausible validation path
- one likely failure mode

### 5. Refresh graph-grounded context

When the included set changes materially, hand the packet forward:

- use `/graph-build` to confirm automatic graph catch-up and refresh the brainstorm bundle
- use `/frontier-mapping` to turn the review packet into frontier items
- when you need typed multi-hop evidence bundles or a short graph-grounded survey brief, prefer `/papernexus-research-chains`

Do not treat this skill as a replacement for graph-grounded reasoning. It is the durable survey layer that makes later graph and ideation work sharper.

## Quality Bar

The review packet is not complete unless it clearly supports downstream decisions:

- Coder should be able to identify the true baseline family and eval protocol from `SOTA_MATRIX.md`
- Orchestrator should be able to trace each active track back to a real gap in `GAP_SYNTHESIS.md`
- Reviewer should be able to see which claims are backed by included papers and which are speculative

Avoid:

- generic prose without explicit inclusion / exclusion decisions
- a SoTA matrix that omits the strongest baselines
- novelty language that is not anchored in the included set
- mixing unrelated subfields into one fake comparison table

## Stage Closeout

When the review packet is complete:

- update `{PROJ}/PROJECT_MANIFEST.json.current_micro_stage` to reflect that the literature review packet is ready
- make sure `/graph-build` and `/frontier-mapping` read this packet next
- if a later stage discovers missing baselines or evaluation mismatches, return here and refresh the packet instead of patching ad hoc notes elsewhere
