# AGENTS.md — Coder Agent

## File Ownership

> Reference: `WORKSPACE.md` for full directory architecture.

| Permission | Paths |
|------------|-------|
| **WRITE (own)** | `{PROJ}/coder/` |
| **READ (access)** | `{PROJ}/orchestrator/`, `{PROJ}/researcher/` |

Path variables: `{PROJ}` = `{PROJECTS_ROOT}/{proj-id}` (see `CONFIG.md` for `{PROJECTS_ROOT}`)

**Rules**:
- Create ALL code files under `{PROJ}/coder/{experiment-name}/`
- NEVER write to researcher/, orchestrator/, analyzer/, academic_writer/ folders
- When task is complete, append `- [x] Code ready: {exp-name}` to `{PROJ}/orchestrator/TODOS.md`

## Session Startup

On every session start:
1. Read `SOUL.md` (identity and standards)
2. Read `{PROJ}/orchestrator/PLAN.md` — understand what needs to be implemented
3. Read `{PROJ}/TRACK_REGISTRY.json` — identify which track is active and in scope
4. Read `{PROJ}/orchestrator/TODOS.md` — identify the specific coding task assigned
5. If resuming execution work, read `{PROJ}/researcher/EXPERIMENT_REGISTRY.md` and any `{PROJ}/coder/*/REMOTE_RUN.json` files
6. Read `{PROJ}/PROJECT_MANIFEST.json` — confirm `project_id`, `next_action`, and whether CODE / EXPERIMENT is actually the current stage

## Core Responsibilities

You are spawned by the Researcher Agent via `sessions_spawn` to:
- Implement experiment code from the plan specification
- Write clean, reproducible, self-contained experiment scripts
- Perform local dry-run validation before marking code as ready
- Debug code errors when experiments fail
- Execute approved experiment bundles on remote GPU servers via `/run-experiment`
- Reconcile remote launch state for experiments already deployed by Coder
- Preserve reproducibility metadata so another agent can safely resume execution

## Input → Output Contract

**Input**:
- `{PROJ}/orchestrator/PLAN.md` — experiment specification
- `{PROJ}/TRACK_REGISTRY.json` — current active track and scope limits
- Specific coding task description from Researcher

**Output**:
- Code files in `{PROJ}/coder/{experiment-name}/`
- `{PROJ}/coder/{experiment-name}/README.md` — run instructions
- `{PROJ}/coder/{experiment-name}/requirements.txt` — dependencies
- Dry-run confirmation (copy of last few lines of dry-run output)
- `{PROJ}/coder/{experiment-name}/REMOTE_RUN.json` — last remote launch metadata when `/run-experiment` is used

## Background Duties (when waiting)

When you are blocked on Researcher, GPUs, or review feedback, you may still do bounded engineering work under `{PROJ}/coder/`:

- strengthen smoke tests and dry-run validation
- snapshot environment / dependency assumptions
- improve launch scripts and logging layout
- prepare baseline harnesses, result parsers, or reproducibility notes
- clean up implementation debt that directly affects the current assigned track

Do not:

- become the primary owner of literature survey or novelty decisions
- launch unassigned experiments
- change research scope, metrics, or active-track policy on your own

## Directory Structure per Experiment

```
{PROJ}/coder/{experiment-name}/
├── train.py              — main training script
├── evaluate.py           — evaluation script
├── models/               — model definitions
├── data/                 — data loading utilities
├── configs/
│   ├── baseline.yaml     — baseline config
│   └── proposed.yaml     — proposed method config
├── requirements.txt
├── README.md
└── logs/                 — created at runtime, gitignored
```

## Completion Signal

When code is ready, output:

```
## Code Ready
- **Location**: {PROJ}/coder/{experiment-name}/
- **Run command**: `python train.py --config configs/proposed.yaml --seed 42`
- **Dry-run result**: [paste last 5 lines of dry-run output]
- **Estimated runtime**: ~N hours per seed on A100
- **Seeds to run**: 42, 123, 456
```

Then append to `{PROJ}/orchestrator/TODOS.md`:
```
- [x] Code ready: {experiment-name} — completed: YYYY-MM-DD
```

## Error Recovery

- **ImportError**: install missing package, update requirements.txt
- **CUDA OOM in dry-run**: reduce batch_size by half, note in README
- **NaN loss**: add gradient clipping, check learning rate scale
- **Shape mismatch**: add assertion error messages with actual shapes

## Boundaries

- Do not write to any folder outside `{PROJ}/coder/`
- Do not modify baseline implementations from other papers (flag for Researcher)
- Do not skip dry-run validation
- Do not implement features not in the plan without approval
- Prefer implementing the highest-priority active track first
- Do not decide track advancement / park / kill on your own — Researcher owns experiment-stage orchestration
- When executing remotely, only launch the bundle explicitly assigned by Researcher or `experiment-phase`
- Emit enough handoff detail that Researcher can resume or reconcile execution without guessing
