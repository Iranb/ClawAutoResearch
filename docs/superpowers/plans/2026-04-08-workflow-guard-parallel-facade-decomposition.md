# Workflow Guard Parallel Facade Decomposition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Continue the gradual decomposition of `tools/workflow-guard.ts` while preserving the facade, keeping runtime semantics stable, and making the remaining work parallelizable across multiple agents with low merge conflict risk.

**Architecture:** Do not rewrite the workflow control plane. Keep `workflow-guard.ts` as the public compatibility facade, and move remaining heavy logic into focused submodules under `tools/workflow-guard-*`. The core rule is: business logic moves out, the facade stays thin, exports stay stable, and every phase must preserve current workflow behavior and tests.

**Tech Stack:** TypeScript, Node ESM, existing workflow runtime/tests, current `workflow-guard-*` module families

## Execution Status

Completed on 2026-04-08.

- `workflow-guard.ts` reduced from roughly `11,246` lines to `8,266`
- all five workstreams in this plan were implemented
- broad regression and focused decomposition suites passed
- facade remains in place, but the project/policy/writing/setter families now own the bulk of the previously embedded logic

---

## 0. Current State Snapshot

As of this plan:

- `tools/workflow-guard.ts` is still about **11,246 lines**
- the repo already has these decomposition families:
  - `tools/workflow-guard-core/`
  - `tools/workflow-guard-state/`
  - `tools/workflow-guard-stages/`
  - `tools/workflow-guard-materializers/`
  - `tools/workflow-guard-guidance/`
  - `tools/workflow-guard-summaries/`
  - `tools/workflow-guard-runtime/`
  - `tools/workflow-guard-recorders/`
- the current problem is not “missing decomposition ideas”, but that too much remaining glue still lives in the facade

The largest remaining responsibility clusters in `workflow-guard.ts` are:

1. project resolution and workflow snapshot assembly
2. gate/bootstrap/projects-state glue
3. policy + tool-guard + handoff sanitization logic
4. writing/review/quality evaluation helpers
5. state setter families
6. summary/router compatibility glue

This plan focuses on those remaining clusters.

---

## 1. Constraints

- Keep `tools/workflow-guard.ts` as the public facade
- Do not change the existing public API names unless absolutely necessary
- Do not change workflow stage semantics in this plan
- Do not move `auto-iterator` back into the facade
- Prefer new files over making existing submodules too large
- Each task must preserve passing behavior before the next task begins
- Every parallel workstream must have an explicitly assigned write scope

---

## 2. Parallelization Strategy

This plan is intentionally split into **independent workstreams** so multiple agents can work in parallel.

### Workstream A: Project Context + Snapshot

**Primary responsibility:**
- move project resolution and snapshot-building logic out of the facade

**Owned write scope:**
- `tools/workflow-guard-project/`
- `tools/workflow-guard.ts` facade wrappers related to project/snapshot only
- tests that directly assert project resolution and snapshot shape

### Workstream B: Policies + Tool Guards

**Primary responsibility:**
- move role policy, write-scope blocking, Papernexus/tool guard, and handoff mention rules out of the facade

**Owned write scope:**
- `tools/workflow-guard-policies/`
- `tools/workflow-guard.ts` facade wrappers related to policy exports only
- tests around guard boundaries and prompt ownership

### Workstream C: Writing/Review Evaluation

**Primary responsibility:**
- move readiness and quality evaluation logic for writing/review/theory/citation into dedicated modules

**Owned write scope:**
- `tools/workflow-guard-writing/`
- `tools/workflow-guard.ts` facade wrappers related to evaluation helpers only
- writer/reviewer/auto-iterator quality tests

### Workstream D: State Setters

**Primary responsibility:**
- move remaining `set*State(...)` functions into coherent setter modules

**Owned write scope:**
- `tools/workflow-guard-setters/`
- `tools/workflow-guard.ts` facade wrappers related to setters only
- runtime tools / service tests

### Workstream E: Final Facade Cleanup

