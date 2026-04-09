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

Monitor experiment status on a remote server and durably reconcile completion so the workflow can advance to analysis without waiting for a human to notice.

This is the default follow-up once remote runs exist. In auto mode, the workflow may repeatedly route the EXPERIMENT stage back here until the remote runs are terminal and `experiment_search` is ready for analysis.

In reviewed-auto mode, monitor mode begins only after the pre-launch review loop has approved a packet and Coder has created real remote runs. Planner/analyzer/cross-reviewer work belongs to the earlier experiment micro-stages.

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
- the `screen` session no longer exists (`screen -ls` does not contain `<exp_name>`)
- the log tail contains `EXIT_CODE=0`
- result files have been generated
- the bundle's `REMOTE_RUN.json` can be updated from `running` to a terminal state with concrete artifact paths

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

### 6. Promote the workflow when runs are done

When all active remote runs are terminal:

1. ensure finished outputs are copied or recorded under `{PROJ}/researcher/artifacts/results/`
2. update `research_workflow.upsert_experiment` for every finished / failed run
3. refresh `{PROJ}/researcher/EXPERIMENT_REGISTRY.md`
4. call `research_workflow.set_experiment_search`

Use these rules for `experiment_search`:

- keep `status: "running"` while remote runs or post-processing are still in flight
- set `multi_seed_status` and `plot_pack_status` honestly
- move to `status: "ready_for_analysis"` only when evaluation summary and plot pack paths both exist and multi-seed / plot-pack work is complete

Do not mark the project analysis-ready just because the training process exited. The workflow should advance only after the result bundle is durable enough for Analyzer.

### 7. Report

When finished, output a status summary:
- runtime
- final metrics (extracted from result files)
- whether there were errors or warnings
- whether the experiment ledger, experiment registry, and `experiment_search` state were updated
- whether the workflow is now ready to advance from EXPERIMENT to ANALYZE
