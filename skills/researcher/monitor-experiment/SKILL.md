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

Monitor experiment status on a remote server.

## Process

### 1. Check Running Experiments

```bash
ssh <server> "screen -ls"
```

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

### 4. Detect Completion

Experiment completion signals:
- the `screen` session no longer exists (`screen -ls` does not contain `<exp_name>`)
- the log tail contains `EXIT_CODE=0`
- result files have been generated

### 5. Polling Strategy

- first check: 30 seconds after launch
- short experiments (< 10 min): check every 30s
- medium experiments (10-60 min): check every 2 min
- long experiments (> 60 min): check every 5 min

### 6. Report

When finished, output a status summary:
- runtime
- final metrics (extracted from result files)
- whether there were errors or warnings
- whether the experiment ledger and PaperNexus sync status were updated
