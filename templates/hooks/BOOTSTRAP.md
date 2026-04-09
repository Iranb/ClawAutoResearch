# BOOTSTRAP.md — Research Agent Session Start

> This file is read by OpenClaw's `boot-md` internal hook at the start of every session.
> It replaces the default "Hello, World" bootstrap with research-workflow-aware startup.
> Deployed from plugin `templates/hooks/` to each agent's workspace root by install script.

## Step 1: Load Identity & Workflow

Read the following files from this workspace root:
1. `SOUL.md` — your identity and principles
2. `AGENTS.md` — your operating protocols
3. `WORKFLOW.md` — the stable global pipeline map and gate vocabulary

Do not treat `WORKFLOW.md` alone as the live decision source for the next step.
Stage-local ownership, missing signals, repair/background opportunities, and dispatch timing come from Workflow Guard plus `research_workflow.auto_iterator_tick`.

## Step 2: Load Research Memory (Researcher Agent only)

If your `SOUL.md` identifies you as the **Researcher Agent** and there is an **active project** (`{PROJ}`):

Read the following files if they exist:
1. `{PROJ}/memory/ideation-memory.md` — known successful idea patterns and dead ends (project-isolated)
2. `{PROJ}/memory/experiment-memory.md` — proven hyperparameter configs and debugging playbook (project-isolated)

If there is no active project yet, skip this step (memory will be created when the first project runs).

Summarize key active constraints in 2–3 bullet points:
- Any idea directions marked "do not retry"
- Any proven configs relevant to current task

## Step 3: Check Active Project State & Let Runtime Decide

```
If {PROJ}/PROJECT_MANIFEST.json exists:
  → Confirm `project_id`, `owner_agent`, `next_action`, `resume_action`, and `memory_scope.project_isolated`
  → If this workspace was previously working on another project:
      Do not start fresh stage work until runtime reconciliation runs
  → If your agent is not the recorded owner and no explicit task has been assigned:
      Stay in background-duty mode from AGENTS.md instead of inventing a new stage

If {PROJECTS_ROOT}/*/orchestrator/TODOS.md exists (any active project):
  → Read the most recently modified one.
  → Identify tasks with status [ ] (incomplete).
  → Note the most recent incomplete task and its assigned agent.

If {PROJECTS_ROOT}/*/researcher/REVIEW_STATE.json exists:
  → Check "status" field:
    - "completed"   → no action needed
    - "in_progress" AND timestamp within 24h → RESUME from round N
    - "in_progress" AND timestamp > 24h → EXPIRED: restart review loop
  → If resuming: announce "Resuming review loop from round N (last score: X/10)"
```

If an active project exists, call `research_workflow` with action `auto_iterator_tick` and `iterator.mode = "bootstrap"` before any fresh stage work.
Use the returned `stageAfter`, `ownerAfter`, `blockingReason`, and `recommendedActions` as the deterministic startup decision.
Interpret the iterator result as follows:

- `drive_stage` = owner work may proceed or be handed off deterministically
- `repair_artifact` = the workflow is waiting on workflow-owned repair/materialization, not a mainline owner handoff
- `background` = bounded background work may continue, but do not present it as the next stage owner taking over
- `wait_human` = stop and wait for the required gate

If the iterator routes ownership away from you, do not invent a parallel mainline task.
If the iterator surfaces repair or background work, keep the foreground session responsive and use workflow-owned background lanes when available instead of monopolizing chat.
Do not manually wake Orchestrator, Coder, or another owner just because an older checklist says that stage "should be next"; prefer the runtime-directed handoff path and only use compatibility fallback when runtime context is unavailable.

## Step 4: Check Running Experiments (Researcher Agent only)

If you are the Researcher Agent, check remote server:

```bash
ssh gpu-server "screen -ls"
```

If active screens found, tail their logs:
```bash
ssh gpu-server "tail -20 ~/experiments/logs/<most-recent>.log"
```

Announce: "Found active experiment: <name>, running for ~N hours."

## Step 5: Announce Readiness

Output before first response:

```
## Session Ready
- Agent: [Researcher / Reviewer / Planner / Coder / Analyzer / Writer]
- Active project: [title if any, else "none"]
- Current stage: [IDEA / PLAN / CODE / EXPERIMENT / ANALYZE / REVIEW / WRITE / SUBMIT / none]
- Current owner: [researcher / orchestrator / coder / analyzer / academic_writer / reviewer / none]
- Iterator action: [drive_stage / repair_artifact / background / wait_human / none]
- Pending gate: [GATE-N waiting / none]
- Pending tasks: [N tasks, next: "..."]
- Running experiments: [name if any, else "none"]
- Memory loaded: [ideation-memory: Y/N, experiment-memory: Y/N]
- Control note: [runtime-ready / workflow-owned repair pending / background-only / human gate]
```

Non-Researcher agents: skip Steps 2, 4, and the experiments/stage/mode lines in Step 5.
