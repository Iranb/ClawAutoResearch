# PaperNexus Progress Visibility Plan

## Goal

Make workflow-owned PaperNexus import and graph-verification work observable enough that agents can answer:

- what is running now
- how far the batch import has progressed
- whether the workflow is waiting on upload, graph verification, or repair
- when a stale background session is only a bookkeeping issue instead of a real running task

## Current Gaps

- Background session state can outlive the real import work and keep reporting `active`.
- `waiting_graph` is semantically different from `waiting_import`, but some logic still treats both as "sync still running".
- Agents can see aggregate batch counts, but they cannot reliably read a single progress summary artifact that explains phase, completion ratio, ETA heuristic, and next action.
- Graph verification progress is reported as a final status, not as a stepwise pipeline.

## Proposed State Model

Create one workflow-owned progress snapshot:

- `{PROJ}/graph/PAPERNEXUS_PROGRESS.json`

Recommended top-level fields:

- `updated_at`
- `phase`
  - `staging`
  - `submitting`
  - `uploading`
  - `waiting_import`
  - `verifying_graph`
  - `ready`
  - `failed`
  - `needs_repair`
- `owner_run`
  - `run_id`
  - `session_key`
  - `queue_key`
  - `wrapper`
- `batch`
  - `manifest_path`
  - `total_items`
  - `pending_items`
  - `running_items`
  - `synced_items`
  - `failed_items`
- `graph_check`
  - `expected_papers`
  - `present_papers`
  - `missing_papers`
  - `last_checked_at`
  - `status`
- `progress`
  - `completed_ratio`
  - `percent`
  - `eta_hint`
- `next_action`
- `blocking_reason`

## Update Rules

1. `queue_paper_ingestion` initializes `PAPERNEXUS_PROGRESS.json` with `phase=staging`.
2. `run_papernexus_wrapper` updates `owner_run` and transitions into `submitting` or `uploading`.
3. Every `set_paper_ingestion` call re-derives batch counters and rewrites the progress snapshot.
4. Background-session reconciliation updates the snapshot when a run is inferred to be finished, failed, or stale.
5. `check_graph_presence` transitions progress into `verifying_graph` and then `ready` or `needs_repair`.
6. `auto_iterator_tick` and workflow snapshot assembly should read this file first for agent-facing progress narration.

## Agent UX

Expose one short status line in workflow prompt assembly:

- `PaperNexus progress: phase=verifying_graph, progress=3/4 synced, graph=3/4 present, next=rerun graph check`

Expose one bounded tool action:

- `research_workflow.get_papernexus_progress`

The tool should return both raw JSON and a compact human summary so agents do not improvise status reports from partial files.

## Repair Strategy

When runtime session state and durable progress disagree:

- trust queued requests and `PAPERNEXUS_PROGRESS.json` first
- trust batch/item counters second
- trust background session registry last

If durable state says no import work is in flight but a session is still `active`, auto-mark the session idle and set progress to `verifying_graph` or `ready`.

## Rollout Order

1. Add `PAPERNEXUS_PROGRESS.json` writer helpers.
2. Wire updates from `set_paper_ingestion`, background reconciliation, and graph presence checks.
3. Add `research_workflow.get_papernexus_progress`.
4. Switch prompt/status formatting to use the new progress snapshot.
5. Add stale-session regression tests and multi-paper ETA/progress tests.
