---
name: experiment-phase
description: "Deploy and run experiments on remote GPU server via SSH. Supports parallel multi-experiment dispatch via EXPERIMENT_REGISTRY. Use after idea is confirmed and PLAN.md exists."
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
---

# Experiment Phase

Orchestrate full experiment execution: classify dependencies → parallel dispatch → monitor → analyze.

## Prerequisites

1. `agents/researcher/SERVER.md` configured (SSH alias, uv project path, remote dirs)
2. `{PROJ}/orchestrator/PLAN.md` generated (stages with success criteria)
3. Code ready in `{PROJ}/coder/<experiment>/` (produced by coder sub-agent)
4. SSH passwordless login configured

`{PROJ}` = `{PROJECTS_ROOT}/{proj-id}`

## Resolve servers for this project

**不同方向/项目可使用不同服务器**。在选 host 前先解析当前项目的服务器配置：

1. 若存在 **`{PROJ}/servers.json`**（格式：`{"default":"host","list":["host1","host2"]}`），则本项目**仅**使用其中的 `default` 与 `list`。
2. 否则使用全局配置（`~/.openclaw/openclaw-research.json` 的 `servers` 或运行环境提供的默认值）。

下文中 `<server>` 即从上述解析得到的 `list` 中选取的 host（默认用 `default`；多机时按负载或策略从 `list` 选）。

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
Parallel Launch (screen × N GPUs)    ← L1 parallelism
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

Write dispatch plan and initialize `{PROJ}/researcher/EXPERIMENT_REGISTRY.md`:

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

## Phase 3: Code Sync

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

Use `/parallel-experiments` for full parallel dispatch and monitoring:

```
/parallel-experiments "[project-id] — Group A"
```

This handles:
- Simultaneous launch of all Group A experiments
- Joint monitoring with exponential backoff
- Automatic Group B trigger when Group A completes
- Error recovery (OOM, stall, crash)

## Phase 5: Monitor Until Completion

Poll loop via `/monitor-experiment`:

```bash
# Status check for all screens
ssh <server> "screen -ls"

# Per-screen log check
ssh <server> "tail -10 <remote_dir>/logs/<screen_name>.log"
```

Update EXPERIMENT_REGISTRY.md on each poll.

**Key events to watch for**:
- Screen exits: check EXIT_CODE in log
- NaN/Inf in training log: immediate kill + fix
- GPU utilization drops to 0% for 20min: stall detection

## Phase 6: Results Collection

When ALL experiments complete:

```bash
rsync -avz <server>:<remote_dir>/results/ {PROJ}/researcher/artifacts/results/
rsync -avz <server>:<remote_dir>/logs/ {PROJ}/researcher/artifacts/logs/
```

## Phase 7: Analysis

```
/analyze-results
```

Produces (written by Analyzer Agent to its own folder):
- `{PROJ}/analyzer/NARRATIVE_REPORT.md`
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

## Error Recovery

| Scenario | Detection | Action |
|----------|-----------|--------|
| Screen died | Not in `screen -ls`, EXIT_CODE ≠ 0 | Read log, fix error, relaunch |
| CUDA OOM | `CUDA out of memory` in log | Halve batch_size, update config, relaunch |
| SSH timeout | Connection refused | Retry 3× with 30s backoff |
| All GPUs full | >80% utilization | Wait 30min, re-check |
| NaN loss | `nan` or `inf` in loss log | Add gradient clipping, reduce LR |
| Stalled | 0% GPU utilization 20min | Kill screen, relaunch with debug config |
| Dependency timeout | Group A not done after MAX_WAIT_H | Report to user, mark as partial |
