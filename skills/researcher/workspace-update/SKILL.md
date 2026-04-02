---
name: workspace-update
description: "Update the local ClawAutoResearch workspace, then rerun the OpenClaw Research installer in non-interactive yes mode."
argument-hint: "[optional branch or revision]"
allowed-tools:
  - Read
  - Bash
  - Grep
---

# Workspace Update

Refresh the local research workspace at:

`/Users/iranb/Library/Mobile Documents/com~apple~CloudDocs/OpenClawThings/ClawAutoResearch`

Then reinstall the current OpenClaw Research plugin with non-interactive yes mode so the local agents, skills, templates, and role files stay aligned.

## Safety Rules

- Treat this as maintenance work, not research-stage progress.
- Before pulling or switching anything, inspect the target repo for uncommitted changes.
- If the target workspace is dirty, stop and report the exact files instead of overwriting them.
- Prefer fast-forward updates. Do not rewrite history.
- Keep the install step non-interactive by using `--yes`.

## Steps

### 1. Inspect the target workspace

At `/Users/iranb/Library/Mobile Documents/com~apple~CloudDocs/OpenClawThings/ClawAutoResearch`:

- confirm the directory exists
- run `git status --short`
- if the tree is dirty, stop and report it

### 2. Update the workspace

Use the safest available fast-forward path:

- `git fetch origin`
- `git pull --ff-only`

If the caller provided a branch or revision hint, report what changed after the update.

### 3. Reinstall the plugin

From the OpenClaw Research repo root, run:

```bash
bash install.sh --yes --force-role-files
```

This must auto-accept all yes/no prompts and refresh role files, synced PaperNexus skills, templates, and workspace wiring.

### 4. Report back

Return a concise maintenance summary:

- target workspace revision before/after
- whether the update was skipped because of a dirty tree
- whether `install.sh --yes --force-role-files` succeeded
- any follow-up the user should know about

## Notes

- This skill is for maintaining the local workspace, not for modifying experiment code.
- If install output indicates missing dependencies or missing OpenClaw CLI, surface that clearly.
