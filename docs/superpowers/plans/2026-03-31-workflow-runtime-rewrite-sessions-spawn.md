# Workflow Runtime Rewrite With sessions_spawn Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current workflow execution control plane with a durable `sessions_spawn + announce + recovery` runtime, while preserving the existing project state files and supporting migration of old projects into the new framework without forcing rebuilds.

**Architecture:** Keep the current decision layer (`PROJECT_MANIFEST.json`, `auto_iterator_tick`, workflow guard, mailbox, bindings) as the source of truth for workflow facts, but rewrite the execution layer into a persistent orchestrator that records transition intents, runtime sessions, announce events, and broadcast outboxes inside each project. The new runtime must survive OpenClaw restarts, resume or repair in-flight work, and degrade explicitly back to legacy dispatch only when the new path fails.

**Tech Stack:** TypeScript, Node.js built-in test runner, existing workflow guard/service/tool infrastructure, OpenClaw runtime bindings

**Progress Snapshot (2026-04-03):**
- Implemented: project-local runtime state files, orchestrator transition intents, session persistence, degraded fallback tracking, announce outbox persistence, durable broadcast outbox replay, recovery helpers, persistent workflow binding metadata, prompt/hook cutover, auto-stage/mitigation/background-run orchestrator launch paths, gate/discussion child-launch persistence, project-local `workflow-events.jsonl`, project-local `workflow-trace.jsonl` with `/tmp` debug mirror only, explicit project-scoped queue/session storage, and a full `setup -> ... -> done` end-to-end lifecycle test that simulates legacy-project migration plus manual `GATE-5` approval.
- Remaining: follow-up hardening can continue in separate plans, but the main `sessions_spawn + announce + recovery` rewrite contract is now implemented and verified.

---

### Task 1: Lock the rewrite contract with failing tests

**Files:**
- Create: `tests/workflow-runtime-orchestrator.test.mjs`
- Modify: `tests/workflow-service.test.mjs`
- Modify: `tests/workflow-commands.test.mjs`
- Modify: `tests/stage-broadcast.test.mjs`
- Modify: `tests/channel-project-bindings.test.mjs`

- [x] **Step 1: Add tests for durable transition intents**

Write failing tests showing:
- a stage decision writes a durable transition intent before any spawn happens
- spawn is not attempted when intent persistence fails
- legacy fallback is only used after explicit new-runtime failure

- [x] **Step 2: Add tests for session registry persistence and recovery**

Write failing tests showing:
- spawned workflow sessions are recorded in a project-local runtime session file
- a restart can reload active sessions and continue
- orphan sessions become `needs_repair` instead of silently disappearing

- [x] **Step 3: Add tests for announce inbox/outbox behavior**

Write failing tests showing:
- child completion is persisted before parent synthesis
- nested child results stay internal by default
- top-level stage handoff/status completion reaches channel broadcast through the outbox

- [x] **Step 4: Add tests for broadcast outbox and idempotent retry**

Write failing tests showing:
- a failed broadcast is retained and retried
- repeated retries do not duplicate channel-visible updates
- `recovered_after_restart` can be emitted exactly once after recovery

- [x] **Step 5: Add migration tests for legacy projects**

Write failing tests showing:
- a project with only existing manifest/mailbox/binding files can be migrated lazily
- migration does not rewrite completed stages
- migration initializes runtime state files without deleting old records

### Task 2: Introduce project-local runtime state primitives

**Files:**
- Create: `tools/workflow-runtime-state.ts`
- Modify: `DOC/reference/state-files.md`
- Modify: `templates/PROJECT_MANIFEST.json`

- [x] **Step 1: Define runtime state types and paths**

Add durable file helpers and normalized types for:
- `workflow-runtime-queue.json`
- `workflow-runtime-sessions.json`
- `workflow-announce-outbox.json`
- `workflow-broadcast-outbox.json`
- `workflow-events.jsonl`

- [x] **Step 2: Keep new runtime state strictly separate from workflow fact state**

Ensure:
- manifest stays the source of truth for `stage`, `owner`, `blocking_reason`, `next_action`
- runtime files only describe execution, retry, broadcast, and recovery state

- [x] **Step 3: Add versioned migration metadata**

Expose helpers for:
- runtime framework version
- migration status
- compatibility mode (`legacy_dispatch`, `hybrid_runtime`, `sessions_spawn_runtime`)

### Task 3: Build the workflow session orchestrator

**Files:**
- Create: `tools/workflow-session-orchestrator.ts`
- Modify: `tools/register-workflow-service.ts`
- Modify: `tools/workflow-fast-paths.ts`

- [x] **Step 1: Implement transition intent creation**

Add orchestrator entrypoints that:
- accept a decision-layer action
- write a durable transition intent
- choose runtime mode
- return a structured launch decision without immediately mutating workflow facts

