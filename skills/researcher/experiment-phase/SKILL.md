---
name: experiment-phase
description: "Orchestrate remote experiment execution across tracks and GPUs. Researcher owns scheduling and monitoring; atomic remote launch is delegated to Coder via /run-experiment."
argument-hint: "[experiment plan or empty to read from PLAN.md]"
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
  - lobster
---

# Experiment Phase

Orchestrate full experiment execution: classify dependencies → track-aware dispatch → assign atomic launches to Coder → monitor → decide → analyze.

In `reviewed_auto` mode, EXPERIMENT includes a pre-launch review loop before any remote run starts:

- `planning` — Planner refreshes `planner/EXPERIMENT_REVIEW_PACKET.json` and `planner/EXPERIMENT_PLAN.md`
- `analyzer_review` — Analyzer audits design reasonableness
- `cross_review` — Cross-Reviewer attacks novelty/confounds/falsifiers
- `synthesis` — Researcher records `researcher/EXPERIMENT_LAUNCH_DECISION.json`
- `launching` — Coder launches only from an approved packet
- `monitoring` — `/monitor-experiment` takes over once real runs exist

## Research Rigor Constraints

- Preserve **one variable per experiment** when building launch groups; if a run combines multiple hypothesis changes, split it or label it as non-attributable.
- **Baseline-first orchestration**: when a track still needs baseline alignment, prioritize the baseline-faithful comparison path before broad sweeps, extra seeds, or speculative repair branches.
- **Record everything** in the registry and ledger: hypothesis, bundle id, GPU assignment, status, failures, and follow-up decisions.
- Keep the **experiment and code change linked** by dispatching only named bundles with durable manifests and config references.
- **Verify before claiming** success: a launched run is not evidence until logs, outputs, and required checks are present.
- **Never manipulate evaluation** through opportunistic reruns, metric swaps, or selective stage advancement.
- **Never fabricate citations** in experiment notes, comparison summaries, or follow-up guidance.

## Prerequisites

1. `agents/researcher/SERVER.md` configured (SSH alias, uv project path, remote dirs)
2. `{PROJ}/orchestrator/PLAN.md` generated (stages with success criteria)
3. Code ready in `{PROJ}/coder/<experiment>/` (produced by coder sub-agent)
4. SSH passwordless login configured

`{PROJ}` = `{PROJECTS_ROOT}/{proj-id}`

## Resolve servers for this project

**Different directions or projects may use different servers.** Before choosing a host, resolve the current project's server config first:

1. If **`{PROJ}/servers.json`** exists (format: `{"default":"host","list":["host1","host2"]}`), this project uses only its `default` and `list`.
2. Otherwise use the global config from `~/.openclaw/openclaw-research.json` or the runtime default.

Below, `<server>` means a host chosen from the resolved `list` (defaulting to `default`; with multiple machines, choose from `list` by load or policy).

## Pipeline Overview

```
Classify Dependencies
        ↓
Build EXPERIMENT_REGISTRY.md
        ↓
Resource Check (nvidia-smi)
        ↓
Code Sync (rsync)
        ↓
Parallel Launch (Coder /run-experiment × N GPUs)    ← L1 parallelism
        ↓
Joint Monitoring (poll all screens)
        ↓
Auto-advance queued experiments
        ↓
Aggregate + Analyze
```

## Phase 1: Dependency Classification

Read `{PROJ}/orchestrator/PLAN.md`. For each experiment stage, classify:

**PARALLEL** (launch simultaneously):
- Baseline vs Proposed on same dataset (no dependency)
- Same method on different datasets
- Ablation variants that don't build on each other

**SEQUENTIAL** (must complete previous group first):
- Multiple seeds for same config (can be parallel within Group B after Group A validates)
- Hyperparameter sweep (each round informs the next)
- Ablations that depend on proposed method results

Read `{PROJ}/TRACK_REGISTRY.json` before dispatch:

- prioritize `active` tracks only
- do not spend GPU on `parked` / `killed` tracks
- if a track is still in pilot stage, run pilot before any full experiment

Write dispatch plan and initialize `{PROJ}/researcher/EXPERIMENT_REGISTRY.md`.
At the same time, create or update `{PROJ}/researcher/EXPERIMENT_LEDGER.json` via `research_workflow.upsert_experiment` for every queued experiment with at least:

- `experimentId`
- `trackId`
- `name`
- `kind` (`pilot` / `full` / `repair` / `ablation` / `baseline`)
- `status: "queued"`
- `stage: "queue_built"`
- `configRef`
- `hypothesis`
- `papernexusSync.status: "pending"` if this run may matter for later analysis

Then initialize `{PROJ}/researcher/EXPERIMENT_REGISTRY.md`:

