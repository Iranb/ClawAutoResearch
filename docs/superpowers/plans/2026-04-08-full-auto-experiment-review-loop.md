# Full-Auto Experiment Review Loop Implementation Plan

> **Status:** COMPLETED

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the current semi-automatic `experiment` stage into a reviewed full-auto launch loop that inserts `planner`, `analyzer`, and `cross-reviewer` between `researcher` and `coder`, so aggressive auto mode can autonomously decide whether an experiment bundle is worth launching before it spends compute.

**Architecture:** Keep the top-level stage graph unchanged (`code -> experiment -> analyze`) and turn `experiment` into a richer micro-stage pipeline: `planning -> analyzer_review -> cross_review -> synthesis -> launch -> monitor -> ready_for_analysis`. Reuse the current workflow guard, auto-iterator, mailbox, and auto-gate/auto-discussion patterns instead of creating a parallel orchestration system. Ground pre-launch review in existing project artifacts plus PaperNexus graph packets so the review loop audits claim coverage, baseline fairness, falsifiers, compute budget, and novelty risk before `coder` is allowed to launch.

**Tech Stack:** TypeScript, Node.js built-in test runner, existing `research_workflow` runtime tools, workflow guard/runtime/service modules, PaperNexus packet contracts, skill docs under `skills/`

---

## Planned File Map

### New files

- `tools/workflow-guard-state/experiment-review.ts`
  - Normalize, serialize, summarize, and validate durable experiment pre-launch review state.
- `tools/workflow-guard-materializers/experiment-review-materializer.ts`
  - Build workflow-owned experiment review packets from tracks, claim maps, code state, and graph packets.
- `tools/workflow-auto-experiment-review.ts`
  - Run the planner/analyzer/cross-reviewer review-round store and aggregate launch verdicts.
- `tools/workflow-guard-guidance/experiment-review-guidance.ts`
  - Build focused experiment review guidance for planner, analyzer, cross-reviewer, and coder.
- `skills/planner/experiment-plan/SKILL.md`
  - New planner role skill for experiment bundle design and launch packet assembly.
- `skills/analyzer/experiment-design-review/SKILL.md`
  - Pre-launch analyzer skill that audits causal attribution, controls, metrics, stop rules, and claim coverage.
- `skills/cross-reviewer/experiment-attack/SKILL.md`
  - Stateless devil’s-advocate experiment critique modeled on the independent-review pattern.
- `agents/planner/AGENTS.md`
  - Planner role identity, write scope, and workflow expectations.
- `tests/experiment-auto-review-loop.test.mjs`
  - End-to-end review-loop regressions for experiment automation.

### Modified files

- `templates/PROJECT_MANIFEST.json`
  - Add `autonomous_execution` and `experiment_review_state`.
- `tools/workflow-guard-policies/role-policy.ts`
  - Add `planner` role and adjust contacts/spawn rules.
- `tools/workflow-agent-isolation.ts`
  - Treat `planner` as a workflow-visible project role.
- `tools/channel-project-bindings.ts`
  - Preserve isolated project binding behavior for the new role.
- `tools/plugin-registration-shared.ts`
  - Recognize planner sessions/workspaces in dashboard and tool contexts.
- `tools/workflow-guard-runtime/stage-preflight.ts`
  - Materialize experiment review state during `experiment`.
- `tools/workflow-guard-runtime/auto-iterator.ts`
  - Auto-drive experiment micro-stages: planning, review, launch, monitor.
- `tools/workflow-guard-stages/execution-stage-signals.ts`
  - Gate `experiment -> analyze` on approved launch review plus monitor reconciliation.
- `tools/register-workflow-tools.ts`
  - Add runtime getters/setters/materializers for experiment review state.
- `tools/register-workflow-service.ts`
  - Dispatch planner/analyzer/cross-reviewer review rounds and persist results.
- `tools/workflow-auto-gate.ts`
  - Reuse review result shape or shared helpers where it reduces duplication.
- `tools/workflow-auto-discussion.ts`
  - Reuse mitigation loop when analyzer and cross-reviewer disagree sharply.
- `skills/researcher/experiment-phase/SKILL.md`
  - Shift Researcher from “manually dispatch launch” to “own synthesis and escalation.”
- `skills/coder/run-experiment/SKILL.md`
  - Require approved experiment review packet before launch.
- `skills/researcher/monitor-experiment/SKILL.md`
  - Clarify that monitor mode starts only after launch-approved bundles exist.
- `skills/analyzer/analyze-results/SKILL.md`
  - Link post-run claim analysis back to pre-launch review packet.
