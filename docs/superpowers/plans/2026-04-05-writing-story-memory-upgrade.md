# Writing, Story, and Cross-Cycle Memory Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade `openclaw-research` so its existing writing, review, tournament, and memory assets are actually exercised by the workflow, producing stronger story discipline, rebuttal depth, and cross-cycle learning without creating a parallel workflow system.

**Architecture:** Add a focused `tools/research-writing/` integration layer for writing/review/story orchestration and a small `tools/research-memory/` aggregation layer for cross-cycle summaries. Wire these modules into stage preflight and writer/reviewer guidance with thin touchpoints only; avoid pushing new business logic into `workflow-guard.ts`.

**Tech Stack:** TypeScript, existing workflow runtime (`stage-preflight`, `register-workflow-tools`, `writing-guidance`), existing skill packs (`paper-plan`, `paper-write`, `research-paper-writing`, `review-response`, `idea-tournament`), Node test runner, repo-local markdown/json artifacts.

**Status:** Completed on 2026-04-05.

---

## Current Context

The repository already contains most of the raw assets needed for higher-quality writing and review:

- Existing section references and review heuristics:
  - `skills/academic_writer/research-paper-writing/references/*.md`
- Existing writer/reviewer workflow contracts:
  - `paper_story_state`
  - `review_pressure_packet`
  - `writing_contract`
- Existing tournament and ideation assets:
  - `CANDIDATE_POOL.json`
  - `RANKING_HISTORY.json`
  - `TOURNAMENT_SCOREBOARD.json`
  - `TOP3_DIRECTION_SUMMARY.md`
  - `RESEARCH_PROPOSAL.md`
- Existing rebuttal skill and template:
  - `skills/reviewer/review-response/SKILL.md`
  - `skills/reviewer/review-response/REBUTTAL_TEMPLATE.md`
- Existing project memory:
  - `memory/ideation-memory.md`
  - `memory/experiment-memory.md`
  - `innovation_reflection`
  - `brainstorm_cycle.working_memory_path`
  - `TRACK_REGISTRY.json`

The main remaining problem is not missing assets but **missing execution connections**:

1. section references are not materialized into a workflow-owned writing bundle
2. fallback narrative exists but is not activated by durable triggers
3. iterative revision is described but not scaffolded as a workflow-owned cycle
4. pre-writing reject simulation / self-attack / figure-anchored writing are not materialized as durable artifacts
5. rebuttal exists but lacks explicit strategy metadata
6. cross-cycle learning exists in fragments but not as a consolidated evolutionary memory layer
7. idea tournament has competitive outputs but does not enforce a stronger candidate-floor policy or emit an explicit contribution-to-story bridge

## File Structure

### New modules

- Create: `tools/research-writing/reference-bundles.ts`
- Create: `tools/research-writing/fallback-activation.ts`
- Create: `tools/research-writing/revision-cycle.ts`
- Create: `tools/research-writing/prewrite-rejection.ts`
- Create: `tools/research-writing/figure-anchor.ts`
- Create: `tools/research-writing/story-bridge.ts`
- Create: `tools/research-memory/cycle-memory.ts`

### Existing modules to modify

- Modify: `tools/workflow-guard-runtime/stage-preflight.ts`
- Modify: `tools/workflow-guard-guidance/writing-guidance.ts`
- Modify: `tools/workflow-guard-state/paper-story.ts`
- Modify: `tools/workflow-guard-materializers/paper-story-materializer.ts`
- Modify: `tools/workflow-guard-materializers/ideation-contract-materializer.ts`
- Modify: `tools/register-workflow-tools.ts`
- Modify: `skills/academic_writer/paper-plan/SKILL.md`
- Modify: `skills/academic_writer/paper-write/SKILL.md`
- Modify: `skills/academic_writer/research-paper-writing/SKILL.md`
- Modify: `skills/researcher/idea-tournament/SKILL.md`
- Modify: `skills/reviewer/review-response/SKILL.md`
- Modify: `skills/reviewer/review-response/REBUTTAL_TEMPLATE.md`

### New reference docs

- Create: `skills/academic_writer/research-paper-writing/references/counterintuitive-writing.md`
- Create: `skills/academic_writer/research-paper-writing/references/story-planning-rules.md`
- Create: `skills/academic_writer/research-paper-writing/references/self-attack-protocol.md`
- Create: `skills/academic_writer/research-paper-writing/references/figure-centric-writing.md`

### Tests

