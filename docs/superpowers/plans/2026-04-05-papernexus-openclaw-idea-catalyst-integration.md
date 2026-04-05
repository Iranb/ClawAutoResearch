# PaperNexus to openclaw-research IDEA-CATALYST Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to complete this plan end-to-end. Keep new business logic out of `workflow-guard.ts` unless a thin facade or compatibility shim is unavoidable.

**Goal:** Integrate the newly upgraded PaperNexus IDEA-CATALYST packet outputs into `openclaw-research` so that the workflow consumes graph-native challenge, mechanism, storyline, and discovery artifacts directly instead of re-deriving them through local heuristics.

**Scope:** `openclaw-research` only. PaperNexus is treated as the upstream provider of packetized graph intelligence.

**Architecture:** Add a focused `tools/papernexus-packets/` adapter layer that:

- reads PaperNexus packet outputs from stable project-local paths
- synchronizes them into existing workflow contracts
- writes only minimal writer-facing derived artifacts
- drives existing requisition / rerun orchestration through `paper_ingestion.queued_requests`

This must reuse existing contracts:

- `ideation_contract`
- `idea_catalyst`
- `paper_story_state`
- `review_pressure_packet`
- `writing_contract`
- `graph_guided_writing`
- `paper_ingestion`

and must not introduce a parallel workflow state system.

## Current Context

PaperNexus now provides or is expected to provide packetized outputs aligned with the IDEA-CATALYST blueprint:

- `MECHANISM_BRIDGE_PACKET`
- `CHALLENGE_INSIGHT_PACKET`
- `GRAPH_STORYLINE_PACKET`
- `LITERATURE_DISCOVERY_PACKET`

`openclaw-research` already has mature downstream contracts and orchestration:

- `tools/idea-catalyst/` modules for decomposition, translation, scouting, integration, judging, and requisition routing
- `paper_story_state`, `review_pressure_packet`, `writing_contract`, and `graph_guided_writing`
- workflow-owned `paper_ingestion.queued_requests`
- stage-preflight orchestration for `idea`, `review`, `write`, and `submit`

The missing layer is a **thin adapter** that makes PaperNexus packets the upstream facts for these contracts.

## File Structure

### New modules

- Create: `tools/papernexus-packets/materializer.ts`
- Create: `tools/papernexus-packets/materializer`

### Existing modules to modify

- Modify: `tools/register-workflow-tools.ts`
- Modify: `tools/workflow-guard-runtime/stage-preflight.ts`
- Modify: `tools/idea-catalyst/materializers.ts`
- Modify: `tools/workflow-guard-materializers/paper-story-materializer.ts`
- Modify: `tools/workflow-guard-materializers/review-pressure-materializer.ts`
- Modify: `tools/workflow-commands/formatters.ts`

### Tests

- Create: `tests/papernexus-packet-integration.test.mjs`
- Modify: `tests/workflow-runtime-tools.test.mjs`
- Modify: `tests/idea-catalyst-runtime-tools.test.mjs`
- Modify: `tests/auto-iterator.test.mjs`

## Packet Contracts

The adapter should look for these default project-local source files:

- `researcher/papernexus/MECHANISM_BRIDGE_PACKET.json`
- `researcher/papernexus/CHALLENGE_INSIGHT_PACKET.json`
- `researcher/papernexus/GRAPH_STORYLINE_PACKET.json`
- `researcher/literature-discovery/LITERATURE_DISCOVERY_PACKET.json`

The adapter should also write a writer-facing derived artifact:

- `academic_writer/KG_STORYLINE_PACKET.md`

## Task 1: Add failing tests for packet consumption and rerun orchestration

**Files:**
- Create: `tests/papernexus-packet-integration.test.mjs`
- Modify: `tests/workflow-runtime-tools.test.mjs`
- Modify: `tests/idea-catalyst-runtime-tools.test.mjs`
- Modify: `tests/auto-iterator.test.mjs`

- [x] Add a RED test for `materialize_papernexus_packet_contracts`
  Cover:
  - `MECHANISM_BRIDGE_PACKET` syncs source domains, bridge evidence tier, and transfer bridges into `ideation_contract.graph_ideation_indices`
  - `CHALLENGE_INSIGHT_PACKET` syncs challenge and insight clusters
  - `GRAPH_STORYLINE_PACKET` enables `writing_contract.kg_storyline_required`, marks `kg_storyline_status=ready`, writes `academic_writer/KG_STORYLINE_PACKET.md`, and updates `graph_guided_writing`

- [x] Add a RED test for stage-preflight orchestration
  Cover:
  - stage preflight materializes PaperNexus packet contracts before downstream paper-story/review materialization
  - a ready `LITERATURE_DISCOVERY_PACKET` queues a workflow-owned requisition without requiring a local heuristic packet rewrite

- [x] Add a RED test showing `materialize_idea_catalyst_state` consumes upstream PaperNexus packet enrichment
  Cover:
  - source-domain pruning / domain distance / mechanism bridges from upstream packets influence the scouting report

## Task 2: Implement a modular PaperNexus packet adapter

**Files:**
- Create: `tools/papernexus-packets/materializer.ts`
- Create: `tools/papernexus-packets/materializer`

- [x] Implement packet normalization and source-path defaults

