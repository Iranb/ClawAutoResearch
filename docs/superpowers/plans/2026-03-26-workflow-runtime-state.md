# Workflow Runtime State Implementation Plan

> **Status:** COMPLETE

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist writer/reviewer runtime state in `PROJECT_MANIFEST.json`, expose summaries, surface the data in workflow snapshots/status output, and gate `write` stage progression on the new runtime readiness signals.

**Architecture:** Extend `tools/workflow-guard.ts` using the existing `citation_integrity` pattern: normalize/serialize manifest state, expose summary and setter APIs, feed the normalized state into `buildWorkflowSnapshot`, and format the extra fields in `workflow-status` output. Reuse those same normalized states inside the `write` stage gate so the workflow auto iterator blocks until writing and graph-guided evidence coverage are ready.

**Tech Stack:** TypeScript, Node.js built-in test runner, existing workflow guard utilities in `tools/workflow-guard.ts`

---

### Task 1: Reproduce the missing runtime-state behavior

**Files:**
- Modify: `docs/superpowers/plans/2026-03-26-workflow-runtime-state.md`
- Test: `tests/writer-reviewer-runtime-state.test.mjs`
- Test: `tests/workflow-commands.test.mjs`

- [x] **Step 1: Run the new runtime-state test file**

Run: `node --test tests/writer-reviewer-runtime-state.test.mjs`
Expected: FAIL because writer/reviewer runtime state APIs are not exported or not wired through manifest/snapshot logic yet.

- [x] **Step 2: Run the workflow-status regression test**

Run: `node --test tests/workflow-commands.test.mjs`
Expected: FAIL in the workflow-status coverage that now expects writing/review/graph-guided lines.

### Task 2: Add manifest-backed runtime-state APIs

**Files:**
- Modify: `tools/workflow-guard.ts`
- Test: `tests/writer-reviewer-runtime-state.test.mjs`

- [x] **Step 1: Implement getter summary APIs**

Add `getWritingSessionStateSummary`, `getReviewSessionStateSummary`, and `getGraphGuidedWritingStateSummary` that mirror the citation-integrity summary shape and resolve key artifact paths/existence where useful.

- [x] **Step 2: Implement setter APIs**

Add `setWritingSessionState`, `setReviewSessionState`, and `setGraphGuidedWritingState`, each reading the current manifest, applying a normalized patch, serializing back into `PROJECT_MANIFEST.json`, and returning the normalized state payload.

- [x] **Step 3: Keep defaults and normalization aligned**

Use the new `normalize*` / `serialize*` helpers so snake_case and camelCase inputs both persist correctly and default artifact paths stay stable.

### Task 3: Feed runtime state into snapshots and status output

**Files:**
- Modify: `tools/workflow-guard.ts`
- Test: `tests/workflow-commands.test.mjs`

- [x] **Step 1: Extend `buildWorkflowSnapshot`**

Normalize the three runtime-state blocks from the manifest, compute derived booleans/summary fields, and populate the new `WorkflowSnapshot` fields.

- [x] **Step 2: Extend `formatWorkflowSnapshotForPrompt` / workflow-status output**

Emit readable lines for writing-session status, evidence coverage, review status/rubric summary, graph-guided-writing status, and scholar fallback slot using the exact semantics expected by the tests.

### Task 4: Gate `write` stage promotion on runtime readiness

**Files:**
- Modify: `tools/workflow-guard.ts`
- Test: `tests/writer-reviewer-runtime-state.test.mjs`

- [x] **Step 1: Add `write` stage manifest checks**

Inside `getMissingStageSignals`, require `PROJECT_MANIFEST.json.writing_session` and `PROJECT_MANIFEST.json.graph_guided_writing` to exist in ready/covered form before the auto iterator can advance from `write` to `submit`.

- [x] **Step 2: Preserve review-session observability without new blocking**

Persist and surface `review_session`, but do not make it a hard `write` gate beyond the writing/graph-guided checks already covered by the approved design.

### Task 5: Verify targeted behavior

**Files:**
- Modify: `tools/workflow-guard.ts`
- Test: `tests/writer-reviewer-runtime-state.test.mjs`
- Test: `tests/workflow-commands.test.mjs`

- [x] **Step 1: Re-run runtime-state tests**

Run: `node --test tests/writer-reviewer-runtime-state.test.mjs`
Expected: PASS

- [x] **Step 2: Re-run workflow-status tests**

Run: `node --test tests/workflow-commands.test.mjs`
Expected: PASS

- [x] **Step 3: Run the TypeScript build**

Run: `npm run build`
Expected: PASS
