---
name: implement-experiment
description: "Implement experiment code from PLAN.md specification. Produces self-contained, reproducible training and evaluation scripts. Use when the Orchestrator has produced a PLAN.md and the Researcher needs code ready for deployment."
argument-hint: "[experiment stage name or 'all']"
allowed-tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - Bash
  - lobster
---

# Implement Experiment

Write reproducible, self-contained experiment code from a research plan specification.

> **File ownership**: Write ONLY to `{PROJ}/coder/`. Read from `{PROJ}/orchestrator/` and `{PROJ}/researcher/`.
> `{PROJ}` = `{PROJECTS_ROOT}/{proj-id}`

## Research Rigor Constraints

- Preserve **one variable per experiment**: each bundle should implement one hypothesis or one clearly named repair, not a grab bag of changes.
- **Baseline-first alignment**: implement and keep a clean baseline path/config first, then express proposed changes as minimal deltas on top of that baseline so later monitoring can compare apples to apples.
- **Record everything**: experiment id, changed files, configs, run command, and assumptions must stay visible in manifests and README notes.
- **Prepare for git-native search.** If the bundle may enter a coder search loop, initialize the search-spec and search-state pointers plus incumbent git lineage fields up front instead of retrofitting them after launch.
- Keep the **experiment and code change linked** so later analysis can trace a result back to an exact diff and config.
- **Verify before claiming** readiness: dry-run, shape checks, and minimal validation come before "implementation complete".
- **Never manipulate evaluation** by quietly changing metrics, splits, baselines, or fixed settings in code.
- **Never fabricate citations** in experiment docs or comments; if prior work is mentioned, verify it first or leave a TODO.
- **Plot when it reduces ambiguity**: if a quick baseline-vs-proposed curve, loss plot, or ablation preview would catch a contract drift early, use `/scientific-visualization` under `{PROJ}/coder/.../figures/`.

## Input

Read in order:
1. `{PROJ}/orchestrator/PLAN.md` — full experiment specification
2. `{PROJ}/TRACK_REGISTRY.json` — active track ids plus the durable `hypothesis` / `novelty_basis` contract
3. `{PROJ}/PROJECT_MANIFEST.json` — confirm CODE ownership and any mirrored research-program contract
4. `{PROJ}/researcher/IDEA_REPORT.md` — method details and novelty claims
5. `{PROJ}/researcher/ideation/RESEARCH_PROPOSAL.md` and `{PROJ}/researcher/ideation/PROBLEM_DECOMPOSITION.md` — the current rationale for why this direction exists and how it should be decomposed into executable deltas
6. `{PROJ}/academic_writer/story/CLAIM_TO_EXPERIMENT_MAP.md` when it already exists — use it as a claim-pressure contract, not just a writing artifact
7. `{PROJ}/orchestrator/TODOS.md` — identify the specific stage(s) to implement

## Steps

### 1. Understand the Specification

Before writing any code:
- State the method in one paragraph
- List all required components: model, loss, optimizer, data pipeline
- Identify any unclear requirements and resolve via `{PROJ}/researcher/IDEA_REPORT.md`
- Resolve the active track contract:
  - `track_id`
  - `question`
  - `hypothesis`
  - `novelty_basis`
- Resolve the proposal/story contract:
  - the selected direction from `RESEARCH_PROPOSAL.md`
  - the decomposition from `PROBLEM_DECOMPOSITION.md`
  - any already-locked claim → experiment obligations from `CLAIM_TO_EXPERIMENT_MAP.md`
- Resolve the baseline contract:
  - `baseline_reference`
  - `primary_baseline_metric`
  - `target_improvement`
  - `baseline_training_protocol`
  - `baseline_eval_protocol`
  - `innovation_points`
  - `validation_steps`
  - `ablation_plan`
- If PLAN.md or the current task conflicts with the active track contract, stop and ask Researcher / Orchestrator to reconcile it before implementing
- If code would violate the current `RESEARCH_PROPOSAL.md`, `PROBLEM_DECOMPOSITION.md`, or `CLAIM_TO_EXPERIMENT_MAP.md`, stop and force a plan/story update before implementing
- If the requested code change would alter the baseline training setup or eval method without an explicit allowed deviation, stop and force a plan update before implementing
- Build a **baseline-first diff view** before implementation:
  - what is identical to baseline
  - what is intentionally changed
  - what logs/metrics must stay directly comparable during monitoring

### 2. Determine Dataset Configuration

**Read dataset requirements from PLAN.md**:
- Look for `Dataset` or `Data` section
- Identify dataset name, path, and preprocessing requirements