- `skills/cross-reviewer/resume-pipeline/SKILL.md`
  - Point recovery into the new pre-launch experiment review artifacts where needed.
- `WORKFLOW.md`
  - Document the new reviewed full-auto experiment loop.
- `tests/auto-iterator.test.mjs`
- `tests/workflow-runtime-tools.test.mjs`
- `tests/workflow-service.test.mjs`
- `tests/workflow-commands.test.mjs`
- `tests/workflow-agent-isolation.test.mjs`

---

## Design Rules

1. Keep the top-level stage graph unchanged. The new logic lives inside `experiment`, not as a brand-new top-level stage.
2. Preserve `cross-reviewer` statelessness. Persist its outputs through workflow-owned files/state instead of broadening its direct write scope.
3. Do not overload `research_program` or `PROJECTS_STATE.json` as the source of truth for launch approval. Use a dedicated `experiment_review_state`.
4. Full-auto experiment launch must be opt-in. Keep current aggressive auto mode behavior unchanged unless the new autonomous execution setting is enabled.
5. “Critical” cross-reviewer findings must block autonomous launch until Researcher revises the packet or explicitly downgrades to manual mode.
6. Pre-launch review must be graph-grounded when PaperNexus packets are present. Missing graph evidence should become a concrete review defect, not silent permissiveness.

---

### Task 1: Lock the reviewed full-auto experiment behavior with failing tests

**Files:**
- Create: `tests/experiment-auto-review-loop.test.mjs`
- Modify: `tests/auto-iterator.test.mjs`
- Modify: `tests/workflow-runtime-tools.test.mjs`
- Modify: `tests/workflow-service.test.mjs`
- Modify: `tests/workflow-commands.test.mjs`
- Modify: `tests/workflow-agent-isolation.test.mjs`

- [x] **Step 1: Add state-tool regressions for experiment review**

Write failing tests for:
- `get_experiment_review_state`
- `set_experiment_review_state`
- `materialize_experiment_review_state`

Assert manifest persistence, summaries, and trace metadata.

- [x] **Step 2: Add auto-iterator regressions for pre-launch review**

Write failing tests showing:
- aggressive auto mode without reviewed-full-auto launch stays on current manual behavior
- reviewed full-auto mode enters `experiment / planning` when no runs exist
- approved bundles auto-dispatch launch
- blocked/revise verdicts do not auto-launch
- once remote runs exist, the workflow routes to `/monitor-experiment`

- [x] **Step 3: Add reviewer-panel regressions**

Write failing tests showing:
- analyzer and cross-reviewer reviews are independent and persisted separately
- cross-reviewer `critical` issues prevent auto-launch
- analyzer “claim bundle conflates variables” prevents auto-launch
- a second review round can approve a revised packet

- [x] **Step 4: Add role/isolation regressions**

Write failing tests showing:
- `planner` is workflow-visible when bound to the project
- non-project dashboard agents still do not inherit workflow guard context

### Task 2: Add durable reviewed-auto-launch state and manifest schema

**Files:**
- Create: `tools/workflow-guard-state/experiment-review.ts`
- Modify: `templates/PROJECT_MANIFEST.json`
- Modify: `tools/workflow-guard.ts`
- Modify: `tools/workflow-commands/formatters.ts`

- [x] **Step 1: Add manifest schema for full-auto experiment launch**

Add:

```json
{
  "autonomous_execution": {
    "experiment_launch_mode": "manual",
    "max_experiment_review_rounds": 2,
    "require_analyzer_review": true,
    "require_cross_review": true
  },
  "experiment_review_state": {
    "status": "missing",
    "micro_stage": "planning",
    "review_round": 0,
    "launch_approved": false,
    "packet_path": null,
    "planner_plan_path": null,
    "analyzer_report_path": null,
    "cross_reviewer_report_path": null,
    "launch_decision_path": null
  }
}
```

- [x] **Step 2: Normalize and summarize experiment review state**

Implement normalized fields for:
- packet fingerprint
- reviewed track ids
- claim ids covered
- verdict summary
- blocker count
- latest launch approval timestamp

- [x] **Step 3: Expose state in workflow snapshot and status**

Add concise status lines for:
- experiment review mode
- current micro-stage
- review round
- approval/block reason
- launch readiness

### Task 3: Introduce the Planner role and experiment review packet builder

**Files:**
- Create: `skills/planner/experiment-plan/SKILL.md`
- Create: `agents/planner/AGENTS.md`
- Create: `tools/workflow-guard-materializers/experiment-review-materializer.ts`
- Modify: `tools/workflow-guard-policies/role-policy.ts`
- Modify: `tools/workflow-agent-isolation.ts`
- Modify: `tools/channel-project-bindings.ts`
- Modify: `tools/plugin-registration-shared.ts`

