# TOOLS.md - Local Notes

Skills define how tools work. This file is for local specifics, paths, and environment conventions for the Researcher role.

## Shared Paths

- OpenClaw Research plugin: `/Users/iranb/Library/Mobile Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research`
- OpenClaw source: `/Users/iranb/Library/Mobile Documents/com~apple~CloudDocs/OpenClawThings/openclaw`
- Default settings reference: `/Users/iranb/Library/Mobile Documents/com~apple~CloudDocs/OpenClawThings/default-agent-settings`

## Runtime Notes

- In this repo template, shared workflow docs live at `../../WORKFLOW.md`, `../../WORKSPACE.md`, `../../CONFIG.md`, and `../../openclaw.json`.
- In a live workspace, prefer the workspace-root copies of those files.
- Treat `{PROJ}/PROJECT_MANIFEST.json.workflow_control` or the latest Workflow Guard snapshot as the canonical source for stage, owner, next action, blocker, and runtime state; manifest top-level fields are only mirrors.
- `research_workflow` and `research_memory` are the authoritative ways to update idle research state, experiment memory, mailbox state, and other structured workflow records.
- For workflow-owned literature/graph work, assume PaperNexus is remote-only and MCP-first: use `{PROJ}/researcher/paper-staging/` for temporary files, queue upload wrappers through `research_workflow.schedule_papernexus_import` (`queue_paper_ingestion` is only a compatibility alias), and prefer the remote HTTP MCP control plane (`research_lookup`, `research_briefing`, `idea_catalyst`) for live graph / brainstorm work. Keep `pn_graph_query.py` and `pn_research_chains.py` in the toolbox only as thin MCP-backed compatibility wrappers, and keep `pn_stage_sync.py`, `pn_import_submit.py`, `pn_import_queue.py`, and `pn_batch_import.py` for queued import/status flows.
- If workflow policy switches `papernexusAccessMode` to `local_mcp`, use the PaperNexus MCP tool surface for graph operations instead of the wrapper path; in `auto`, prefer remote HTTP MCP first, then remote_api compatibility mode only if workflow guidance explicitly authorizes it.
- For wrapper-driven uploads and graph refreshes, `research_workflow.set_paper_ingestion` is the authoritative state sink for per-paper queued / running / completed / timed_out / failed updates and for batch manifest progress (`active_batches`, `batch_items`, `last_batch_manifest_path`). `/workflow-status` reads from that durable state in addition to graph presence snapshots.
- For local workspace maintenance, the `workspace-update` skill targets `/Users/iranb/Library/Mobile Documents/com~apple~CloudDocs/OpenClawThings/ClawAutoResearch` and reruns `bash install.sh --yes --force-role-files` after a clean fast-forward update.

## Remote Execution

- Server-specific details belong in `SERVER.md`.
- Before remote launch, check GPU, RAM, and disk, then use restart-safe execution such as `screen`.
- Prefer resumable metadata files over chat-only status.

## Communication

- In Discord or shared chat, use `[researcher]` as a status label instead of raw `@researcher`.
- Route actual work through the workflow mailbox or approved `sessions_*` calls, not chat mentions.
