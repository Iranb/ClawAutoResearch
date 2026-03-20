---
name: idea-generator
description: "Generate and run parallel pilot experiments on top-K research ideas. Outputs ranked candidates to IDEA_REPORT.md for idea-tournament. Use after literature survey and frontier mapping."
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

Brainstorm → filter → create typed tracks → generate parallel pilot code → hand off to `/idea-tournament`.

## Constants

- **N_BRAINSTORM = 8** — tracks to generate via MCP
- **N_SURVIVORS = 4** — kept after feasibility/novelty pre-filter
- **N_PILOT = 3** — tracks to pilot (limited by GPU slots)
- **PILOT_MAX_H = 2** — per-pilot GPU budget cap

## Step 1: Brainstorm (via MCP)

Load research context:
- `{PROJ}/researcher/LITERATURE.md` (from `/research-lit`)
- `{PROJ}/researcher/FRONTIER_REPORT.md` (from `/frontier-mapping`)
- `{PROJ}/graph/subgraphs/` (anchor snapshots from `/frontier-mapping`)
- `{PMEM}/ideation-memory.md` (known failures + successful patterns)

`{PROJ}` = `{PROJECTS_ROOT}/{proj-id}`, `{PMEM}` = `{PROJ}/memory`

Call external LLM for broad brainstorming:

```
mcp__codex__codex:
  config: {"model_reasoning_effort": "xhigh"}
  prompt: |
    You are a creative ML researcher. Generate {N_BRAINSTORM} distinct research ideas
    based on the following literature landscape and graph-grounded frontier report.

    [LITERATURE.md content]

    Graph frontier signals:
    [FRONTIER_REPORT.md content]

    Graph subgraph snapshots / anchors:
    [{PROJ}/graph/subgraphs/*.md content or compact summary]

    Known failed directions (DO NOT suggest similar ideas):
    [{PMEM}/ideation-memory.md — Failed Idea Catalog section]

    For each track provide:
    1. Track ID (short, stable)
    2. Title (concise, specific)
    3. Core hypothesis (one sentence, falsifiable)
    4. Key novelty vs existing work (cite specific papers from landscape)
    5. Feasibility (1–5): compute/data requirements
    6. Expected impact (1–5): potential contribution
    7. Simplest pilot (< {PILOT_MAX_H}h GPU): what to run, what metric to check
    8. Failure mode: what would disprove this track quickly
    9. Frontier lens: limitation / contradiction / transfer / composition
    10. Graph anchors: the concrete problems / methods / limitations this track connects
    11. Relation pattern: which graph relation pattern exposed the opportunity
    12. Why-now: why this graph gap matters now
    13. Weakest assumption: what assumption is doing the most work
    14. Portfolio role: safe-bet / high-upside / bridge

    Avoid incremental tweaks. Favor ideas that challenge assumptions.
```

## Step 2: Pre-filter

From the N_BRAINSTORM tracks, eliminate:
- feasibility < 3 (compute infeasible)
- Any idea substantially similar to `{PMEM}/ideation-memory.md` failed entries
- Duplicate hypotheses (keep the stronger framing)
- Rephrasings of an existing track already visible in `{PROJ}/TRACK_REGISTRY.json` or graph anchors (merge or kill them)

Keep top N_SURVIVORS ranked by (0.35 × novelty + 0.25 × impact + 0.2 × feasibility + 0.2 × graph_support).

## Step 3: Generate Pilot Configs

For each of the top N_PILOT tracks, produce a minimal pilot specification:

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

Write pilot configs to `{PROJ}/researcher/pilots/track_{1,2,3}.yaml`.

## Step 4: Hand Off to Tournament

Write `{PROJ}/TRACK_REGISTRY.json` with candidate tracks and their initial metadata:

```json
{
  "project_id": "proj_xxx",
  "updated_at": "ISO-TS",
  "selection_policy": {
    "max_active_tracks": 2,
    "max_parked_tracks": 1
  },
  "tracks": [
    {
      "track_id": "track_lim_a",
      "title": "Example title",
      "lens": "limitation",
      "status": "candidate",
      "stage": "idea",
      "hypothesis": "one sentence",
      "portfolio_role": "safe-bet",
      "novelty_status": "unchecked",
      "evidence_status": "graph-grounded",
      "linked_graph_nodes": ["problem:x", "limitation:y"],
      "relation_patterns": ["HAS_LIMITATION", "MAY_BE_ADDRESSED_BY"],
      "why_now": "why this gap matters",
      "weakest_assumption": "what assumption is carrying the track",
      "falsification_test": "what would fail quickly",
      "compute_budget_gpu_h": 2,
      "last_decision": "generated"
    }
  ]
}
```

Write `{PROJ}/researcher/IDEA_REPORT.md` (pre-tournament, candidates only):

```markdown
# Idea Report — Candidates (Pre-Tournament)

**Generated**: YYYY-MM-DD
**Source direction**: [research direction]
**Total brainstormed**: {N_BRAINSTORM}
**Survivors after pre-filter**: {N_SURVIVORS}
**Queued for pilot**: {N_PILOT}

## Pilot Candidates

### Track 1: [Title]
- **Track ID**: [track_lim_a]
- **Hypothesis**: [one sentence]
- **Frontier lens**: [limitation / contradiction / transfer / composition]
- **Portfolio role**: [safe-bet / high-upside / bridge]
- **Novelty vs**: [paper A], [paper B]
- **Feasibility**: 4/5
- **Impact**: 4/5
- **Pilot**: 2 epochs, 10% data → check [metric] > [baseline + threshold]
- **Failure mode**: [what would disprove it]
- **Relation pattern**: [HAS_LIMITATION + MAY_BE_ADDRESSED_BY / CONTRADICTS / ...]
- **Why now**: [why this frontier matters now]
- **Weakest assumption**: [what could break the track]

### Track 2: [Title]
...

### Track 3: [Title]
...

## Shortlisted (no pilot budget, review if pilots fail)
### Track 4: [Title]
...
### Track 5: [Title]
...

## Eliminated
| Track | Reason |
|-------|--------|
| [sketch] | feasibility 2/5 — requires 8xA100 for 2 weeks |
| [sketch] | Already done by [paper] |
```

Then call:
```
/idea-tournament
```

The tournament runs parallel pilots and produces the final ranked IDEA_REPORT.md with empirical signals.

Do not drop graph evidence after pilots: the surviving tracks must keep their anchor nodes, relation patterns, why-now note, and weakest assumption in `{PROJ}/TRACK_REGISTRY.json`.