- [x] **Step 1: Add planner to workflow roles**

Update role policy so:
- `researcher` can contact/spawn `planner`
- `planner` can contact `researcher`
- planner writes only under `{PROJ}/planner/`

- [x] **Step 2: Define the planner packet contract**

The materializer must write a workflow-owned packet like:

```json
{
  "track_id": "fd-gcd-freq-debiased",
  "claims_under_test": ["C1", "C2"],
  "single_variable_change": "frequency debiasing term only",
  "baselines": [],
  "datasets": [],
  "metrics": [],
  "ablations": [],
  "falsifiers": [],
  "stop_rules": [],
  "compute_budget": {},
  "graph_grounding": {
    "baseline_norms": [],
    "evaluation_norms": [],
    "mechanism_bridges": []
  }
}
```

- [x] **Step 3: Ground the planner packet in current durable artifacts**

Use:
- `TRACK_REGISTRY.json`
- `CLAIM_POLICY.md`
- `researcher/ideation/RESEARCH_PROPOSAL.md`
- `academic_writer/story/CLAIM_TO_EXPERIMENT_MAP.md`
- PaperNexus packets under `researcher/papernexus/`
- experiment ledger / prior verdicts

The planner packet must explicitly identify what evidence the launch is supposed to produce, not just how to run it.

### Task 4: Add analyzer and cross-reviewer pre-launch review passes

**Files:**
- Create: `skills/analyzer/experiment-design-review/SKILL.md`
- Create: `skills/cross-reviewer/experiment-attack/SKILL.md`
- Create: `tools/workflow-auto-experiment-review.ts`
- Create: `tools/workflow-guard-guidance/experiment-review-guidance.ts`
- Modify: `tools/register-workflow-service.ts`
- Modify: `tools/workflow-auto-discussion.ts`
- Modify: `tools/workflow-auto-gate.ts`

- [x] **Step 1: Model the review loop after the academic review pipeline**

Adapt the external review pattern into:
- Phase 0: planner assembles review packet
- Phase 1: analyzer and cross-reviewer review independently
- Phase 2: workflow-owned synthesis decides `pass / revise / block`
- Phase 2.5: revised packet can be re-reviewed up to the configured round limit

- [x] **Step 2: Define analyzer review output**

Analyzer review must score and explain:
- claim-to-experiment alignment
- attribution purity (one variable per experiment)
- baseline fairness
- metric sufficiency
- seed/variance adequacy
- stop-rule sanity
- expected artifact completeness

- [x] **Step 3: Define cross-reviewer attack output**

Cross-reviewer output must include:
- strongest counter-argument
- missing alternative explanations
- likely cherry-picking risk
- missing falsifiers / negative controls
- confirmation-bias risk
- “so what?” / launch-worthiness judgment

`critical` cross-reviewer findings must hard-block autonomous launch.

- [x] **Step 4: Persist review results through workflow-owned artifacts**

Do not grant broad write scope to `cross-reviewer`. Persist returned reviewer outputs into workflow-owned files and state such as:
- `{PROJ}/planner/EXPERIMENT_REVIEW_PACKET.json`
- `{PROJ}/analyzer/EXPERIMENT_REASONABLENESS_REPORT.md`
- `{PROJ}/cross-reviewer/EXPERIMENT_ATTACK_REPORT.md`
- `{PROJ}/researcher/EXPERIMENT_LAUNCH_DECISION.json`

### Task 5: Auto-drive experiment micro-stages in aggressive reviewed-auto mode

**Files:**
- Modify: `tools/workflow-guard-runtime/stage-preflight.ts`
- Modify: `tools/workflow-guard-runtime/auto-iterator.ts`
- Modify: `tools/workflow-guard-stages/execution-stage-signals.ts`
- Modify: `tools/register-workflow-tools.ts`

- [x] **Step 1: Materialize experiment review state during `experiment`**

When:
- current stage = `experiment`
- no active remote runs exist
- reviewed full-auto launch is enabled

then preflight must ensure the planner packet and review state exist.

- [x] **Step 2: Add experiment micro-stage routing**

Use deterministic micro-stages:
- `planning`
- `analyzer_review`
- `cross_review`
- `synthesis`
- `launch_ready`
- `launching`
- `monitoring`
- `ready_for_analysis`

- [x] **Step 3: Auto-launch only after reviewed approval**

If the review aggregate is approved:
- hand off to `coder` with an explicit launch packet
- persist a launch decision
- mark `micro_stage = launching`