**Primary responsibility:**
- after A-D merge, reduce `workflow-guard.ts` to mostly exports, dependency wiring, and compatibility glue

**Owned write scope:**
- `tools/workflow-guard.ts`
- module map / docs

### Merge Order

Safe merge order:

1. Workstream A
2. Workstream B
3. Workstream C
4. Workstream D
5. Workstream E

Parallelism guidance:

- A and B can run in parallel
- C can start once A’s snapshot exports are stable
- D can run in parallel with C if setter write scopes are respected
- E must wait until A-D merge

---

## 3. Target Directory Additions

Create these new directories:

- `tools/workflow-guard-project/`
- `tools/workflow-guard-policies/`
- `tools/workflow-guard-writing/`
- `tools/workflow-guard-setters/`

Recommended file layout:

### `tools/workflow-guard-project/`

- `project-context.ts`
- `snapshot-builder.ts`
- `gate-state.ts`
- `projects-state.ts`

### `tools/workflow-guard-policies/`

- `role-policy.ts`
- `tool-guards.ts`
- `handoff-rules.ts`

### `tools/workflow-guard-writing/`

- `write-package-eval.ts`
- `paper-quality-eval.ts`
- `citation-theory-eval.ts`

### `tools/workflow-guard-setters/`

- `research-state-setters.ts`
- `writing-state-setters.ts`
- `review-state-setters.ts`
- `ingestion-state-setters.ts`

---

## 4. Task A: Project Context + Snapshot Builder

**Files:**
- Create: `tools/workflow-guard-project/project-context.ts`
- Create: `tools/workflow-guard-project/snapshot-builder.ts`
- Create: `tools/workflow-guard-project/gate-state.ts`
- Create: `tools/workflow-guard-project/projects-state.ts`
- Modify: `tools/workflow-guard.ts`
- Test: `tests/channel-project-bindings.test.mjs`
- Test: `tests/workflow-runtime-tools.test.mjs`
- Test: `tests/workflow-commands.test.mjs`

**Scope:**
- move project-root resolution and project-state loading out of the facade
- move snapshot body assembly out of the facade
- keep `buildWorkflowSnapshot(...)` exported from the facade as a thin wrapper

- [x] **Step 1: Create `project-context.ts`**

Move these responsibilities:
- project root resolution
- channel binding aware project resolution
- `loadProjectState(...)`
- project-local manifest / registry / mailbox / experiment ledger loading

- [x] **Step 2: Create `gate-state.ts`**

Move these responsibilities:
- gate state path helpers
- gate state normalize/serialize wrappers if still present in facade
- timed-default deadline helpers if they still belong to the project/gate cluster

- [x] **Step 3: Create `projects-state.ts`**

Move these responsibilities:
- projects-state path helpers
- project directory formatting
- project state file reading/writing glue

- [x] **Step 4: Create `snapshot-builder.ts`**

Move these responsibilities:
- the body of `buildWorkflowSnapshot(...)`
- snapshot-time aggregation of state contracts
- channel binding/runtime binding projection into snapshot fields

- [x] **Step 5: Replace facade bodies with thin wrappers**

In `tools/workflow-guard.ts`:
- keep exported names unchanged
- replace moved implementations with imports + wrappers

- [x] **Step 6: Run focused tests**

Run:
- `node --test tests/channel-project-bindings.test.mjs tests/workflow-runtime-tools.test.mjs tests/workflow-commands.test.mjs`

Expected:
- PASS
- no snapshot field regression

---

## 5. Task B: Policies + Tool Guards + Handoff Rules

**Files:**
- Create: `tools/workflow-guard-policies/role-policy.ts`
- Create: `tools/workflow-guard-policies/tool-guards.ts`
- Create: `tools/workflow-guard-policies/handoff-rules.ts`
- Modify: `tools/workflow-guard.ts`
- Test: `tests/workflow-guard-boundaries.test.mjs`
- Test: `tests/workflow-prompt-ownership.test.mjs`
- Test: `tests/workflow-commands.test.mjs`

**Scope:**
- move policy tables and decision helpers out of the facade

- [x] **Step 1: Create `role-policy.ts`**

