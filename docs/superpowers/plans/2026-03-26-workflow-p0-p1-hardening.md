# Workflow P0/P1 Hardening Implementation Plan

> **Status:** PARTIALLY COMPLETE

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the automation gap between workflow guards and tool actions, enforce the missing IDEA/REVIEW semantic gates from `WORKFLOW.md`, and emit durable workflow trace logs into the system temp directory.

**Architecture:** Extend `research_workflow` with explicit get/set actions for the writer/reviewer runtime-state blocks already persisted in `PROJECT_MANIFEST.json`. Harden `getMissingStageSignals` with concrete artifact/content checks for ideation reasoning packets and unsupported-claim leakage. Add a small workflow-trace helper that appends JSONL events under `os.tmpdir()` and wire it into tool actions plus the auto iterator so stage progression can be reconstructed after the fact.

**Tech Stack:** TypeScript, Node.js built-in test runner, existing workflow guard/plugin registration utilities

---

### Task 1: Add failing tests for the missing automation surfaces

**Files:**
- Create: `tests/workflow-runtime-tools.test.mjs`
- Modify: `tests/auto-iterator.test.mjs`
- Modify: `tests/writer-reviewer-runtime-state.test.mjs`

- [x] **Step 1: Add a tool-surface regression test**

Cover `research_workflow` get/set actions for `writing_session`, `review_session`, and `graph_guided_writing`, and assert that a temp-folder trace log is created.

- [x] **Step 2: Add semantic gate regressions**

Cover IDEA blocking when reasoning packets/evidence are only declared in metadata but not materially present, and REVIEW blocking when unsupported primary claims remain in the selected writing scope.

- [x] **Step 3: Upgrade legacy submit fixtures**

Seed the new writer runtime-state blocks in existing submit fixtures so full-suite auto-iterator expectations still describe a truly ready project.

### Task 2: Implement P0 tool actions and temp trace logging

**Files:**
- Create: `tools/workflow-trace.ts`
- Modify: `tools/register-workflow-tools.ts`
- Modify: `tools/workflow-guard.ts`

- [x] **Step 1: Add a shared trace helper**

Append JSONL events under `os.tmpdir()/openclaw-research-workflow-trace/` with project, stage, action, function, and summary metadata.

- [x] **Step 2: Expose runtime-state actions**

Add `get_*` / `set_*` actions for `writing_session`, `review_session`, and `graph_guided_writing`, wiring them to the existing manifest-backed helpers.

- [x] **Step 3: Log tool calls and iterator flow**

Record trace events for workflow tool actions and for `runWorkflowAutoIterator` stage evaluations/transitions.

### Task 3: Implement P1 semantic guards

**Files:**
- Modify: `tools/workflow-guard.ts`
- Modify: `tests/auto-iterator.test.mjs`
- Modify: `tests/writer-reviewer-runtime-state.test.mjs`

- [x] **Step 1: Harden IDEA -> PLAN checks**

Require graph-backed evidence fields plus non-empty reasoning packet artifacts on disk for each active track.

- [x] **Step 2: Harden REVIEW -> WRITE checks**

Detect unsupported primary claims that still overlap the selected writing scope and keep the workflow blocked until they are cleared.

### Task 4: Verify the hardening end to end

**Files:**
- Modify: `tools/workflow-guard.ts`
- Modify: `tools/register-workflow-tools.ts`
- Create: `tools/workflow-trace.ts`

- [x] **Step 1: Run focused runtime-state/tool tests**

Run: `node --test tests/workflow-runtime-tools.test.mjs tests/writer-reviewer-runtime-state.test.mjs`
Expected: PASS

- [x] **Step 2: Run workflow regression tests**

Run: `node --test tests/auto-iterator.test.mjs tests/workflow-commands.test.mjs tests/workflow-service.test.mjs`
Expected: PASS

- [ ] **Step 3: Run full verification**

Run: `npm test` and `npm run build`
Expected: PASS