If the review aggregate is `revise` or `block`:
- keep ownership with `researcher`
- surface exact blockers
- do not route to `coder`

- [x] **Step 4: Reuse existing monitor flow after launch**

Do not invent a second post-launch control plane. Once runs exist:
- route back to `/monitor-experiment`
- keep using `EXPERIMENT_LEDGER.json`
- keep using `experiment_search`
- advance to `analyze` only when current readiness rules are satisfied

### Task 6: Tighten role skills and review standards

**Files:**
- Modify: `skills/researcher/experiment-phase/SKILL.md`
- Modify: `skills/coder/run-experiment/SKILL.md`
- Modify: `skills/researcher/monitor-experiment/SKILL.md`
- Modify: `skills/analyzer/analyze-results/SKILL.md`
- Modify: `skills/cross-reviewer/resume-pipeline/SKILL.md`
- Modify: `WORKFLOW.md`

- [x] **Step 1: Re-scope Researcher’s experiment-phase role**

Researcher should:
- pick tracks/hypotheses
- request or revise the planner packet
- synthesize analyzer/cross-reviewer verdicts
- decide whether to accept a revise loop or downgrade to manual launch

Researcher should no longer be the only manual bridge between experiment design and launch in full-auto mode.

- [x] **Step 2: Make Coder launch strictly packet-driven**

`/run-experiment` must reject launch attempts that do not have:
- approved launch decision
- stable experiment packet fingerprint
- explicit one-variable change statement
- concrete stop rule and artifact targets

- [x] **Step 3: Add graph-grounded experiment-quality checks**

The skill docs must explicitly instruct planner/analyzer/cross-reviewer to use PaperNexus-backed context for:
- standard baselines used in adjacent work
- standard metrics / evaluation slices
- known confounds and missing controls
- closest prior experiments likely to invalidate the launch

### Task 7: Verify the whole reviewed full-auto loop end to end

**Files:**
- Test: `tests/experiment-auto-review-loop.test.mjs`
- Test: `tests/auto-iterator.test.mjs`
- Test: `tests/workflow-runtime-tools.test.mjs`
- Test: `tests/workflow-service.test.mjs`
- Test: `tests/workflow-commands.test.mjs`
- Test: `tests/workflow-agent-isolation.test.mjs`

- [x] **Step 1: Run focused runtime and service suites**

Run:

```bash
node --test tests/experiment-auto-review-loop.test.mjs tests/auto-iterator.test.mjs tests/workflow-runtime-tools.test.mjs tests/workflow-service.test.mjs tests/workflow-commands.test.mjs tests/workflow-agent-isolation.test.mjs
```

Expected:
- PASS
- reviewed full-auto experiment loop promotes `planning -> review -> launch -> monitor`
- blocked reviews prevent autonomous launch

- [x] **Step 2: Run the TypeScript build**

Run:

```bash
npm run build
```

Expected:
- PASS

---

## Execution Notes

- Prefer implementing this in three mergeable slices even if the code is developed in one branch:
  1. state + tests + planner role
  2. review loop + auto-iterator integration
  3. skill/doc tightening + end-to-end verification
- Reuse existing reviewer-packet patterns instead of inventing one-off JSON layouts.
- Preserve manual and conservative modes as stable fallbacks throughout the rollout.

## External Design Inputs

This plan adapts ideas from the public `academic-research-skills` repository, especially:
- `academic-pipeline` for phase-based review orchestration
- `academic-paper-reviewer` for independent reviewers, devil’s-advocate critique, and “critical issues block acceptance”

The adaptation here is intentionally narrower:
- experiment-launch review, not manuscript review
- graph-grounded experiment reasonableness, not only prose critique
- workflow-owned durable state, not chat-only orchestration

## Completion Notes

- Reviewed-auto experiment launch is now a first-class micro-stage loop inside `experiment`: `planning -> analyzer_review -> cross_review -> synthesis -> launching -> monitoring -> ready_for_analysis`.
- The workflow now persists and summarizes `experiment_review_state` durably, exposes it in `/workflow-status`, and auto-routes ownership to `planner`, `analyzer`, `cross-reviewer`, `researcher`, or `coder` as appropriate.
- Experiment review state now self-heals from workflow-owned artifacts. Planner/analyzer/cross-reviewer/Researcher can update files and the next materialization pass will reconcile verdicts, blockers, launch readiness, and micro-stage timing without requiring brittle manual manifest edits.
- Manual launch remains the fallback. The full-auto path activates only when `autonomous_execution.experiment_launch_mode = reviewed_auto`.
