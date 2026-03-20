---
name: plan-research
description: "Translate a confirmed research idea into a structured experiment plan (PLAN.md) and task list (TODOS.md). Use after idea-phase produces a confirmed IDEA_REPORT.md."
argument-hint: "[confirmed track title or path to IDEA_REPORT.md]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
---

# Plan Research

Produce a concrete, sequenced, track-aware experiment plan from a confirmed idea report.

> **File ownership**: Write ONLY to `{PROJ}/orchestrator/`. Read from `{PROJ}/researcher/`.
> `{PROJ}` = `{PROJECTS_ROOT}/{proj-id}`

## Input

Read `{PROJ}/researcher/IDEA_REPORT.md` to understand:
- The confirmed hypothesis
- Pilot experiment results (if any)
- Novelty claims and closest baselines
- The graph-backed innovation evidence packet for each surviving track

Read `{PROJ}/TRACK_REGISTRY.json` to understand:
- which tracks are `active`
- which track is the current leading narrative
- which tracks are parked / merged / killed and therefore out of scope

Also read graph-grounding artifacts when present:
- `{PROJ}/researcher/FRONTIER_REPORT.md`
- `{PROJ}/graph/subgraphs/`

## Steps

### 1. Extract Experiment Requirements

From the idea report and active tracks, identify:
- **Method**: What exactly is being proposed?
- **Baselines**: Which existing methods must be compared against?
- **Datasets**: What data is required?
- **Metrics**: How will we measure success?
- **Ablations**: What components need isolated evaluation?
- **Track decision rules**: what would advance / park / kill each active track

Before writing the plan, perform one explicit innovation-construction pass:
- convert each active track's graph evidence into a bounded hypothesis package
- preserve anchor nodes, relation patterns, closest prior work, why-now, weakest assumption, and falsifier pilot
- narrow vague ideas into executable deltas instead of rewriting the idea from scratch

### 2. Estimate Compute

For each active track and experiment stage, estimate:
- GPU memory required (determines batch size feasibility)
- Training time per seed (hours)
- Number of seeds (minimum 3)
- Total GPU-hours

If total > 50 GPU-hours, flag and suggest prioritization.

### 3. Write PLAN.md

Write `{PROJ}/orchestrator/PLAN.md` using the structure defined in `AGENTS.md`:
- Goal, Hypotheses, Experiment Stages table
- Track Portfolio section
- Baselines and Ablations
- Compute Budget
- Fallback Plan

Additional required sections:
- Per-track plan section (`track_id`, hypothesis, baselines, pilot/full path)
- Per-track graph evidence section (`anchor nodes`, `relation patterns`, `closest prior work`, `innovation delta`)
- Per-track stop / rollback / kill rules
- Scope narrowing rule if multiple tracks survive but budget is tight

### 4. Write TODOS.md

Write `{PROJ}/orchestrator/TODOS.md` with:
- Stage 1: Implement baseline(s) per active track — assign: coder
- Stage 2: Implement proposed method / variant per active track — assign: coder
- Stage 3: Deploy and run experiments — assign: researcher
- Stage 4: Analyze results + track verdicts — assign: analyzer
- Stage 5: Internal review / scope decision — assign: reviewer
- Stage 6: Write paper — assign: academic_writer

Each task must have:
- Clear description (what done = task complete)
- Assigned agent
- Dependencies (what must complete first)

### 5. Output Summary

Return to Researcher Agent:

```
## Plan Ready
- **PLAN.md**: {PROJ}/orchestrator/PLAN.md
- **TODOS.md**: {PROJ}/orchestrator/TODOS.md
- **Stages**: N stages
- **Estimated compute**: ~X GPU-hours total
- **First task**: [description] — assigned: coder
- **Risks**: [any flagged concerns]
```

## Rules

- Do not start any experiment — planning only
- Do not write to any folder outside `{PROJ}/orchestrator/`
- Do not modify `{PROJ}/researcher/IDEA_REPORT.md`
- If compute estimate is unfeasible, propose a scaled-down version
- Every stage must have a measurable success criterion
- Prefer 1–2 strong active tracks over an over-expanded portfolio
- Preserve graph-backed novelty rationale; do not silently drop it during planning
