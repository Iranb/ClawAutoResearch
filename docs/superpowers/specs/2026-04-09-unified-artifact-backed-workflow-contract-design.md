# Unified Artifact-Backed Workflow Contract Design

**Date:** 2026-04-09

## Goal

Unify workflow state evaluation around artifact-backed, workflow-owned files so stage readiness, auto-mode routing, and agent handoff all consume the same derived facts instead of re-implementing partial checks against different JSON surfaces.

## Problem Summary

The current workflow has three conflicting sources of truth:

1. Materializers and some packet builders read workflow-owned artifacts such as per-track `GRAPH_EVIDENCE.json`.
2. Stage guards often check only inline manifest or track fields.
3. Auto-iterator and handoff logic can still produce `drive_stage` actions even when stage signals remain missing.

This creates contradictory behavior:

- files contain valid evidence but guards still report it as missing
- one agent reports a workflow bug and declines handoff
- another agent sees a `drive_stage` action and tries to dispatch work anyway

## Design Principles

- Artifact-backed workflow state is the primary truth for workflow-owned deliverables.
- Inline JSON fields remain useful as cached summaries, not as the only readiness source.
- Stage readiness and handoff eligibility must share one contract.
- Repairable gaps should produce repair actions, not false-positive stage handoffs.
- Story-support evidence should help the paper narrative close the loop without becoming a hard coder-alignment requirement.

## Proposed Architecture

Add a new derived-state layer under `tools/workflow-derived-state/`:

- `track-evidence.ts`
  Resolves track graph evidence from inline fields plus workflow-owned artifacts such as `<reasoning_packet_dir>/GRAPH_EVIDENCE.json`, with explicit alias handling and diagnostics.
- `stage-readiness.ts`
  Computes stage readiness from normalized derived facts and returns structured blocking, repairable, and background opportunities.
- `handoff-eligibility.ts`
  Decides whether a workflow may hand off stage work, should queue a repair action, or should only advertise background opportunities.
- `diagnostics.ts`
  Builds compact, user-facing diagnostic summaries for snapshots, prompts, and status updates.

## Core Derived Facts

Track evidence should no longer collapse to a bare boolean. The resolver should return structured facts, for example:

- `presence`: `missing | inline_only | file_backed | mixed | invalid`
- `hasGraphBackedInnovationEvidence`
- `hasStoryFacingTrackGraphSupport`
- `graphEvidencePath`
- `importedFromGraphEvidence`
- `evidencePointers`
- `linkedGraphNodes`
- `relationPatterns`
- `diagnostics`
- `repairable`

Stage readiness should similarly be structured:

- `readyForOwnerWork`
- `blockingSignals`
- `repairableSignals`
- `backgroundOpportunities`
- `hardBlock`
- `suggestedOwner`
- `handoffMode`

## Behavioral Changes

### 1. Stage Guards

Idea, plan, and other file-backed stages should evaluate readiness through the derived-state layer instead of manually checking inline fields.

### 2. Auto Iterator

`recommendedActions` should only include a dispatchable `drive_stage` action when the stage is ready for owner work. If readiness gaps remain but are repairable, emit repair or background actions instead.

### 3. Agent Handoff

Tool-side dispatch and service-side auto dispatch must both consult the same handoff eligibility result. This prevents premature cross-agent routing when the workflow still lacks required artifacts.

### 4. Diagnostics

Snapshots, prompt assembly, and visible workflow status should explain whether a gap is:

- truly missing
- present only in artifacts and not yet materialized
- invalid because fields were unrecognized
- repairable by a workflow-owned materializer

## Non-Goals

- Do not make coder implementation depend on strong paper-story alignment.
- Do not add new hard execution gates for low-level code design choices.
- Do not make Zotero or other optional integrations mandatory for readiness.
- Do not introduce a heavyweight persistent cache in this iteration.

## Expected Outcome

After this change, workflow-owned files and workflow dispatch semantics should agree:

- if evidence exists in canonical artifact locations, guards can recognize it
- if evidence is repairable but not yet canonicalized, the workflow queues repair work instead of a false stage handoff
- if a stage is not actually ready, no agent will be told to "continue the next stage" prematurely
- diagnostics explain why the workflow is blocked and what type of action can unblock it
