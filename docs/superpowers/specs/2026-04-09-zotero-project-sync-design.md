# Zotero Project Sync Design

Date: 2026-04-09

## Summary

Add an optional, workflow-owned Zotero project sync layer for literature research so project papers can be organized under a per-project Zotero collection such as `bot/<project-id>` or `Bot/<project-id>`, depending on plugin-level configuration.

This sync is best-effort only:

- if Zotero MCP is available, sync project papers into Zotero collections
- if Zotero MCP is unavailable, misconfigured, or fails, record the skip/failure durably and continue the workflow
- never make Zotero sync a stage blocker
- never let Zotero sync block the main Researcher chat/process or force a workflow rollback

## Goals

- Add a plugin-global Zotero collection root setting.
- Respect explicit project overrides in `PROJECT_MANIFEST.json.research_program.zotero_project_path`.
- Keep project literature organized in Zotero by project collection and sub-collection.
- Let literature-research flows refresh Zotero automatically when possible.
- Preserve foreground responsiveness by pushing Zotero work to background/best-effort execution.

## Non-Goals

- Do not make Zotero the source of truth for graph state, full text, or citation verification.
- Do not require Zotero MCP to be installed for the workflow to proceed.
- Do not add new hard blockers to `idea`, `graph_build`, `review`, `write`, or `submit`.
- Do not require Coder or execution-stage agents to align their runtime with Zotero state.
- Do not migrate old projects automatically between lowercase `bot/...` and custom roots such as `Bot/...`.

## Existing State

The repository already treats Zotero as a recommended per-project bibliography layer:

- new project bootstrap seeds `research_program.zotero_project_path`
- `research-lit` and `graph-build` prompts already mention `/zotero-project-library`
- `{PROJ}/researcher/ZOTERO_PACKET.md` is already the durable human-readable status artifact

However, current behavior is mostly prompt-level guidance. There is no workflow-owned soft-sync layer that:

- computes a normalized sync target
- triggers sync consistently from research flows
- records skipped/unavailable states durably
- keeps the foreground Researcher session responsive

## Chosen Approach

Implement a workflow-owned soft sync path built around the existing manifest field plus a small Zotero sync packet, plus one explicit manual Discord command for project-wide reconciliation.

### 1. Path policy

- If `PROJECT_MANIFEST.json.research_program.zotero_project_path` is set, use it exactly.
- Otherwise, compute the path from a plugin-global Zotero project root plus the current `project-id`.
- The plugin-global root defaults to `bot`.
- Example: if the global root is `Bot`, the effective per-project path becomes `Bot/<project-id>`.
- Existing projects with `bot/<project-id>` or any other explicit path remain valid and are not rewritten automatically.

### 2. Workflow-owned Zotero sync packet

Add a machine-readable project artifact that captures the current sync intent and status.

Proposed artifact:

- `{PROJ}/researcher/ZOTERO_SYNC_PACKET.json`

Primary responsibilities:

- record the effective Zotero project path
- capture the collections that should be synchronized
- capture a bounded, background-safe sync status
- store the last skip/failure reason without turning it into a blocker

The existing human-readable artifact remains:

- `{PROJ}/researcher/ZOTERO_PACKET.md`

`ZOTERO_PACKET.md` summarizes the last attempted sync, collection counts, unresolved metadata cleanup, and any manual follow-up.

### 3. Sync scope

Initial automatic collections:

- `<path>/selected`
- `<path>/baselines`
- `<path>/writing-shortlist`

Deferred collections, enabled when upstream artifacts already exist:

- `<path>/included`
- `<path>/excluded`

The sync packet should be built from workflow-owned project state, not from ad hoc chat memory.

Preferred source inputs:

- `{PROJ}/researcher/PAPER_SOURCE_INDEX.json` for canonical paper identities
- `PROJECT_MANIFEST.json.research_program`
- baseline-related project artifacts when present
- writing/review shortlist artifacts when present

### 4. Manual command

Add a dedicated Discord slash command:

- `/zotero-sync`

Command behavior:

- resolve the current workflow project the same way `/graph-build` and `/resume-pipeline` do
- refresh the workflow-owned Zotero sync packet for that project
- launch a background Researcher continuation for Zotero reconciliation
- return immediately to the foreground user without waiting for Zotero MCP completion

This command is the manual override or catch-up path when the user wants an immediate project bibliography reconciliation outside other research checkpoints.

## Trigger Points

Zotero sync is best-effort and should be refreshed from bounded research checkpoints:

- after `/research-lit` has materially updated canonical paper state
- after workflow-owned literature discovery materializes a meaningful new paper set
- during `/graph-build` as a bounded bibliography refresh pass

These triggers should update the sync packet and then request background sync. They should not run a long Zotero operation inline in the foreground session.

`/zotero-sync` uses the same background-safe contract, but as an explicit user-initiated trigger.

## Reconciliation Policy

`/zotero-sync` is a project-wide reconciliation command, not an append-only importer.

Expected behavior:

- treat workflow-owned project state as the source of truth for membership in `selected`, `baselines`, and `writing-shortlist`
- add missing project papers to the corresponding Zotero collections
- remove papers that no longer belong to the project collections
- keep collection membership aligned with current project state after paper replacement or deletion

Safety rule:

- when a paper no longer belongs to the project, remove it only from the configured project Zotero collections
- do not delete the Zotero item itself
- do not move the Zotero item to trash

## Foreground/Background Contract

This is the key safety rule for the implementation.

### Foreground responsibilities

- compute or refresh the Zotero sync packet
- record that a background sync is wanted
- provide a short user-visible status update if helpful
- return control immediately

### Background responsibilities

- run `/zotero-project-library` or the equivalent Zotero MCP-backed sync step
- update `ZOTERO_SYNC_PACKET.json`
- refresh `ZOTERO_PACKET.md`
- stop on bounded failure and report `skipped`, `unavailable`, or `needs_manual_followup`

### Hard constraints

- the main Researcher conversation must stay responsive
- Zotero sync must never hold the foreground waiting on MCP I/O
- failure to connect to Zotero must never trigger stage rollback
- if a background Zotero sync is already active, the foreground should not start a second conflicting inline sync
- the manual `/zotero-sync` command must also avoid inline Zotero work and must degrade to queued/background execution if runtime subagent access is unavailable

## Failure Policy

Zotero sync outcomes are informational, not blocking.

Allowed terminal states:

- `synced`
- `skipped`
- `unavailable`
- `failed`
- `needs_manual_followup`

Required behavior:

- no stage blocker for any of these non-`synced` states
- persist the last error/skipped reason durably
- keep the rest of literature, graph, and ideation work moving

## Compatibility

- Keep existing docs and prompts that mention `bot/<project-id>` compatible, but update defaults and examples toward `Bot/<project-id>`.
- Do not break projects that already use a lowercase `bot/...` path.
- Preserve the current meaning of `research_program.zotero_project_path`: it is the project bibliography path, not a readiness gate for stage advancement.

## Testing Plan

Add tests for:

- default Zotero path now resolves to `Bot/<project-id>` for new projects
- plugin-global Zotero root defaults to `bot`
- effective default path resolves to `<configured-root>/<project-id>`
- explicit manifest path overrides still win
- `/zotero-sync` registers as a dedicated workflow command and launches a background Researcher continuation
- sync packet generation is non-blocking and survives missing Zotero availability
- research/graph trigger points request background sync instead of inline blocking work
- project reconciliation removes stale papers from project collections without deleting Zotero items
- workflow continues normally when Zotero sync reports `unavailable` or `failed`
- human-readable `ZOTERO_PACKET.md` still updates with path and summary information

## Open Implementation Notes

- The actual Zotero MCP invocation should be wrapped behind workflow-owned helpers so prompt wording is not the only contract.
- The first implementation should prefer the smallest reliable scope: `selected`, `baselines`, `writing-shortlist`, then expand only if the repository already has strong upstream artifacts for `included` and `excluded`.
- If the local Zotero MCP schema differs from assumptions, degrade to `unavailable` cleanly rather than blocking or retry-looping in the foreground.