```markdown
# Experiment Registry — [Project Title]

**Last updated**: YYYY-MM-DD HH:MM

## Active Experiments

| ID | Name | Group | GPU | Screen | Status | Started | ETA | Exit | Key Metric |
|----|------|-------|-----|--------|--------|---------|-----|------|------------|
| e001 | baseline_s42 | A | 0 | exp_base_42 | running | 20:00 | 22:00 | — | — |
| e002 | proposed_s42 | A | 1 | exp_prop_42 | running | 20:00 | 22:30 | — | — |
| e003 | ablation_noX | A | 2 | exp_abl_42 | running | 20:00 | 22:10 | — | — |

## Queued (awaiting Group A completion)

| ID | Name | Group | Depends On | Status |
|----|------|-------|-----------|--------|
| e004 | proposed_s123 | B | e002 | queued |
| e005 | proposed_s456 | B | e002 | queued |

## Completed

| ID | Name | Status | Exit | Key Metric | Duration |
|----|------|--------|------|------------|----------|
```

## Phase 2: Resource Check

```bash
ssh <server> "nvidia-smi --query-gpu=index,name,memory.used,memory.total,utilization.gpu --format=csv,noheader && echo '---' && free -h | head -2 && echo '---' && screen -ls 2>/dev/null || echo 'No screens'"
```

Parse GPU availability. If insufficient free GPUs for Group A:
- `AUTO_PROCEED=false`: present occupancy table, wait for user input
- `AUTO_PROCEED=true`: proceed with available GPUs, queue remainder

Do not default to a one-by-one serial plan when experiments are independent. In particular:

- same method across multiple datasets should be parallelized across free GPUs
- baseline vs proposed on the same dataset should be parallelized when memory permits
- multi-seed replicas should usually start after the first validating launch is healthy, unless the plan explicitly wants immediate parallel seeds

Before launch, build a simple resource-aware wave plan:

- wave 1: highest-priority independent bundles that safely fit current GPUs
- wave 2+: queued remainder
- mark heavy bundles separately so they do not block all lighter validations behind them

When baseline alignment is still uncertain, make wave 1 a **baseline alignment wave**:

- baseline
- the minimum directly comparable proposed run
- only then broader seeds / ablations / repair variants

## Phase 3: Code Sync

Code sync may happen in either of two ways:
- **preferred for one bundle / restart-safe relaunch**: let Coder `/run-experiment` sync its assigned bundle
- **preferred for many bundles sharing one codebase**: Researcher performs one shared rsync first, then Coder only launches

```bash
rsync -avz \
  --exclude='.git' --exclude='__pycache__' --exclude='*.pyc' \
  --exclude='wandb/' --exclude='checkpoints/' \
  <local_code_dir>/ <server>:<remote_dir>/
```

Install dependencies if new:
```bash
ssh <server> "cd <remote_dir> && UV_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple uv pip install -r requirements.txt -q 2>&1 | tail -5"
```

## Phase 4: Parallel Launch

Use `/parallel-experiments` for full parallel dispatch and monitoring. Actual per-bundle remote launch is delegated to the **Coder Agent** via `/run-experiment`:

```
/parallel-experiments "[project-id] — Group A"
```

This handles:
- Simultaneous dispatch of all Group A experiments
- Spawning / assigning Coder for each atomic `/run-experiment`
- Joint monitoring with exponential backoff
- Automatic Group B trigger when Group A completes
- Error recovery (OOM, stall, crash)

Coder may apply only bounded runtime fixes needed to keep the assigned runs alive, such as:

- lower batch size
- higher gradient accumulation
- fewer workers
- lower evaluation frequency

Coder may not silently change the scientific question, dataset, metric, or core model semantics.

In `reviewed_auto` mode, do not dispatch Coder until these artifacts are durable and aligned:

- `{PROJ}/planner/EXPERIMENT_REVIEW_PACKET.json`
- `{PROJ}/planner/EXPERIMENT_PLAN.md`
- `{PROJ}/researcher/EXPERIMENT_LAUNCH_DECISION.json` with `launch_approved: true`
- required analyzer / cross-reviewer reports

If the review loop returns `revise` or `block`, keep ownership with Researcher, revise the packet, and rerun review instead of launching anyway.

## Phase 5: Monitor Until Completion

Poll loop via `/monitor-experiment`:

```bash
# Status check for all screens
ssh <server> "screen -ls"

# Per-screen log check
ssh <server> "tail -10 <remote_dir>/logs/<screen_name>.log"
```

Update EXPERIMENT_REGISTRY.md on each poll.
Update `{PROJ}/researcher/EXPERIMENT_LEDGER.json` on each poll checkpoint as well:

- `status: running` when the remote screen is confirmed
- `status: done | failed | stalled | timeout` when the run ends
- `stage: launched | monitoring | results_synced | decision_made`
- `server`, `gpuId`, `screenName`, `launchedAt`, `completedAt`
- `keyMetric`, `metrics`, `resultPaths`, `evidencePointers`
- `failureSignature` if the run crashed or is not worth retrying