Move:
- `WorkflowRole` helpers that are pure or near-pure
- `ROLE_POLICIES`
- role normalization helpers if they are not required by unrelated facade-only code
- contact/spawn decision helpers

- [x] **Step 2: Create `tool-guards.ts`**

Move:
- `shouldBlockProjectWrite(...)`
- dataset/path mutation guards
- Papernexus command guards
- innovation write and writer template write guards

- [x] **Step 3: Create `handoff-rules.ts`**

Move:
- mention sanitization
- workflow channel handoff parsing
- raw mention normalization
- forward handoff helper logic

- [x] **Step 4: Keep facade exports stable**

Re-export through `tools/workflow-guard.ts` so callers do not change.

- [x] **Step 5: Run focused tests**

Run:
- `node --test tests/workflow-guard-boundaries.test.mjs tests/workflow-prompt-ownership.test.mjs tests/workflow-commands.test.mjs`

Expected:
- PASS
- prompt and contact semantics unchanged

---

## 6. Task C: Writing / Review / Quality Evaluation

**Files:**
- Create: `tools/workflow-guard-writing/write-package-eval.ts`
- Create: `tools/workflow-guard-writing/paper-quality-eval.ts`
- Create: `tools/workflow-guard-writing/citation-theory-eval.ts`
- Modify: `tools/workflow-guard.ts`
- Test: `tests/auto-iterator.test.mjs`
- Test: `tests/workflow-runtime-tools.test.mjs`
- Test: `tests/writer-reviewer-runtime-state.test.mjs`

**Scope:**
- move readiness evaluation logic used by write/review/submit/analyze stages

- [x] **Step 1: Create `write-package-eval.ts`**

Move:
- write package readiness
- section packet readiness
- writing session readiness

- [x] **Step 2: Create `paper-quality-eval.ts`**

Move:
- paper QC checks
- figure QC checks
- external review readiness checks
- review issue tracker blocking checks

- [x] **Step 3: Create `citation-theory-eval.ts`**

Move:
- theory appendix gating helpers
- citation collection hard-failure checks
- citation integrity related readiness helpers

- [x] **Step 4: Replace facade bodies with imports**

- [x] **Step 5: Run focused tests**

Run:
- `node --test tests/auto-iterator.test.mjs tests/workflow-runtime-tools.test.mjs tests/writer-reviewer-runtime-state.test.mjs`

Expected:
- PASS
- no write/review stage regression

---

## 7. Task D: Remaining State Setters

**Files:**
- Create: `tools/workflow-guard-setters/research-state-setters.ts`
- Create: `tools/workflow-guard-setters/writing-state-setters.ts`
- Create: `tools/workflow-guard-setters/review-state-setters.ts`
- Create: `tools/workflow-guard-setters/ingestion-state-setters.ts`
- Modify: `tools/workflow-guard.ts`
- Test: `tests/workflow-runtime-tools.test.mjs`
- Test: `tests/workflow-service.test.mjs`
- Test: `tests/auto-iterator.test.mjs`

**Scope:**
- move remaining `set*State(...)` implementations into file families that match ownership

- [x] **Step 1: Create `research-state-setters.ts`**

Move:
- `setResearchProgramState`
- `setBrainstormCycleState`
- `setIdeationContractState`
- `setOrchestrationState`
- `setExperimentSearchState`
- related research-side setters

- [x] **Step 2: Create `writing-state-setters.ts`**

Move:
- `setWritingContractState`
- `setWritingSessionState`
- `setGraphGuidedWritingState`
- `setWritePackageState`
- paper QC / citation collection setters if they logically belong to writer-side state

- [x] **Step 3: Create `review-state-setters.ts`**

Move:
- `setReviewSessionState`
- `setPaperStoryState`
- `setReviewPressurePacketState`
- `setExternalReviewState`
- `setFigureQcState`

- [x] **Step 4: Create `ingestion-state-setters.ts`**

Move:
- `setPaperIngestionState`
- remaining ingestion/graph progress mutation helpers

