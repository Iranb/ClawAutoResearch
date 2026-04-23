# PaperNexus Graph-Build Contract Stabilization Plan

> Goal: remove the unstable coupling between literature-discovery scaffolds, upload manifests, and graph-build readiness so workflow-owned graph work can reuse PaperNexus graph/index state instead of repeatedly re-indexing or re-importing the same papers.

## Why This Work Exists

Recent `graph_build` failures exposed two control-plane flaws:

1. A literature-discovery scaffold with `papers: []` and a populated `literature_discovery` block was validated as if it were a batch upload manifest, then dead-lettered as `manifest_unreadable_or_empty`.
2. `graph_build` still treats graph readiness as "can I re-find these papers in sources.json right now?" even when `PAPER_SOURCE_INDEX.json` already records graph-backed confirmation (`graph_paper_id`, `graph_presence`, `import_status=deduped`, or an explicit graph presence override).

That combination causes duplicate work:

- discovery requisition -> mistaken upload validation -> repair loop
- graph already contains equivalent indexed content -> workflow still attempts another import/build cycle

The stable fix is not a tiny patch. We need to separate contracts and teach graph-build to trust explicit graph/index evidence when it exists.

## Observed Failure Chain

Project: `https-arxiv-org-abs-2410-11206-shortcut-`

Current evidence:

- `researcher/literature-discovery/requisition/idea-track-graph-evidence-gap/batch-import.json`
  - contains `papers: []`
  - contains a valid `literature_discovery` scaffold
- `graph/paper-ingestion-validation/idea-track-graph-evidence-gap-idea-track-graph-evidence-gap.json`
  - marks the scaffold invalid because `papers` is empty
- `researcher/PAPER_SOURCE_INDEX.json`
  - already records graph-backed facts such as `graph_paper_id`, `graph_presence`, `import_status=deduped`
  - contains `graph_presence_override.status = ready`
- `graph/GRAPH_PRESENCE_CHECK.json`
  - still reports `missing_papers`

Conclusion:

- the validator is conflating discovery requisitions with upload manifests
- graph presence is ignoring explicit project-local graph confirmation metadata

## Design Principles

1. Separate discovery intent from import execution.
2. Prefer durable graph/index evidence over repeated rebuilds.
3. Keep workflow-owned graph work remote-first and queue-driven.
4. Preserve backward compatibility for existing queued requests and manifests.
5. Favor explicit state transitions over heuristic chat-time interpretation.

## Target Architecture

### 1. Two First-Class Contracts

We will distinguish:

- **Discovery requisition**
  - describes what literature still needs to be found
  - may legitimately have `selected_papers = []`
  - is not upload-ready
- **Upload manifest**
  - describes staged paper files that are ready for `pn_batch_import.py` or `pn_import_submit.py`
  - must contain real source entries

Stability rule:

- a discovery requisition must never be dead-lettered by upload validation merely because it has no staged paper files yet

### 2. Graph Readiness Can Be Satisfied By Explicit Index Evidence

`graph_build` should accept graph readiness from any of these sources:

- canonical source match in local/remote corpus sources
- summary-only remote corpus metadata when counts match
- explicit project-local graph confirmation metadata from `PAPER_SOURCE_INDEX.json`

Examples of explicit confirmation metadata:

- `graph_paper_id`
- `graph_presence = confirmed_*`
- `import_status = deduped | completed | indexed | graph_synced`
- `graph_presence_override.status = ready`

This does not mean "trust any local file blindly." It means: if the workflow already persisted graph-backed confirmation from the PaperNexus control plane, do not force another import/build loop just to rediscover the same state.

### 3. Keep Graph-Build Micro-Stages Stable

We will keep the existing durable micro-stages:

- `graph_build/uploading`
- `graph_build/verifying`
- `graph_build/brainstorm_refresh`

Fine-grained distinctions such as "discovery pending", "index metadata synchronized", and "content import pending" belong in `paper_ingestion` and `PAPERNEXUS_PROGRESS.json`, not in new top-level graph-build micro-stages.

## Implementation Scope

### A. Paper-Ingestion Contract Updates

Files:

- `tools/workflow-guard.ts`
- `tools/workflow-guard-state/paper-ingestion.ts`
- `tools/paper-ingestion-validation.ts`
- `tools/literature-discovery/workflow-bridge.ts`

Changes:

- add a queued-request classifier:
  - `upload_manifest`
  - `direct_source`
  - `literature_discovery_requisition`
- persist that classifier on queued requests
- ensure validation logic classifies discovery scaffolds before deciding validity
- prevent discovery requisitions from being converted into `needs_repair` or `failed` upload requests solely because they are not upload-ready yet
- keep backward compatibility for older queued requests without a classifier

### B. Discovery Requisition File Naming

Files:

- `tools/literature-discovery/workflow-bridge.ts`
- tests touching requisition materialization and queueing

Changes:

- stop reusing `batch-import.json` as the durable name for literature-discovery scaffolds
- materialize discovery scaffolds under a requisition-specific name such as `DISCOVERY_REQUISITION.json`
- keep upload manifest generation as a later step once `selected_papers` or staged files exist

Migration rule:

- existing projects with the old filename must still parse correctly
- new writes should use the clearer filename

