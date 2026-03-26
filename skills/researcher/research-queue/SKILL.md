---
name: research-queue
description: "Manage multiple research projects in parallel pipeline. Each project is independently staged (graph→idea→plan→experiment→review→paper) and controlled by manifest + track registry state. Use to start a new project, check status of all projects, advance a specific project, or run overnight multi-project batch."
argument-hint: "[add <topic> | status | advance <project-id> | overnight | next]"
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
---

# Research Queue

L3 parallelism: multiple complete research projects, each at a different pipeline stage, managed as a priority queue.

## Slash Fast Path

When this skill is invoked directly via `/research-queue ...` from Discord or another native slash surface:

1. Parse the full queue command from `$ARGUMENTS`.
2. Parse internal marker: `__BACKGROUND_CONTINUATION__: true/false`.
3. If `__BACKGROUND_CONTINUATION__ != true`, do **not** run the full queue inline.
4. First call `research_workflow`:
   - `action = "start_background_run"`
   - `backgroundRun.kind = "research_queue"`
   - `backgroundRun.summary = "Starting research queue task"`
   - `backgroundRun.commandText = /research-queue ... -- __BACKGROUND_CONTINUATION__: true`
5. After the tool returns:
   - Reply briefly that the queue task has started in the background
   - Include `project_id` / `project_root` if the tool returned them
   - **STOP**
6. The background continuation will execute the actual queue logic and post later progress through normal agent/channel delivery.

## Constants

- **MAX_ACTIVE_PROJECTS = 4** — max projects in active (non-archived) state
- **MAX_CONCURRENT_EXPERIMENTS = 4** — total GPU slots across all projects
- **OVERNIGHT_MODE = false** — when true, AUTO_PROCEED all projects until GPU budget exhausted
- **PRIORITY_WEIGHTS**: experiment > review > paper > idea > graph (GPU-intensive first, graph work can fill CPU-only gaps)

## Path Variables

- `{WS}` = `~/.openclaw/workspace-researcher`
- `{PMEM}` = `{PROJ}/memory`
- Per-project: `{PROJ}` = `{PROJECTS_ROOT}/{proj-id}` (see `CONFIG.md` for `{PROJECTS_ROOT}`)

Each project's files are organized under `{PROJECTS_ROOT}/{proj-id}/` with per-agent subfolders. See `WORKSPACE.md`.

## State Files

### `{PROJECTS_ROOT}/PROJECTS_STATE.json` — master registry

```json
{
  "updated_at": "ISO-TS",
  "gpu_allocation": {
    "0": "proj_abc/exp_baseline_s42",
    "1": "proj_abc/exp_proposed_s42",
    "2": null,
    "3": null
  },
  "projects": [
    {
      "id": "proj_abc",
      "title": "Adaptive Token Mixing for ViTs",
      "stage": "experiment",
      "active_tracks": 1,
      "priority": 1,
      "dir": "proj_abc/",
      "created": "2026-03-16",
      "updated": "2026-03-16T20:00:00Z",
      "status": "active",
      "next_action": "monitor experiments and analyze results",
      "blocked_by": null,
      "estimated_gpu_h_remaining": 4.5
    },
    {
      "id": "proj_def",
      "title": "Contrastive Pre-training for Low-resource NLP",
      "stage": "review",
      "priority": 2,
      "dir": "proj_def/",
      "created": "2026-03-14",
      "updated": "2026-03-15T18:00:00Z",
      "status": "active",
      "next_action": "submit to reviewer, await score",
      "blocked_by": null,
      "estimated_gpu_h_remaining": 0
    },
    {
      "id": "proj_ghi",
      "title": "Efficient Sparse Attention Mechanisms",
      "stage": "idea",
      "active_tracks": 2,
      "priority": 3,
      "dir": "proj_ghi/",
      "created": "2026-03-16",
      "updated": "2026-03-16T10:00:00Z",
      "status": "active",
      "next_action": "run novelty check on top 3 ideas",
      "blocked_by": null,
      "estimated_gpu_h_remaining": 2
    }
  ]
}
```

### Per-project directory structure

Each project lives under `{PROJECTS_ROOT}/{proj-id}/` with per-agent subfolders (see `WORKSPACE.md`):