- Create: `tests/research-writing-integration.test.mjs`
- Create: `tests/research-cycle-memory.test.mjs`
- Modify: `tests/workflow-zotero-scientific-skills.test.mjs`
- Modify: `tests/workflow-runtime-tools.test.mjs`
- Modify: `tests/auto-iterator.test.mjs`
- Modify: `tests/idea-catalyst-runtime-tools.test.mjs`
- Modify: `tests/idea-catalyst-modules.test.mjs`

## Phase Map

### Phase 1: Immediate execution connections

- A1: connect `research-paper-writing/references/` to actual writer execution
- A2: add workflow-owned fallback narrative activation
- B4: add durable iterative revision-cycle scaffolding

### Phase 2: wisdom-layer writing and review depth

- B1: add counterintuitive writing rules + planning rules
- B2: integrate pre-writing reject simulation into `paper-plan`
- B3: integrate writing-time self-attack protocol into `paper-write`
- B5: add figure-centric / anchor-figure writing strategy
- B6: add rebuttal strategy depth
- C3: add reverse-engineering contribution-to-story bridge

### Phase 3: cross-cycle learning and tournament tightening

- C1: add cross-cycle evolutionary memory aggregation
- C2: strengthen tournament candidate-floor policy

---

### Task 1: Add failing tests for writing execution bundles and fallback activation

**Files:**
- Create: `tests/research-writing-integration.test.mjs`
- Modify: `tests/workflow-zotero-scientific-skills.test.mjs`

- [ ] **Step 1: Write failing tests for section reference bundle generation**

Cover:
- section -> reference files mapping
- inclusion of counterintuitive/planning/self-attack/figure references

- [ ] **Step 2: Write failing tests for fallback activation**

Cover:
- `partial/unsupported` support + review pressure -> `fallback`
- `supported` support + low pressure -> `main`

- [ ] **Step 3: Write failing doc tests for `paper-plan`, `paper-write`, and rebuttal strategy content**

Cover:
- `paper-plan` mentions reject simulation, story bridge, figure anchor
- `paper-write` mentions writing bundle, fallback activation, self-attack, revision cycle
- `review-response` and template mention color-coded strategy / champion path

- [ ] **Step 4: Run targeted tests to verify RED**

Run:
`node --test tests/research-writing-integration.test.mjs tests/workflow-zotero-scientific-skills.test.mjs`

Expected:
- FAIL on missing new modules / missing doc references

### Task 2: Implement Phase 1 execution connections

**Files:**
- Create: `tools/research-writing/reference-bundles.ts`
- Create: `tools/research-writing/fallback-activation.ts`
- Create: `tools/research-writing/revision-cycle.ts`
- Modify: `tools/workflow-guard-runtime/stage-preflight.ts`
- Modify: `tools/workflow-guard-guidance/writing-guidance.ts`
- Modify: `tools/workflow-guard-state/paper-story.ts`
- Modify: `tools/workflow-guard-materializers/paper-story-materializer.ts`
- Modify: `tools/register-workflow-tools.ts`

- [ ] **Step 1: Implement writing reference bundle materializer**

Write:
- durable file `academic_writer/WRITING_REFERENCE_BUNDLE.json`
- section-level mapping to `research-paper-writing/references/*`
- include planning rules, counterintuitive rules, self-attack, figure-centric references

- [ ] **Step 2: Implement fallback activation materializer**

Write:
- durable file `academic_writer/FALLBACK_ACTIVATION.json`
- derive `active_narrative_mode = main|fallback`
- derive `trigger_reason`
- derive `blocking_claim_ids` and `recommended_story_switch`

- [ ] **Step 3: Implement revision-cycle materializer**

Write:
- durable file `academic_writer/PAPER_REVISION_STATE.json`
- states:
  - `section_pass`
  - `intro_method_consistency_pass`
  - `full_paper_adversarial_pass`

- [ ] **Step 4: Wire these materializers into stage preflight for `plan/write/review/submit`**

Rules:
- plan -> bundle + prewrite simulation + figure anchor + story bridge
- write/review/submit -> fallback activation + revision state + cycle memory refresh

- [ ] **Step 5: Update writing guidance to point writers/reviewers to the new durable artifacts**

- [ ] **Step 6: Run targeted tests to verify GREEN**

Run:
`node --test tests/research-writing-integration.test.mjs`

Expected:
- PASS

### Task 3: Add the wisdom-layer reference content and connect it to execution

