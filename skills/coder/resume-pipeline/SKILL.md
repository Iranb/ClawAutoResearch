---
name: resume-pipeline
description: "Restart-safe recovery entrypoint for Coder. Resume local implementation or atomic remote execution without duplicating already-running launches."
argument-hint: "[experiment name or empty to infer from TODOS.md]"
allowed-tools:
  - Bash(*)
  - Read
  - Write
  - Edit
  - Grep
  - Glob
---

# Resume Pipeline

Use after session loss, gateway restart, or when Researcher asks Coder to continue interrupted implementation or execution work.

## Read First

- `{PROJ}/PROJECT_MANIFEST.json`
- `{PROJ}/TRACK_REGISTRY.json`
- `{PROJ}/orchestrator/PLAN.md`
- `{PROJ}/orchestrator/TODOS.md`
- `{PROJ}/researcher/EXPERIMENT_REGISTRY.md` if exists
- `{PROJ}/coder/<experiment-name>/README.md` if exists
- `{PROJ}/coder/<experiment-name>/REMOTE_RUN.json` if exists

## Resume Logic

1. Determine the target experiment from explicit argument or the first incomplete coder task in `TODOS.md`.
2. If the code bundle is incomplete, continue `/implement-experiment`.
3. If the code bundle is complete and `REMOTE_RUN.json` exists:
   - check remote `screen -ls`
   - if the recorded screen is still active, do not relaunch
   - if the screen is gone, inspect the remote log before deciding whether to relaunch
4. If Researcher assigned a fresh launch and no active run exists, continue with `/run-experiment`.
5. Return a structured status summary for Researcher to persist into `EXPERIMENT_REGISTRY.md`.

## Safety Rules

- Never relaunch a bundle if remote state still shows it as running.
- Never choose a new experiment independently; execute only the bundle explicitly assigned by Researcher or `experiment-phase`.

## Output

```markdown
## Resume Status
- **Experiment**: {experiment-name}
- **Implementation**: [complete / resumed / blocked]
- **Remote execution**: [running / relaunched / waiting / failed]
- **Researcher action needed**: [yes/no + note]
```
