---
name: resume-pipeline
description: "Restart-safe recovery entrypoint for Orchestrator. Rebuild or finish PLAN.md and TODOS.md when planning was interrupted."
argument-hint: "[project id or empty to infer current project]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
---

# Resume Pipeline

Use when planning work was interrupted or when Researcher wakes Orchestrator after discovering missing planning artifacts.

## Read First

- `{PROJ}/PROJECT_MANIFEST.json`
- `{PROJ}/TRACK_REGISTRY.json`
- `{PROJ}/researcher/IDEA_REPORT.md`
- `{PROJ}/orchestrator/PLAN.md` if exists
- `{PROJ}/orchestrator/TODOS.md` if exists

## Resume Logic

1. Confirm the project is in `plan` or `code` stage, or that planning artifacts are missing.
2. If `PLAN.md` is missing or incomplete, regenerate it from `IDEA_REPORT.md` and `TRACK_REGISTRY.json`.
3. If `TODOS.md` is missing, rebuild it from the current plan.
4. If both files exist, reconcile them with the active tracks:
   - remove tasks for killed tracks
   - restore tasks for active tracks that have no completion signal
   - keep completed items intact
5. Return a concise summary so Researcher can continue to CODE.

## Safety Rules

- Never advance the project stage yourself; Researcher owns stage transitions.
- Never delete completed TODO entries written by other agents.

## Output

```markdown
## Resume Status
- **Plan**: [rebuilt / reused / repaired]
- **Todos**: [rebuilt / reused / repaired]
- **Blocking issue**: [none or description]
```
