---
name: parallel-experiments
description: "Dispatch multiple independent experiments to different GPUs simultaneously. Researcher owns scheduling and monitoring; atomic remote launch is delegated to Coder via /run-experiment."
argument-hint: "[experiment group name, or 'all' to dispatch all pending from EXPERIMENT_REGISTRY.md]"
allowed-tools:
  - Bash(*)
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - research_workflow
---

# Parallel Experiments

L1 parallelism: schedule multiple independent experiments (seeds, ablations, baselines vs proposed) across available GPUs, then assign each atomic launch to Coder.

## Research Rigor Constraints

- Preserve **one variable per experiment** even in parallel mode: independence and attribution matter more than GPU saturation.
- **Record everything** in the registry, ledger, and parallel-state files, including queue decisions and failure handling.
- Keep the **experiment and code change linked** by dispatching only named bundles with clear config and hypothesis references.
- **Verify before claiming** that a parallel batch is informative; pilots, validation runs, and full evaluations must stay distinct.
- **Never manipulate evaluation** by promoting the best-looking run while hiding the rest of the batch.
- **Never fabricate citations** in dispatch notes or experiment summaries.

## Constants

- **MAX_PARALLEL = 4** — max simultaneous experiments (GPU count is the real limit)
- **MAX_WAIT_H = 12** — max total wall-clock hours before declaring timeout
- **SEED_LIST = [42, 123, 456]** — default seeds for all experiments
- **PRIORITY**: baselines first (needed for comparison), then proposed variants

## Resolve servers for this project

**Different directions or projects may use different servers.** Before choosing a host, resolve the current project's server config first:

1. If **`{PROJ}/servers.json`** exists (format: `{"default":"host","list":["host1","host2"]}`), this project uses only its `default` and `list`.
2. Otherwise use the global config from `~/.openclaw/openclaw-research.json` or the runtime default.

Below, `<server>` means a host chosen from the resolved `list`.

## Decision: What to Parallelize

> **File ownership**: Write ONLY to `{PROJ}/researcher/`, `{PROJ}/PROJECT_MANIFEST.json`, and `{PROJ}/TRACK_REGISTRY.json`. `{PROJ}` = `{PROJECTS_ROOT}/{proj-id}`

Read `{PROJ}/orchestrator/PLAN.md` and classify each experiment:

**PARALLELIZE** (independent results):
- Method A vs Method B vs Method C on same dataset → one GPU per method
- Same method on Dataset X, Y, Z → one GPU per dataset
- Baseline vs Proposed (no hyperparameter dependency) → parallel

**SEQUENTIAL** (results depend on previous):
- Hyperparameter tuning (each round uses previous result)
- Debug → fix → re-run (must observe before proceeding)
- Ablation that builds on proposed method (need proposed results first)

Read `{PROJ}/TRACK_REGISTRY.json` and apply:
- active tracks may consume GPU
- parked / killed tracks may not
- if two active tracks compete for the same GPU budget, higher-evidence track wins

## Phase 1: Build Experiment Queue

Read `{PROJ}/orchestrator/PLAN.md` stages. For each independent group:

```markdown
## Experiment Dispatch Plan

### Group A — Parallel (launch simultaneously)
| Slot | Name | Config | GPU | Screen | Seeds |
|------|------|--------|-----|--------|-------|
| 1 | baseline | configs/baseline.yaml | 0 | exp_baseline_s42 | 42 |
| 2 | proposed | configs/proposed.yaml | 1 | exp_proposed_s42 | 42 |
| 3 | ablation_noX | configs/ablation_noX.yaml | 2 | exp_ablation_noX | 42 |

### Group B — After Group A (depends on proposed results)
| Slot | Name | Config | GPU | Screen | Seeds |
|------|------|--------|-----|--------|-------|
| 1 | proposed_seed2 | configs/proposed.yaml | any | exp_proposed_s123 | 123 |
| 2 | proposed_seed3 | configs/proposed.yaml | any | exp_proposed_s456 | 456 |
```

