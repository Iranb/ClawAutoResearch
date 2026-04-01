# PaperNexus Batch Graph Sync Design

**Date:** 2026-04-01

## Goal

Make workflow-owned PaperNexus graph synchronization compatible with the updated Python wrapper skills by treating manifest-driven batch import as the default path for 2 or more staged papers, while keeping durable workflow state and channel-visible progress stable.

## Problems

- `openclaw-research` only recognizes single-paper wrappers and cannot launch `pn_batch_import.py`.
- Background continuation guidance still pushes agents toward one-paper serial imports and long queue waits.
- `paper_ingestion` only models single-paper imports and graph operations, so batch progress is hard to reflect in `/workflow-status`.
- `graph-build` guidance mixes "shared-graph reconcile" with long-running import waits, which makes graph sync feel hung.

## Design

### 1. Wrapper Runtime Support

- Extend `research_workflow.run_papernexus_wrapper` and runtime wrapper detection to support `pn_batch_import.py`.
- Treat `pn_batch_import.py template|submit|status|wait` as first-class workflow-owned PaperNexus work.
- Keep raw HTTP and local live-graph CLI blocked.

### 2. Durable Batch State

Extend `PROJECT_MANIFEST.json.paper_ingestion` with batch-compatible fields:

- `active_batches`
- `batch_items`
- `last_batch_manifest_path`

`set_paper_ingestion` remains the authoritative sink and now merges both single-paper and batch-driven progress.

### 3. Workflow Contract

- For 1 paper: `pn_import_submit.py` remains acceptable.
- For 2+ papers: default to one manifest plus `pn_batch_import.py`.
- Batch waits must stay bounded per workflow pass; the workflow should prefer repeated short `status` / short `wait` checks over one giant blocking wait.
- `/graph-build` becomes:
  - batch import / queue tracking
  - short reconciliation / presence verification

### 4. User-Visible Status

- `/workflow-status` must surface batch progress, not just single-paper task counts.
- Remote graph refresh reasoning should treat active batches as in-flight work rather than immediately declaring the graph permanently missing.
- Batch terminal states should be eligible for the same durable/broadcast flow as per-paper updates.

### 5. Agent Guidance

Update Researcher workflow skills and agent docs so they all teach the same policy:

- wrapper-first
- `pn_batch_import.py` for multi-paper sync
- project-local staging only
- durable status through `research_workflow.set_paper_ingestion`
- graph sync is a bounded coordination loop, not an indefinite wait
