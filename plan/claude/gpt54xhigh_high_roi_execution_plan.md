# GPT5.4XHigh High-ROI Execution Plan

> Source plan reviewed: [gpt54xhigh_upgrade_plan.md](/Users/iranb/Library/Mobile%20Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/plan/claude/gpt54xhigh_upgrade_plan.md)  
> Codebase: `/Users/iranb/Library/Mobile Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research`  
> Planning goal: preserve the original ambition, but cut the scope down to the changes that are most likely to improve paper quality without destabilizing the workflow.  
> Execution status: planning only, not yet approved for implementation.

---

## 1. Executive Summary

This plan keeps only the parts of the GPT5.4XHigh upgrade that have a strong payoff-to-risk ratio:

1. Statistical rigor for multi-seed experiments
2. Plan and ablation diagnostics for experiment design quality
3. Venue-aware reviewer guidance
4. Engineering hardening in the most fragile runtime paths
5. Canary-style verification and regression coverage

This plan explicitly does **not** implement:

- external-API-dependent baseline completeness as a stage blocker
- novelty live-check as an IDEA-stage blocker
- large-scale "anti-detection" prose rewriting
- hard code-plan alignment enforcement
- multi-dataset hard gates based only on generalized wording
- a large new decomposition of `workflow-guard.ts` as a Phase 1 objective

The key strategic choice is:

- prefer **diagnostics over hard gates**
- prefer **workflow-native artifacts over standalone helpers**
- prefer **bounded, testable modules over large cross-cutting refactors**

---

## 2. Design Principles

### 2.1 Workflow-Native Rule

Every new capability must attach to at least one of the following:

- a durable artifact under `{PROJ}/`
- a `research_workflow` tool action
- an existing stage signal / stage-preflight path
- an existing skill contract in `skills/`

If a module is not reachable through the existing workflow contract system, it should not be built yet.

### 2.2 Soft-Gate Rule

The default outcome for new quality logic should be one of:

- `ready`
- `repairable`
- `advisory`

Only make something a hard blocker if it would otherwise allow a clearly invalid scientific conclusion or a clearly broken artifact into the next stage.

### 2.3 Story-Closure Rule

The user has already clarified that the system is not pursuing strict code-design alignment for its own sake. The workflow should optimize for:

- scientific credibility
- coherent storytelling
- clear evidence labeling
- bounded operational complexity

It should not optimize for:

- maximal formalism in every research pass
- speculative hard gates that depend on unstable external APIs
- heavyweight process steps that delay iteration without raising confidence much

### 2.4 Survey-Line Safety Rule

All new work in this plan must be harmless to the survey workflow:

- no experiment-only artifacts may become required for survey projects
- no survey project may be forced through experiment-specific missing signals
- all new stage checks must guard on workflow line and stage semantics

---

## 3. Current Architecture Touchpoints

The following existing modules are the intended integration points:

- [tools/register-workflow-tools.ts](/Users/iranb/Library/Mobile%20Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/tools/register-workflow-tools.ts)
- [tools/workflow-guard-stages/execution-stage-signals.ts](/Users/iranb/Library/Mobile%20Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/tools/workflow-guard-stages/execution-stage-signals.ts)
- [tools/workflow-guard-guidance/dynamic-tasks.ts](/Users/iranb/Library/Mobile%20Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/tools/workflow-guard-guidance/dynamic-tasks.ts)
- [tools/research-writing/section-scorer.ts](/Users/iranb/Library/Mobile%20Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/tools/research-writing/section-scorer.ts)
- [tools/workflow-guard-guidance/writing-guidance.ts](/Users/iranb/Library/Mobile%20Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/tools/workflow-guard-guidance/writing-guidance.ts)
- [skills/analyzer/analyze-results/SKILL.md](/Users/iranb/Library/Mobile%20Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/skills/analyzer/analyze-results/SKILL.md)
- [skills/academic_writer/paper-write/SKILL.md](/Users/iranb/Library/Mobile%20Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/skills/academic_writer/paper-write/SKILL.md)

These should be treated as the main insertion surfaces.

---

## 4. Workstream A: Statistical Rigor for Analyzer

### 4.1 Goal

Add workflow-native significance analysis so the Analyzer can distinguish:

- statistically meaningful improvement
- likely noise
- too-few-seed evidence
- regression

This should improve scientific credibility without making the early experiment loop unusably rigid.

### 4.2 Deliverables

Create:

- [tools/experiment-statistics/significance.ts](/Users/iranb/Library/Mobile%20Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/tools/experiment-statistics/significance.ts)
- [tools/experiment-statistics/multi-seed-aggregator.ts](/Users/iranb/Library/Mobile%20Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/tools/experiment-statistics/multi-seed-aggregator.ts)
- `analyzer/SIGNIFICANCE_REPORT.json`