Write initial `{PROJ}/researcher/EXPERIMENT_REGISTRY.md`:

```markdown
# Experiment Registry

**Project**: [title]
**Last updated**: YYYY-MM-DD HH:MM

| ID | Name | GPU | Screen | Status | Started | ETA | Metric | Notes |
|----|------|-----|--------|--------|---------|-----|--------|-------|
| e001 | baseline_s42 | 0 | exp_baseline_s42 | pending | — | — | — | |
| e002 | proposed_s42 | 1 | exp_proposed_s42 | pending | — | — | — | |
| e003 | ablation_noX | 2 | exp_ablation_noX | pending | — | — | — | |
| e004 | proposed_s123 | — | — | queued | — | — | — | after e002 |
| e005 | proposed_s456 | — | — | queued | — | — | — | after e002 |
```

For each queued row, also upsert `{PROJ}/researcher/EXPERIMENT_LEDGER.json` with `status: "queued"` and `stage: "queue_built"`. Keep the markdown registry as the operator dashboard and the JSON ledger as the restart-safe memory.

Write `{PROJ}/researcher/PARALLEL_STATE.json`:
```json
{
  "group": "A",
  "status": "dispatching",
  "active_screens": [],
  "completed": [],
  "failed": [],
  "started_at": "ISO-TS",
  "timeout_at": "ISO-TS + MAX_WAIT_H"
}
```

## Phase 2: Resource Check & Allocation

```bash
ssh <server> "nvidia-smi --query-gpu=index,name,memory.used,memory.total,utilization.gpu --format=csv,noheader"
```

Parse output, identify free GPUs (utilization < 10% AND memory.used/memory.total < 0.2).

Before assigning GPUs, classify each bundle into a rough resource tier:

- **light**: pilot / small split / cheap ablation
- **medium**: standard single-dataset full run
- **heavy**: large model, high resolution, or historically OOM-prone config

Allocation rules:

- if five datasets are independent and five GPUs are safely free, launch all five together
- if only two GPUs are safely free, launch the top-priority two and queue the other three
- baseline vs proposed on the same dataset should stay in the same wave when comparison latency matters
- different datasets should not be serialized by default when there is safe free capacity
- multi-seed replicas should normally wait until the first seed of that config starts cleanly, unless the plan explicitly requests immediate parallel seeds

If insufficient free GPUs:
- Report current occupancy: "GPU 0: exp_X (running), GPU 1: free, GPU 2: free"
- Ask user to confirm proceeding with available GPUs or wait
- `AUTO_PROCEED=true`: proceed with available GPUs, queue remainder

Safe runtime tuning policy for Coder:
- allow bounded fixes such as smaller batch size, higher gradient accumulation, fewer workers, and lower eval frequency
- do not let Coder change dataset choice, experiment semantics, or hypothesis just to make the queue fit
- record every launch-time adjustment in the registry and ledger

## Phase 3: Code Sync (once, shared)

Choose one:
- shared rsync upfront by Researcher for a whole group
- per-bundle sync inside Coder `/run-experiment` for better restart safety

```bash
rsync -avz \
  --exclude='.git' --exclude='__pycache__' --exclude='*.pyc' \
  --exclude='wandb/' --exclude='checkpoints/' \
  <local_code_dir>/ <server>:<remote_code_dir>/
```

Install dependencies once:
```bash
ssh <server> "cd <remote_code_dir> && UV_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple uv pip install -r requirements.txt -q"
```

## Phase 4: Parallel Launch (Group A)

Assign ALL Group A experiments simultaneously:

```text
for each pending experiment in Group A:
  spawn / assign Coder:
    /run-experiment "<experiment-name> --config <config> --seed <seed> --gpu <gpu_id>"
```

Each Coder assignment should also include:
- the current GPU allocation table
- which bundles may run in parallel now
- which bundles must stay queued
- the allowed bounded runtime adjustments

Coder returns launch metadata including:
- `server`
- `screen_name`
- `gpu_id`
- `REMOTE_RUN.json` path
- initial log tail