- [x] Implement `materializePapernexusPacketContracts(...)`
  It must:
  - read the four packet types if present
  - merge `MECHANISM_BRIDGE_PACKET` + `CHALLENGE_INSIGHT_PACKET` into:
    - `ideation_contract.graph_ideation_indices`
    - `idea_catalyst.targetDomain`
    - `idea_catalyst.sourceDomains`
    - `idea_catalyst.bridgeCount`
  - derive `academic_writer/KG_STORYLINE_PACKET.md` from `GRAPH_STORYLINE_PACKET`
  - set:
    - `writing_contract.kg_storyline_required = true`
    - `writing_contract.kg_storyline_status = ready`
    - `writing_contract.kg_storyline_packet_path = academic_writer/KG_STORYLINE_PACKET.md`
  - update `graph_guided_writing` evidence coverage and missing-claim metadata from the storyline packet

- [x] Keep this adapter thin
  Rules:
  - prefer packet values over local heuristics
  - never replicate PaperNexus domain/mechanism algorithms here
  - only derive lightweight writer-facing markdown from packet facts

## Task 3: Wire the adapter into workflow tools and stage preflight

**Files:**
- Modify: `tools/register-workflow-tools.ts`
- Modify: `tools/workflow-guard-runtime/stage-preflight.ts`

- [x] Add a workflow tool action:
  - `materialize_papernexus_packet_contracts`

- [x] Wire stage preflight to run packet synchronization ahead of:
  - `idea`
  - `plan`
  - `review`
  - `write`
  - `submit`

- [x] Wire stage preflight to queue `LITERATURE_DISCOVERY_PACKET` as a workflow-owned requisition when:
  - the packet exists
  - it is not already active in `paper_ingestion.queued_requests`
  - the current stage is downstream of graph build

## Task 4: Make catalyst, story, and review materializers consume PaperNexus packets directly

**Files:**
- Modify: `tools/idea-catalyst/materializers.ts`
- Modify: `tools/workflow-guard-materializers/paper-story-materializer.ts`
- Modify: `tools/workflow-guard-materializers/review-pressure-materializer.ts`

- [x] Update IDEA-CATALYST materialization
  - merge upstream domain distance, bridge nodes, candidate/selected/pruned domains, and bridge evidence tier into the local scouting basis before calling the scout

- [x] Update paper-story materialization
  - prefer `GRAPH_STORYLINE_PACKET` for:
    - task summary
    - challenge statement
    - insight summary
    - contribution bullets
    - advantage bullets
    - module motivations
    - claim/evidence storyline hints

- [x] Update review-pressure materialization
  - use `GRAPH_STORYLINE_PACKET` and `CHALLENGE_INSIGHT_PACKET` to strengthen:
    - reject-first review
    - novelty attack
    - reverse outline
    - limitation audit

## Task 5: Status and verification

**Files:**
- Modify: `tools/workflow-commands/formatters.ts`
- Test only

- [x] Surface packet-derived readiness in `/workflow-status`
  Include:
  - KG storyline readiness
  - bridge evidence tier
  - source domain counts
  - discovery packet / requisition state when relevant

- [x] Run targeted verification
  - `node --test tests/papernexus-packet-integration.test.mjs tests/workflow-runtime-tools.test.mjs tests/idea-catalyst-runtime-tools.test.mjs tests/auto-iterator.test.mjs`

- [x] Run broader verification
  - `node --test tests/workflow-service.test.mjs tests/workflow-commands.test.mjs tests/workflow-zotero-scientific-skills.test.mjs`

- [x] Run build
  - `npm run build`

## Completion Criteria

This plan is complete only when all of the following are true:

1. PaperNexus packet files can be synchronized into existing workflow contracts with one workflow-owned action
2. `materialize_idea_catalyst_state` consumes upstream domain/bridge enrichment rather than relying only on local graph heuristics
3. `paper_story_state` and `review_pressure_packet` consume `GRAPH_STORYLINE_PACKET` as an upstream fact source
4. `writing_contract.kg_storyline_*` and `graph_guided_writing` are made ready from packet-backed evidence rather than manual patching
5. `LITERATURE_DISCOVERY_PACKET` can enter `paper_ingestion.queued_requests` through stage-preflight without a manual side path
6. `/workflow-status` surfaces the new packet-backed readiness signals
7. All targeted and broad verification commands pass

## Completion Notes

Completed on 2026-04-05.

Key shipped pieces:

- Added `tools/papernexus-packets/materializer.ts` as the thin adapter from upstream PaperNexus packets into existing workflow contracts.
- Added workflow action `materialize_papernexus_packet_contracts`.
- Wired stage preflight to synchronize packet contracts before downstream idea/story/review work and to queue packet-backed literature discovery requisitions.
- Upgraded IDEA-CATALYST, paper story, and review pressure materializers to consume upstream packet facts directly.
- Surfaced packet-backed readiness in `/workflow-status`.
- Verified with:
  - `node --test tests/papernexus-packet-integration.test.mjs tests/workflow-runtime-tools.test.mjs tests/idea-catalyst-runtime-tools.test.mjs tests/auto-iterator.test.mjs`
  - `node --test tests/workflow-service.test.mjs tests/workflow-commands.test.mjs tests/workflow-zotero-scientific-skills.test.mjs`
  - `npm run build`
