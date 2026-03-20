# HEARTBEAT.md — Periodic State Persistence

> This file is read by OpenClaw's heartbeat mechanism (every 2h by default).
> On each heartbeat trigger, execute ALL applicable steps below.
> This replaces the "before-compaction" hook with a time-based state flush.
> Deployed from plugin `templates/hooks/` to workspace roots by install script.

## When to Execute

OpenClaw calls this agent every 2 hours while sessions are active.
On each heartbeat, run whichever steps are applicable to the current session state.

## Step 1: Update TODOS.md

If any project is active, ensure `{PROJ}/orchestrator/TODOS.md` is current:
- Mark completed tasks as `[x]`
- Add any new tasks discovered since last heartbeat
- Record any blocked items with blocking reason

(`{PROJ}` = `{PROJECTS_ROOT}/{proj-id}`; see `CONFIG.md` for `{PROJECTS_ROOT}`)

## Step 2: Save Daily Log

If an active project exists, append a brief session checkpoint to `{PROJ}/memory/YYYY-MM-DD.md`:

```markdown
## HH:MM — Heartbeat Checkpoint
**Phase**: [idea / experiment / review / paper / idle]
**What was done since last checkpoint**:
- [bullet point 1]
**Running experiments**: [name or "none"]
**Next steps**:
- [what to continue next session]
```

## Step 3: Persist Review State (if in review-phase)

If currently executing `review-phase`, write or update `{PROJ}/researcher/REVIEW_STATE.json`:

```json
{
  "round": <current round>,
  "status": "in_progress",
  "last_score": <float>,
  "last_verdict": "<ready|almost|not ready>",
  "pending_actions": ["<action 1>", "<action 2>"],
  "timestamp": "<ISO 8601>"
}
```

## Step 4: Distill Ideation Memory (if idea-phase was active this session)

If this session included idea generation, novelty checking, or idea abandonment, and an active project exists:

Append to `{PROJ}/memory/ideation-memory.md`:

**Successful ideas** (passed Gate 1):
```markdown
### [Idea Title] — YYYY-MM-DD
- **Domain**: [domain]
- **Core hypothesis**: [one sentence]
- **Why novel**: [key differentiator]
- **Pilot result**: [key metric]
- **Generalizable pattern**: [lesson for future search]
```

**Failed / abandoned ideas**:
```markdown
### [Idea Title] — YYYY-MM-DD (ABANDONED)
- **Failure mode**: [why abandoned]
- **Do not retry unless**: [specific condition]
```

## Step 5: Distill Experiment Memory (if experiments completed this session)

If experiments completed with results and an active project exists:

Append to `{PROJ}/memory/experiment-memory.md` under "Proven Experiment Strategies":
```markdown
### [Experiment Name] — YYYY-MM-DD
- **Task**: [task type]
- **Dataset**: [name]
- **Key hyperparameters**: lr=X, bs=Y, epochs=N
- **Result**: [metric: value ± std across N seeds]
- **Training time**: ~N hours on [GPU]
- **Reuse condition**: [when applicable]
```

## Step 6: Announce Checkpoint

Output:
```
## Heartbeat Checkpoint Saved — HH:MM
- TODOS.md: [updated / unchanged]
- Daily log: appended
- Review state: [saved / not applicable]
- Ideation memory: [updated / not applicable]
- Experiment memory: [updated / not applicable]
Next heartbeat in ~2h.
```
