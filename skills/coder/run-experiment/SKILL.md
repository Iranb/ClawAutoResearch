---
name: run-experiment
description: "Resource-aware remote execution owned by Coder: deploy one or more approved independent experiment bundles to GPU servers via SSH, record launch metadata, and return a restart-safe status summary."
argument-hint: "[experiment name and config]"
allowed-tools:
  - Bash(*)
  - Read
  - Write
  - Grep
  - Glob
  - Edit
  - research_workflow
---

# Run Experiment

Deploy one approved experiment bundle, or a small explicitly assigned set of independent bundles, to a remote GPU server over SSH.

> **Ownership split**:
> - Coder owns the atomic launch and writes launch metadata under `{PROJ}/coder/`
> - Researcher / `/experiment-phase` owns portfolio scheduling, registry updates, and track decisions
> - If multiple bundles are assigned together, Coder may parallelize only the explicitly assigned independent bundles; Coder must not invent new experiments

## Research Rigor Constraints

- Keep **one variable per experiment** at launch time: do not bundle unrelated hypothesis changes into one remote run.
- **Baseline-first runtime rule**: if the packet includes a baseline or baseline-equivalent anchor, prioritize bringing that run into a trustworthy state before spending long GPU time on broader ablations or speculative repairs.
- **Record everything** about each launch: exact bundle, config, GPU, command, remote path, and restart status.
- **Respect git ratchet boundaries.** If the bundle belongs to a coder search loop, remote launch should happen from a disposable candidate branch/worktree unless the run is explicitly the retained incumbent.
- Keep the **experiment and code change linked** by launching only named bundles with durable manifests and run metadata.
- **Verify before claiming** a run started correctly: confirm screen/process state, log creation, and first-step sanity.
- **Never manipulate evaluation** through launch-time flag changes that alter the agreed metric, dataset, or baseline protocol.
- **Never fabricate citations** in launch notes or experiment READMEs; unresolved references stay unresolved.

## Prerequisites

Read `SERVER.md` to obtain:
- SSH alias (for example `gpu-server`)
- remote code directory (with `requirements.txt` or `pyproject.toml`)
- remote log/result directory
- uv path (default `~/.local/bin/uv`)

Read before launch:
- `{PROJ}/orchestrator/PLAN.md`
- `{PROJ}/TRACK_REGISTRY.json`
- `{PROJ}/planner/EXPERIMENT_REVIEW_PACKET.json` when reviewed-auto launch is enabled
- `{PROJ}/researcher/EXPERIMENT_LAUNCH_DECISION.json` when reviewed-auto launch is enabled
- `{PROJ}/coder/<experiment-name>/README.md`
- `{PROJ}/coder/<experiment-name>/requirements.txt`
- `{PROJ}/coder/EXPERIMENT_INDEX.md`
- `{PROJ}/coder/.../EXPERIMENT_MANIFEST.json`
- `{PROJ}/planner/EXPERIMENT_SEARCH_SPEC.json` when search-loop launch is enabled
- bundle-local `SEARCH_STATE.json` when it exists

Write after launch:
- `{PROJ}/coder/<experiment-name>/REMOTE_RUN.json`

## Steps

### 0. Verify reviewed-auto launch approval

If `{PROJ}/researcher/EXPERIMENT_LAUNCH_DECISION.json` exists, require all of the following before launch:

- `launch_approved = true`
- packet fingerprint still matches the current planner packet
- one-variable change statement is explicit
- stop rules and expected artifact targets are explicit

If any of these are missing, stop and hand control back to Researcher instead of guessing.

If `EXPERIMENT_SEARCH_SPEC.json` exists, also require:

- an explicit incumbent branch
- a disposable candidate branch/worktree policy
- promotion criteria that name the primary metric
- no reliance on gap-reduction-only or similar secondary signals as a keep rule

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

**Dataset immutability rule**:
- Dataset paths are read-only inputs for Coder
- Do not create, delete, patch, chmod, extract, or sync files into any dataset root during launch
- Put checkpoints, logs, temporary conversions, caches, and scratch outputs under the remote experiment directory or another scratch/results directory, not under `datasets/`

### 2. Resource Check

```bash
ssh <server> "nvidia-smi --query-gpu=index,name,memory.used,memory.total,utilization.gpu --format=csv,noheader"
ssh <server> "free -h | head -2"
```

If the target GPU is already full, select a free GPU or notify the user.

When multiple bundles are explicitly assigned in the same packet:

- read the GPU table first
- compute a safe slot count from free GPUs and memory headroom
- launch one bundle per safe slot
- queue the remainder instead of forcing full serialization

Use these heuristics unless Researcher gave stricter numbers:

