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
  - research_workflow
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
- `{PROJ}/researcher/EXPERIMENT_LEDGER.json` if exists
- `{PROJ}/researcher/EXPERIMENT_REGISTRY.md` if exists
- `{PROJ}/orchestrator/TODOS.md` if exists

## Reconciliation Order

0. If `research_workflow` is available, call `research_workflow` with action `auto_iterator_tick` and `iterator.mode = "resume"` before manual reconciliation. Treat the returned `stageAfter`, `ownerAfter`, and `blockingReason` as the durable starting point for this resume pass.
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
5. Reconcile idle-research state:
   - read `PROJECT_MANIFEST.json.idle_research` or call `research_workflow.get_idle_research`
   - if `idle_research.enabled = true`, confirm whether `last_digest_path` exists and whether the next round is due
   - if the round is due and the critical path is blocked on another agent or a human gate, schedule `/idle-research` before drifting into generic literature work
   - if the cooldown has not expired, do not rerun the idle-research round early
6. Reconcile innovation-reflection state:
   - call `research_workflow.get_innovation_reflection` or inspect `PROJECT_MANIFEST.json.innovation_reflection`
   - if `due = true` and the next action involves ideation, re-planning, or track rewriting, schedule `/innovation-reflection` before `/idea-phase` or any direct write to `IDEA_REPORT.md`
   - if `due = false`, reuse the latest `researcher/INNOVATION_REFLECTION.md` as the current experiment-informed ideation memory
7. If current stage is `CODE` and planning artifacts are missing, wake Orchestrator and wait for both files.
8. If current stage is `EXPERIMENT`:
   - check remote screens
   - reconcile against `EXPERIMENT_LEDGER.json` first, then `EXPERIMENT_REGISTRY.md`
   - if launches are missing but code bundles are ready, assign Coder `/run-experiment`
   - if runs are complete, sync artifacts, upsert the final experiment ledger entries, mirror the summary into `PROJECT_MANIFEST.json.experiment_memory`, and only then advance to `ANALYZE`
9. If current stage is `ANALYZE`, `REVIEW`, or `WRITE`, wake the owning agent's `/resume-pipeline`.
10. Update `PROJECT_MANIFEST.json` and `PROJECTS_STATE.json` with `updated_at`, `current_stage`, `current_micro_stage`, and `next_action`.

## Safety Rules

- Never start a new stage until the recorded current stage is reconciled with on-disk artifacts.
- Never relaunch an experiment if remote `screen`, logs, or `REMOTE_RUN.json` show it is already active.
- Never trust remembered experiment history over `{PROJ}/researcher/EXPERIMENT_LEDGER.json`; ledger beats chat memory.
- Do not rerun `/idle-research` inside the cooldown window unless the user explicitly overrides it.
- When an idle-research round runs, record it through `research_workflow.record_idle_research_run`; the digest path and runtime state beat chat memory.
- Do not resume or rewrite ideation outputs when `innovation_reflection` is due; refresh `/innovation-reflection` first.
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