**Resolve dataset path** (priority order):
1. **Explicit path in PLAN.md**: Use the specified path
2. **Project config**: `{PROJ}/PROJECT_MANIFEST.json` → `dataset_path`
3. **SERVER.md defaults**: Use the appropriate dataset directory

**Immutability rule**:
- Treat the resolved dataset path as read-only input
- Never preprocess in place, rewrite annotations, or drop caches back into the source dataset root
- Put converted shards, manifests, temporary files, and derived caches under `{PROJ}/coder/<experiment-name>/`, `logs/`, `results/`, or remote scratch

**Example dataset configurations**:

```yaml
# In PLAN.md
dataset:
  name: COCO
  path: /data/datasets/coco
  format: coco_detection
  splits: [train2017, val2017]

# Or
dataset:
  name: Custom
  path: /data/projects/{PROJ}/datasets/my_dataset
  format: custom
  loader: data/dataset.py
```

### 3. Directory Setup

Create experiment directory:
```
{PROJ}/coder/experiments/<track-id>/<experiment-id>__<experiment-name>/
├── EXPERIMENT_MANIFEST.json
├── train.py
├── evaluate.py
├── models/
│   └── <model-name>.py
├── data/
│   └── dataset.py
├── configs/
│   ├── baseline.yaml
│   └── proposed.yaml
├── utils/
│   └── logging.py
├── logs/
├── results/
├── requirements.txt
└── README.md
```

Also maintain a project-level index:

```
{PROJ}/coder/EXPERIMENT_INDEX.md
```

Rules:
- every experiment bundle must have a stable `experiment-id`
- folder names must make the project/track/experiment relationship obvious
- never dump many unrelated runs into one flat folder
- do not delete old bundle folders when iterating; create a new experiment id or record the revision in the manifest
- if the bundle will participate in approved local search, point it at one incumbent branch and one search-state file rather than letting candidate history sprawl across the main branch

### 3. Implement Core Components

**Mandatory in every train.py**:
```python
import random, numpy as np, torch

def set_seed(seed: int):
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)
    torch.backends.cudnn.deterministic = True
```

**Mandatory logging** — log to both file and stdout:
```python
import logging, json
from pathlib import Path

def setup_logging(exp_name: str, log_dir: str):
    log_dir = Path(log_dir)
    log_dir.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        handlers=[
            logging.FileHandler(log_dir / f"{exp_name}.log"),
            logging.StreamHandler()
        ]
    )
```

**Mandatory config via argparse or yaml**:
- All hyperparameters must be overridable via command line
- Config file path must be a required argument

**Shape assertions** at critical points:
```python
assert logits.shape == (batch_size, num_classes), f"Expected ({batch_size}, {num_classes}), got {logits.shape}"
```

### 4. Write Configs

`configs/baseline.yaml`:
```yaml
experiment_name: baseline
seed: 42
model: <baseline-architecture>
# training
learning_rate: 1e-4
batch_size: 32
epochs: 100
optimizer: adamw
weight_decay: 0.01
# data
dataset: <name>
data_dir: /data/datasets/<name>
# logging
log_dir: logs/
results_dir: results/
```

`configs/proposed.yaml`: same as baseline but with method-specific additions.

### 5. Dry-Run Validation

Always run before marking code as ready:
```bash
# Use tiny subset: 2 batches, 1 epoch
uv run python train.py --config configs/proposed.yaml --seed 42 \
  --max_steps 2 --batch_size 2 --dry_run
```

## Idle Handoff Recovery

If the implementation bundle is already durable, validated, and Coder is still the live owner while nobody advances the workflow:

- call `research_workflow.auto_iterator_tick`
- if the next owner should change and the handoff is still idle, use the shared `workflow-handoff-signal` skill and call `research_workflow.prepare_stage_handoff`
- do not run experiment-monitoring or analyzer work yourself unless the workflow routes ownership back

Expected: no crash, loss printed, no NaN.

If the dry-run or mini-ablation is hard to interpret from logs alone, generate one bounded diagnostic plot with `/scientific-visualization` and store it in the experiment bundle so Analyzer can later reuse or re-render it.

Before handing the bundle to launch:
- make sure `configs/baseline.yaml` is the clean comparison anchor
- make sure `configs/proposed.yaml` differs from baseline only where the track contract expects
- make sure log keys / eval cadence are comparable enough that Researcher can judge whether the proposed run is tracking above or below baseline without reverse-engineering the code

