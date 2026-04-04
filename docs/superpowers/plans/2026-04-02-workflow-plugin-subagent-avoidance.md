# Workflow Plugin-Subagent Avoidance Plan

> **Status:** PARTIALLY COMPLETE

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reshape `openclaw-research` so critical workflow paths no longer depend on plugin-internal `runtime.subagent.*` execution, minimizing `Plugin runtime subagent methods are only available during a gateway request` failures even before `openclaw` upstream is fully fixed.

**Architecture:** Keep workflow-owned orchestration, durable queueing, announce, and broadcast as the primary execution substrate. Treat plugin delegated subagent usage as best-effort enhancement only. All critical slash commands and workflow stage transitions must be queue-first, stateful, and replayable without relying on plugin tool internal subagent dispatch.

**Tech Stack:** TypeScript, Node.js built-in test runner, existing workflow runtime state/orchestrator, plugin wrapper tools, slash command surfaces, agent/skill markdown docs

---

### Task 1: Lock the avoidance contract with failing tests

**Files:**
- Modify: `tests/workflow-commands.test.mjs`
- Modify: `tests/workflow-fast-paths.test.mjs`
- Modify: `tests/workflow-service.test.mjs`
- Modify: `tests/workflow-runtime-tools.test.mjs`
- Modify: `tests/workflow-guard-boundaries.test.mjs`

- [ ] **Step 1: Add failing tests for queue-first slash commands**

Cover:
- `/research-pipeline`
- `/research-queue`
- `/resume-pipeline`
- `/workflow-status`

Expected behavior:
- runtime unavailable never causes immediate hard failure on critical path
- commands reply with queued or replay status
- replay uses durable workflow queue, not plugin delegated subagent directly

- [ ] **Step 2: Add failing tests for critical tool launches**

Cover:
- PaperNexus wrapper launch
- brainstorm cycle launch
- experiment monitor launch

Expected behavior:
- tool metadata or runtime decision marks them as workflow-owned
- critical launches do not require plugin delegated subagent contract

- [ ] **Step 3: Add failing tests for degraded enhancement paths**

Expected behavior:
- optional enhancement tools may degrade
- stage progression does not block on enhancement-only delegated work
- user sees structured warning rather than raw gateway-request runtime error

### Task 2: Classify workflow actions by runtime dependency

**Files:**
- Modify: `tools/workflow-fast-paths.ts`
- Modify: `tools/register-workflow-tools.ts`
- Modify: `tools/register-workflow-service.ts`
- Modify: `tools/workflow-runtime-state.ts`

- [ ] **Step 1: Introduce explicit runtime dependency labels**

Add structured classification for workflow actions such as:
- `workflow_owned`
- `plugin_best_effort`
- `forbidden_plugin_subagent_critical`

- [ ] **Step 2: Persist runtime contract decisions**

Store enough metadata to explain:
- why a launch used queue-first
- whether plugin delegated subagent was forbidden
- whether a degraded fallback occurred

- [ ] **Step 3: Emit workflow events for contract-driven routing**

Record events such as:
- `plugin_subagent_forbidden_for_critical_path`
- `queued_due_to_runtime_unavailable`
- `replayed_from_workflow_queue`
- `enhancement_degraded`

### Task 3: Make critical slash commands uniformly queue-first

**Files:**
- Modify: `tools/workflow-commands.ts`
- Modify: `tools/workflow-fast-paths.ts`
- Modify: `DOC/reference/slash-commands.md`

- [ ] **Step 1: Normalize all four key slash commands**

Ensure all of the following share the same contract:
- `/research-pipeline`
- `/research-queue`
- `/resume-pipeline`
- `/workflow-status`

- [ ] **Step 2: Ensure replay is opportunistic and durable**

When runtime access returns:
- replay queued work through workflow runtime
- skip plugin delegated subagent shortcuts on critical path

- [ ] **Step 3: Keep user-visible status concise and explicit**

Message shape should say:
- queued
- started
- replayed
- blocked
- needs_repair

Do not expose raw `Plugin runtime subagent methods are only available during a gateway request` unless no safer wrapper message exists.

### Task 4: Move PaperNexus / graph / brainstorm critical launches to workflow-owned dispatch

**Files:**
- Modify: `tools/register-workflow-tools.ts`
- Modify: `tools/workflow-fast-paths.ts`
- Modify: `tools/workflow-guard.ts`
- Modify: `tools/graph-presence.ts`

- [ ] **Step 1: Treat PaperNexus wrapper launch as workflow-owned**

Critical actions must:
- queue and replay through workflow runtime
- write durable state first
- expose progress through `set_paper_ingestion`

- [ ] **Step 2: Treat graph readiness and brainstorm refresh as workflow-owned**

Do not let `/graph-build` or brainstorm refresh depend on plugin delegated subagent as a hard requirement.

- [ ] **Step 3: Distinguish enhancement from critical bundle generation**

If a typed brief / extra synthesis path uses delegated subagent internally:
- mark it enhancement-only
- degrade safely when unavailable

### Task 5: Strengthen workflow prompt and guard language

**Files:**
- Modify: `tools/workflow-guard.ts`
- Modify: `tools/register-workflow-hooks.ts`
- Modify: `WORKFLOW.md`

