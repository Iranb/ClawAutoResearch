# BOOTSTRAP.md — Research Agent Session Start

> This file is read by OpenClaw's `boot-md` internal hook at the start of every session.
> It replaces the default "Hello, World" bootstrap with research-workflow-aware startup.
> Deployed from plugin `templates/hooks/` to each agent's workspace root by install script.

## Step 1: Load Identity & Workflow

Read the following files from this workspace root:
1. `SOUL.md` — your identity and principles
2. `AGENTS.md` — your operating protocols
3. `WORKFLOW.md` — the **global pipeline definition** (stages, gates, AUTO_PROCEED setting)

Check `WORKFLOW.md` → `Configuration` section:
- Note `AUTO_PROCEED` value (`true` = autonomous loop, `false` = pause at gates)
- Note `PROJECT_MODE` value (`single` or `queue`)

## Step 2: Load Research Memory (Researcher Agent only)

If your `SOUL.md` identifies you as the **Researcher Agent** and there is an **active project** (`{PROJ}`):

Read the following files if they exist:
1. `{PROJ}/memory/ideation-memory.md` — known successful idea patterns and dead ends (project-isolated)
2. `{PROJ}/memory/experiment-memory.md` — proven hyperparameter configs and debugging playbook (project-isolated)

If there is no active project yet, skip this step (memory will be created when the first project runs).

Summarize key active constraints in 2–3 bullet points:
- Any idea directions marked "do not retry"
- Any proven configs relevant to current task

## Step 3: Check Active Project State & Resume Stage

```
If {PROJECTS_ROOT}/*/researcher/GATE_STATE.json exists:
  → Read current_stage and gate_status
  → If gate_status = "waiting" AND AUTO_PROCEED=false:
      Re-post the gate message (user may have missed it)
  → Else: resume pipeline at current_stage

If {PROJ}/PROJECT_MANIFEST.json exists:
  → Confirm `project_id`, `owner_agent`, `next_action`, `resume_action`, and `memory_scope.project_isolated`
  → If this workspace was previously working on another project:
      Run `/resume-pipeline` before any fresh write
  → If your agent is not the recorded owner and no explicit task has been assigned:
      Stay in background-duty mode from AGENTS.md instead of inventing a new stage

If resuming at stage CODE (or about to enter CODE) and either {PROJ}/orchestrator/PLAN.md or {PROJ}/orchestrator/TODOS.md is missing:
  → **Wake Orchestrator first**: spawn Orchestrator with instruction "Run /plan-research using {PROJ}/researcher/IDEA_REPORT.md; write PLAN.md and TODOS.md to {PROJ}/orchestrator/."
  → Wait for both files to exist before spawning Coder or proceeding. Do not assume someone else will run Orchestrator.

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
- Pending gate: [GATE-N waiting / none]
- Pending tasks: [N tasks, next: "..."]
- Running experiments: [name if any, else "none"]
- Memory loaded: [ideation-memory: Y/N, experiment-memory: Y/N]
- Mode: [AUTO_PROCEED=true (autonomous) / AUTO_PROCEED=false (gated)]
```

Non-Researcher agents: skip Steps 2, 4, and the experiments/stage/mode lines in Step 5.
