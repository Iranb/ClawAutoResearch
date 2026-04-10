---
name: search-experiment
description: "Run a bounded git-native experiment search loop from an approved search envelope. Only promoted metric wins enter the incumbent branch; all other candidates are rolled back."
argument-hint: "[track id, experiment id, or empty to infer from the active reviewed-auto packet]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - Bash
  - research_workflow
---

# Search Experiment

Use this skill when Coder is assigned an approved experiment search envelope rather than a one-shot launch.

## Goal

Operate inside one bounded `search_session`:

- read the approved `EXPERIMENT_SEARCH_SPEC.json`
- use the current incumbent as the only branchable base
- request one reviewed candidate branch/worktree per trial
- run dry-run + bounded execution
- compare against the approved primary metric contract
- promote only reviewed primary-metric wins into the incumbent branch
- record every keep/discard decision in durable state

## Read First

- `{PROJ}/PROJECT_MANIFEST.json`
- `{PROJ}/TRACK_REGISTRY.json`
- `{PROJ}/planner/EXPERIMENT_REVIEW_PACKET.json`
- `{PROJ}/planner/EXPERIMENT_SEARCH_SPEC.json`
- `{PROJ}/coder/EXPERIMENT_INDEX.md`
- bundle-local `EXPERIMENT_MANIFEST.json`
- bundle-local `SEARCH_STATE.json`
- `research_workflow.get_experiment_memory`

## Git Ratchet Rules

- `experiment/<track-id>/incumbent` is the only retained branch for accepted experiment changes.
- `experiment/<track-id>/candidate/<experiment-id>` is disposable.
- Start every trial from the current incumbent commit.
- Candidate worktree creation must go through `research_workflow.request_experiment_git_op` and `research_workflow.apply_experiment_git_op` after planner + analyzer + cross-reviewer approval.
- Only merge the candidate into incumbent when the approved `promotion_rule` says the primary metric win is real.
- Promote or discard through workflow-owned git actions; do not run `git worktree add/remove`, branch promotion, or branch deletion directly from Coder.
- Gap reduction, smoother curves, nicer runtime behavior, or more optimistic intermediate checkpoints are not enough to keep a commit unless the packet explicitly makes them primary.

## Runtime Rules

- Stay inside the approved search envelope.
- Keep one variable per candidate.
- Preserve baseline fairness and evaluation semantics.
- Use graph-backed experiment memory as guidance, not as permission to widen the search.
- Poll `research_workflow.get_experiment_git_review` before assuming a candidate worktree, promotion, or discard is executable.
- Let workflow own ledger writeback and graph-memory packet sync after promote/discard; do not hand-edit those records from Coder.
- If the next candidate would require a new scientific question, new dataset, new metric, or major semantic drift, stop and hand the decision back to Researcher.

## Required Durable Outputs

- bundle-local `SEARCH_STATE.json`
- updated bundle `EXPERIMENT_MANIFEST.json`
- updated `coder/EXPERIMENT_INDEX.md`
- `research_workflow.upsert_experiment` entries for run/eval outcomes when the bundle has new execution evidence
- workflow-owned reviewed git decisions via `request_experiment_git_op` / `apply_experiment_git_op`

## Completion

Return a short summary with:

- incumbent branch + commit
- promoted candidates
- discarded candidates
- why the last decision was keep or rollback
- whether Researcher should continue search, sync graph memory, or stop