- [x] **Step 2: Implement spawn/resume execution**

Add orchestrator helpers that:
- invoke `sessions_spawn`-style runtime execution
- persist the resulting session identity and lineage
- support persistent thread/session binding for long-lived owner agents

- [x] **Step 3: Implement explicit degraded fallback**

If the new runtime cannot spawn or resume:
- mark the intent as degraded
- record the reason and attempt count
- optionally route to legacy dispatch
- emit a structured recovery/broadcast note

### Task 4: Replace ad hoc background queue logic with durable runtime queueing

**Files:**
- Modify: `tools/workflow-fast-paths.ts`
- Modify: `tools/register-workflow-service.ts`
- Modify: `tests/workflow-service.test.mjs`

- [x] **Step 1: Move queue/registry off `/tmp`**

Replace project-critical `/tmp` queue/registry usage with project-local runtime state.

- [x] **Step 2: Preserve only non-authoritative temp traces in `/tmp`**

Keep `/tmp` only for disposable diagnostics. Recovery-critical data must come from project-local files.

- [x] **Step 3: Port existing auto-stage and mitigation queue flows**

Rewire:
- auto-stage dispatch
- mitigation dispatch
- discussion reviewer queueing
- background run continuation

to the new runtime queue model.

### Task 5: Add announce persistence and parent synthesis

**Files:**
- Create: `tools/workflow-announce-runtime.ts`
- Modify: `tools/register-workflow-service.ts`
- Modify: `tools/stage-broadcast.ts`
- Modify: `tests/workflow-runtime-orchestrator.test.mjs`

Implementation note for this slice:
- expose `consumeWorkflowAnnounceOutbox` for parent grouping, dedupe, and orphan handling
- expose `replayWorkflowBroadcastOutbox` for durable, idempotent broadcast retries
- keep service wiring thin so announce/recovery behavior can be called from the new runtime without rewriting the dispatcher again

- [x] **Step 1: Persist child completion before parent handling**

Record every child completion into `workflow-announce-outbox.json` before synthesis.

- [x] **Step 2: Distinguish internal and external delivery modes**

Support:
- nested/internal announce (`deliver=false`)
- workflow key-node broadcast (`deliver=true`)

- [x] **Step 3: Add duplicate suppression**

Prevent repeated announce replay and repeated channel status delivery using stable ids and idempotency keys.

### Task 6: Rebuild channel status delivery around a durable broadcast outbox

**Files:**
- Modify: `tools/stage-broadcast.ts`
- Modify: `tools/register-workflow-service.ts`
- Modify: `tests/stage-broadcast.test.mjs`

- [x] **Step 1: Convert stage/status broadcasts into outbox-backed sends**

Before sending to channel:
- write a broadcast record
- allocate an idempotency key
- mark delivery status transitions explicitly

- [x] **Step 2: Keep the current visible message shape**

Retain the existing canonical block:
- `[STATUS]`
- `[HANDOFF]`
- `[ARTIFACTS]`
- `[NEXT]`

Also preserve:
- one raw `@next-owner` at most
- sanitized follow-up replies

- [x] **Step 3: Restrict external broadcasts to key workflow nodes**

Only emit channel-visible updates for:
- `queued`
- `started`
- `waiting_on_children`
- `child_completed`
- `handoff_ready`
- `handed_off`
- `blocked`
- `timed_out`
- `recovered_after_restart`

### Task 7: Extend channel/thread binding into persistent runtime session binding

**Files:**
- Modify: `tools/channel-project-bindings.ts`
- Modify: `tools/workflow-subagent-sessions.ts`
- Modify: `tests/channel-project-bindings.test.mjs`

- [x] **Step 1: Preserve current project binding behavior**

Do not break the existing:
- channel -> project binding
- session sample lookup
- project-root resolution

- [x] **Step 2: Add runtime session binding metadata**

Add binding helpers for:
- project + role -> persistent workflow session
- parent session -> child session lineage
- optional thread binding keys for persistent owner agents

Also persist the normalized runtime binding fields alongside the existing channel binding record so lookup still works while future runtime orchestration can recover:
- `workflowRole`
- `workflowSessionKey`
- `workflowSessionId`
- `parentWorkflowSessionKey`
- `threadBindingKey`
- `depth`
- `lineageKey`
- `workflowBindingMode`

- [x] **Step 3: Add degraded thread fallback**

If thread creation/binding fails:
- continue in degraded channel mode when safe
- record the degraded reason
- allow later rebind

### Task 8: Add crash recovery and continue semantics

**Files:**
- Create: `tools/workflow-runtime-recovery.ts`
- Modify: `tools/register-workflow-service.ts`
- Modify: `tools/workflow-fast-paths.ts`
- Modify: `tests/workflow-runtime-orchestrator.test.mjs`