If later monitoring shows the run stays materially below the baseline trend for a meaningful stretch, your default move is not to pile on more novelty. First prepare a bounded diagnosis around baseline parity, likely runtime issues, and the smallest safe fix.

If dry-run fails:
- ImportError → `uv pip install <package> --index-url https://pypi.tuna.tsinghua.edu.cn/simple`, then update `requirements.txt`
- CUDA OOM → halve `batch_size` in config
- NaN loss → add `torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)`
- Shape error → fix with exact shape values from assertion message

### 6. Write README.md

```markdown
# Experiment: <name>

## Purpose
[one sentence from PLAN.md]

## Dependencies
```bash
UV_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple uv pip install -r requirements.txt
```

## Run Baseline
```bash
uv run python train.py --config configs/baseline.yaml --seed 42
```

## Run Proposed Method
```bash
uv run python train.py --config configs/proposed.yaml --seed 42
```

## Expected Outputs
- `logs/<exp_name>.log` — training log
- `results/<exp_name>/` — checkpoints and metrics JSON

## Estimated Runtime
~N hours per seed on A100 80GB (batch_size=32)
```

### 6.5 Write EXPERIMENT_MANIFEST.json

Every bundle must include `EXPERIMENT_MANIFEST.json` with:

- `experiment_id`
- `project_id`
- `track_id`
- `question`
- `hypothesis`
- `novelty_basis`
- `entry_point`
- `config_paths`
- `results_dir`
- `log_dir`
- `dataset_path`
- `status`
- `baseline_reference`
- `primary_baseline_metric`
- `target_improvement`
- `baseline_training_protocol`
- `baseline_eval_protocol`
- `innovation_points`
- `validation_steps`
- `ablation_plan`
- `implementation_proof.changed_files`
- `implementation_proof.integration_points`
- `implementation_proof.activation_signals`
- `implementation_proof.execution_command`
- `claim_ids_supported`
- `proposal_basis`
- `allowed_deviations`
- `search_spec_path`
- `search_state_path`
- `graph_memory_packet_path`
- `git.incumbent_branch`
- `git.base_commit`
- `git.last_candidate_branch`
- `git.last_candidate_commit`
- `git.promotion_reason`

`implementation_proof` must explain, concretely and durably:

- which files changed for this method
- where each claimed innovation point is actually wired into the code path
- what runtime signal or artifact would prove the code path was activated
- which execution command should exercise that implementation

Update `{PROJ}/coder/EXPERIMENT_INDEX.md` so Coder can later recover:

- what the bundle tests
- which track it belongs to
- which hypothesis / novelty basis it implements
- which baseline and primary metric it is trying to improve
- how each innovation point is validated step by step
- where results live
- whether it was launched remotely

### 7. Completion Signal

```
## Code Ready
- **Location**: {PROJ}/coder/experiments/<track-id>/<experiment-id>__<experiment-name>/
- **Baseline config**: configs/baseline.yaml
- **Proposed config**: configs/proposed.yaml
- **Run command**: uv run python train.py --config configs/proposed.yaml --seed 42
- **Dry-run**: PASSED (last 3 lines: ...)
- **Estimated runtime**: ~N hours per seed on A100
- **Seeds to run**: 42, 123, 456
- **Total GPU-hours**: ~N h (N seeds × N h/seed)
```

Then append to `{PROJ}/orchestrator/TODOS.md`:
```
- [x] Code ready: <experiment-name> — completed: YYYY-MM-DD
```

## Rules

- Never skip dry-run validation
- Never write to any folder outside `{PROJ}/coder/`
- Never create flat, ambiguous experiment folders that hide the owning track or question
- Always keep `EXPERIMENT_MANIFEST.json` and `EXPERIMENT_INDEX.md` updated
- Never modify files under shared `datasets/` roots; keep dataset-derived outputs in `{PROJ}/coder/` or remote scratch/results
- Remote deployment is handled separately by `/run-experiment` on the Coder agent when Researcher / `experiment-phase` explicitly assigns it
- Never modify baseline code from other papers without flagging it
- Never change the baseline experiment setting or eval method unless the manifest records an explicit allowed deviation and the plan approved it
- Never leave the bundle ambiguous about its incumbent branch or search state when reviewed-auto search is enabled
- If a specification is ambiguous, use the most conservative interpretation and flag it

## Stage Closeout

When the required experiment bundle is complete, the dry-run has passed, and the stage is genuinely ready to move into EXPERIMENT, use the shared `workflow-handoff-signal` skill and call `research_workflow.prepare_stage_handoff` for `code -> experiment`.

Do not hand off if dry-run, reproducibility, or implementation review still requires fixes.
