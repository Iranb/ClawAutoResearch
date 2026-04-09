# Unified Artifact-Backed Workflow Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce one artifact-backed derived-state contract that unifies file-backed workflow readiness, auto-iterator action generation, and agent handoff eligibility so workflow-owned artifacts and dispatch behavior stop disagreeing.

**Architecture:** Build a shared derived-state layer for track evidence and stage readiness, then route stage guards, auto-iterator, handoff dispatch, and snapshot diagnostics through that layer. Keep story-support evidence semantics explicit and lightweight: the workflow should recognize and repair graph-backed narrative support without forcing coder design alignment or making optional integrations into hard blockers.

**Tech Stack:** TypeScript, Node.js filesystem helpers, existing workflow guard/runtime/service modules, Node test runner.

---

## Scope Summary

This plan replaces divergent ad hoc checks with one shared contract:

- file-backed workflow artifacts become first-class readiness inputs
- stage readiness becomes a structured result instead of scattered booleans
- dispatchable `drive_stage` actions are only emitted when the stage is actually ready for owner work
- repairable gaps become repair/background actions instead of premature handoffs

## Parallel Execution Strategy

These tasks are designed for parallel workers with disjoint write scopes after the controller lands the plan:

- **Worker A:** Derived-state foundation
- **Worker B:** Guard and preflight integration
- **Worker C:** Auto-iterator and handoff gating
- **Worker D:** Snapshot/prompt diagnostics

The controller owns final cross-task integration, conflict resolution, and the full verification pass.

## File Map

**Create:**

- `tools/workflow-derived-state/track-evidence.ts`
- `tools/workflow-derived-state/stage-readiness.ts`
- `tools/workflow-derived-state/handoff-eligibility.ts`
- `tools/workflow-derived-state/diagnostics.ts`
- `tests/workflow-derived-state.test.mjs`

**Modify:**

- `tools/workflow-guard-track-evidence.ts`
- `tools/workflow-guard.ts`
- `tools/workflow-guard-stages/ideation-stage-signals.ts`
- `tools/workflow-guard-runtime/stage-preflight.ts`
- `tools/literature-discovery/materializer.ts`
- `tools/workflow-guard-materializers/ideation-contract-materializer.ts`
- `tools/workflow-guard-runtime/auto-iterator.ts`
- `tools/register-workflow-tools.ts`
- `tools/register-workflow-service.ts`
- `tools/workflow-guard-project/snapshot-builder.ts`
- `tools/workflow-commands/formatters.ts`
- `tools/workflow-guard-prompt-assembly.ts`
- `tests/auto-iterator.test.mjs`
- `tests/workflow-runtime-tools.test.mjs`
- `tests/workflow-service.test.mjs`
- `tests/workflow-guard-snapshot-builder.test.mjs`
- `tests/workflow-prompt-ownership.test.mjs`

## Task 1: Build the Shared Derived-State Foundation

**Owner:** Worker A

**Files:**

- Create: `tools/workflow-derived-state/track-evidence.ts`
- Create: `tools/workflow-derived-state/stage-readiness.ts`
- Create: `tools/workflow-derived-state/handoff-eligibility.ts`
- Create: `tools/workflow-derived-state/diagnostics.ts`
- Create: `tests/workflow-derived-state.test.mjs`
- Modify: `tools/workflow-guard-track-evidence.ts`

- [ ] **Step 1: Write failing derived-state tests**

Add tests that cover:

- inline-only evidence
- file-backed evidence under `<reasoning_packet_dir>/GRAPH_EVIDENCE.json`
- alias support for `graph_innovation_evidence`
- invalid or empty artifact payloads
- handoff eligibility when blocking signals remain

Run:

```bash
node --test tests/workflow-derived-state.test.mjs
```

Expected: FAIL on missing modules or missing behaviors.

- [ ] **Step 2: Implement track-evidence resolution**

Create `track-evidence.ts` with functions that:

- normalize canonical inline fields
- read workflow-owned artifact-backed evidence from `reasoning_packet_dir`
- merge inline and artifact-backed evidence deterministically
- emit diagnostics and `repairable` metadata

Keep accepted aliases explicit and finite.

- [ ] **Step 3: Implement stage-readiness and handoff-eligibility helpers**

Create helpers that:

- turn derived facts into structured readiness
- separate `blockingSignals` from `repairableSignals`
- decide whether the workflow may emit `drive_stage`, `repair_artifact`, or only `background` work

- [ ] **Step 4: Keep legacy helper exports compatible**

Update `tools/workflow-guard-track-evidence.ts` so existing callers can gradually move to the new modules without a flag day.

- [ ] **Step 5: Re-run the focused foundation tests**

Run:

```bash
node --test tests/workflow-derived-state.test.mjs
```

Expected: PASS.

## Task 2: Route Guard and Preflight Checks Through Derived State

**Owner:** Worker B

**Files:**

- Modify: `tools/workflow-guard.ts`
- Modify: `tools/workflow-guard-stages/ideation-stage-signals.ts`
- Modify: `tools/workflow-guard-runtime/stage-preflight.ts`
- Modify: `tools/literature-discovery/materializer.ts`
- Modify: `tools/workflow-guard-materializers/ideation-contract-materializer.ts`
- Modify: `tests/auto-iterator.test.mjs`
- Modify: `tests/workflow-runtime-tools.test.mjs`

- [ ] **Step 1: Add failing regressions for artifact-backed readiness**

Cover cases where:

