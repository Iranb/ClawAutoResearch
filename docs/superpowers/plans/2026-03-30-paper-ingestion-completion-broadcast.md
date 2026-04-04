# Paper Ingestion Completion Broadcast Implementation Plan

> **Status:** COMPLETE

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist PaperNexus completed-paper ingestion events and broadcast one Discord status update per newly completed paper.

**Architecture:** Extend workflow paper-ingestion state with append-only `completed_papers`, compute newly added completion events in the state layer, and reuse existing workflow status broadcasts in the tool layer. Keep all behavior behind `research_workflow.set_paper_ingestion` so callers can report true PaperNexus completions explicitly.

**Tech Stack:** TypeScript, Node test runner, existing `research_workflow` runtime and stage-broadcast utilities

---

### Task 1: Add Failing Runtime Tool Tests

**Files:**
- Modify: `tests/workflow-runtime-tools.test.mjs`
- Reference: `tools/register-workflow-tools.ts`
- Reference: `tools/workflow-guard.ts`

- [x] **Step 1: Write a failing test for first-time completed paper broadcast**

Add a test that:
- calls `set_paper_ingestion` with one `completed_papers` entry
- asserts the returned state persists that entry
- asserts a `deliver: true` workflow status broadcast was emitted with `Status: completed`

- [x] **Step 2: Run the targeted test and verify it fails**

Run: `node --test tests/workflow-runtime-tools.test.mjs`
Expected: FAIL because `completed_papers` is not persisted and no per-paper broadcast exists.

- [x] **Step 3: Extend the same test with duplicate-report coverage**

Add a second `set_paper_ingestion` call with the same completed paper and assert that no new completed broadcast is emitted.

- [x] **Step 4: Extend the same test with second-paper coverage**

Add a third `set_paper_ingestion` call with a different completed paper and assert exactly one additional completed broadcast is emitted.

- [x] **Step 5: Re-run the targeted test and confirm the failure is still for missing behavior**

Run: `node --test tests/workflow-runtime-tools.test.mjs`
Expected: FAIL on missing `completed_papers` persistence and/or missing completed broadcast entries.

### Task 2: Implement Completed Paper State

**Files:**
- Modify: `tools/workflow-guard.ts`
- Test: `tests/workflow-runtime-tools.test.mjs`

- [x] **Step 1: Add the completed paper state type**

Introduce a focused type for paper-ingestion completion entries and add `completedPapers` to `PaperIngestionState`.

- [x] **Step 2: Normalize and serialize `completed_papers`**

Update normalization and serialization helpers so manifest state round-trips `canonical_id`, `title`, and `import_task_id`.

- [x] **Step 3: Implement additive union semantics in `setPaperIngestionState`**

Merge incoming `completed_papers` with current state by stable identity and compute `newlyCompletedPapers`.

- [x] **Step 4: Return the incremental completion list from `setPaperIngestionState`**

Update the return shape so the tool layer can decide what to broadcast.

- [x] **Step 5: Run the targeted test to verify state behavior is now green enough to move on**

Run: `node --test tests/workflow-runtime-tools.test.mjs`
Expected: still failing only on missing broadcast behavior, or partially passing if state assertions are now satisfied.

### Task 3: Implement Per-Paper Discord Broadcasts

**Files:**
- Modify: `tools/register-workflow-tools.ts`
- Test: `tests/workflow-runtime-tools.test.mjs`

- [x] **Step 1: Handle `newlyCompletedPapers` in `set_paper_ingestion`**

After persisting state, iterate over new completion events and call `maybeBroadcastWorkflowStatusUpdate`.

- [x] **Step 2: Use one idempotency suffix per completed paper**

Build a stable suffix from project id, canonical id, and import task id so retries stay quiet.

- [x] **Step 3: Include broadcast results in the tool response**

Return the broadcast receipts so callers and tests can see what was emitted.

- [x] **Step 4: Run the targeted test and verify it passes**

Run: `node --test tests/workflow-runtime-tools.test.mjs`
Expected: PASS.

### Task 4: Regression Verification

**Files:**
- Modify: none unless regressions appear
- Test: `tests/workflow-runtime-tools.test.mjs`
- Test: `tests/stage-broadcast.test.mjs`
- Test: `tests/workflow-commands.test.mjs`

- [x] **Step 1: Run focused regression tests**

Run: `node --test tests/workflow-runtime-tools.test.mjs tests/stage-broadcast.test.mjs tests/workflow-commands.test.mjs`
Expected: PASS.

- [x] **Step 2: If all tests pass, stop**

## Progress Snapshot

- `completed_papers` now round-trips through the workflow paper-ingestion state.
- `research_workflow.set_paper_ingestion` computes `newlyCompletedPapers`, emits one idempotent broadcast per new completion, and avoids rebroadcasting metadata-only enrichments.
- The tool layer also persists and broadcasts batch progress plus per-paper timeout state.
- Focused regressions live in `tests/workflow-runtime-tools.test.mjs`.

No extra refactors unless the tests reveal a real integration issue.
