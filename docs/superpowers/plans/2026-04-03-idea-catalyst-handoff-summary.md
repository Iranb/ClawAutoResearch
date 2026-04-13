# IDEA-CATALYST Handoff Summary

## Purpose

This document is a handoff summary for continuing the IDEA-CATALYST implementation across:

- the functional audit findings in:
  `/workspace/internal/artifacts/functional_audit_v2.md.resolved`
- the blueprint in:
  `/workspace/openclaw-research/docs/superpowers/plans/IDEA_CATALYST_MultiAgent_Blueprint.md`
- the implementation plan in:
  `/workspace/openclaw-research/docs/superpowers/plans/2026-04-03-idea-catalyst-kg-subpipeline.md`
- the companion design spec in:
  `/workspace/openclaw-research/docs/superpowers/specs/2026-04-03-idea-catalyst-kg-subpipeline-design.zh-CN.md`

The current direction is:

1. strengthen the PaperNexus KG/schema first
2. then connect IDEA-CATALYST into the `IDEA` stage as a formal sub-pipeline
3. avoid pushing new logic into `workflow-guard.ts` unless a thin facade change is unavoidable

---

## What Has Been Implemented

### 1. PaperNexus KG groundwork is partially in place

The following capabilities were implemented on the PaperNexus side to support catalyst-style ideation:

- domain/field metadata support in semantic extraction
- mechanism-oriented semantic metadata persistence
- initial schema helpers for:
  - domain taxonomy
  - abstract mechanisms
  - domain bridges

This means the system is no longer limited to pure prompt-only cross-domain guessing. It now has a graph-side foundation for:

- `fieldOfStudy`
- `fieldCandidates`
- `domainTags`
- `abstractMechanisms`

However, this is still an early foundation, not the full Phase δ graph design from the blueprint.

### 2. IDEA-CATALYST runtime contract exists in `openclaw-research`

The project manifest now has an `idea_catalyst` contract. The workflow can:

- materialize an IDEA-CATALYST state
- persist catalyst packet paths
- expose catalyst status through workflow tools
- show catalyst status in `/workflow-status`

Current catalyst state includes:

- `status`
- `mode`
- `micro_stage`
- packet paths
- target domain
- source domain list
- bridge count
- top fragment id
- requisition flags

### 3. IDEA-CATALYST logic was split into dedicated modules

Instead of adding more logic to `workflow-guard.ts`, the catalyst code now lives under:

- `tools/idea-catalyst/decomposer.ts`
- `tools/idea-catalyst/translator.ts`
- `tools/idea-catalyst/scout-adapter.ts`
- `tools/idea-catalyst/gatekeeper.ts`
- `tools/idea-catalyst/integrator.ts`
- `tools/idea-catalyst/judge.ts`
- `tools/idea-catalyst/materializers.ts`
- `tools/idea-catalyst/workflow-bridge.ts`
- `tools/idea-catalyst/state.ts`
- `tools/idea-catalyst/ranking.ts`

This is important: the implementation has already started following the desired modular structure.

### 4. IDEA stage integration is partially wired

The workflow currently supports:

- catalyst preflight materialization before downstream stages
- catalyst-aware idea-stage missing-signal checks
- catalyst micro-stage derivation for auto-iterator visibility
- catalyst status display in `/workflow-status`

The IDEA stage documentation was also updated so IDEA-CATALYST is now described as a formal sub-pipeline, not just an implicit script.

### 5. Skill bundle scaffolding is now present

The following new skills were added:

- `idea-catalyst-decompose`
- `idea-catalyst-translate`
- `idea-catalyst-scout`
- `idea-catalyst-gatekeeper`
- `idea-catalyst-integrator`
- `idea-catalyst-judge`

These are registered in `skills/index.json` and referenced in workflow/agent docs.

### 6. Tests currently passing for the implemented slice

The following checks were green when this handoff was prepared:

- targeted IDEA-CATALYST runtime tool tests
- workflow command/status tests
- auto-iterator tests including catalyst micro-stage visibility
- broader workflow runtime/service/guard tests
- TypeScript build

In other words, the current catalyst implementation is not just documentation; it has working runtime and test coverage.

---

## What Is Still Not Done

### 1. The blueprint’s full six-agent control loop is only partially realized

The current implementation has packet materialization and modular logic, but it still does **not** fully realize the blueprint’s metacognitive control loop.

Still missing or incomplete:

