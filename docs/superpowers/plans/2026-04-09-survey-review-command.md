# Survey Review Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Discord-friendly `/survey-review` command that can start a projectless, survey-only literature workflow for a topic, retrieve far more papers than the bounded startup pipeline, and keep durable state aligned so progress never depends on ad hoc file edits.

**Architecture:** Introduce a dedicated `survey_review_state` contract in `PROJECT_MANIFEST.json`, plus a materializer that reconciles durable survey artifacts into one authoritative state summary. Register `/survey-review` as a workflow background command that creates a lightweight survey workspace, launches a Researcher continuation, and stops at graph-grounded survey outputs rather than entering experiment stages.

**Tech Stack:** TypeScript, Node.js built-in test runner, existing workflow command/fast-path runtime, workflow manifest state setters/materializers, Researcher skills, PaperNexus-backed literature ingestion and graph grounding

---

### Task 1: Write failing command tests for `/survey-review`

**Files:**
- Modify: `tests/workflow-commands.test.mjs`
- Test: `tests/workflow-commands.test.mjs`

- [ ] **Step 1: Write the failing test**

Add tests that assert:
- `createResearchWorkflowCommands(...)` registers `survey-review`
- the command starts a background continuation on the bound Researcher session
- a topic like `"graph reasoning survey"` produces a survey-prefixed project id and `backgroundRun.kind = "survey_review"`

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/workflow-commands.test.mjs`
Expected: FAIL because `survey-review` is not registered and `survey_review` is not a known background kind.

- [ ] **Step 3: Write minimal implementation**

Update command types and registration boundaries only enough to register the command and route it through the background command handler.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/workflow-commands.test.mjs`
Expected: PASS for the new survey command assertions.


### Task 2: Write failing tests for durable `survey_review_state`

**Files:**
- Create: `tests/survey-review-state.test.mjs`
- Create: `tools/workflow-guard-state/survey-review.ts`

- [ ] **Step 1: Write the failing test**

Add tests for:
- `normalizeSurveyReviewState(...)` defaults
- `serializeSurveyReviewState(...)`
- `getSurveyReviewStateSummary(...)` or equivalent summary contract
- artifact-based status transitions such as `searching -> screening -> graph_grounded -> completed`

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/survey-review-state.test.mjs`
Expected: FAIL because the module does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Create the survey state module with:
- normalized paths for `QUERY_REGISTRY.json`, `LITERATURE.md`, `LITERATURE_REVIEW.md`, `REVIEW_PROTOCOL.md`, `INCLUDED_PAPERS.json`, `EXCLUDED_PAPERS.json`, `SOTA_MATRIX.md`, `GAP_SYNTHESIS.md`, `SURVEY_BRIEF.md`, `COVERAGE_SUMMARY.md`
- normalized status values
- serializing helpers

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/survey-review-state.test.mjs`
Expected: PASS.


### Task 3: Write failing tests for survey materialization and snapshot/status visibility

**Files:**
- Create: `tests/survey-review-materializer.test.mjs`
- Modify: `tests/workflow-guard-snapshot-builder.test.mjs`
- Modify: `tests/workflow-runtime-tools.test.mjs`

- [ ] **Step 1: Write the failing test**

Cover:
- materializer reads durable artifacts and updates manifest `survey_review_state`
- snapshot includes survey topic/status/counts/paths
- workflow runtime tools can `get_survey_review` and `set_survey_review`

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/survey-review-materializer.test.mjs tests/workflow-guard-snapshot-builder.test.mjs tests/workflow-runtime-tools.test.mjs`
Expected: FAIL because the state isn’t part of the manifest or tools yet.

- [ ] **Step 3: Write minimal implementation**

Add:
- `tools/workflow-guard-materializers/survey-review-materializer.ts`
- setter/summary plumbing in research state setters
- snapshot builder fields and runtime tool registry support

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/survey-review-materializer.test.mjs tests/workflow-guard-snapshot-builder.test.mjs tests/workflow-runtime-tools.test.mjs`
Expected: PASS.


### Task 4: Implement `/survey-review` background fast path and projectless survey bootstrap

**Files:**
- Modify: `tools/workflow-commands/types.ts`
- Modify: `tools/workflow-commands.ts`
- Modify: `tools/workflow-fast-paths.ts`
- Modify: `tools/workflow-guard-project/project-context.ts`

- [ ] **Step 1: Add failing regression coverage if needed**

If command bootstrapping or fast-path behavior needs extra coverage beyond Task 1, add it before implementation.

- [ ] **Step 2: Implement command kind and builder**

Add:
- `survey_review` background kind
- `buildSurveyReviewBackgroundCommand(...)`
- explicit summary text for survey runs

- [ ] **Step 3: Implement survey workspace bootstrap**

Ensure `/survey-review`:
- can start from a Discord topic without an existing project
- creates a lightweight survey workspace with a `survey-<slug>` project id
- binds the conversation to that workspace for later `/workflow-status`