Update:

- [tools/register-workflow-tools.ts](/Users/iranb/Library/Mobile%20Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/tools/register-workflow-tools.ts)
- [skills/analyzer/analyze-results/SKILL.md](/Users/iranb/Library/Mobile%20Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/skills/analyzer/analyze-results/SKILL.md)
- [tools/workflow-guard-stages/execution-stage-signals.ts](/Users/iranb/Library/Mobile%20Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/tools/workflow-guard-stages/execution-stage-signals.ts)

Add tests:

- `tests/experiment-statistics/significance.test.mjs`
- `tests/experiment-statistics/multi-seed-aggregator.test.mjs`
- one workflow-runtime tool integration test for the new tool action
- one analyzer-skill integration test for artifact generation semantics

### 4.3 Scope

Include:

- paired t-test
- bootstrap confidence interval
- effect size summary
- multi-seed aggregation and verdict labeling
- readable formatting for result-table consumption

Defer:

- advanced Bayesian testing
- hierarchical meta-analysis
- test selection based on complex normality diagnostics
- full reviewer-facing plot generation

### 4.4 Decision Policy

Use the following default policy:

- `>= 5 seeds`: use paired t-test + bootstrap CI
- `3-4 seeds`: use bootstrap CI + lightweight paired test summary
- `< 3 seeds`: do not claim significance; return `insufficient_seeds`

Primary output labels:

- `significant_improvement`
- `marginal_improvement`
- `no_significant_difference`
- `significant_regression`
- `insufficient_seeds`

### 4.5 Workflow Integration

The integration should be soft-gated, not hard-gated everywhere:

- during active experimentation: advisory only
- during analyze stage: required artifact if a project has a baseline comparison and seed-structured results
- during review/write: surfaced as evidence strength metadata, not as a universal hard blocker

`SIGNIFICANCE_REPORT.json` should be considered:

- `missing` only when the project actually has seed-comparable experiment outputs
- `not_applicable` when the experiment design does not support the comparison

### 4.6 Acceptance Criteria

- known vectors produce stable and believable significance outputs
- edge cases are handled without crashing
- Analyzer can write `SIGNIFICANCE_REPORT.json`
- the report can be consumed by later stages without introducing new regression loops
- survey projects are unaffected

---

## 5. Workstream B: Experiment Design Diagnostics

### 5.1 Goal

Improve rigor in experiment planning and ablation design without turning workflow planning into a brittle compliance exercise.

### 5.2 Deliverables

Create:

- [tools/experiment-rigor/ablation-coverage.ts](/Users/iranb/Library/Mobile%20Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/tools/experiment-rigor/ablation-coverage.ts)
- [tools/experiment-rigor/plan-rigor-summary.ts](/Users/iranb/Library/Mobile%20Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/tools/experiment-rigor/plan-rigor-summary.ts)

Generate artifacts:

- `orchestrator/ABLATION_COVERAGE.json`
- `orchestrator/PLAN_RIGOR_SUMMARY.json`

Update:

- [tools/register-workflow-tools.ts](/Users/iranb/Library/Mobile%20Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/tools/register-workflow-tools.ts)
- [tools/workflow-guard-stages/execution-stage-signals.ts](/Users/iranb/Library/Mobile%20Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/tools/workflow-guard-stages/execution-stage-signals.ts)
- [tools/workflow-guard-guidance/dynamic-tasks.ts](/Users/iranb/Library/Mobile%20Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/tools/workflow-guard-guidance/dynamic-tasks.ts)
- if useful, relevant orchestrator skill docs

Add tests:

- `tests/experiment-rigor/ablation-coverage.test.mjs`
- `tests/experiment-rigor/plan-rigor-summary.test.mjs`
- one workflow integration test proving the output is treated as diagnostic rather than as a universal blocker

### 5.3 Scope

`ablation-coverage.ts` should answer:

- what are the declared innovation points for the active track
- which planned ablations map to each innovation point
- which innovation points are not isolated by any ablation
- whether the ablation story is complete enough to support a later paper claim

`plan-rigor-summary.ts` should answer:

- does each active track have a hypothesis
- does each track define a main metric and success threshold
- are baseline references present
- are rollback/stop rules present
- does the staged task graph cover the declared track

This should rely on existing durable files only:

- `PROJECT_MANIFEST.json`
- `TRACK_REGISTRY.json`
- plan docs under `orchestrator/`
- active execution metadata if present

### 5.4 Explicit Non-Goals

Do not implement in this workstream:

- live Semantic Scholar baseline completeness checks
- top-3 SOTA hard coverage enforcement
- code-vs-plan hard alignment checking
- external benchmarking APIs

### 5.5 Workflow Integration

Default semantics:

- if plan quality is weak but the story can still proceed: `repairable`
- if ablation coverage is partial: advisory + dynamic task hint
- if there is literally no ablation path for a core innovation claim: elevate to strong warning

This workstream should influence:

- plan quality prompts
- experiment readiness summaries
- reviewer awareness of what claims should remain provisional

It should not automatically block experiment launch unless the missing contract is extreme.

### 5.6 Acceptance Criteria

- active experiment tracks receive clear coverage summaries
- output helps the orchestrator/coder understand what to add next
- no survey workflow regression
- no new dependence on remote APIs

---

## 6. Workstream C: Venue-Aware Review Guidance

### 6.1 Goal

Give reviewer and writer agents better venue-shaped feedback without making the paper-writing flow feel like a rigid score-optimization game.

### 6.2 Deliverables

Create:

- [tools/research-writing/venue-calibration.ts](/Users/iranb/Library/Mobile%20Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/tools/research-writing/venue-calibration.ts)

Update:

- [tools/research-writing/section-scorer.ts](/Users/iranb/Library/Mobile%20Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/tools/research-writing/section-scorer.ts)
- [tools/workflow-guard-guidance/writing-guidance.ts](/Users/iranb/Library/Mobile%20Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/tools/workflow-guard-guidance/writing-guidance.ts)
- reviewer or writer skill docs where appropriate

Artifacts:

- `reviewer/VENUE_CALIBRATION_REPORT.json`
- optionally a summary section inside an existing review packet

Add tests:

- `tests/research-writing/venue-calibration.test.mjs`
- updated section scorer tests
- one writing-guidance regression test

### 6.3 Scope

Support a bounded set of venue profiles:

- NeurIPS
- ICML
- ICLR
- CVPR
- ACL
- AAAI

The profile should shape guidance on:

- novelty emphasis
- experimental completeness
- empirical credibility
- storytelling expectations
- limitation handling

### 6.4 Integration Policy

This is advisory, not a hard gate.

Permitted uses:

- improve reviewer summaries
- help writers tune emphasis
- explain why a section feels weak for a given venue

Not permitted in this phase:

- blocking `write -> submit` solely because a venue score is low
- substituting numeric venue score for real scientific evidence

### 6.5 Acceptance Criteria

- different venue profiles produce meaningfully different advice
- writer/reviewer prompts become more concrete
- no regression in existing writing-stage readiness logic

---

## 7. Workstream D: Runtime Hardening and Error Visibility

### 7.1 Goal

Reduce silent failure and fragile runtime behavior in the workflow control plane without embarking on a major structural rewrite.

### 7.2 Deliverables

Audit and patch the most dangerous silent catches in:

- workflow runtime snapshot/read paths
- project resolution paths
- stage-preflight and derived-state reads
- runtime queue/background reconciliation paths

Preferred pattern:

- return `null` or degrade only on expected ENOENT-like absence
- log unexpected runtime issues with enough context to debug
- rethrow when silent recovery would hide a real system bug

### 7.3 Scope

Include:

- top 10-15 most dangerous silent catches
- fragile JSON read/parse boundaries
- misleading fallback logic in read-only paths

Defer:

- broad architectural split of [workflow-guard.ts](/Users/iranb/Library/Mobile%20Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/tools/workflow-guard.ts)
- style-only refactors
- large public API reorganization

### 7.4 Why This Instead of a Large Guard Split

The codebase has already started modular extraction, and the highest ROI now is not another large split project. The highest ROI is:

- more predictable runtime behavior
- clearer error surfaces
- less accidental regression in prompt/build/handoff flows

### 7.5 Acceptance Criteria

- fewer silent failure paths in critical runtime modules
- improved logs for unexpected failures
- no new regression in hook, snapshot, background-run, or stage transition tests

---

## 8. Workstream E: Verification and Canary Coverage

### 8.1 Goal

Ensure the new features are actually consumed by the workflow and do not become dead modules.

### 8.2 Deliverables

Add:

- targeted tests for each new module
- workflow tool integration tests
- at least one end-to-end smoke path for the ordinary paper line that exercises the new statistical and diagnostic outputs
- one explicit non-regression check for the survey line

Documentation:

- a quarterly canary procedure under docs or plan materials

### 8.3 Canary Design

Quarterly canary should validate:

- ordinary paper line still produces expected contracts
- survey line stays on survey workflow line
- significance artifact generation still works when seeds are present
- diagnostic artifacts do not create accidental hard-block loops

### 8.4 Acceptance Criteria

- `npm run build` passes
- `npm test` passes
- no new runtime import breakage
- no new stage-loop regression from the added diagnostics

---

## 9. Detailed Execution Sequence

### Phase 1: Statistical Rigor Foundation