- treat a GPU as safely available when utilization < 10% and memory.used / memory.total < 0.2
- reserve at least 10-15% VRAM headroom for each launch
- if a bundle already has an estimated VRAM requirement, do not co-locate it with another bundle on the same GPU unless the packet explicitly allows packing
- prefer one GPU per dataset when the same method is being validated on multiple datasets
- prefer one GPU per seed only after the first validating run has started successfully

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

If a batch of independent bundles is assigned, repeat the same launch pattern for each `(bundle, gpu_id)` pair chosen from the resource check. Keep separate screen names and separate `REMOTE_RUN.json` files per bundle.

### 5. Verify Launch

```bash
ssh <server> "screen -ls | grep <exp_name> && echo 'RUNNING' || echo 'FAILED TO START'"
ssh <server> "sleep 5 && tail -5 <remote_dst>/logs/<exp_name>.log"
```

### 5.5 Early baseline alignment check

As soon as the run survives startup:

- confirm the logged metric names and eval cadence still line up with the baseline contract
- compare the first meaningful checkpoints against the baseline curve or expected baseline neighborhood
- if the proposed bundle is clearly lagging the baseline for several monitoring passes, treat that as a **soft strategy-review trigger**

What to do when the run keeps trailing baseline:

- first check for bounded runtime issues: bad batch size, unstable LR, eval/config drift, broken resume path, data loader mismatch
- apply only the allowed bounded runtime fixes
- if the issue looks scientific rather than operational, stop blindly burning compute and hand the decision back to Researcher with a short diagnosis

This is intentionally not a hard-coded threshold. Use the baseline trend, elapsed training progress, and the plan's target metric to judge whether the run is just warming up or genuinely off-track.

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

Also update:

- the bundle's `EXPERIMENT_MANIFEST.json` status and remote pointers
- `{PROJ}/coder/EXPERIMENT_INDEX.md` so the local folder tree and remote run stay linked
- bundle-local `SEARCH_STATE.json` when this launch belongs to a search session
- `research_workflow.record_experiment_runtime_signal` with a normalized `running` heartbeat once launch verification succeeds, so watcher artifacts (`RUN_HEARTBEAT.json`) exist even if no agent keeps polling the process

Return a short structured summary so Researcher can update `{PROJ}/researcher/EXPERIMENT_REGISTRY.md`.
If you can identify `experimentId`, `trackId`, `server`, `gpu_id`, `screen_name`, and `REMOTE_RUN.json`, also call `research_workflow.upsert_experiment` so the shared ledger records the atomic launch immediately.

### 6.5 Know when launch work is "done enough"

Coder does not need to wait for a human to say "the run finished".

Treat the run as having crossed from **launch** into **monitor / reconcile** when the evidence stack says so:

- `screen -ls` no longer shows the run
- the log contains `EXIT_CODE=0` or another terminal failure signature
- `REMOTE_RUN.json` can be updated to a terminal status
- the workflow ledger / guard shows `active_runs=0` and `finished_unreconciled>0`
- the workflow `next_action` or monitor summary points at `/monitor-experiment`
- `research_workflow.refresh_gpu_monitor` followed by `research_workflow.get_gpu_monitor` shows the assigned GPU idle with the tracked `screen_name` missing, which is a strong likely-finished signal

When those signals appear:

- stop treating the branch as a fresh launch problem
- do not burn more GPU time on adjacent novelty branches just because the old screen exited
- call `research_workflow.record_experiment_runtime_signal` with a terminal status if watcher artifacts are missing or stale, so `/monitor-experiment` can reconcile from durable state instead of guessing from shell output alone
- hand control to monitoring / reconciliation so results, artifacts, and ledger state become durable

## Allowed Runtime Adjustments

Coder may make only bounded execution-time adjustments needed to keep the assigned experiment alive:

- reduce `batch_size`
- increase `gradient_accumulation_steps`
- reduce `num_workers`
- lower evaluation frequency
- enable or disable mixed precision flags already supported by the codebase

Coder may not, without Researcher approval:

- switch datasets
- change the main model architecture
- change the primary metric
- replace the loss/objective with a different research hypothesis
- expand the sweep to new hyperparameters not in the assigned plan

In reviewed-auto mode, Coder must refuse launch when the approved packet or launch decision is missing, stale, or still mixes multiple hypothesis changes.
Coder should also avoid repeatedly relaunching a run that stays well below baseline without a fresh diagnosis or Researcher-approved strategy change.
Coder should not promote or retain code solely because gap reduction, stability, or intermediate curves looked better if the approved primary metric did not justify it.

## Error Recovery

- `screen` launch failure → inspect the first 20 log lines to locate the error
- ImportError → install the missing package and rerun
- CUDA OOM (within the first 10 seconds) → halve the batch size and rerun
- repeated CUDA OOM after one bounded retry → mark the bundle as blocked_by_resources and hand back to Researcher instead of endlessly shrinking the run
