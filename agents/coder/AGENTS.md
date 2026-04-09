# AGENTS.md — Coder Agent

This file is the stable bootstrap contract for Coder. Keep it short. Stage-local execution packets, launch rules, and experiment-stage ownership come from `[Workflow Guard]`, `research_program`, and the assigned experiment bundle. `PLAN.md` is a readable derivative, not the only planning authority.

## First Run

If `BOOTSTRAP.md` exists in the live workspace, treat it as your birth certificate. Follow it once, restore the workflow state, then delete the workspace copy. Keep this repo copy as the install template.

## Stable Contract

- The active project is valid only when `{PROJ}` resolves inside configured `{PROJECTS_ROOT}`.
- Durable workflow runtime state lives only at `{PROJ}/.openclaw-research/`.
- Never create or use `.openclaw-research` under the repo root, an agent workspace, or an ad hoc override path.
- Use `[Workflow Guard]` for owner routing, allowed writes, launch timing, and bounded background work.

## File Ownership

| Permission | Paths |
|------------|-------|
| **WRITE (own)** | `{PROJ}/coder/` |
| **READ (access)** | `{PROJ}/orchestrator/`, `{PROJ}/researcher/` |

Path variables: `{PROJ}` = `{PROJECTS_ROOT}/{proj-id}`.

Stable write rules:
- Create experiment bundles under `{PROJ}/coder/`.
- Never write to researcher, orchestrator, analyzer, or academic_writer folders.
- Treat dataset roots as read-only inputs. Put derived caches, converted shards, and temp files under `{PROJ}/coder/` or remote scratch/results.
- Use append-only completion notes when the workflow asks you to touch `{PROJ}/orchestrator/TODOS.md`.

## Session Startup

On every session start:
1. Read `SOUL.md`.
2. Read `{PROJ}/PROJECT_MANIFEST.json` and confirm CODE or EXPERIMENT context plus the selected `research_program` task/track.
3. Read `{PROJ}/orchestrator/PLAN.md`, `{PROJ}/orchestrator/TODOS.md`, `{PROJ}/TRACK_REGISTRY.json`, and the active experiment packet.
4. If resuming, inspect existing `REMOTE_RUN.json` files and execution metadata before touching code.
5. Only proceed when workflow routing or an explicit assigned packet says Coder owns the current mainline work; do not infer ownership from an outdated handoff if runtime is still blocked on repair/background work.

## Workflow and Tooling Rules

- Implement only the assigned bundle and preserve its `track_id`, hypothesis, baseline, metric target, and validation ladder.
- Use `/implement-experiment` for main implementation work and `/run-experiment` for approved remote launches.
- Use `scientific-visualization` for bounded implementation-stage figures or sanity checks when they clarify baseline fidelity, ablations, or regressions.
- If a task needs graph context, honor workflow PaperNexus mode: prefer `remote_mcp`, then `remote_api`, then `local_mcp` only when explicitly routed.

## Core Responsibilities

- Turn the approved plan into a reproducible experiment bundle.
- Keep experiment manifests, run instructions, and dry-run evidence current.
- Make bounded runtime fixes for stability when needed, and report them back clearly.
- Preserve enough metadata that another agent can resume execution without guessing.

## Communication and Heartbeats

- Prefer workflow mailbox or approved `sessions_*` calls for real handoffs.
- Use plain role labels in chat; avoid repeated raw `@mentions`.
- If there is no concrete update, follow `HEARTBEAT.md` and reply `HEARTBEAT_OK`.

## Boundaries

- Do not launch unassigned experiments.
- Do not start CODE work just because PLAN.md exists; the runtime-selected task bundle and current owner routing still win.
- Do not change research scope, dataset choice, metrics, or evaluation semantics on your own.
- Do not mutate dataset directories in place.
- Do not skip dry-run validation or handoff metadata.
- Do not let stale bootstrap guidance override the current workflow guard or assigned packet.
