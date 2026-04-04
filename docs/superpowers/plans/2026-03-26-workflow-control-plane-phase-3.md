# Workflow Control Plane Phase 3 Implementation Plan

> **Status:** COMPLETE

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the next approved workflow architecture slice by adding durable control-plane state for planner/orchestrator and write-package assembly, promoting `experiment_search` into a real stage gate, strengthening review into a richer issue-closure system, and upgrading focused prompt assembly plus prompt-trace metadata.

**Architecture:** Extend `tools/workflow-guard.ts` with three new runtime-state blocks: `research_program`, `orchestration_state`, and `write_package`, then wire them through `PROJECT_MANIFEST.json`, `research_workflow`, snapshot/status output, and stage gates. Tighten `plan`, `experiment`, `review`, and `write` transitions using deterministic checks on the new state plus richer review-issue semantics. Add a layered prompt-assembly helper and trace metadata so writer/reviewer prompts stay focused while still exposing the new control-plane context.

**Tech Stack:** TypeScript, Node.js built-in test runner, existing workflow guard/tool/hook/trace infrastructure

---

### Task 1: Lock the new control-plane and gate behavior with failing tests

**Files:**
- Modify: `tests/workflow-runtime-tools.test.mjs`
- Modify: `tests/writer-reviewer-runtime-state.test.mjs`
- Modify: `tests/auto-iterator.test.mjs`
- Modify: `tests/workflow-prompt-ownership.test.mjs`
- Modify: `tests/workflow-commands.test.mjs`

- [x] **Step 1: Add runtime-tool coverage for new control-plane states**

Write failing tests for:
- `get_research_program` / `set_research_program`
- `get_orchestration_state` / `set_orchestration_state`
- `get_write_package` / `set_write_package`

Assert manifest persistence, trace events, and summary helpers.

- [x] **Step 2: Add planner/orchestrator contract regressions**

Write failing tests showing `PLAN -> CODE` stays blocked unless:
- `research_program` exists
- at least one active track exists
- each active track has experiment-stage coverage
- each active track has baseline, ablation, stop rule, and rollback trigger coverage

- [x] **Step 3: Add experiment/write/review gate regressions**

Write failing tests showing:
- `EXPERIMENT -> ANALYZE` stays blocked until `experiment_search` is ready for analysis
- `WRITE -> SUBMIT` stays blocked until `write_package.status = ready`
- `WRITE -> SUBMIT` also requires `citation_integrity.verification_status = verified`
- `REVIEW` / `SUBMIT` block when medium issues remain open without waiver
- paper-surface and submission-simulation review artifacts are enforced

- [x] **Step 4: Add prompt-layer metadata regressions**

Write failing tests showing focused prompt assembly exposes:
- a layered payload structure
- current section or review-lane focus
- prompt trace metadata such as `prompt_layer_profile`, `prompt_payload_sizes`, `section_context_id`, `review_lane`, and `round_id`

### Task 2: Add durable control-plane state models

**Files:**
- Modify: `tools/workflow-guard.ts`
- Modify: `templates/PROJECT_MANIFEST.json`

- [x] **Step 1: Define new state types and defaults**

Add normalized types and serializers for:
- `ResearchProgramState`
- `OrchestrationState`
- `WritePackageState`

- [x] **Step 2: Implement getter and setter APIs**

Add `getResearchProgramStateSummary`, `setResearchProgramState`, `getOrchestrationStateSummary`, `setOrchestrationState`, `getWritePackageStateSummary`, and `setWritePackageState`.

- [x] **Step 3: Mirror state into snapshot and status surfaces**

Populate concise summary fields in `WorkflowSnapshot` and `workflow-status`.

### Task 3: Harden planner/orchestrator and experiment gates

**Files:**
- Modify: `tools/workflow-guard.ts`
- Modify: `tests/auto-iterator.test.mjs`

- [x] **Step 1: Strengthen `plan` stage requirements**

Require machine-readable `research_program` semantics in addition to `PLAN.md`, `TODOS.md`, and `PLAN_AUDIT.md`.

- [x] **Step 2: Strengthen `experiment` stage requirements**

Require `experiment_search` readiness before advancing to `analyze`.

- [x] **Step 3: Surface orchestration control-plane state**

Expose blocking category, next transition candidate, retry budget, rollback target, and resume cursor summaries.

### Task 4: Harden write and review contracts

**Files:**
- Modify: `tools/workflow-guard.ts`
- Modify: `tests/writer-reviewer-runtime-state.test.mjs`
- Modify: `tests/auto-iterator.test.mjs`

- [x] **Step 1: Require `write_package` for submit handoff**

Block `WRITE -> SUBMIT` until `write_package.status = ready` and required package inputs are assembled.

- [x] **Step 2: Tighten citation and review issue policy**

Require citation verification before submit handoff and block on unresolved `medium` issues unless they are explicitly waived with a machine-readable waiver reason.

- [x] **Step 3: Add paper-surface and submission-simulation review requirements**

Make `SURFACE_REVIEW.json` and `SUBMISSION_SIMULATION_REVIEW.json` part of the review contract without introducing a separate stage.

### Task 5: Upgrade prompt layering and trace metadata

**Files:**
- Modify: `tools/workflow-guard.ts`
- Modify: `tools/register-workflow-hooks.ts`
- Modify: `tools/workflow-trace.ts`
- Modify: `tests/workflow-prompt-ownership.test.mjs`

- [x] **Step 1: Add a layered prompt-assembly helper**

Build focused prompt output from:
- stable policy
- stage-local control state
- primary payload
- supporting evidence
- reflection delta

- [x] **Step 2: Emit prompt-trace metadata**

Record prompt-assembly metadata without storing the full prompt body.

- [x] **Step 3: Keep hook injection on the focused path**

Continue using focused prompts for writer/reviewer lanes, now backed by the layered builder.

### Task 6: Verify the slice end to end

**Files:**
- Test: `tests/workflow-runtime-tools.test.mjs`
- Test: `tests/writer-reviewer-runtime-state.test.mjs`
- Test: `tests/workflow-prompt-ownership.test.mjs`
- Test: `tests/auto-iterator.test.mjs`
- Test: `tests/workflow-commands.test.mjs`

- [x] **Step 1: Run targeted test suites**

Run: `node --test tests/workflow-runtime-tools.test.mjs tests/writer-reviewer-runtime-state.test.mjs tests/workflow-prompt-ownership.test.mjs tests/auto-iterator.test.mjs tests/workflow-commands.test.mjs`
Expected: PASS

- [x] **Step 2: Run the TypeScript build**

Run: `npm run build`
Expected: PASS