**Files:**
- Create: `skills/academic_writer/research-paper-writing/references/counterintuitive-writing.md`
- Create: `skills/academic_writer/research-paper-writing/references/story-planning-rules.md`
- Create: `skills/academic_writer/research-paper-writing/references/self-attack-protocol.md`
- Create: `skills/academic_writer/research-paper-writing/references/figure-centric-writing.md`
- Modify: `skills/academic_writer/research-paper-writing/SKILL.md`
- Modify: `skills/academic_writer/paper-plan/SKILL.md`
- Modify: `skills/academic_writer/paper-write/SKILL.md`

- [ ] **Step 1: Add 7 counterintuitive writing rules**

They should explicitly cover:
- remove easy-but-weak contribution framing
- write the challenge so the method feels necessary
- shrink claims before expanding wording
- prefer defense-ready contributions over exciting but unsupported ones
- do not let related work dissolve the gap
- make limitations strengthen trust rather than weaken confidence
- optimize for skeptical reviewer reading order

- [ ] **Step 2: Add 5 planning rules**

They should explicitly cover:
- story before prose
- contributions before sections
- anchor figure before paragraph sprawl
- fallback narrative before overclaiming
- rejection simulation before outline freeze

- [ ] **Step 3: Connect `paper-plan` to pre-writing reject simulation and story bridge**

Write durable outputs:
- `academic_writer/PREWRITE_REJECTION_SIMULATION.md`
- `academic_writer/CONTRIBUTION_TO_STORY_BRIDGE.md`
- `academic_writer/FIGURE_ANCHOR_PLAN.md`

- [ ] **Step 4: Connect `paper-write` to self-attack and revision state**

Require it to consume:
- `WRITING_REFERENCE_BUNDLE.json`
- `FALLBACK_ACTIVATION.json`
- `PAPER_REVISION_STATE.json`
- `PREWRITE_REJECTION_SIMULATION.md`
- `CONTRIBUTION_TO_STORY_BRIDGE.md`
- `FIGURE_ANCHOR_PLAN.md`

- [ ] **Step 5: Run targeted tests**

Run:
`node --test tests/research-writing-integration.test.mjs tests/workflow-zotero-scientific-skills.test.mjs`

Expected:
- PASS

### Task 4: Strengthen rebuttal strategy depth

**Files:**
- Modify: `skills/reviewer/review-response/SKILL.md`
- Modify: `skills/reviewer/review-response/REBUTTAL_TEMPLATE.md`

- [ ] **Step 1: Add explicit issue color coding**

Statuses:
- `red` = needs new evidence or major claim downgrade
- `amber` = manuscript revision can address
- `green` = already addressed

- [ ] **Step 2: Add champion strategy**

Every response must classify the response mode:
- `fix_now`
- `downgrade_claim`
- `defer_with_scope_boundary`
- `rebut_with_existing_evidence`

- [ ] **Step 3: Add top rebuttal priorities and revision commitments**

- [ ] **Step 4: Verify doc tests**

Run:
`node --test tests/workflow-zotero-scientific-skills.test.mjs`

Expected:
- PASS

### Task 5: Add cross-cycle evolutionary memory aggregation

**Files:**
- Create: `tools/research-memory/cycle-memory.ts`
- Create: `tests/research-cycle-memory.test.mjs`
- Modify: `tools/workflow-guard-runtime/stage-preflight.ts`

- [ ] **Step 1: Write failing tests for cycle-memory aggregation**

Cover:
- ideation lessons
- writing/rebuttal lessons
- experiment-supported evolution summaries

- [ ] **Step 2: Implement cycle-memory aggregation**

Write durable outputs:
- `memory/IDE_CYCLE_MEMORY.json`
- `memory/IVE_CYCLE_MEMORY.json`
- `memory/ESE_CYCLE_MEMORY.json`

Source data should come from existing artifacts only:
- `brainstorm_cycle`
- `innovation_reflection`
- `TRACK_REGISTRY.json`
- `IDEA_TO_CLAIM_MAP.json`
- `CLAIM_EVIDENCE_MATRIX.md`
- `REVIEW_REPORT.md`
- rebuttal strategy outputs
- `experiment-memory.md`

- [ ] **Step 3: Wire cycle-memory refresh into stage preflight**

Refresh at:
- `idea`
- `review`
- `write`
- `submit`

- [ ] **Step 4: Run targeted tests**

Run:
`node --test tests/research-cycle-memory.test.mjs`

Expected:
- PASS

### Task 6: Tighten idea tournament floor and story bridge