**Key events to watch for**:
- Screen exits: check EXIT_CODE in log
- NaN/Inf in training log: immediate kill + fix
- GPU utilization drops to 0% for 20min: stall detection
- Proposed or repair runs stay below baseline for a meaningful stretch: trigger a strategy review instead of passively consuming the full budget

### 5.5 Baseline-first monitoring decision loop

Keep one question active during EXPERIMENT:

`Are we still moving toward a fair baseline comparison, or are we spending GPU on a branch that is persistently under baseline?`

If a run keeps trailing baseline after enough real progress to be informative:

- update the ledger and registry with the under-baseline signal
- decide whether the likely cause is:
  - runtime / config instability
  - implementation drift away from baseline
  - a weak scientific delta
- prefer a bounded response:
  - ask Coder for a minimal runtime fix
  - pause or deprioritize lower-value follow-up runs on the same branch
  - switch to a closer-to-baseline repair experiment
  - route back for plan / strategy adjustment if the delta itself looks weak

This is a soft rule, not a universal hard threshold. The goal is to avoid inertial compute burn when the baseline comparison is clearly going the wrong way.

## Phase 6: Results Collection

When ALL experiments complete:

```bash
rsync -avz <server>:<remote_dir>/results/ {PROJ}/researcher/artifacts/results/
rsync -avz <server>:<remote_dir>/logs/ {PROJ}/researcher/artifacts/logs/
```

## Phase 6.5: Track Decision

After pilot or experiment completion, update `{PROJ}/TRACK_REGISTRY.json` with one of:

- `advance` — strong positive signal, merits more budget
- `merge` — overlaps heavily with a stronger track
- `park` — interesting but not currently budget-worthy
- `kill` — falsified or low-value

Also update `{PROJ}/PROJECT_MANIFEST.json`:
- `current_stage: "experiment"`
- `current_micro_stage: "track_decision_made"`
- `budget.gpu_hours_used`
- `experiment_memory.last_ledger_update_at`
- `experiment_memory.last_completed_experiment_id` / `last_failed_experiment_id`
- `experiment_memory.best_known_config_ref`
- `experiment_memory.papernexus_sync_status`
- `innovation_reflection.status` when new experiment evidence changes future ideation
- `updated_at`

If a PaperNexus corpus exists for the project, mark the relevant completed experiments with `papernexusSync.status: "pending"` until they are mirrored into the graph or enhancement overlay.

Once a completed or failed run materially changes the next-idea search space, treat the next ideation cycle as reflection-bound:

- the ledger update should make `PROJECT_MANIFEST.json.innovation_reflection.status` become `pending`
- the next serious idea proposal must refresh `/innovation-reflection`
- do not let Researcher overwrite `IDEA_REPORT.md` with a fresh innovation angle until the reflection packet has been regenerated

## Phase 7: Analysis

```
/analyze-results
```

Produces (written by Analyzer Agent to its own folder):
- `{PROJ}/analyzer/NARRATIVE_REPORT.md`
- `{PROJ}/analyzer/TRACK_VERDICTS.md`
- `{PROJ}/analyzer/figures/`
- `{PROJ}/analyzer/tables/`

## Memory Updates (ESE / IVE)

After phase completes, update project-isolated memory files (`{PMEM}` = `{PROJ}/memory`):

**If experiments succeeded** (proposed > baseline):
- Append to `{PMEM}/experiment-memory.md` under "Proven Experiment Strategies":
  - Config, hyperparams, training time, GPU type

**If experiments failed** (all variants < baseline):
- Append to `{PMEM}/ideation-memory.md` under "Failed Idea Catalog":
  - Method name, failure mode, do-not-retry condition

The markdown memories are summaries. `{PROJ}/researcher/EXPERIMENT_LEDGER.json` remains the authoritative run-by-run memory that restart and resume flows must trust first.

## Error Recovery

| Scenario | Detection | Action |
|----------|-----------|--------|
| Weak pilot on secondary track | improvement below planned threshold | Park or kill the track instead of escalating to full run |
| Screen died | Not in `screen -ls`, EXIT_CODE ≠ 0 | Read log, fix error, relaunch |
| CUDA OOM | `CUDA out of memory` in log | Halve batch_size, update config, relaunch |
| SSH timeout | Connection refused | Retry 3× with 30s backoff |
| All GPUs full | >80% utilization | Wait 30min, re-check |
| NaN loss | `nan` or `inf` in loss log | Add gradient clipping, reduce LR |
| Stalled | 0% GPU utilization 20min | Kill screen, relaunch with debug config |
| Dependency timeout | Group A not done after MAX_WAIT_H | Report to user, mark as partial |

## Stage Closeout

When experiment execution is durably reconciled and the track decision is to proceed into ANALYZE, Researcher should trigger the Lobster handoff workflow.

Do not hand off if more experiments or a bounded relaunch are still required, the right action is `restart-idea`, or artifacts / ledger state are still out of sync.