```
{PROJECTS_ROOT}/
├── proj_abc/
│   ├── README.md
│   ├── PROJECT_MANIFEST.json
│   ├── TRACK_REGISTRY.json
│   ├── CLAIM_POLICY.md
│   ├── researcher/          ← researcher owns
│   │   ├── IDEA_REPORT.md, LITERATURE.md
│   │   ├── EXPERIMENT_REGISTRY.md, REVIEW_STATE.json
│   │   └── artifacts/{pilots/, results/, logs/}
│   ├── orchestrator/        ← orchestrator owns
│   │   ├── PLAN.md, PLAN_AUDIT.md, TODOS.md
│   ├── coder/               ← coder owns
│   │   └── {exp-name}/
│   ├── analyzer/            ← analyzer owns
│   │   ├── NARRATIVE_REPORT.md, CLAIM_EVIDENCE_MATRIX.md, QUALITY_AUDIT.md, figures/, tables/
│   ├── academic_writer/     ← academic_writer owns
│   │   ├── PAPER_PLAN.md, paper/
│   ├── reviewer/            ← reviewer owns (saved by researcher)
│   │   ├── REVIEW_REPORT.md
│   │   ├── external_review_{date}.md
│   │   └── rebuttal_{date}.md
│   └── cross-reviewer/      ← cross-reviewer owns (saved by calling agent)
│       ├── novelty/, outline/, prose/
├── proj_def/
│   └── ...
└── proj_ghi/
    └── ...
```

---

## Commands

### `add <topic>`

Add a new project to the queue.

1. Generate a short project ID: `proj_<6-char-hash>`
2. Create `{PROJECTS_ROOT}/{project-id}/` directory structure
3. Initialize `{PROJ}/PROJECT_MANIFEST.json`, `{PROJ}/TRACK_REGISTRY.json`, `{PROJ}/CLAIM_POLICY.md`, and `{PROJ}/graph/`
4. Add entry to `{PROJECTS_ROOT}/PROJECTS_STATE.json` with stage=`graph`, priority=lowest
5. Start graph build for this project:
   ```
   /graph-build "<topic>"
   # outputs to {PROJECTS_ROOT}/{project-id}/graph/
   ```
6. Update `{PROJECTS_ROOT}/PROJECTS_STATE.json` stage to `graph`, next_action=`run frontier mapping then idea phase`

Output:
```
## Project Added
- **ID**: proj_abc
- **Title**: [topic]
- **Directory**: {PROJECTS_ROOT}/proj_abc/
- **Status**: graph phase started
```

---

### `status`

Print a dashboard of all active projects:

```
## Research Queue Status — YYYY-MM-DD HH:MM

GPU Allocation:
  GPU 0 ████ exp_baseline_s42 (proj_abc) — running 1.2h
  GPU 1 ████ exp_proposed_s42 (proj_abc) — running 1.2h
  GPU 2 ░░░░ free
  GPU 3 ░░░░ free

Projects:
┌─────────┬──────────────────────────────────────┬────────────┬──────────┬──────────────────────────────┐
│ ID      │ Title                                │ Stage      │ Tracks   │ Priority │ Next Action                  │
├─────────┼──────────────────────────────────────┼────────────┼──────────┼──────────┼──────────────────────────────┤
│ proj_abc│ Adaptive Token Mixing for ViTs        │ experiment │ 1 active │ 1 ★      │ monitor + analyze results    │
│ proj_def│ Contrastive Pre-training for NLP     │ review     │ 1 active │ 2        │ submit report to reviewer    │
│ proj_ghi│ Efficient Sparse Attention            │ idea       │ 2 active │ 3        │ novelty check on top tracks  │
└─────────┴──────────────────────────────────────┴────────────┴──────────┴──────────┴──────────────────────────────┘

Estimated completion:
  proj_def (paper): ~3 days
  proj_abc (paper): ~7 days
  proj_ghi (paper): ~14 days
```

---

### `advance <project-id>`

Manually advance one project to its next action.