- [ ] **Step 4: Run command tests**

Run: `node --test tests/workflow-commands.test.mjs`
Expected: PASS.


### Task 5: Add runtime tools and materializer-backed reconciliation

**Files:**
- Modify: `tools/register-workflow-tools.ts`
- Modify: `tools/workflow-guard-setters/research-state-setters.ts`
- Create: `tools/workflow-guard-materializers/survey-review-materializer.ts`

- [ ] **Step 1: Implement runtime tools**

Add actions:
- `get_survey_review`
- `set_survey_review`
- `materialize_survey_review_state`

- [ ] **Step 2: Make artifact reconciliation authoritative**

The materializer must treat these as sources of truth:
- query registry
- included/excluded sets
- review protocol
- SoTA matrix / gap synthesis
- survey brief

and update `PROJECT_MANIFEST.json.survey_review_state` atomically.

- [ ] **Step 3: Prevent stale-state blocking**

Ensure the materializer computes status from artifacts instead of requiring manual file edits, so later reruns and `/workflow-status` use reconciled state rather than stale in-memory assumptions.

- [ ] **Step 4: Run state/runtime tests**

Run: `node --test tests/survey-review-state.test.mjs tests/survey-review-materializer.test.mjs tests/workflow-runtime-tools.test.mjs`
Expected: PASS.


### Task 6: Add survey snapshot/status output

**Files:**
- Modify: `tools/workflow-guard.ts`
- Modify: `tools/workflow-guard-project/snapshot-builder.ts`
- Modify: `tools/workflow-commands/formatters.ts`

- [ ] **Step 1: Add survey fields to `WorkflowSnapshot`**

Expose:
- survey topic
- survey mode/depth
- survey status/current phase
- candidate/included/excluded counts
- graph-grounded brief readiness
- key artifact paths

- [ ] **Step 2: Add workflow-status formatting**

Add a dedicated survey section so projectless review work is inspectable through `/workflow-status`.

- [ ] **Step 3: Run snapshot/status tests**

Run: `node --test tests/workflow-guard-snapshot-builder.test.mjs tests/workflow-commands.test.mjs`
Expected: PASS.


### Task 7: Add the Researcher `survey-review` skill and docs

**Files:**
- Create: `skills/researcher/survey-review/SKILL.md`
- Modify: `skills/index.json`
- Modify: `DOC/reference/slash-commands.md`
- Modify: `WORKFLOW.md`

- [ ] **Step 1: Write the skill**

The skill must:
- run in survey-only mode
- widen retrieval beyond startup-project defaults
- record query families durably
- use `papers-cool + optional PASA + PaperNexus graph expansion`
- stop after survey outputs, not experiments
- call `materialize_survey_review_state` after each major phase

- [ ] **Step 2: Document the contract**

Document `/survey-review` as:
- projectless from the user’s point of view
- backed by a lightweight survey workspace
- non-experimental and writing-oriented

- [ ] **Step 3: Add/extend docs tests if needed**

If existing docs tests cover slash-command docs or skill indexing, update them and run the relevant suites.


### Task 8: Verification and integration

**Files:**
- Test: `tests/workflow-commands.test.mjs`
- Test: `tests/survey-review-state.test.mjs`
- Test: `tests/survey-review-materializer.test.mjs`
- Test: `tests/workflow-runtime-tools.test.mjs`
- Test: `tests/workflow-guard-snapshot-builder.test.mjs`

- [ ] **Step 1: Run focused tests**

Run:
`node --test tests/workflow-commands.test.mjs tests/survey-review-state.test.mjs tests/survey-review-materializer.test.mjs tests/workflow-runtime-tools.test.mjs tests/workflow-guard-snapshot-builder.test.mjs`

Expected: PASS.

- [ ] **Step 2: Run broader regression**

Run:
`node --test tests/workflow-service.test.mjs tests/workflow-fast-paths.test.mjs tests/researcher-literature-review-skill.test.mjs tests/workflow-zotero-scientific-skills.test.mjs`

Expected: PASS.

- [ ] **Step 3: Run build**

Run:
`npm run build`

Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add tools/workflow-commands.ts tools/workflow-fast-paths.ts tools/workflow-commands/types.ts tools/register-workflow-tools.ts tools/workflow-guard.ts tools/workflow-guard-project/snapshot-builder.ts tools/workflow-guard-setters/research-state-setters.ts tools/workflow-commands/formatters.ts tools/workflow-guard-state/survey-review.ts tools/workflow-guard-materializers/survey-review-materializer.ts skills/researcher/survey-review/SKILL.md skills/index.json DOC/reference/slash-commands.md WORKFLOW.md tests/workflow-commands.test.mjs tests/survey-review-state.test.mjs tests/survey-review-materializer.test.mjs tests/workflow-runtime-tools.test.mjs tests/workflow-guard-snapshot-builder.test.mjs docs/superpowers/plans/2026-04-09-survey-review-command.md
git commit -m "Add survey review slash workflow"
```
