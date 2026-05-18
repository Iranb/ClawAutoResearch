---
name: current-workflow-contract
description: "Shared current-state contract for OpenClaw workflow agents. Use when agent or skill guidance must align with canonical workflow_control, PaperNexus discovery/graph/idea artifacts, Karpathy-led experiment gating, and PaperGuru writing/review boundaries."
allowed-tools:
  - Read
---

# Current Workflow Contract

Use this compact contract before following older role-local workflow instructions.

## Canonical Control

- The canonical stage, owner, next action, blocker, completion status, and runtime state live in `{PROJ}/PROJECT_MANIFEST.json.workflow_control`.
- `current_stage`, `owner_agent`, `next_action`, and `blocking_reason` at the manifest top level are mirrors of the reconciled contract, not independent authorities.
- Stage advancement must go through workflow tools such as `research_workflow.auto_iterator_tick`, lane materializers/setters, and `research_workflow.prepare_stage_handoff`; agents should not hand-edit owner or stage fields.
- Runtime queue/session files answer whether work is active, queued, degraded, stale, or terminal. They do not decide semantic stage completion.
- Derived artifacts such as `paper_ingestion`, `survey_review`, `experiment_search`, `research_program`, and `paper_story_state` are evidence/projections consumed by the resolver unless a specific tool documents them as the canonical completion source.

## Current Main Chain

The expected research chain is:

```text
remote discovery
-> REQUISITION_SATISFACTION_REPORT
-> GRAPH_BUILD_DECISION
-> IDEA_CATALYST_CONTRACT
-> INNOVATION_PACKET
-> experiment dispatch
-> EXPERIMENT_SEARCH.json + experiment ledger + result summaries
-> Karpathy analysis gate
-> analysis
-> writing
-> review / submit
```

`GRAPH_BUILD_DECISION` should include a machine-readable backlink to the satisfaction report. `IDEA_CATALYST_CONTRACT` and `INNOVATION_PACKET` should cite their upstream discovery/graph decision inputs instead of relying on prose memory.

## Experiment Gate

Experiment completion is Karpathy-led: an idea should move toward analysis only after an actual experiment improves the approved primary metric.

- Call `research_workflow.evaluate_experiment_search_decision` after runtime, ledger, and result summaries are synchronized.
- `execution_reviewer` is the primary vote. It requires a retained trial decision (`keep`, `advance`, or `promote`) and a positive primary metric delta against the approved baseline.
- Metric direction must be explicit when possible. Lower-is-better metrics such as EER, error, loss, latency, or NLL count as improvement only when the candidate is lower than baseline.
- `novelty_reviewer` and `paper_readiness_reviewer` are auxiliary. `ready_for_analysis` requires execution approval and at least 2 of 3 reviewers approving.
- No retained metric gain means `continue_search` or `continue_tuning`, usually routed to Coder. Broken runtime, missing baseline, missing execution proof, or stale result sync is a repair/reconcile blocker, not normal scientific search.
- PaperGuru/PaperNexus writing prompts help writing, review, and submit quality. They do not replace the experiment improvement gate.

## Handoff Rule

When a stage packet is durable, run the relevant materializer/setter, call `auto_iterator_tick`, and only then use `prepare_stage_handoff` for cross-owner delivery. If the tick reports a blocker or same-owner repair, report the blocker and keep ownership unchanged.
