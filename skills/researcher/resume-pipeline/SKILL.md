---
name: resume-pipeline
description: "Restart-safe recovery entrypoint for Researcher. Reconcile durable state, remote experiment reality, and per-agent outputs before continuing the research pipeline."
argument-hint: "[project id or empty to infer current active project]"
allowed-tools:
  - Bash(*)
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - Agent
  - Skill
---

# Resume Pipeline

Researcher-owned restart entrypoint. Use after session loss, gateway restart, or any time the pipeline state may have drifted from reality.

## Read First

- `{PROJECTS_ROOT}/PROJECTS_STATE.json`
- `{PROJ}/PROJECT_MANIFEST.json`
- `{PROJ}/TRACK_REGISTRY.json`
- `{PROJ}/CLAIM_POLICY.md`
- `{PROJ}/researcher/PAPER_SOURCE_INDEX.json` if exists
- `{PROJ}/researcher/GATE_STATE.json` if exists
- `{PROJ}/researcher/REVIEW_STATE.json` if exists
- `{PROJ}/researcher/EXPERIMENT_REGISTRY.md` if exists
- `{PROJ}/orchestrator/TODOS.md` if exists

## Reconciliation Order

1. Resolve the project to resume from `PROJECTS_STATE.json`, explicit argument, or the newest active project.
2. Read `PROJECT_MANIFEST.json` and `GATE_STATE.json`; treat them as the top-level stage source of truth.
3. Validate required artifacts for the recorded stage:
   - `plan/code` → `orchestrator/PLAN.md`, `orchestrator/TODOS.md`
   - `experiment` → `researcher/EXPERIMENT_REGISTRY.md`, `coder/*/REMOTE_RUN.json`, remote `screen -ls`
   - `analyze` → `researcher/artifacts/results/`
   - `review` → `researcher/REVIEW_STATE.json`, `reviewer/AUTO_REVIEW.md`
   - `write` → `academic_writer/PAPER_PLAN.md`, `paper/sections/`
4. Reconcile literature source state:
   - read `paper_source_dir`, `graph_last_built_at`, and `paper_ingestion.*` from `PROJECT_MANIFEST.json`
   - inspect `{PROJ}/researcher/PAPER_SOURCE_INDEX.json` if present
   - count canonical papers added or changed since `paper_ingestion.last_graph_sync_at` or `graph_last_built_at`
   - if the project uses frequent paper ingestion, verify whether `papernexus watch` is active for this corpus; if not, restart or recommend restarting it
   - if `paper_ingestion.refresh_required = true`, schedule `/graph-build --force` before the next ideation / novelty / revision decision
5. If current stage is `CODE` and planning artifacts are missing, wake Orchestrator and wait for both files.
6. If current stage is `EXPERIMENT`:
   - check remote screens
   - reconcile against `EXPERIMENT_REGISTRY.md`
   - if launches are missing but code bundles are ready, assign Coder `/run-experiment`
   - if runs are complete, sync artifacts and advance to `ANALYZE`
7. If current stage is `ANALYZE`, `REVIEW`, or `WRITE`, wake the owning agent's `/resume-pipeline`.
8. Update `PROJECT_MANIFEST.json` and `PROJECTS_STATE.json` with `updated_at`, `current_stage`, `current_micro_stage`, and `next_action`.

## Safety Rules

- Never start a new stage until the recorded current stage is reconciled with on-disk artifacts.
- Never relaunch an experiment if remote `screen`, logs, or `REMOTE_RUN.json` show it is already active.
- If gate status is `waiting` and `AUTO_PROCEED=false`, re-post the gate and stop.
- Do not trigger a graph refresh from duplicate-only paper downloads; use canonical paper counts and refresh rules, not raw file counts.
- If `papernexus watch` is enabled, prefer resuming the watcher instead of repeatedly forcing full rebuilds.

## Output

Return:

```markdown
## Resume Status
- **Project**: {proj-id}
- **Stage reconciled**: {current_stage} / {current_micro_stage}
- **Reality check**: [matched / drift fixed / blocked]
- **Next action**: [exact next step]
- **Agents woken**: [list or none]
```
