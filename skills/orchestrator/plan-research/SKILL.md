---
name: plan-research
description: "Translate a confirmed research idea into a structured experiment plan (PLAN.md), task list (TODOS.md), and plan audit (PLAN_AUDIT.md). Use after idea-phase produces a confirmed IDEA_REPORT.md."
argument-hint: "[confirmed track title or path to IDEA_REPORT.md]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - lobster
---

# Plan Research

Produce a concrete, sequenced, track-aware experiment plan from a confirmed idea report.

> **File ownership**: Write ONLY to `{PROJ}/orchestrator/`. Read from `{PROJ}/researcher/`.
> `{PROJ}` = `{PROJECTS_ROOT}/{proj-id}`

## Research Rigor Constraints

- Enforce **one variable per experiment** in the plan. If two ideas both matter, split them into separate stages, ablations, or tracks.
- **Record everything** in `PLAN.md`, `TODOS.md`, and `PLAN_AUDIT.md`, including expected code touchpoints, baselines, rollback rules, and decision gates.
- Every active track must stay **baseline-grounded**: the plan must name the baseline reference, primary baseline metric, target improvement, preserved training protocol, preserved eval protocol, innovation points, validation ladder, and ablation ladder.
- Keep the **experiment change and code change linked**: each planned experiment should map to a concrete bundle, config family, or implementation delta.
- **Verify before claiming**: do not mark a plan ready unless the required evidence, audit, and completion signals are named explicitly.
- **Never manipulate evaluation**: metrics, datasets, baselines, and minimum decision scale are protected constraints unless a documented override is approved.
- **Never fabricate citations** or prior-work positioning in the plan; verify source details before building strategy around them.

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

When available, also read:
- `{PROJ}/analyzer/THEORY_SUPPORT_NOTE.md`
- `research_workflow.get_writing_contract` to inspect proof-writing / appendix expectations

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
- **Theory opportunities**: what repeatable mechanisms, invariances, monotonicities, or convergence patterns might support a lightweight theorem / lemma narrative

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
- Per-track baseline contract section (`baseline_reference`, `primary_baseline_metric`, `target_improvement`, `baseline_training_protocol`, `baseline_eval_protocol`)
- Per-track innovation validation ladder (`innovation_points`, `validation_steps`, `ablation_plan`, `allowed_deviations`)
- Scope narrowing rule if multiple tracks survive but budget is tight

Add one explicit **Theory / Proof Appendix Plan** section:
- candidate lemma / proposition list grounded in actually feasible results
- which statements are safe for main text as concise theorem / lemma claims
- which derivations must be deferred to appendix
- what assumptions are empirical, heuristic, or only partially justified
- what extra experiments or diagnostics would raise confidence in the derivation

### 4. Write TODOS.md

Write `{PROJ}/orchestrator/TODOS.md` with:
- Stage 1: Implement baseline(s) per active track — assign: coder
- Stage 2: Implement proposed method / variant per active track — assign: coder
- Stage 3: Deploy and run experiments — assign: researcher
- Stage 4: Analyze results + track verdicts — assign: analyzer
- Stage 5: Internal review / scope decision — assign: reviewer
- Stage 6: Draft proof appendix packet from feasible results / theory note — assign: academic_writer
- Stage 7: Write paper — assign: academic_writer

Each task must have:
- Clear description (what done = task complete)
- Assigned agent
- Dependencies (what must complete first)

### 5. Write PLAN_AUDIT.md

Write `{PROJ}/orchestrator/PLAN_AUDIT.md` using `PLAN_AUDIT_TEMPLATE.md` in this skill directory.

The audit must explicitly answer:
- whether every active track has required baselines, datasets, metrics, and ablations
- whether every active track has a baseline-preserving training/eval contract and an incremental validation ladder for each innovation point
- whether seed policy, compute budget, and rollback / kill rules are actually documented
- whether leakage / contamination risks were checked
- whether theory / appendix expectations are reflected conservatively
- whether the plan is truly ready to hand off to CODE or still needs revision

If any critical blocker remains, mark:
- `Verdict: NEEDS_REVISION`
- `Ready to hand off to CODE: no`

Only mark the audit ready when:
- `PLAN.md` and `TODOS.md` are complete
- no required baseline / artifact / dependency is still missing
- the active track scope is bounded enough for implementation

### 6. Output Summary

Return to Researcher Agent:

```
## Plan Ready
- **PLAN.md**: {PROJ}/orchestrator/PLAN.md
- **TODOS.md**: {PROJ}/orchestrator/TODOS.md
- **PLAN_AUDIT.md**: {PROJ}/orchestrator/PLAN_AUDIT.md
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

## Stage Closeout

Do not consider PLAN complete until all of the following are true:
- `{PROJ}/orchestrator/PLAN.md` exists and is non-empty
- `{PROJ}/orchestrator/TODOS.md` exists and is non-empty
- `{PROJ}/orchestrator/PLAN_AUDIT.md` exists and is non-empty
- `PLAN_AUDIT.md` says `Verdict: READY_FOR_CODE`
- `PLAN_AUDIT.md` says `Ready to hand off to CODE: yes`

When those conditions are satisfied, invoke the Lobster handoff workflow described in `{PLUGIN_ROOT}/lobster/QUICKSTART.md`.

Do not hand off if the plan is still being revised, narrowed, or re-audited.