1. Add the `experiment-statistics/` module directory.
2. Implement pure statistical helpers.
3. Add deterministic unit tests and edge-case tests.
4. Add `research_workflow` tool exposure.
5. Update Analyzer skill docs to call the tool.
6. Emit `SIGNIFICANCE_REPORT.json`.
7. Add analyzer/runtime integration coverage.

Exit condition:

- statistical helpers are stable
- Analyzer can produce the artifact
- no survey regression

### Phase 2: Design Diagnostics

1. Implement `ablation-coverage.ts`.
2. Implement `plan-rigor-summary.ts`.
3. Register both through workflow tools.
4. Surface results in orchestrator/analyzer-facing guidance.
5. Decide soft signal severity and connect to execution-stage summaries.
6. Add regression tests around `repairable` vs `blocking` semantics.

Exit condition:

- active tracks get readable design diagnostics
- no external API dependence
- no new experiment-start deadlock

### Phase 3: Venue-Calibrated Guidance

1. Add venue profile definitions.
2. Integrate them into section scoring.
3. Update writing guidance output.
4. Add reviewer-facing artifact or summary.
5. Add tests for venue differentiation.

Exit condition:

- venue advice is visible and useful
- write flow remains advisory-first

### Phase 4: Runtime Hardening

1. Inventory high-risk silent catches.
2. Patch the top set in runtime-critical modules.
3. Add regression tests for improved failure visibility where practical.
4. Re-run full test suite after every small batch, not as one large patch.

Exit condition:

- runtime behavior is more legible
- no fragile read-path regressions

### Phase 5: Canary and Final Verification

1. Add or update smoke tests.
2. Document the quarterly canary.
3. Validate build, tests, and workflow non-regression.

Exit condition:

- implementation is demonstrably wired into the workflow

---

## 10. File-Level Change Map

### New files likely required

- `tools/experiment-statistics/significance.ts`
- `tools/experiment-statistics/multi-seed-aggregator.ts`
- `tools/experiment-rigor/ablation-coverage.ts`
- `tools/experiment-rigor/plan-rigor-summary.ts`
- `tools/research-writing/venue-calibration.ts`
- corresponding `tests/...` files

### Existing files likely to change

- [tools/register-workflow-tools.ts](/Users/iranb/Library/Mobile%20Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/tools/register-workflow-tools.ts)
- [tools/workflow-guard-stages/execution-stage-signals.ts](/Users/iranb/Library/Mobile%20Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/tools/workflow-guard-stages/execution-stage-signals.ts)
- [tools/workflow-guard-guidance/dynamic-tasks.ts](/Users/iranb/Library/Mobile%20Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/tools/workflow-guard-guidance/dynamic-tasks.ts)
- [tools/research-writing/section-scorer.ts](/Users/iranb/Library/Mobile%20Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/tools/research-writing/section-scorer.ts)
- [tools/workflow-guard-guidance/writing-guidance.ts](/Users/iranb/Library/Mobile%20Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/tools/workflow-guard-guidance/writing-guidance.ts)
- [skills/analyzer/analyze-results/SKILL.md](/Users/iranb/Library/Mobile%20Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/skills/analyzer/analyze-results/SKILL.md)
- [skills/academic_writer/paper-write/SKILL.md](/Users/iranb/Library/Mobile%20Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/skills/academic_writer/paper-write/SKILL.md)

---

## 11. Risks and Mitigations

### Risk 1: New diagnostics accidentally become blockers

Mitigation:

- represent outputs as soft diagnostics first
- add explicit tests for `repairable` behavior
- avoid wiring them directly into submit-stage hard gates in the first pass

### Risk 2: Statistics logic causes false confidence

Mitigation:

- conservative labeling for low seed counts
- clear `insufficient_seeds` state
- avoid overstating significance in generated prose

### Risk 3: Survey workflow regresses due to experiment-specific checks

Mitigation:

- stage-aware and line-aware guards in every new signal
- add at least one survey non-regression test

### Risk 4: Runtime hardening turns expected absence into noisy failures

Mitigation:

- treat ENOENT and explicit “artifact not yet created” cases differently from malformed or contradictory state

---

## 12. Approval Questions for Implementation

Before implementation, confirm:

1. Statistical significance should be soft-gated for low-seed runs, not universal hard-gated.
2. Baseline completeness should remain out of scope for now if it depends on unstable external APIs.
3. Venue calibration should remain reviewer/writer advisory, not a submit blocker.
4. `workflow-guard.ts` should receive targeted hardening, not a new large split project in this round.

If all four remain true, this plan is ready to execute.

---

## 13. Recommended First Implementation Slice

If implementation starts immediately, the first slice should be:

1. `significance.ts`
2. `multi-seed-aggregator.ts`
3. workflow tool registration
4. Analyzer skill wiring
5. tests

This slice is small enough to review clearly, scientifically meaningful, and unlikely to destabilize the broader workflow.
