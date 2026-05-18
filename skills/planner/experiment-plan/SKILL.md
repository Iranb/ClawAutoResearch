---
name: experiment-plan
description: "Assemble the reviewed-auto experiment launch packet: claims, baselines, falsifiers, stop rules, compute budget, and graph-grounded experiment norms."
argument-hint: "[track id or experiment packet context]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - research_workflow
---

# Experiment Plan

Build or revise the workflow-owned pre-launch packet for a reviewed-auto experiment round.

> **Write scope**: planner writes only under `{PROJ}/planner/`. Use workflow tools to mirror review status back into `PROJECT_MANIFEST.json`; do not hand-edit canonical `workflow_control`.

## Goals

- Turn the active track into a bounded launch packet with one clear variable under test.
- Turn the active track into a bounded search envelope when the innovation direction is fixed enough for coder-side local search.
- Make claim coverage explicit before Analyzer or Cross-Reviewer is asked to judge launch-worthiness.
- Use PaperNexus-backed norms when available so the packet reflects real baselines, metrics, controls, and common confounds.

## Read First

- `{PROJ}/PROJECT_MANIFEST.json`
- `{PROJ}/TRACK_REGISTRY.json`
- `{PROJ}/CLAIM_POLICY.md`
- `{PROJ}/researcher/ideation/RESEARCH_PROPOSAL.md`
- `{PROJ}/academic_writer/story/CLAIM_TO_EXPERIMENT_MAP.md`
- `{PROJ}/planner/EXPERIMENT_REVIEW_PACKET.json` if it already exists
- `{PROJ}/researcher/papernexus/EXPERIMENT_MEMORY_PACKET.json` if it exists
- `{PROJ}/researcher/INNOVATION_REFLECTION.md` if it exists
- PaperNexus packets when present:
  - `{PROJ}/researcher/papernexus/MECHANISM_BRIDGE_PACKET.json`
  - `{PROJ}/researcher/papernexus/CHALLENGE_INSIGHT_PACKET.json`
  - `{PROJ}/researcher/papernexus/GRAPH_STORYLINE_PACKET.json`
  - `{PROJ}/researcher/ideation/GRAPH_IDEATION_PACKET.json`

## Required Outputs

- `{PROJ}/planner/EXPERIMENT_REVIEW_PACKET.json`
- `{PROJ}/planner/EXPERIMENT_PLAN.md`

The packet must make these fields concrete:

- target track and claim ids
- one-variable change statement
- baselines and fairness expectations
- datasets / metrics / evaluation slices
- ablations and falsifiers
- stop rules
- compute budget
- expected artifact targets
- graph-grounded norms or contradictions from PaperNexus packets
- search envelope, git retention policy, and explicit non-promotion signals when coder-side search is enabled

## Review Constitution

- **One variable per experiment.** If the packet tests multiple coupled changes, split or downgrade it.
- **Baseline fairness first.** Match the reference training and evaluation protocol unless deviations are spelled out and justified.
- **Falsifiers are mandatory.** At least one negative control, failure mode, or rollback trigger must be explicit.
- **Compute must be bounded.** If the budget is vague, the packet is not ready.
- **Claim coverage is explicit.** Every launch-worthy claim needs a matching experiment or artifact target.
- **Graph-grounded context beats intuition.** Prefer PaperNexus evidence about common baselines, metrics, or confounds over free-form assumptions.
- **Git retention policy must be explicit.** If coder search is enabled, define what enters the incumbent branch and what must remain only as discarded candidate history.
- **Secondary signals do not keep code by default.** Gap reduction, smoother curves, or generic stability should guide diagnosis only unless they are the named primary metric.

## Persistence Rules

After updating the packet/plan, mirror durable state through `research_workflow.set_experiment_review_state`:

- `planner_status: "ready"` when the packet is launch-reviewable
- `packet_path`
- `planner_plan_path`
- `target_track_ids`
- `claim_ids`
- `graph_packet_paths`
- `packet_fingerprint` if available from the packet
- `pending_reason` when the packet is still incomplete

Do not mark the packet ready if baseline fairness, falsifiers, stop rules, or compute budget are still vague.
Do not mark the packet ready if the search envelope is enabled but incumbent/candidate git policy or non-promotion signals are still ambiguous.
