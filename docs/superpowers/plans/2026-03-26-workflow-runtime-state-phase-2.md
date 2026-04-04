# Workflow Runtime State Phase 2 Implementation Plan

> **Status:** COMPLETE

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the next workflow runtime-state slice with durable support for `paper_qc`, `figure_qc`, `citation_collection`, `review_issue_tracker`, and independent `EXPERIMENT_SEARCH.json`, while keeping `WRITE -> SUBMIT` moderately strict and aligning the design with the latest human decisions.

**Architecture:** Extend the existing runtime-state pattern in `tools/workflow-guard.ts` with four new manifest-backed quality/review blocks plus one file-backed `experiment_search` state mirrored into the manifest. Wire the new state through `research_workflow`, snapshots, `workflow-status`, trace logging, and a moderated `write` gate that blocks on unresolved critical/high review issues or explicit hard-fail QC states, but does not require every late-stage QC block to be fully `ready` before entering `submit`.

**Tech Stack:** TypeScript, Node.js built-in test runner, existing workflow guard/tool/command infrastructure

---

### Task 1: Lock the new behavior with failing tests

**Files:**
- Modify: `tests/workflow-runtime-tools.test.mjs`
- Modify: `tests/writer-reviewer-runtime-state.test.mjs`
- Modify: `tests/auto-iterator.test.mjs`
- Modify: `tests/workflow-commands.test.mjs`

- [x] **Step 1: Add runtime-tool coverage for the new state blocks**

Write failing tests for:
- `get_paper_qc` / `set_paper_qc`
- `get_figure_qc` / `set_figure_qc`
- `get_citation_collection` / `set_citation_collection`
- `get_review_issue_tracker` / `set_review_issue_tracker`
- `get_experiment_search` / `set_experiment_search`

Also assert manifest persistence, `EXPERIMENT_SEARCH.json` persistence, and temp-trace function names.

- [x] **Step 2: Add write-gate coverage for moderate `WRITE -> SUBMIT` behavior**

Write tests showing:
- open `critical` or `high` review issues block `write`
- `medium` issues do not block `write` by default
- explicit hard failures such as `paper_qc.compile_status = fail` or `figure_qc.caption_alignment_status = fail` block `write`
- pending-but-not-failed QC states do not block `write`

- [x] **Step 3: Add snapshot and command-output coverage**

Add tests showing the new state summaries appear in `workflow-status`, including concise issue counts and `EXPERIMENT_SEARCH.json` state visibility.

### Task 2: Add durable state models and normalization helpers

**Files:**
- Modify: `tools/workflow-guard.ts`
- Modify: `templates/PROJECT_MANIFEST.json`
- Create: `templates/EXPERIMENT_SEARCH.json`

- [x] **Step 1: Define the new state types**

Add normalized types and serializers for:
- `PaperQcState`
- `FigureQcState`
- `CitationCollectionState`
- `ReviewIssueTrackerState`
- `ExperimentSearchState`

- [x] **Step 2: Make `experiment_search` file-backed**

Persist the canonical state to `researcher/EXPERIMENT_SEARCH.json`, mirror a summary into `PROJECT_MANIFEST.json.experiment_search`, and expose resolved-path helpers.

- [x] **Step 3: Keep state semantics aligned with the approved design choices**

Reflect these decisions directly in the normalization and defaults:
- `Planner` and `Orchestrator` remain one agent role
- paper-surface review is part of `REVIEW`
- waiver does not require human approval in aggressive automatic mode

### Task 3: Expose the new state through `research_workflow`

**Files:**
- Modify: `tools/register-workflow-tools.ts`
- Modify: `tools/workflow-guard.ts`

- [x] **Step 1: Register new actions**

Expose getter/setter actions for the five new state blocks.

- [x] **Step 2: Return useful summary payloads**

Each getter/setter should return normalized state plus readiness/blocking helpers and resolved artifact/file paths where relevant.

### Task 4: Extend snapshot, status output, and prompt context

**Files:**
- Modify: `tools/workflow-guard.ts`
- Modify: `tools/workflow-commands.ts`
- Modify: `docs/superpowers/specs/2026-03-26-agent-prompt-assembly-spec.zh-CN.md`

- [x] **Step 1: Extend `WorkflowSnapshot`**

Add concise fields for:
- experiment-search progress
- paper QC
- figure QC
- citation collection
- review issue counts/status

- [x] **Step 2: Update `workflow-status`**

Print concise, scan-friendly lines so operators can see what is blocking and which late-stage QC systems are only advisory vs hard-fail.

- [x] **Step 3: Update prompt assembly guidance**

Document which of the new states may enter the focused writer/reviewer prompt and which must stay in control-plane/trace only.

### Task 5: Moderate `WRITE -> SUBMIT` gating without making it lax

**Files:**
- Modify: `tools/workflow-guard.ts`
- Modify: `tests/writer-reviewer-runtime-state.test.mjs`
- Modify: `tests/auto-iterator.test.mjs`

- [x] **Step 1: Keep the existing hard evidence checks**

Do not weaken current hard blockers such as unsupported primary claims, missing required writing state, or missing graph-guided evidence coverage.

- [x] **Step 2: Add review-issue hard blockers**

Block `write` on unresolved `critical` or `high` review issues unless the tracker reports them as closed or waived.

- [x] **Step 3: Add QC hard-fail blockers instead of universal ready-state blockers**

Block `write` only when QC states explicitly report failure on high-signal checks, rather than requiring every late-stage QC block to already be fully `ready`.

### Task 6: Sync the design docs to the latest decisions

**Files:**
- Modify: `docs/superpowers/specs/2026-03-26-workflow-target-architecture-design.zh-CN.md`
- Modify: `docs/superpowers/specs/2026-03-26-workflow-target-architecture-design.md`

- [x] **Step 1: Resolve the open questions that the human already answered**

Update the spec to reflect:
- Planner and Orchestrator remain one agent
- `experiment_search` uses an independent `EXPERIMENT_SEARCH.json`
- paper-surface review lives under `REVIEW`
- `WRITE -> SUBMIT` uses moderate blocking
- waiver in aggressive automatic mode does not require human approval

### Task 7: Verify the slice end to end

**Files:**
- Test: `tests/workflow-runtime-tools.test.mjs`
- Test: `tests/writer-reviewer-runtime-state.test.mjs`
- Test: `tests/auto-iterator.test.mjs`
- Test: `tests/workflow-commands.test.mjs`

- [x] **Step 1: Run the targeted runtime-state and iterator tests**

Run: `node --test tests/workflow-runtime-tools.test.mjs tests/writer-reviewer-runtime-state.test.mjs tests/auto-iterator.test.mjs tests/workflow-commands.test.mjs`
Expected: PASS

- [x] **Step 2: Run the TypeScript build**

Run: `npm run build`
Expected: PASS
