# PaperNexus Batch Graph Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align workflow-owned PaperNexus graph synchronization with the new batch-import Python wrappers and make graph sync status durable, visible, and non-blocking.

**Architecture:** Extend the wrapper runtime and `paper_ingestion` state model to understand manifest-driven batch imports, then update workflow prompts/status rendering and Researcher docs so the runtime and agent guidance describe the same bounded graph-sync protocol.

**Tech Stack:** TypeScript, Node.js test runner, markdown workflow docs

---

### Task 1: Add failing tests for batch-wrapper runtime support

**Files:**
- Modify: `tests/workflow-fast-paths.test.mjs`
- Modify: `tests/workflow-runtime-tools.test.mjs`
- Modify: `tests/workflow-commands.test.mjs`
- Modify: `tests/workflow-guard-boundaries.test.mjs`

- [x] Add a failing test that `run_papernexus_wrapper` accepts `pn_batch_import.py`.
- [x] Add a failing test that background continuation prompts teach manifest-driven batch updates.
- [x] Add a failing test that `/workflow-status` renders batch ingestion summary.
- [x] Add a failing test that workflow guards reject long blocking batch waits.

### Task 2: Implement runtime and state-model support

**Files:**
- Modify: `tools/workflow-fast-paths.ts`
- Modify: `tools/workflow-subagent-sessions.ts`
- Modify: `tools/workflow-guard.ts`
- Modify: `tools/register-workflow-tools.ts`
- Modify: `tools/workflow-commands.ts`
- Modify: `tools/graph-presence.ts`

- [x] Add `pn_batch_import.py` to the wrapper allowlist and command builders.
- [x] Extend continuation prompts to describe batch-manifest workflow rules.
- [x] Extend `paper_ingestion` normalization, serialization, and merge logic with batch summaries/items.
- [x] Render batch-aware status text and in-flight graph-refresh reasoning.
- [x] Keep backward compatibility for old projects that only have single-paper fields.

### Task 3: Sync workflow and agent docs

**Files:**
- Modify: `skills/researcher/research-lit/SKILL.md`
- Modify: `skills/researcher/graph-build/SKILL.md`
- Modify: `skills/researcher/research-pipeline/SKILL.md`
- Modify: `skills/researcher/resume-pipeline/SKILL.md`
- Modify: `skills/researcher/papernexus/SKILL.md`
- Modify: `skills/researcher/papernexus-agentic-reasoning/SKILL.md`
- Modify: `agents/researcher/AGENTS.md`
- Modify: `agents/researcher/SOUL.md`
- Modify: `agents/researcher/TOOLS.md`

- [x] Change the default multi-paper guidance to `pn_batch_import.py`.
- [x] Clarify that graph sync should report durable batch progress instead of waiting for free-form replies.
- [x] Clarify that `/graph-build` should stay bounded and reconcile after batch progress snapshots.

### Task 4: Verify and summarize

**Files:**
- Modify: `docs/superpowers/plans/2026-04-01-papernexus-batch-graph-sync.md`

- [x] Run the targeted Node test suites.
- [x] Run `npm run build`.
- [x] Update this plan with a brief completion note if implementation diverges from the initial scope.

## Completion Note

Implementation completed on 2026-04-01. The shipped version keeps backward compatibility for single-paper updates while adding manifest-driven batch state (`active_batches`, `batch_items`, `last_batch_manifest_path`) and batch-aware workflow guidance. The main intentional divergence from the older single-paper design is that workflow-owned graph sync now treats 2+ staged papers as a batch-import-first path rather than forcing repeated one-paper submit loops.