**Files:**
- Modify: `tools/workflow-guard-materializers/ideation-contract-materializer.ts`
- Modify: `skills/researcher/idea-tournament/SKILL.md`
- Modify: `tests/idea-catalyst-runtime-tools.test.mjs`

- [ ] **Step 1: Enforce stronger candidate-floor policy**

Use:
- `target_candidate_count = 15`
- `hard_floor_candidate_count = 9`

If fewer than 15 survive:
- mark scarcity in tournament scoreboard
- require explicit scarcity reason
- do not silently present a tiny pool as “fully explored”

- [ ] **Step 2: Emit story-bridge-compatible metadata from ideation materialization**

Carry forward:
- top fragment(s)
- top-3 directions
- selected direction -> contribution hints
- candidate scarcity reason

- [ ] **Step 3: Update `idea-tournament` docs to match the stronger policy**

- [ ] **Step 4: Run targeted tests**

Run:
`node --test tests/idea-catalyst-runtime-tools.test.mjs`

Expected:
- PASS

### Task 7: Broad verification

**Files:**
- Test only

- [ ] **Step 1: Run writing/review/idea targeted suite**

Run:
`node --test tests/research-writing-integration.test.mjs tests/research-cycle-memory.test.mjs tests/workflow-zotero-scientific-skills.test.mjs tests/idea-catalyst-runtime-tools.test.mjs`

- [ ] **Step 2: Run broader workflow suite**

Run:
`node --test tests/auto-iterator.test.mjs tests/workflow-runtime-tools.test.mjs tests/workflow-service.test.mjs tests/workflow-commands.test.mjs`

- [ ] **Step 3: Run build**

Run:
`npm run build`

- [ ] **Step 4: Update this plan with completion notes if implementation diverged**

---

## Completion Criteria

This plan is complete only when all of the following are true:

1. `paper-plan` and `paper-write` explicitly consume durable writing/story assets rather than just mentioning them conceptually
2. writer execution has a materialized `WRITING_REFERENCE_BUNDLE.json`
3. fallback narrative activation is durable and auto-generated
4. revision cycle state is durable and auto-generated
5. pre-writing rejection simulation, figure anchor plan, and contribution-to-story bridge are durable and auto-generated
6. rebuttal template includes strategic depth fields
7. cycle-memory aggregation writes `IDE/IVE/ESE` project artifacts
8. tournament materialization no longer quietly accepts a tiny candidate pool without explanation
9. all targeted and broad verification commands pass

---

## Completion Notes

- All planned implementation items in this document were completed and verified on 2026-04-05.
- The intended `tools/research-memory/cycle-memory.ts` path was adapted to:
  - `tools/research-memory-cycle.ts`
  - `tools/research-memory-cycle`
  because `tools/research-memory` already existed as a repo shim file, so creating a nested directory there would have conflicted with the existing module layout.
- Writing/story support now materializes durable workflow-owned artifacts:
  - `academic_writer/WRITING_REFERENCE_BUNDLE.json`
  - `academic_writer/FALLBACK_ACTIVATION.json`
  - `academic_writer/PAPER_REVISION_STATE.json`
  - `academic_writer/PREWRITE_REJECTION_SIMULATION.md`
  - `academic_writer/FIGURE_ANCHOR_PLAN.md`
  - `academic_writer/CONTRIBUTION_TO_STORY_BRIDGE.md`
- Cross-cycle memory now materializes:
  - `memory/IDE_CYCLE_MEMORY.json`
  - `memory/IVE_CYCLE_MEMORY.json`
  - `memory/ESE_CYCLE_MEMORY.json`
- Tournament tightening was implemented with:
  - `candidate_target_count = 15`
  - `hard_floor_candidate_count = 9`
  - explicit `candidate_pool_status`
  - explicit `candidate_scarcity_reason`
  - contribution hints carried forward into story-facing artifacts
- The final candidate-floor status semantics are:
  - `healthy` for pools meeting the target breadth
  - `scarce` for pools below target but still above the hard floor
  - `below_floor` for pools that do not meet the hard minimum
- Verification completed successfully with:
  - `node --test tests/research-writing-integration.test.mjs tests/research-cycle-memory.test.mjs tests/workflow-zotero-scientific-skills.test.mjs tests/idea-catalyst-runtime-tools.test.mjs tests/idea-catalyst-modules.test.mjs tests/idea-catalyst-state.test.mjs tests/idea-catalyst-llm-control.test.mjs tests/auto-iterator.test.mjs tests/workflow-runtime-tools.test.mjs tests/workflow-service.test.mjs tests/workflow-commands.test.mjs`
  - `npm run build`
