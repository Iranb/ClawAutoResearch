# Agent Bootstrap Hook (Reference / Archive)

> **Note**: This file is NOT directly read by OpenClaw.
> The active version is `BOOTSTRAP.md` in this directory (`templates/hooks/`), which is deployed
> to each agent's workspace root by the install script. OpenClaw reads `BOOTSTRAP.md` via its
> `boot-md` internal hook. This file is kept for reference only.

Injected at the start of every agent session. Execute these steps before responding to any user request.

## Step 1: Load Identity

Read your agent directory's `SOUL.md` and `AGENTS.md` to restore your identity, principles, and operating protocols.

## Step 2: Load Research Memory (Researcher Agent only)

If you are the **Researcher Agent**:

```
Read the following files if they exist:
1. {PROJ}/memory/ideation-memory.md — known successful patterns and dead ends (project-isolated)
2. {PROJ}/memory/experiment-memory.md — proven hyperparameter configs and debugging playbook (project-isolated)
```

Summarize key active constraints in 2–3 bullet points before proceeding:
- Any idea directions marked "do not retry"
- Any proven configs relevant to current task

## Step 3: Check Active Project State

```
If research/TODOS.md exists:
  → Read it. Identify tasks with status [ ] (incomplete).
  → Note the most recent incomplete task.

If research/REVIEW_STATE.json exists:
  → Check "status" field:
    - "completed" → no action needed
    - "in_progress" AND timestamp within 24 hours → RESUME: continue from round N
    - "in_progress" AND timestamp > 24 hours → EXPIRED: restart review loop
  → If resuming, announce: "Resuming review loop from round N (last score: X/10)"
```

## Step 4: Check Running Experiments (Researcher Agent only)

If you are the **Researcher Agent**, check whether any experiments are still running on the remote server:

```bash
ssh gpu-server "screen -ls"
```

If active screens are found, check their logs:
```bash
ssh gpu-server "tail -20 ~/experiments/logs/<most-recent>.log"
```

Announce the status: "Found active experiment: <name>, running for ~N hours."

## Step 5: Announce Readiness

Output a brief status summary before the first response:

```
## Session Ready
- Agent: [Researcher / Reviewer / Planner / Coder / Analyzer / Writer]
- Active project: [title if found, else "none"]
- Pending tasks: [N tasks, next: "..."]
- Running experiments: [name if found, else "none"]
- Memory loaded: [ideation-memory: Y/N, experiment-memory: Y/N]
```

Skip Step 4 and Running Experiments for non-Researcher agents.