### C. Graph Presence Overrides

Files:

- `tools/graph-presence.ts`
- related tests in `tests/auto-iterator.test.mjs`
- status/progress summaries that surface graph readiness

Changes:

- extend expected-paper parsing to capture explicit graph confirmation fields
- parse a summary-level `graph_presence_override`
- if every expected paper is explicitly confirmed, or an explicit override says `ready`, treat graph presence as ready
- expose a clear `verification_mode`, for example:
  - `canonical_paper_index`
  - `remote_corpus_summary`
  - `paper_source_index_override`

Guardrails:

- do not override readiness while active upload work is still genuinely in flight
- do not invent ready state when there is neither corpus match nor explicit graph-backed confirmation

### D. Runtime Decision Updates

Files:

- `tools/workflow-guard-runtime/auto-iterator.ts`
- `tools/workflow-guard-state/paper-ingestion.ts`
- `tools/papernexus-progress.ts`
- snapshot/status builders that currently collapse everything into generic graph blockage

Changes:

- exclude discovery requisitions from upload-repair failure counts
- surface discovery requisitions as "pending selection / pending staging", not "broken import"
- preserve current graph-build blocking only when:
  - graph is truly missing
  - import is truly required
  - upload manifest is truly invalid

### E. Guidance Updates

Files:

- `skills/researcher/papernexus/SKILL.md`
- `skills/researcher/graph-build/SKILL.md`
- `skills/researcher/research-lit/SKILL.md`
- `skills/researcher/research-pipeline/SKILL.md`

Changes:

- describe the three-step decision boundary:
  - discovery requisition
  - index-sync / graph-backed confirmation
  - content import
- make it explicit that graph-build should short-circuit when graph/index confirmation is already durable
- forbid treating discovery scaffolds as import manifests

## Failure Tolerance Requirements

The implementation must tolerate:

- old queued requests with no new classifier fields
- old literature-discovery scaffolds still named `batch-import.json`
- mixed projects where some papers have graph-backed confirmation and some do not
- remote graph summaries that are healthy even when no explicit local paper list exists
- stale failed upload requests that should no longer block because graph readiness is already satisfied

## Test Coverage Plan

### Validator / Queue Tests

- discovery scaffold with `papers: []` and `literature_discovery` block is classified as requisition, not invalid upload
- upload manifest with empty `papers` and no discovery block still fails validation
- `queue_literature_discovery_requisition` persists the requisition classifier
- `derivePaperIngestionWorkflowDecision` ignores discovery requisitions when computing upload repair state

### Graph Presence Tests

- graph presence accepts per-paper `graph_paper_id`
- graph presence accepts `graph_presence = confirmed_*`
- graph presence accepts `import_status = deduped` when paired with graph confirmation
- graph presence accepts `graph_presence_override.status = ready`
- graph presence does not claim ready from a weak override while active upload work is still in flight

### Auto Iterator / Snapshot Tests

- graph-build no longer blocks on discovery scaffolds as failed uploads
- graph-build advances when project-local graph confirmation metadata proves readiness
- status/progress text distinguishes discovery-pending from import-failed

## Migration Strategy

1. Add parsers/serializers first.
2. Make validation classification backward compatible.
3. Add graph presence override support.
4. Update runtime decision logic.
5. Update docs and tests.

This order minimizes the risk of writing a new state shape that older code cannot read.

## Implementation Checklist

- [x] Add failing tests for requisition-vs-upload classification.
- [x] Add failing tests for graph presence override / explicit graph confirmation.
- [x] Add queued-request classifier fields and normalization/serialization support.
- [x] Stop marking discovery scaffolds as invalid upload manifests.
- [x] Rename new requisition writes away from `batch-import.json` while preserving old-path compatibility.
- [x] Teach graph presence to trust explicit graph/index confirmation metadata.
- [x] Update workflow runtime decision logic and status summaries.
- [x] Update PaperNexus / graph-build skill docs.
- [x] Run targeted tests.
- [x] Run broader workflow tests.

## Completion Note

Implemented on 2026-04-23.

Delivered changes:

- queued paper-ingestion requests now distinguish requisitions from executable upload manifests
- literature-discovery and IDEA-CATALYST requisitions are written under explicit requisition filenames instead of new `batch-import.json` scaffolds
- upload validation no longer dead-letters requisition scaffolds solely because they contain no staged paper sources yet
- graph presence now accepts durable `PAPER_SOURCE_INDEX.json` graph confirmation metadata (`graph_paper_id`, `graph_presence=confirmed_*`, `import_status=deduped|completed|indexed|graph_synced`, and fresh `graph_presence_override.status=ready`)
- graph-build / PaperNexus runtime logic now keeps active requisitions on `graph_build/uploading`, while dormant queued requisitions are ignored once graph presence is already ready

Verification:

- targeted Node tests for validator, runtime tools, fast paths, and auto iterator passed
- full `npm test` passed (`822` tests)

Known local limitation:

- `npm run build` in this workspace is still blocked by unrelated pre-existing local files (`tools/register-workflow-tools 2.ts` and similar duplicate `* 2.ts` artifacts, plus a separate existing dirty change in `tools/agent-task-dispatch.ts`). Those files are outside this implementation scope.