Update EXPERIMENT_REGISTRY.md: set Status=running, Started=now, ETA=now+estimated_h.
Update `{PROJ}/researcher/EXPERIMENT_LEDGER.json`: set `status: "running"`, `stage: "launched"`, and store the launch metadata.
Update PARALLEL_STATE.json: set active_screens=[list].

## Phase 5: Joint Monitoring

Monitor all running experiments together:

```bash
# Check completion status for all screens
ssh <server> "
for s in exp_baseline_s42 exp_proposed_s42 exp_ablation_noX; do
  if screen -ls | grep -q \$s; then
    echo '\$s: RUNNING'
    tail -3 logs/\$s.log
  else
    code=\$(grep 'EXIT_CODE=' logs/\$s.log | tail -1 | cut -d= -f2)
    echo '\$s: DONE (exit=\$code)'
  fi
  echo '---'
done"
```

Polling schedule: 2min → 5min → 10min → 15min (exponential backoff up to 15min).

**Stalled experiment detection**: If log has no new lines for 30min and process is still running:
- Check GPU utilization: `nvidia-smi -i <gpu_id> --query-gpu=utilization.gpu --format=csv,noheader`
- If utilization = 0% for 30min → likely stalled → kill and requeue

**On individual completion**: Update EXPERIMENT_REGISTRY.md row to status=done/failed.
Also upsert the corresponding ledger entry with final metrics, result pointers, and `papernexusSync.status`.

**Trigger Group B** when all Group A dependencies complete:
- Check EXPERIMENT_REGISTRY.md: if all Group A rows = done → launch Group B

## Phase 6: Aggregate Results

When ALL experiments complete (or final timeout):

```bash
# Pull all results
rsync -avz <server>:<remote_dir>/results/ research/artifacts/results/
rsync -avz <server>:<remote_dir>/logs/ research/artifacts/logs/
```

Build summary:
```markdown
## Parallel Experiment Summary — [timestamp]

| Experiment | Status | Key Metric | vs Baseline | Wall Time |
|-----------|--------|------------|-------------|-----------|
| baseline_s42 | ✓ done | 72.3% | — | 2.1h |
| proposed_s42 | ✓ done | 74.8% | +2.5% ↑ | 2.4h |
| ablation_noX | ✓ done | 71.1% | -1.2% ↓ | 2.0h |
| proposed_s123 | ✓ done | 74.1% | +1.8% ↑ | 2.4h |
| proposed_s456 | ✓ done | 75.2% | +2.9% ↑ | 2.4h |

**Proposed method**: 74.7 ± 0.56% (mean ± std, 3 seeds)
**Baseline**: 72.3% (1 seed)
**Conclusion**: POSITIVE — proceed to full review
```

Update PARALLEL_STATE.json to `"status": "completed"`.
Update EXPERIMENT_REGISTRY.md: all rows finalized.
Update `{PROJ}/researcher/EXPERIMENT_LEDGER.json` and `PROJECT_MANIFEST.json.experiment_memory` so resume logic can recover the completed run set without rereading old chat context.

Then update `{PROJ}/TRACK_REGISTRY.json` with per-track experiment outcomes and recommended next action.

Pass control to `/analyze-results` for figure generation and narrative report.

## Error Recovery

| Scenario | Detection | Response |
|----------|-----------|---------|
| Two active tracks cannot both fit budget | registry shows both active but GPU budget exhausted | complete the stronger track first, park the weaker one |
| Screen died (crash) | Not in `screen -ls`, EXIT_CODE ≠ 0 | Check log for error, fix and requeue on same GPU |
| CUDA OOM | `CUDA out of memory` in log | Halve batch_size, relaunch |
| SSH timeout | Connection refused | Retry 3× with 30s backoff |
| All GPUs full | >80% utilization | Wait 30min, re-check; report to user if still blocked |
| Stalled | 0% GPU utilization for 30min | Kill screen, relaunch with `--debug` mode to diagnose |
