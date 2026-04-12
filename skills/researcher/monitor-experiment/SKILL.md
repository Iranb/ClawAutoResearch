---
name: monitor-experiment
description: "Monitor running experiments on remote server: check status, read logs, detect completion."
argument-hint: "[server or experiment name]"
allowed-tools:
  - Bash(ssh *)
  - Bash(echo *)
  - Read
  - Write
  - Edit
  - research_workflow
---

# Monitor Experiment

Reconcile experiment state from durable runtime signals so the workflow can advance to analysis without waiting for a human to notice.

This is the default follow-up once remote runs exist. In auto mode, the workflow may repeatedly route the EXPERIMENT stage back here until the remote runs are terminal and `experiment_search` is ready for analysis.

In reviewed-auto mode, monitor mode begins only after the pre-launch review loop has approved a packet and Coder has created real remote runs. Planner/analyzer/cross-reviewer work belongs to the earlier experiment micro-stages.

## Monitoring Principles

- **Reconciliation first**: this skill should prefer durable runtime artifacts (`REMOTE_RUN.json`, `RUN_HEARTBEAT.json`, `RUN_TERMINAL.json`, `RESULT_SUMMARY.json`, `FAILURE_SIGNATURE.json`) over live shell inspection whenever those artifacts exist.
- **Agent is not the primary watcher**: if watcher artifacts already say the run is terminal, do not keep treating this as a process babysitting task.

- **Baseline-first interpretation**: compare running curves against the agreed baseline contract before reading too much into a proposed variant.
- **Soft early intervention**: if a run spends a meaningful stretch clearly below baseline, do not just keep waiting out the whole budget by default.
- **No universal hard threshold**: use training progress, eval checkpoints, and the baseline trend to judge whether the run is still plausibly recovering or genuinely off-track.

## Process

### 1. Check Running Experiments

```bash
ssh <server> "screen -ls"
```

Also read the active bundles' `REMOTE_RUN.json` files first so you know:

- `server`
- `screen_name`
- `log_path`
- `results_path`
- which experiment id / track id each remote run belongs to

If watcher artifacts already exist beside `REMOTE_RUN.json`, read them before making any live-shell inference:

- `RUN_HEARTBEAT.json`
- `RUN_TERMINAL.json`
- `RESULT_SUMMARY.json`
- `FAILURE_SIGNATURE.json`

If the workflow GPU monitor is available, refresh it before concluding that a run is still active:

- call `research_workflow.refresh_gpu_monitor`
- then read `research_workflow.get_gpu_monitor`

This gives you one durable server/GPU snapshot instead of forcing every future turn to rediscover GPU occupancy from scratch.

### 2. Read Recent Logs

```bash
ssh <server> "tail -30 <remote_dst>/logs/<exp_name>.log"
```

### 3. Check Results

```bash
ssh <server> "ls -lt <remote_dst>/results/*.json 2>/dev/null | head -5"
```

If result files exist:
```bash
ssh <server> "cat <remote_dst>/results/<latest>.json"
```

When a new checkpoint is observed, update `{PROJ}/researcher/EXPERIMENT_LEDGER.json` through `research_workflow.upsert_experiment` with the current `status`, `stage`, `keyMetric`, `metrics`, `resultPaths`, and `failureSignature` if present.

Update `{PROJ}/researcher/EXPERIMENT_REGISTRY.md` in the same pass so humans and later agents can see the latest run table without replaying chat history.

### 4. Detect Completion

Experiment completion signals:
- `RUN_TERMINAL.json` exists
- `RESULT_SUMMARY.json` exists and points at stable result outputs
- the `screen` session no longer exists (`screen -ls` does not contain `<exp_name>`)
- the log tail contains `EXIT_CODE=0`
- result files have been generated
- the bundle's `REMOTE_RUN.json` can be updated from `running` to a terminal state with concrete artifact paths
- the workflow ledger / guard reports `active_runs=0` with `finished_unreconciled>0`
- the workflow GPU monitor shows the assigned GPU as idle and the tracked `screen_name` missing, which is a strong "likely finished" cue even before manual reconciliation

### 5. Polling Strategy

- first check: 30 seconds after launch
- short experiments (< 10 min): check every 30s
- medium experiments (10-60 min): check every 2 min
- long experiments (> 60 min): check every 5 min

In workflow auto mode, prefer short bounded monitor passes over one giant wait:

- check
- update `upsert_experiment`
- refresh local result pointers
- exit

Let the workflow scheduler re-enter `/monitor-experiment` on the next pass instead of holding one chat turn forever.

### 5.5 Baseline-first watchpoints

On each bounded monitoring pass, ask:

1. Is the run comparable to baseline yet?
2. If yes, is it tracking near / above / below the baseline trend?
3. If below, does the pattern look temporary or persistent?

Useful signs that a branch may need intervention:

- repeated eval checkpoints stay materially below baseline
- loss curve looks unhealthy relative to the baseline run
- the proposed branch underperforms while the baseline on the same protocol is healthy
- the run keeps consuming time but produces no evidence that it is closing the baseline gap

If that happens, treat it as a **strategy-review signal**:

- update the ledger / registry with the current comparison note
- distinguish runtime issues from scientific issues
- prefer one of:
  - bounded runtime fix by Coder
  - a closer-to-baseline repair branch
  - pausing lower-priority follow-up runs
  - escalating back to Researcher / Orchestrator for strategy adjustment

The point is not to hard-stop every underperforming run instantly. The point is to avoid silently burning long GPU time on a branch that is staying below baseline with no recovery story.

### 6. Reconcile the workflow when runs are done

When all active remote runs are terminal:

1. ensure finished outputs are copied or recorded under `{PROJ}/researcher/artifacts/results/`
2. call `research_workflow.record_experiment_runtime_signal` if the watcher artifacts are missing or stale, so the run leaves behind a normalized heartbeat/terminal/result summary
2. update `research_workflow.upsert_experiment` for every finished / failed run
3. refresh `{PROJ}/researcher/EXPERIMENT_REGISTRY.md`
4. call `research_workflow.set_experiment_search`

Use these rules for `experiment_search`:

- keep `status: "running"` while remote runs or post-processing are still in flight
- set `multi_seed_status` and `plot_pack_status` honestly
- move to `status: "ready_for_analysis"` only when evaluation summary and plot pack paths both exist and multi-seed / plot-pack work is complete

Do not mark the project analysis-ready just because the training process exited. The workflow should advance only after the result bundle is durable enough for Analyzer.

If `research_workflow.evaluate_experiment_search_decision` recommends:

- `reconcile_runtime` — finish the runtime reconciliation first
- `repair_implementation` — hand back to Coder / Researcher with the recorded failure evidence
- `require_multi_seed` — schedule the multi-seed validation pass, do not over-interpret a single run
- `require_ablation` — request the missing ablation rather than claiming the innovation is validated
- `innovation_invalidated` — stop tuning this envelope and route back to Researcher/Planner for rollback or reflection

### 7. Report

When finished, output a status summary:
- runtime
- final metrics (extracted from result files)
- current baseline comparison status
- whether there were errors or warnings
- whether the experiment ledger, experiment registry, and `experiment_search` state were updated
- whether the workflow is now ready to advance from EXPERIMENT to ANALYZE