- rigorous per-question coverage assessment in Decomposer
- richer mechanism-quality evaluation in Translator
- structure-first domain selection beyond lightweight bridge heuristics in Scout
- strong data sufficiency policy and investigation requisition loop in Gatekeeper
- richer idea fragment structure and synthesis constraints in Integrator
- true pairwise multi-call judging behavior in Judge

Today, the system is much better structured than before, but it is still a pragmatic workflow implementation, not yet a faithful full reproduction of the paper’s cognitive design.

### 2. PaperNexus KG is not yet deep enough for the full blueprint

Not yet complete:

- no finalized domain taxonomy decision
- no stable domain distance matrix contract exposed to the workflow
- no fully realized `AbstractMechanism` traversal layer integrated end-to-end
- no vector-index-backed cross-domain semantic bridge retrieval
- no structural analogy detection

This means Scout is still graph-first but not yet truly “bridge-native” in the strongest blueprint sense.

### 3. Investigation requisition feedback loop is documented but not fully workflow-owned

The blueprint expects:

`Gatekeeper -> Investigation Requisition -> Ingestion -> Graph Build -> Frontier Refresh -> IDEA rerun`

The current code does not yet fully turn this into a first-class workflow loop with durable orchestration and automatic re-entry.

### 4. The old `pn_idea_catalyst.py` path is not yet resolved

This is still open:

- keep it and bridge to the new workflow-owned implementation
- refactor it in place
- or leave it as a legacy script and move fully to the new modular path

No final decision has been applied.

### 5. Unresolved design decisions remain open

Still open:

- **Domain taxonomy**
  - use Semantic Scholar’s 19 top-level fields
  - or use a finer-grained taxonomy
- **`pn_idea_catalyst.py` migration path**
  - refactor in place
  - or keep the new bundle alongside it

The phase-ordering decision has effectively been made already:

- PaperNexus KG/schema first
- workflow integration second

### 6. The functional audit is only partially addressed

Some audit items are already fixed or partially mitigated in recent workflow work, but the following still need explicit attention in the IDEA-CATALYST continuation:

- complete graph/KG-driven ideation instead of lightweight heuristic bridging
- durable requisition/recovery loop
- remaining end-to-end autonomy gaps
- stricter separation between workflow contracts and agent-generated prose

Also note that the audit mentioned several general workflow issues outside IDEA-CATALYST itself. Those should be checked against the current code state before treating them as still-open bugs.

---

## Recommended Next Steps

### Priority 1: Finish the PaperNexus-side bridge contract

Before more workflow sophistication is added, finish the graph-side contract that Scout and Gatekeeper depend on:

1. finalize domain tagging contract
2. implement or expose a stable domain-distance helper
3. stabilize mechanism bridge queries
4. define what the workflow may assume is available from PaperNexus

### Priority 2: Upgrade Scout and Gatekeeper from heuristic to contract-driven

The next biggest value gain is here:

- Scout should prefer graph-native bridge evidence, not just reused transfer strings
- Gatekeeper should make a durable, defensible sufficiency decision
- requisition output should be structured enough to feed workflow-owned ingestion

### Priority 3: Wire requisition -> ingestion -> graph refresh loop

This is one of the most important unfinished pieces.

The workflow should be able to:

1. detect requisition emission
2. queue required paper/domain acquisition
3. route it through ingestion / graph refresh
4. re-enter IDEA-CATALYST without manual state surgery

### Priority 4: Decide how to handle `pn_idea_catalyst.py`

This should happen before the implementation becomes duplicated across two systems.

### Priority 5: Strengthen Judge behavior

The current ranking helper is useful, but not yet the blueprint’s strongest form.

Eventually Judge should support:

- explicit pairwise comparison records
- independent evaluator separation
- clearer interdisciplinary potential criteria

---

## Suggested Working Rule For The Next Implementer

When continuing this work:

- prefer adding code under `tools/idea-catalyst/`
- prefer small workflow glue in runtime/tool layers
- do not dump new catalyst logic into `workflow-guard.ts`
- treat the blueprint as the architecture target
- treat the functional audit as the “what still breaks autonomy” checklist
- treat the current plan file as the immediate execution plan

---

## Current State In One Sentence

The project now has a real, modular, workflow-visible IDEA-CATALYST foundation, but it has **not yet completed the full KG-native cross-domain reasoning loop** that the blueprint calls for.