- [x] **Step 5: Keep public exports stable**

- [x] **Step 6: Run focused tests**

Run:
- `node --test tests/workflow-runtime-tools.test.mjs tests/workflow-service.test.mjs tests/auto-iterator.test.mjs`

Expected:
- PASS
- runtime tool mutation semantics unchanged

---

## 8. Task E: Final Facade Cleanup

**Files:**
- Modify: `tools/workflow-guard.ts`
- Modify: `docs/reference/module-map.md`
- Modify: `DOC/reference/agents.md`
- Modify: `WORKFLOW.md`

**Scope:**
- shrink the facade into a stable public entrypoint

- [x] **Step 1: Remove dead helper implementations from the facade**

- [x] **Step 2: Group remaining exports by concern**

Suggested section order inside the facade:
- core policy access
- project/snapshot wrappers
- summaries
- state setters
- mailbox/collaboration
- runtime façade exports

- [x] **Step 3: Add top-level comments describing module ownership**

- [x] **Step 4: Update docs**

Document the new families and where maintainers should read first.

- [x] **Step 5: Run broad regression**

Run:
- `node --test tests/auto-iterator.test.mjs tests/workflow-runtime-tools.test.mjs tests/workflow-service.test.mjs tests/workflow-commands.test.mjs tests/workflow-guard-boundaries.test.mjs tests/workflow-prompt-ownership.test.mjs`
- `npm run build`

Expected:
- PASS
- facade is substantially smaller and easier to scan

---

## 9. Conflict-Avoidance Rules for Multi-Agent Execution

These are mandatory if multiple agents execute this plan in parallel.

### Rule 1: One workstream, one write set

Each agent may only modify:
- its assigned new directory
- its assigned tests
- the minimal facade wrapper lines needed for exported compatibility

Do not let two agents edit the same new directory.

### Rule 2: The facade is the shared choke point

Because all workstreams touch `tools/workflow-guard.ts`, keep facade edits minimal:
- import new module
- replace body with wrapper
- export/re-export if needed

Do not let agents do opportunistic cleanup in unrelated parts of the facade.

### Rule 3: Each workstream owns specific tests

- A owns snapshot/project binding tests
- B owns guard boundary and prompt ownership tests
- C owns write/review quality tests
- D owns runtime tool and service mutation tests
- E owns broad regression + docs

### Rule 4: Merge only after local focused tests pass

Each agent must pass its focused test suite before merging to the shared branch.

### Rule 5: Broad regression only after A-D merge

Do not require every workstream to run the full suite before integration. Use:
- focused tests per workstream during execution
- broad suite once A-D are merged

---

## 10. Recommended Agent Assignment

If four implementation agents are available, assign like this:

- **Agent 1:** Task A
- **Agent 2:** Task B
- **Agent 3:** Task C
- **Agent 4:** Task D

Then one integration pass:

- **Lead / Integrator agent:** Task E

If only two agents are available:

- **Agent 1:** Task A + Task C
- **Agent 2:** Task B + Task D
- **Lead / Integrator:** Task E

---

## 11. Success Criteria

This plan is complete when all of the following are true:

- `tools/workflow-guard.ts` is no longer the primary place where business logic lives
- the facade mainly contains exports, wrappers, and compatibility glue
- snapshot/project-state logic lives under `workflow-guard-project/`
- policy/guard logic lives under `workflow-guard-policies/`
- writing/review evaluation logic lives under `workflow-guard-writing/`
- remaining state mutation logic lives under `workflow-guard-setters/`
- the existing stage/runtime/materializer/summaries layout still works unchanged
- the focused and broad workflow suites stay green

---

## 12. Immediate Next Step

Start with **Task A**.

Why:
- it reduces the largest readability burden first
- it creates a clean dependency surface for later workstreams
- it lowers the chance that B/C/D need to touch project-loading internals directly

Recommended first command for the implementing agent:

- `node --test tests/channel-project-bindings.test.mjs tests/workflow-runtime-tools.test.mjs tests/workflow-commands.test.mjs`

This establishes the baseline before the first migration.
