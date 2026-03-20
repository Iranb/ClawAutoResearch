# Before Compaction Hook (Reference / Archive)

> **Note**: OpenClaw does NOT have a "before-compaction" file hook.
> The content of this file has been migrated to `HEARTBEAT.md` (same directory),
> which OpenClaw deploys to workspace roots and triggers every 2 hours.
> Time-based heartbeat covers the same state-persistence need.
> This file is kept for reference only.

Triggered automatically when session token count approaches the compaction threshold. Execute ALL steps before context is compressed.

## Step 1: Update TODOS.md

Ensure `{PROJ}/orchestrator/TODOS.md` reflects current state (`{PROJ}` = active project directory):
- Mark completed tasks as `[x]`
- Add any new tasks discovered during this session
- Record any blocked items with blocking reason

## Step 2: Save Daily Log

Append a session summary to `{PROJ}/memory/YYYY-MM-DD.md` (create if not exists):

```markdown
## HH:MM — Session Summary
**Phase**: [idea / experiment / review / paper / other]
**What was done**:
- [bullet point 1]
- [bullet point 2]
**Key decisions**:
- [any important choices made and why]
**Results** (if any):
- [metric: value]
**Next steps**:
- [what should happen next session]
```

## Step 3: Persist Review State (if in review-phase)

If currently executing `review-phase`, ensure `{PROJ}/researcher/REVIEW_STATE.json` is up to date:

```json
{
  "round": <current round number>,
  "status": "in_progress",
  "last_score": <float>,
  "last_verdict": "<ready|almost|not ready>",
  "pending_actions": ["<action item 1>", "<action item 2>"],
  "timestamp": "<ISO 8601 timestamp>"
}
```

## Step 4: Distill Ideation Memory (if in idea-phase or after idea failure)

If this session included idea generation, novelty checking, or an idea was abandoned:

Append to `{PROJ}/memory/ideation-memory.md`:

**For successful ideas** (passed Gate 1):
```markdown
### [Idea Title] — YYYY-MM-DD
- **Domain**: [domain]
- **Core hypothesis**: [one sentence]
- **Why novel**: [what distinguishes it from existing work]
- **Pilot result**: [key metric from pilot experiment]
- **Generalizable pattern**: [lesson for future idea search]
```

**For failed/abandoned ideas**:
```markdown
### [Idea Title] — YYYY-MM-DD (ABANDONED)
- **Failure mode**: [why abandoned]
- **Do not retry unless**: [specific condition]
```

## Step 5: Distill Experiment Memory (if experiment completed)

If this session included completed experiment runs with results:

Append to `{PROJ}/memory/experiment-memory.md` under "Proven Experiment Strategies":

```markdown
### [Experiment Name] — YYYY-MM-DD
- **Task**: [task type]
- **Dataset**: [name]
- **Key hyperparameters**: lr=X, bs=Y, epochs=N, optimizer=Z
- **Result**: [metric: value ± std across N seeds]
- **Training time**: ~N hours on [GPU]
- **Reuse condition**: [when applicable]
```

Also update "Compute Budget Log" with hours consumed.

## Step 6: Announce Completion

Output confirmation:
```
## Compaction Checkpoint Saved
- TODOS.md: updated
- Daily log: appended to memory/YYYY-MM-DD.md
- Review state: [saved / not applicable]
- Ideation memory: [updated / not applicable]
- Experiment memory: [updated / not applicable]
Context compression proceeding.
```
