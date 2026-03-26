# Workflow External Review and Prompt Layering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the latest approved workflow slice: manifest-backed external review state, stronger section-packet writing readiness, and focused prompt-assembly support so writer/reviewer prompts do not drown in full workflow state.

**Architecture:** Extend the existing manifest-backed runtime-state pattern in `tools/workflow-guard.ts` to cover `external_review_state`, wire it through `research_workflow`, snapshots, status output, and `submit` gating, then tighten `writing_session.section_packets` with more machine-readable readiness fields. Add a focused prompt-assembly path for workflow hook prompt injection that preserves ownership/routing rules while reducing prompt overload for active writing/review tasks.

**Tech Stack:** TypeScript, Node.js built-in test runner, existing workflow guard/tool/hook infrastructure

---

### Task 1: Lock the behavior with failing tests

**Files:**
- Modify: `tests/workflow-runtime-tools.test.mjs`
- Modify: `tests/writer-reviewer-runtime-state.test.mjs`
- Modify: `tests/workflow-prompt-ownership.test.mjs`
- Modify: `tests/auto-iterator.test.mjs`

- [ ] **Step 1: Add external-review runtime-state tool coverage**

Add tests for `get_external_review_state` and `set_external_review_state`, including manifest persistence and temp-trace events.

- [ ] **Step 2: Add submit-gate coverage for external review state**

Write a test showing that `submit` cannot clear when reviewer files exist but `external_review_state` is missing or inconclusive.

- [ ] **Step 3: Add stronger section-packet readiness coverage**

Write a test showing that `writing_session` is not `readyForSubmit` when a packet is stale, still has forbidden unsupported claims, or still has missing citation placeholders.

- [ ] **Step 4: Add focused prompt-assembly coverage**

Add a prompt-formatting test showing that the focused writer/reviewer prompt still includes ownership and routing rules, but emphasizes current section/subtask context instead of replaying the entire workflow state as the main task payload.

### Task 2: Add manifest-backed external review state

**Files:**
- Modify: `tools/workflow-guard.ts`
- Modify: `tools/register-workflow-tools.ts`

- [ ] **Step 1: Define external review state types and normalization**

Add `ExternalReviewState` plus normalize/serialize helpers using the same pattern as the current runtime-state blocks.

- [ ] **Step 2: Implement getter and setter APIs**

Add `getExternalReviewStateSummary` and `setExternalReviewState`, persist to `PROJECT_MANIFEST.json`, and return resolved-path helpers plus normalized readiness signals.

- [ ] **Step 3: Expose the new actions through `research_workflow`**

Register `get_external_review_state` and `set_external_review_state`, and record their tool-action traces.

### Task 3: Strengthen section-packet writing readiness

**Files:**
- Modify: `tools/workflow-guard.ts`
- Modify: `tests/writer-reviewer-runtime-state.test.mjs`

- [ ] **Step 1: Extend section packet schema**

Add a bounded set of new packet fields that support the approved design without trying to implement the whole target architecture at once, such as `section_class`, `required_figure_ids`, `required_citation_count`, `dependent_sections`, and `stale`.

- [ ] **Step 2: Tighten readiness evaluation**

Update `areWritingSectionPacketsReady` / `isWritingSessionReadyForSubmit` so stale packets, unresolved unsupported claims, and unresolved citation placeholders block `readyForSubmit`.

- [ ] **Step 3: Surface the new fields in summaries**

Expose the new packet fields in writing-session summaries and prompt/status formatting where they help explain why a section is blocked.

### Task 4: Wire external review into snapshots, status, and submit gating

**Files:**
- Modify: `tools/workflow-guard.ts`
- Modify: `tools/workflow-commands.ts`
- Modify: `tests/auto-iterator.test.mjs`

- [ ] **Step 1: Extend `WorkflowSnapshot`**

Add external-review summary fields and any new section-readiness fields needed for prompt/status output.

- [ ] **Step 2: Extend `workflow-status`**

Show concise external-review status and recommendation lines, plus clearer section-readiness blockers when `write` or `submit` is blocked.

- [ ] **Step 3: Tighten `submit` stage gating**

Require both the reviewer-side files and an acceptable `external_review_state` conclusion before `submit` can clear.

### Task 5: Add focused prompt assembly support

**Files:**
- Modify: `tools/workflow-guard.ts`
- Modify: `tools/register-workflow-hooks.ts`
- Create: `docs/superpowers/specs/2026-03-26-agent-prompt-assembly-spec.zh-CN.md`

- [ ] **Step 1: Add prompt-layer helpers**

Introduce a focused prompt formatter or helper output that separates stable role policy, stage-local control state, active section/subtask context, and revision deltas.

- [ ] **Step 2: Use focused prompt assembly in hook injection**

Update the workflow prompt hook so writer/reviewer turns receive the focused layered form instead of the full verbose snapshot as their dominant context.

- [ ] **Step 3: Write the prompt assembly spec**

Document exactly which fields belong in each layer, which states must stay out of active prompts, and how prompt trace metadata should be recorded.

### Task 6: Verify the slice end to end

**Files:**
- Modify: `tools/workflow-guard.ts`
- Modify: `tools/register-workflow-tools.ts`
- Modify: `tools/register-workflow-hooks.ts`
- Modify: `tools/workflow-commands.ts`
- Test: `tests/workflow-runtime-tools.test.mjs`
- Test: `tests/writer-reviewer-runtime-state.test.mjs`
- Test: `tests/workflow-prompt-ownership.test.mjs`
- Test: `tests/auto-iterator.test.mjs`

- [ ] **Step 1: Run the targeted runtime-state tests**

Run: `node --test tests/writer-reviewer-runtime-state.test.mjs tests/workflow-runtime-tools.test.mjs`
Expected: PASS

- [ ] **Step 2: Run the prompt and auto-iterator tests**

Run: `node --test tests/workflow-prompt-ownership.test.mjs tests/auto-iterator.test.mjs`
Expected: PASS

- [ ] **Step 3: Run the TypeScript build**

Run: `npm run build`
Expected: PASS
