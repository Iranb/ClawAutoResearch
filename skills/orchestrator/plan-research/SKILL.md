---
name: plan-research
description: "Translate a confirmed research idea into a structured experiment plan (PLAN.md) and task list (TODOS.md). Use after idea-phase produces a confirmed IDEA_REPORT.md."
argument-hint: "[confirmed idea title or path to IDEA_REPORT.md]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
---

# Plan Research

Produce a concrete, sequenced experiment plan from a confirmed idea report.

> **File ownership**: Write ONLY to `{PROJ}/orchestrator/`. Read from `{PROJ}/researcher/`.
> `{PROJ}` = `{PROJECTS_ROOT}/{proj-id}`

## Input

Read `{PROJ}/researcher/IDEA_REPORT.md` to understand:
- The confirmed hypothesis
- Pilot experiment results (if any)
- Novelty claims and closest baselines

## Steps

### 1. Extract Experiment Requirements

From the idea report, identify:
- **Method**: What exactly is being proposed?
- **Baselines**: Which existing methods must be compared against?
- **Datasets**: What data is required?
- **Metrics**: How will we measure success?
- **Ablations**: What components need isolated evaluation?

### 2. Estimate Compute

For each experiment stage, estimate:
- GPU memory required (determines batch size feasibility)
- Training time per seed (hours)
- Number of seeds (minimum 3)
- Total GPU-hours

If total > 50 GPU-hours, flag and suggest prioritization.

### 3. Write PLAN.md

Write `{PROJ}/orchestrator/PLAN.md` using the structure defined in `AGENTS.md`:
- Goal, Hypotheses, Experiment Stages table
- Baselines and Ablations
- Compute Budget
- Fallback Plan

### 4. Write TODOS.md

Write `{PROJ}/orchestrator/TODOS.md` with:
- Stage 1: Implement baseline(s) — assign: coder
- Stage 2: Implement proposed method — assign: coder
- Stage 3: Deploy and run experiments — assign: researcher
- Stage 4: Analyze results — assign: analyzer
- Stage 5: Write paper — assign: academic_writer

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