1. Read `{PROJECTS_ROOT}/{project-id}/orchestrator/TODOS.md` if it exists — find first incomplete task
2. Read `{PROJECTS_ROOT}/{project-id}/` state files to understand context
3. Execute the next action using the appropriate skill:
   - stage=`graph` → `/graph-build` then `/frontier-mapping`
   - stage=`idea` → `/idea-phase`, `/idea-tournament`, or `/research-reflect`
   - stage=`plan` → spawn orchestrator sub-agent → `/plan-research`
   - stage=`experiment` → `/parallel-experiments`
   - stage=`review` → `/review-phase`
   - stage=`paper` → `/paper-phase`
4. Update `{PROJECTS_ROOT}/PROJECTS_STATE.json` when done

---

### `overnight`

Autonomous multi-project run with `AUTO_PROCEED=true` on all projects.

Priority scheduling algorithm:
1. **Experiment-stage projects first** (GPU-intensive, need to run while sleeping)
2. **Review-stage projects second** (CPU-only, can run while GPU is free)
3. **Paper-stage projects third** (writing, no GPU needed)
4. **Idea-stage projects next** (can use frontier report + limited GPUs for pilots)
5. **Graph-stage projects last** (CPU / local indexing work, opportunistic background progress)

Execution loop:

```
WHILE active_projects exist AND gpu_budget_remaining > 0:

  1. Re-read {PROJECTS_ROOT}/PROJECTS_STATE.json (refresh state)
  2. Check GPU availability
  3. For each project by priority:
     a. If project.stage == "experiment" AND free_gpu exists:
        - Launch /parallel-experiments for this project
        - Update gpu_allocation
     b. If project.stage == "review" AND no running experiments:
        - Launch /review-phase AUTO_PROCEED=true
     c. If project.stage == "paper" AND no blocking deps:
        - Launch /paper-phase AUTO_PROCEED=true
     d. If project.stage == "idea" AND free_gpu exists:
        - Launch /idea-phase or /research-reflect for the current track portfolio
     e. If project.stage == "graph":
        - Launch /graph-build or /frontier-mapping for this project
  4. Wait for any project to advance stage
  5. Repeat

BREAK conditions:
  - All projects in "complete" or "paused" state
  - Total GPU-hours > MAX_OVERNIGHT_GPU_H (default: 20h)
  - Critical error in any project (unrecoverable failure)
  - Wall clock > 8h (overnight session limit)
```

Send Discord notification at:
- Session start: "Overnight run started — N projects active"
- Each stage transition: "proj_abc advanced: experiment → review"
- Session end: "Overnight run complete — summary: ..."

---

### `next`

Show just the single highest-priority next action across all projects.

Useful for quick "what should I do now?" check.

Output:
```
## Next Action
Project: proj_abc (priority 1 — experiment stage)
Action: Run /parallel-experiments — 2 experiments pending on available GPUs
Command: /parallel-experiments "proj_abc — Group B (proposed seeds 123, 456)"
```

---

## Project Lifecycle

```
add <topic>
    ↓
[graph] → /graph-build → /frontier-mapping
    ↓
[idea] → /idea-phase → /idea-tournament → /research-reflect → Gate 1
    ↓
[plan] → spawn orchestrator → /plan-research → Gate 2
    ↓
[experiment] → /parallel-experiments → /analyze-results
    ↓
[review] → /review-phase (cross-agent) → score ≥ 6 → Gate 3
    ↓
[paper] → /paper-phase → compile → Gate 4
    ↓
[complete] → archive to {PROJECTS_ROOT}/archived/<project-id>/
```

## Memory Updates

When a project completes:
1. Update `{PMEM}/ideation-memory.md` (IDE — successful pattern)
2. Update `{PMEM}/experiment-memory.md` (ESE — proven config)
3. Archive project: `mv {PROJECTS_ROOT}/<id>/ {PROJECTS_ROOT}/archived/<id>/`
4. Remove from `{PROJECTS_ROOT}/PROJECTS_STATE.json`

## Rules

- Never run more experiments than available GPUs
- Never advance a project if its blocking dependency is unresolved
- Always update `{PROJECTS_ROOT}/PROJECTS_STATE.json` after each state change
- Always reflect active track counts from `{PROJ}/TRACK_REGISTRY.json`
- If two projects compete for the same GPU: priority wins
- If `estimated_gpu_h_remaining` differs from actual by >2h: recalculate