- [ ] **Step 1: Rewrite critical-path instructions**

Tell agents:
- use `research_workflow.*` for critical execution
- prefer workflow-owned queue / orchestrator
- do not rely on plugin tool internal subagent dispatch for stage-critical work

- [ ] **Step 2: Add hard wording for plugin enhancement paths**

Document that plugin delegated subagent is:
- best-effort only
- not a guaranteed runtime contract
- forbidden as a hard dependency for critical workflow actions

- [ ] **Step 3: Update status / blocking wording**

Make blocking reasons explain:
- runtime unavailable
- queued for replay
- workflow-owned continuation pending

### Task 6: Update agent and skill docs to match the new contract

**Files:**
- Modify: `agents/researcher/AGENTS.md`
- Modify: `agents/researcher/SOUL.md`
- Modify: `agents/researcher/TOOLS.md`
- Modify: `agents/reviewer/AGENTS.md`
- Modify: `agents/coder/AGENTS.md`
- Modify: `skills/researcher/research-pipeline/SKILL.md`
- Modify: `skills/researcher/resume-pipeline/SKILL.md`
- Modify: `skills/researcher/graph-build/SKILL.md`
- Modify: `skills/researcher/research-lit/SKILL.md`
- Modify: `skills/researcher/papernexus/SKILL.md`
- Modify: `skills/researcher/papernexus-batch-import/SKILL.md`
- Modify: `skills/researcher/papernexus-research-chains/SKILL.md`
- Modify: `skills/researcher/monitor-experiment/SKILL.md`

- [ ] **Step 1: Update Researcher critical workflow guidance**

Clarify:
- workflow-owned background continuation is the default
- plugin delegated subagent is not reliable enough for critical stage progression

- [ ] **Step 2: Update brainstorm / graph / monitor skills**

Clarify:
- progress must be written to durable workflow state
- free-form child replies are optional, not authoritative

- [ ] **Step 3: Update reviewer/coder expectations where needed**

Clarify:
- review and code gates must consume durable artifacts
- they should not depend on plugin subagent reply chains

### Task 7: Add runtime-availability preflight helpers

**Files:**
- Modify: `tools/workflow-fast-paths.ts`
- Modify: `tools/register-workflow-tools.ts`
- Modify: `tools/workflow-commands.ts`

- [ ] **Step 1: Centralize runtime unavailability detection**

Use a single helper to recognize:
- gateway-request errors
- unavailable plugin subagent errors
- missing runtime access states

- [ ] **Step 2: Add structured preflight routing**

Before launch:
- critical actions route to queue-first
- enhancement actions may attempt best-effort inline execution

- [ ] **Step 3: Keep replay and cooldown behavior consistent**

Ensure:
- replay is explicit
- retry backoff is recorded
- status remains visible in workflow files and channel output

### Task 8: Improve operator-facing documentation

**Files:**
- Modify: `DOC/reference/skills.md`
- Modify: `DOC/reference/slash-commands.md`
- Modify: `DOC/overview.md`
- Modify: `DOC/overview_zh.md`
- Modify: `DOC/web/workflow-handbook.html`

- [ ] **Step 1: Document the runtime boundary**

Explain clearly:
- why plugin delegated subagent is not guaranteed
- why queue-first exists
- which paths are workflow-owned

- [ ] **Step 2: Document the recommended operator response**

When a command is queued:
- run `/workflow-status`
- let coordinator replay
- inspect queue/session state before retrying manually

- [ ] **Step 3: Update the bilingual web handbook**

Add a section covering:
- runtime availability
- queue-first slash commands
- why critical workflow no longer trusts plugin delegated subagent

### Task 9: Verification and rollout

**Files:**
- Modify: `docs/superpowers/plans/2026-04-02-workflow-plugin-subagent-avoidance.md`

- [x] **Step 1: Run targeted tests**

Run:
- `node --test tests/workflow-commands.test.mjs tests/workflow-fast-paths.test.mjs tests/workflow-service.test.mjs tests/workflow-runtime-tools.test.mjs tests/workflow-guard-boundaries.test.mjs`

- [x] **Step 2: Run build verification**

Run:
- `npm run build`

- [x] **Step 3: Update progress snapshot in this plan**

Record:
- implemented slices
- remaining reliance on upstream `openclaw`
- any still-open critical fallback paths

---

## Notes

## Progress Snapshot

- Critical slash commands now follow a queue-first contract with durable replay rather than hard-failing on plugin runtime subagent unavailability.
- The queue and background run registry no longer silently fall back to ephemeral `/tmp` paths without explicit test overrides.
- Critical PaperNexus and graph-refresh progress flows persist through `research_workflow.set_paper_ingestion`, including completion and timeout status updates.
- Remaining gaps still depend on the broader runtime rewrite plan: durable broadcast outbox completion, persistent session reattachment, and deeper crash recovery.

- This plan is intentionally scoped to `openclaw-research`.
- If upstream `openclaw` later lands a full fix for `#50131`, this plan still remains useful because queue-first critical workflow execution is a stronger contract than ad-hoc delegated plugin subagent execution.
