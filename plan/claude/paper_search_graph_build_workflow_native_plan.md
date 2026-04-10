# Workflow-Native Plan: Paper Search & Graph Build Hardening

> This plan replaces the “build a second discovery control plane” direction with a workflow-native upgrade that strengthens the existing `research-lit -> queue_paper_ingestion -> graph-build` path.

## Why This Version

The repo already has:

- multi-query retrieval through `papers-cool` plus optional PASA
- Markdown/PDF waterfall acquisition
- workflow-owned queued PaperNexus ingestion
- graph presence checking
- graph-build / brainstorm refresh

The highest-ROI work is therefore not a new orchestrator. It is making the existing path harder to poison, easier to diagnose, and less likely to loop.

## Scope We Will Actually Build

### 1. Code-enforced staged paper validation

Goal:

- stop invalid Markdown/PDF payloads before wrapper launch
- persist validation reports durably so auto mode and humans see the same truth

Implementation:

- validate batch manifests and direct `--source` uploads
- detect missing files, HTML/login/error stubs, tiny/truncated Markdown, and fake PDFs
- persist per-request reports under `graph/paper-ingestion-validation/`
- expose `research_workflow.validate_paper_ingestion`

### 2. Resilient queued ingestion with bounded retry + dead-letter

Goal:

- keep the current queued ingestion path
- stop infinite repair/relaunch loops

Implementation:

- add `validation_status`, `attempt_count`, `max_attempts`, `next_retry_at`, and `dead_letter_*` to queued requests
- retry only on bounded intervals
- dead-letter exhausted requests instead of requeueing forever
- keep `needs_repair` as a repair state, not a hidden active launch

### 3. Safer canonical matching in graph presence

Goal:

- reduce false missing-paper signals caused by light title variants

Implementation:

- keep arXiv / DOI exact matching first
- add lightweight title-signature matching for pluralization and punctuation noise
- avoid broad fuzzy matching that could merge unrelated papers

### 4. Non-blocking coverage diagnostics

Goal:

- audit literature quality without turning niche topics into blocker loops

Implementation:

- add `research_workflow.audit_literature_coverage`
- write `researcher/LITERATURE_COVERAGE_AUDIT.json` and `.md`
- report baseline-hint coverage, recent-paper coverage, metadata gaps, and provider diversity
- keep output advisory, not stage-blocking

### 5. Bounded citation expansion planning

Goal:

- support deeper literature growth without a large always-on discovery engine

Implementation:

- add `research_workflow.plan_citation_expansion`
- select a small bounded seed set from in-corpus papers
- generate forward/backward citation expansion prompts and one keyword refresh round
- persist `researcher/CITATION_EXPANSION_PACKET.json` and `.md`

## Explicit Non-Goals

We are not building in this phase:

- a second autonomous discovery state machine
- mandatory Semantic Scholar orchestration
- mandatory venue sweep loops
- multi-hop uncontrolled citation crawling
- new stage blockers based on coverage thresholds

## Delivery Order

1. Extend queued ingestion state and validation reports.
2. Enforce validation before wrapper launch and bound retries.
3. Strengthen graph presence identity matching.
4. Add coverage audit and citation expansion planning tools.
5. Update skills/tests/docs around the new workflow-native path.

## Success Criteria

- invalid staged content is caught in code, not only by prompt instructions
- wrapper retries stop after a bounded budget and enter dead-letter state
- common title variants no longer trigger unnecessary missing-paper loops
- Researcher and Survey flows can request advisory coverage audits and bounded citation expansion without blocking the main pipeline
