---
name: run-experiment
description: "Atomic remote execution owned by Coder: deploy one approved experiment bundle to a GPU server via SSH, record launch metadata, and return a restart-safe status summary."
argument-hint: "[experiment name and config]"
allowed-tools:
  - Bash(*)
  - Read
  - Write
  - Grep
  - Glob
  - Edit
---

# Run Experiment

Deploy a single prepared experiment bundle to a remote GPU server over SSH.

> **Ownership split**:
> - Coder owns the atomic launch and writes launch metadata under `{PROJ}/coder/`
> - Researcher / `/experiment-phase` owns portfolio scheduling, registry updates, and track decisions

## Prerequisites

Read `SERVER.md` to obtain:
- SSH alias (for example `gpu-server`)
- remote code directory (with `requirements.txt` or `pyproject.toml`)
- remote log/result directory
- uv path (default `~/.local/bin/uv`)

Read before launch:
- `{PROJ}/orchestrator/PLAN.md`
- `{PROJ}/TRACK_REGISTRY.json`
- `{PROJ}/coder/<experiment-name>/README.md`
- `{PROJ}/coder/<experiment-name>/requirements.txt`

Write after launch:
- `{PROJ}/coder/<experiment-name>/REMOTE_RUN.json`

## Steps

### 1. Determine Dataset Path

**Priority order** (check in this order):

1. **Project-specific**: `{PROJ}/PROJECT_MANIFEST.json` → `dataset_path` field
2. **Track-specific**: `{PROJ}/TRACK_REGISTRY.json` → `tracks[<track-id>].dataset_path`
3. **Plan-specific**: `{PROJ}/orchestrator/PLAN.md` → `Dataset location` section
4. **Default**: `SERVER.md` → 主数据集 `/data/datasets/`

**Common dataset paths**:
```bash
# COCO dataset
DATASET_PATH="/data/datasets/coco"

# ImageNet
DATASET_PATH="/data/datasets/imagenet"

# Project-specific
DATASET_PATH="/data/projects/{PROJ}/datasets"

# Custom path from PLAN.md
DATASET_PATH="/data/shared/datasets/custom_dataset"
```

### 2. Resource Check

```bash
ssh <server> "nvidia-smi --query-gpu=index,name,memory.used,memory.total,utilization.gpu --format=csv,noheader"
ssh <server> "free -h | head -2"
```

If the target GPU is already full, select a free GPU or notify the user.

### 2. Code Sync

```bash
rsync -avz --exclude='.git' --exclude='__pycache__' --exclude='*.pyc' --exclude='wandb' --exclude='checkpoints' <local_src>/ <server>:<remote_dst>/
```

### 3. Install Dependencies (if needed)

```bash
ssh <server> "cd <remote_dst> && UV_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple uv pip install -r requirements.txt 2>&1 | tail -5"
```

### 4. Launch in Screen

```bash
ssh <server> "screen -dmS <exp_name> bash -c 'cd <remote_dst> && CUDA_VISIBLE_DEVICES=<gpu_id> uv run python <script> <args> > logs/<exp_name>.log 2>&1; echo EXIT_CODE=\$? >> logs/<exp_name>.log'"
```

### 5. Verify Launch

```bash
ssh <server> "screen -ls | grep <exp_name> && echo 'RUNNING' || echo 'FAILED TO START'"
ssh <server> "sleep 5 && tail -5 <remote_dst>/logs/<exp_name>.log"
```

### 6. Persist Launch Metadata

Write `{PROJ}/coder/<experiment-name>/REMOTE_RUN.json`:

```json
{
  "experiment_name": "<exp_name>",
  "server": "<server>",
  "remote_dir": "<remote_dst>",
  "screen_name": "<exp_name>",
  "gpu_id": "<gpu_id>",
  "status": "running",
  "launched_at": "ISO-TS",
  "log_path": "<remote_dst>/logs/<exp_name>.log",
  "results_path": "<remote_dst>/results/<exp_name>/"
}
```

Return a short structured summary so Researcher can update `{PROJ}/researcher/EXPERIMENT_REGISTRY.md`.

## Error Recovery

- `screen` launch failure → inspect the first 20 log lines to locate the error
- ImportError → install the missing package and rerun
- CUDA OOM (within the first 10 seconds) → halve the batch size and rerun