Implementation note for this slice:
- expose `buildWorkflowRuntimeRecoveryPlan` as the ordered view of pending announce/broadcast/queue/session work
- expose `recoverWorkflowRuntimeState` as the ordered sweep that the main service can call after restart
- keep the helper self-contained so it can be reused by future sessions_spawn integration without duplicating recovery rules

- [x] **Step 1: Add startup/project recovery sweep**

On recovery, inspect:
- runtime queue
- session registry
- announce outbox
- broadcast outbox
- current manifest owner/stage

- [x] **Step 2: Implement ordered repair**

Recovery order:
1. unconsumed announce events
2. pending broadcasts
3. queued transition intents
4. stale active sessions
5. degraded fallback entries needing retry

- [x] **Step 3: Define `continue` as checkpoint resume, not blind rerun**

Prefer:
- reattaching to an active persistent session
- replaying from durable announce/broadcast checkpoints
- only then re-dispatching from the last durable transition intent

### Task 9: Add legacy-project migration support

**Files:**
- Create: `tools/workflow-runtime-migration.ts`
- Modify: `tools/register-workflow-tools.ts`
- Modify: `tools/register-workflow-service.ts`
- Modify: `tests/workflow-runtime-orchestrator.test.mjs`

- [x] **Step 1: Implement lazy migration**

When an old project is touched by:
- `workflow-status`
- `auto_iterator_tick`
- `resume-pipeline`
- coordinator pass

initialize the new runtime files from current project state.

- [x] **Step 2: Add explicit migration action**

Expose a tool action such as:
- `research_workflow.migrate_runtime_state`

Support:
- normal run
- dry run
- diagnostics summary

- [x] **Step 3: Keep migration non-destructive**

Migration must:
- never delete old files
- never reset completed stages
- never clear mailbox/contact history
- never require project rebuild

### Task 10: Update workflow prompts and guardrails for the new execution model

**Files:**
- Modify: `tools/workflow-guard.ts`
- Modify: `tools/register-workflow-hooks.ts`
- Modify: `DOC/concepts/workflow-and-auto-iterator.md`
- Modify: `DOC/reference/configuration.md`

- [x] **Step 1: Teach the prompt about the new control plane**

Explain that:
- `auto_iterator_tick` remains the decision boundary
- execution now happens through the workflow runtime/session orchestrator
- child completions are announce-driven
- non-owner guidance should prefer runtime/orchestrator handoff first, with `dispatch_task` / `sessions_send` / mailbox only as compatibility fallback

- [x] **Step 2: Preserve bounded communication and anti-spam rules**

Keep:
- mention normalization
- cooldown protection
- non-owner restrictions

while allowing coordinator-safe nested execution.

- [x] **Step 3: Add recovery-aware guidance**

Tell agents:
- do not re-run blindly after restart
- prefer resume/recovery paths
- expect channel-visible updates at key nodes only

### Task 11: Migrate traces and audit logs to durable runtime events

**Files:**
- Modify: `tools/workflow-trace.ts`
- Modify: `tools/register-workflow-service.ts`
- Modify: `DOC/reference/state-files.md`

- [x] **Step 1: Keep append-only event logging project-local**

Move workflow-critical event logs from `/tmp` into project-local `workflow-events.jsonl`.

- [x] **Step 2: Preserve temp traces only for debug convenience**

Do not rely on temp logs for recovery.

- [x] **Step 3: Record fallback and degraded states explicitly**

Every fallback event must include:
- source node
- fallback target
- reason
- retry budget
- whether human intervention is required

### Task 12: Verify the rewrite in progressive slices

**Files:**
- Test: `tests/workflow-runtime-orchestrator.test.mjs`
- Test: `tests/workflow-service.test.mjs`
- Test: `tests/stage-broadcast.test.mjs`
- Test: `tests/channel-project-bindings.test.mjs`
- Test: `tests/workflow-guard-boundaries.test.mjs`

- [x] **Step 1: Run targeted runtime rewrite tests**

Run: `node --test tests/workflow-runtime-orchestrator.test.mjs tests/workflow-service.test.mjs tests/stage-broadcast.test.mjs tests/channel-project-bindings.test.mjs tests/workflow-guard-boundaries.test.mjs`
Expected: PASS

- [x] **Step 2: Run the broader workflow regression suite**

Run: `node --test tests/workflow-prompt-ownership.test.mjs tests/workflow-commands.test.mjs tests/researcher-paper-ingestion-skills.test.mjs`
Expected: PASS

- [x] **Step 3: Run the TypeScript build**

Run: `npm run build`
Expected: PASS

- [x] **Step 4: Run one old-project migration simulation**

Create or reuse a fixture with only the legacy manifest/mailbox/binding files populated, then verify that migration initializes the new runtime state and can continue without rebuilding the project.
