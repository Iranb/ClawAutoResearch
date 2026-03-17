---
name: idea-generator
description: "Generate and run parallel pilot experiments on top-K research ideas. Outputs ranked candidates to IDEA_REPORT.md for idea-tournament. Use after literature survey."
argument-hint: "[research direction + landscape summary]"
allowed-tools:
  - Bash(*)
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - mcp__codex__codex
  - mcp__codex__codex-reply
---

# Idea Generator

Brainstorm → filter → generate parallel pilot code → hand off to `/idea-tournament`.

## Constants

- **N_BRAINSTORM = 10** — ideas to generate via MCP
- **N_SURVIVORS = 5** — kept after feasibility/novelty pre-filter
- **N_PILOT = 3** — ideas to pilot (limited by GPU slots)
- **PILOT_MAX_H = 2** — per-pilot GPU budget cap

## Step 1: Brainstorm (via MCP)

Load research context:
- `{PROJ}/researcher/LITERATURE.md` (from `/research-lit`)
- `{PMEM}/ideation-memory.md` (known failures + successful patterns)

`{PROJ}` = `{PROJECTS_ROOT}/{proj-id}`, `{PMEM}` = `{PROJ}/memory`

Call external LLM for broad brainstorming:

```
mcp__codex__codex:
  config: {"model_reasoning_effort": "xhigh"}
  prompt: |
    You are a creative ML researcher. Generate {N_BRAINSTORM} distinct research ideas
    based on the following literature landscape.

    [LITERATURE.md content]

    Known failed directions (DO NOT suggest similar ideas):
    [{PMEM}/ideation-memory.md — Failed Idea Catalog section]

    For each idea provide:
    1. Title (concise, specific)
    2. Core hypothesis (one sentence, falsifiable)
    3. Key novelty vs existing work (cite specific papers from landscape)
    4. Feasibility (1–5): compute/data requirements
    5. Expected impact (1–5): potential contribution
    6. Simplest pilot (< {PILOT_MAX_H}h GPU): what to run, what metric to check
    7. Failure mode: what would disprove this idea quickly

    Avoid incremental tweaks. Favor ideas that challenge assumptions.
```

## Step 2: Pre-filter

From the N_BRAINSTORM ideas, eliminate:
- feasibility < 3 (compute infeasible)
- Any idea substantially similar to `{PMEM}/ideation-memory.md` failed entries
- Duplicate hypotheses (keep the stronger framing)

Keep top N_SURVIVORS ranked by (0.4 × novelty + 0.4 × impact + 0.2 × feasibility).

## Step 3: Generate Pilot Configs

For each of the top N_PILOT ideas, produce a minimal pilot specification:

```
Idea: [title]
Pilot config:
  dataset: [smallest viable subset, e.g., 10% of full data]
  model: [same backbone as baseline for fair comparison]
  epochs: [1–3 epochs, or until first convergence signal]
  key_metric: [single metric that signals the hypothesis]
  success_signal: [concrete threshold, e.g., +0.5% over baseline]
  estimated_time: [N GPU-hours on A100]
  script: |
    python train.py --config pilot/idea{N}.yaml --seed 42 \
      --max_epochs 2 --data_fraction 0.1 \
      --output_dir results/pilot_idea{N}
```

Write pilot configs to `{PROJ}/researcher/pilots/idea{1,2,3}.yaml`.

## Step 4: Hand Off to Tournament

Write `{PROJ}/researcher/IDEA_REPORT.md` (pre-tournament, candidates only):

```markdown
# Idea Report — Candidates (Pre-Tournament)

**Generated**: YYYY-MM-DD
**Source direction**: [research direction]
**Total brainstormed**: {N_BRAINSTORM}
**Survivors after pre-filter**: {N_SURVIVORS}
**Queued for pilot**: {N_PILOT}

## Pilot Candidates

### Idea 1: [Title]
- **Hypothesis**: [one sentence]
- **Novelty vs**: [paper A], [paper B]
- **Feasibility**: 4/5
- **Impact**: 4/5
- **Pilot**: 2 epochs, 10% data → check [metric] > [baseline + threshold]
- **Failure mode**: [what would disprove it]

### Idea 2: [Title]
...

### Idea 3: [Title]
...

## Shortlisted (no pilot budget, review if pilots fail)
### Idea 4: [Title]
...
### Idea 5: [Title]
...

## Eliminated
| Idea | Reason |
|------|--------|
| [sketch] | feasibility 2/5 — requires 8xA100 for 2 weeks |
| [sketch] | Already done by [paper] |
```

Then call:
```
/idea-tournament
```

The tournament runs parallel pilots and produces the final ranked IDEA_REPORT.md with empirical signals.