- active tracks have valid per-track `GRAPH_EVIDENCE.json`
- canonical arrays are absent or stale
- guard/preflight should still classify the track as file-backed or repairable

Run:

```bash
node --test tests/auto-iterator.test.mjs tests/workflow-runtime-tools.test.mjs
```

Expected: FAIL on current guard/preflight behavior.

- [ ] **Step 2: Update stage-signal collection to use derived readiness**

Modify idea-stage checks so they do not call a bare inline-only boolean. They should consume the shared derived-state result and preserve current user-facing signal wording where possible.

- [ ] **Step 3: Update stage preflight to use repairable readiness**

If artifact-backed evidence exists but canonical arrays are not materialized yet, treat the stage as repairable and allow workflow-owned preparation/materialization to close the gap.

- [ ] **Step 4: Keep literature discovery and ideation materialization aligned**

Use the new resolver so:

- literature-discovery gap detection
- ideation contract materialization
- canonical track-field backfill

all agree on what counts as usable graph-backed evidence.

- [ ] **Step 5: Re-run the focused guard/preflight regressions**

Run:

```bash
node --test tests/auto-iterator.test.mjs tests/workflow-runtime-tools.test.mjs
```

Expected: PASS for the new cases.

## Task 3: Gate Auto-Iterator Actions and Handoffs With the Same Contract

**Owner:** Worker C

**Files:**

- Modify: `tools/workflow-guard-runtime/auto-iterator.ts`
- Modify: `tools/register-workflow-tools.ts`
- Modify: `tools/register-workflow-service.ts`
- Modify: `tests/workflow-service.test.mjs`

- [ ] **Step 1: Add failing handoff regressions**

Add tests showing that:

- missing stage signals should not still produce a dispatchable `drive_stage`
- repairable artifact gaps should produce repair/background guidance instead of stage handoff
- service dispatch should respect the same handoff eligibility contract as tool-side dispatch

Run:

```bash
node --test tests/workflow-service.test.mjs
```

Expected: FAIL on current dispatch behavior.

- [ ] **Step 2: Update auto-iterator action generation**

Change `recommendedActions` generation so `drive_stage` is only emitted when stage readiness says owner work can proceed.

If the stage is not ready:

- emit a repair-oriented action when the gap is workflow-repairable
- keep background research opportunities separate
- preserve human-gate behavior

- [ ] **Step 3: Update handoff decision points**

Make both tool-side and service-side dispatch paths check the same derived handoff eligibility result before launching or queuing a stage handoff.

- [ ] **Step 4: Preserve non-blocking background work**

Do not regress idle research or other background opportunities. The main workflow may stay responsive while background repair or discovery work runs.

- [ ] **Step 5: Re-run the focused dispatch tests**

Run:

```bash
node --test tests/workflow-service.test.mjs
```

Expected: PASS.

## Task 4: Surface Unified Diagnostics in Snapshots and Prompts

**Owner:** Worker D

**Files:**

- Modify: `tools/workflow-guard-project/snapshot-builder.ts`
- Modify: `tools/workflow-commands/formatters.ts`
- Modify: `tools/workflow-guard-prompt-assembly.ts`
- Modify: `tests/workflow-guard-snapshot-builder.test.mjs`
- Modify: `tests/workflow-prompt-ownership.test.mjs`

- [ ] **Step 1: Add failing diagnostic regressions**

Add tests showing that snapshots and prompts should distinguish:

- truly missing evidence
- file-backed but not yet canonicalized evidence
- repairable workflow-owned gaps
- stale blocking reasons that should clear once derived readiness is satisfied

Run:

```bash
node --test tests/workflow-guard-snapshot-builder.test.mjs tests/workflow-prompt-ownership.test.mjs
```

Expected: FAIL where diagnostics still only mirror old blocking strings.

- [ ] **Step 2: Add compact derived diagnostics to snapshots**

Expose enough structured detail for agent prompts and status text to explain why the workflow is blocked and whether the gap is repairable.

- [ ] **Step 3: Update formatter/prompt wording**

Keep output concise, but make it clear whether the workflow should:

- continue stage work
- repair workflow-owned artifacts
- wait on a human gate
- run only background research

- [ ] **Step 4: Re-run the focused diagnostics tests**

Run:

```bash
node --test tests/workflow-guard-snapshot-builder.test.mjs tests/workflow-prompt-ownership.test.mjs
```

Expected: PASS.

## Task 5: Controller Integration and Verification

**Owner:** Controller

**Files:**

- Modify only as needed after worker merges

- [ ] **Step 1: Merge worker outputs without reverting unrelated user changes**

Read each worker patch carefully and resolve interface mismatches in the controller session.

- [ ] **Step 2: Run targeted integration coverage**

Run:

```bash
node --test tests/workflow-derived-state.test.mjs tests/auto-iterator.test.mjs tests/workflow-runtime-tools.test.mjs tests/workflow-service.test.mjs tests/workflow-guard-snapshot-builder.test.mjs tests/workflow-prompt-ownership.test.mjs
```

Expected: PASS.

- [ ] **Step 3: Run the project build**

Run:

```bash
npm run build
```

Expected: successful TypeScript build.

- [ ] **Step 4: Run diff hygiene checks**

Run:

```bash
git diff --check
```

Expected: no whitespace or merge-marker issues.

- [ ] **Step 5: Prepare the branch for review**

Summarize:

- the new derived-state contract
- handoff behavior changes
- diagnostics changes
- verification evidence

Do not merge until the human reviews the final result.
