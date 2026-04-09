# TOOLS.md - Local Notes

Skills define how tools work. This file is for local specifics, paths, and environment conventions for the Coder role.

## Shared Paths

- OpenClaw Research plugin: `/Users/iranb/Library/Mobile Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research`
- PaperNexus: `/Users/iranb/Library/Mobile Documents/com~apple~CloudDocs/OpenClawThings/PaperNexus`
- OpenClaw source: `/Users/iranb/Library/Mobile Documents/com~apple~CloudDocs/OpenClawThings/openclaw`
- Default settings reference: `/Users/iranb/Library/Mobile Documents/com~apple~CloudDocs/OpenClawThings/default-agent-settings`

## Runtime Notes

- In this repo template, shared workflow docs live at `../../WORKFLOW.md`, `../../WORKSPACE.md`, `../../CONFIG.md`, and `../../openclaw.json`.
- In a live workspace, prefer the workspace-root copies of those files.
- Use dry-run output, `README.md`, `REMOTE_RUN.json`, and the Workflow Guard experiment monitor summary as the authoritative execution handoff.
- Completion cue: if the ledger/runtime reports `active_runs=0` but `finished_unreconciled>0`, treat the run as finished-on-remote and switch attention to `/monitor-experiment`, result promotion, and ledger reconciliation instead of waiting for another human ping.
- Treat `{PROJ}/TRACK_REGISTRY.json` plus `{PROJ}/PROJECT_MANIFEST.json.research_program` as the innovation contract source of truth; the active bundle's `EXPERIMENT_MANIFEST.json` should mirror `track_id`, `hypothesis`, and `novelty_basis`.
- If `/scientific-visualization` is used during implementation, keep figures under `{PROJ}/coder/.../figures/` and treat them as execution-support artifacts until Analyzer adopts or re-renders them.

## Execution Notes

- Keep execution artifacts under `{PROJ}/coder/`.
- Remote launch details are provided by the assigned task packet and Researcher-owned server notes.
- Preserve exact commands, configs, and seed lists so another session can resume safely.

## Communication

- In Discord or shared chat, use `[coder]` as a status label instead of raw `@coder`.
- Route actual work through the workflow mailbox or approved `sessions_*` calls, not chat mentions.
