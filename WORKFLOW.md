# WORKFLOW.md — Global Research Pipeline

> This is the **master control document** for the entire research pipeline.
> The Researcher agent reads this on every session start and uses it as the
> authoritative definition of what to do next, in what order, and when to pause.

## Agent naming (Coder, not “methodologist”)

The **CODE** stage and all implementation work (baselines, training code, reproducibility) are owned by **Coder**.  
If any older text still says **methodologist**, treat it as a deprecated alias — use **`coder` / Coder / `@coder`** in skills, handoffs, and external mentions.

---

## Configuration

```
AUTO_PROCEED: false        # true = skip all optional gates, loop forever
                           # false = pause at each gate and wait for human
GATE_TIMEOUT_HOURS: 24     # if AUTO_PROCEED=false and no human response
                           # after this many hours, treat as "continue"
PROJECT_MODE: single       # single | queue  (queue = /research-queue skill)
```

To switch to fully autonomous mode, set `AUTO_PROCEED: true` and restart the session.
The agent will then run like autoresearch — loop forever, never ask, human interrupts at will.

---

## Control Model

This workflow is a **state machine**, not just an ordered checklist.

Every project is controlled by four mandatory state files:

- `{PROJ}/PROJECT_MANIFEST.json` — coarse stage, micro-stage, budget, gate state, graph ingestion state, and idle-research background topic policy
- `{PROJ}/TRACK_REGISTRY.json` — candidate / active / parked / killed hypothesis tracks
- `{PROJ}/CLAIM_POLICY.md` — how support labels constrain writing and advancement
- `{PROJ}/researcher/EXPERIMENT_LEDGER.json` — restart-safe structured memory for queued, running, completed, failed, and PaperNexus-synced experiments

When coder-driven local experiment search is enabled, the workflow also expects:

- `{PROJ}/planner/EXPERIMENT_SEARCH_SPEC.json` — approved search envelope, git retention policy, and non-promotion signals
- `{PROJ}/coder/experiments/<track-id>/<experiment-id>__<slug>/SEARCH_STATE.json` — incumbent/candidate runtime state for the active search session

The workflow advances only when:

1. the current stage's mandatory artifacts exist
2. `PROJECT_MANIFEST.json` reflects the correct `current_stage` and `current_micro_stage`
3. track decisions are explicit (`advance` / `merge` / `park` / `kill`)
4. experiment history is durably reconciled before leaving the EXPERIMENT stage
5. claim support satisfies the current gate

For survey-only work, the workflow may create a lightweight project whose primary durable contract is:

- `{PROJ}/PROJECT_MANIFEST.json.survey_review`

The survey loop still uses the same manifest/snapshot/runtime infrastructure, but it does not enter `plan`, `code`, or `experiment`.

Advisory writing signals are tracked separately and never block draft generation.

### Gate Types

- **Quality gate** — novelty, evidence quality, baseline coverage, reproducibility
- **Budget gate** — GPU hours, time, API spend, and scope pressure
- **Risk gate** — fragility, unclear assumptions, dependence on a single result
- **Scope gate** — whether the paper is already sufficient vs. still under-supported
- **Publishability gate** — whether the work is strong enough to justify writing/submission

### Advisory Writing Signals

The workflow also tracks three **non-blocking** writing signals:

- **Theory signal** — whether the current claims have enough rough theoretical or mechanistic support for confident venue-facing prose
- **Storyline signal** — whether the paper already has a single clean thesis and evidence spine
- **Paragraph logic signal** — whether section-to-section and paragraph-to-paragraph flow is coherent enough for human polishing

These signals use only two labels:

- `green` — safe to write normally
- `red` — still write the draft, but use more conservative language and surface the issue for human review

`red` on any advisory writing signal must **not** stop progression from ANALYZE → REVIEW → WRITE.

### Template-Driven Writing Contract

When the user provides a writing template, it must become durable workflow state instead of an ephemeral chat instruction.

- record it in `{PROJ}/PROJECT_MANIFEST.json.writing_contract`
- store the readable template path in `writing_contract.template_path`
- store the project-local copied template path in `writing_contract.project_template_path`
- choose a durable `writing_contract.paper_mode`
  - `conference` = `9` pages main body + `2` pages references
  - `journal` = `12` pages main body + `2` pages references
- if the template is mandatory, set `writing_contract.template_required = true`
- require Academic Writer to read the project-local template copy before `/paper-plan` or `/paper-write`
- adapt the template explicitly into `{PROJ}/academic_writer/TEMPLATE_MAPPING.md`
- never let Writer edit the external source template in place; the plugin should copy the template into `{PROJ}/academic_writer/template_bundle/` first
- if `writing_contract.kg_storyline_required = true`, require `{PROJ}/academic_writer/KG_STORYLINE_PACKET.md` before final drafting
- if proof-aware writing is enabled, keep `writing_contract.main_text_proof_style = lemma_result_only` and require `writing_contract.proof_appendix_path` for detailed derivations

The writing contract should also bound paper scope:

- keep at most `1-2` core ideas
- keep headline claims small and explicit
- use the knowledge graph to constrain `problem -> gap -> method -> evidence -> limitation`

Paragraph logic is part of this contract, not an optional polish pass:

- one paragraph should carry one message
- the opening sentence should state the paragraph role or claim
- sentence order should show a clear relation: cause, contrast, consequence, refinement, or example
- the closing sentence should bridge to the next paragraph or section when possible
- Writer should reverse-outline each section before treating it as stable

If `writing_contract.template_required = true` and the template file is missing, Writer must stop and restore the template before drafting new prose.

### Citation Integrity Contract

Citation reliability must become durable workflow state instead of a last-minute manual check.

- record it in `{PROJ}/PROJECT_MANIFEST.json.citation_integrity`
- keep `citation_integrity.bibliography_path = academic_writer/paper/refs.bib`
- keep `citation_integrity.verification_report_path = reviewer/CITATION_VERIFICATION.md`
- when the local Zotero MCP server is configured, use that local Zotero server directly and treat the configured Zotero project path (default `<zoteroProjectRoot>/<project-id>`, where `zoteroProjectRoot` defaults to `bot`) as the bibliography queue and writing shortlist, while still verifying final metadata against DBLP/CrossRef/DataCite/Semantic Scholar/arXiv before accepting citations
- require writer-side `/citation-preflight` before final citation review
- require reviewer-side citation verification before SUBMIT
- block submission when citation verification is not `verified`
- block submission when unresolved placeholders exceed budget
- block submission when hallucinated citations remain

### Structured Experiment Bundle Contract

Coder must keep experiment folders self-describing enough that a later run can recover the relationship between:

- project
- track
- experiment id
- scientific question
- track hypothesis
- track novelty basis
- entry point
- config set
- result directory
- remote launch record

Minimum structure:

- `coder/EXPERIMENT_INDEX.md`
- `coder/experiments/<track-id>/<experiment-id>__<slug>/EXPERIMENT_MANIFEST.json`
- `planner/EXPERIMENT_SEARCH_SPEC.json` when coder-side search is enabled
- bundle-local `SEARCH_STATE.json` when coder-side search is enabled
- one local `README.md` per bundle
- one `REMOTE_RUN.json` per launched bundle

Flat, ambiguous experiment dumping under `coder/` is not allowed for new work.

### Git Ratchet Contract

When experiment search is active, git is part of the scientific control surface:

- `experiment/<track-id>/incumbent` stores only promoted changes
- disposable candidate branches or worktrees store one trial each
- candidate worktree creation plus promote/discard branch actions must go through workflow-owned multi-agent review before any git mutation happens
- only primary-metric wins, or explicit equal-but-simpler wins allowed by the packet, may advance the incumbent line
- gap reduction, smoother curves, nicer runtime, or optimistic intermediate checkpoints are diagnostic signals only unless the packet explicitly makes them primary

The ledger should remember all candidate outcomes, but the incumbent branch should remember only accepted ones.
Workflow, not Coder, owns the durable ledger update and experiment-memory / graph-sync materialization that follows a reviewed promote or discard decision.

### Workflow Guard Code Map

The workflow runtime is implemented as a facade plus focused submodules, rather than a single unreadable file.

- `tools/workflow-guard.ts`
  Public facade and compatibility layer. It should keep exports, dependency wiring, and limited glue logic only.
- `tools/workflow-guard-core/`
  Shared coercion, fs, path, and weak-business helpers.
- `tools/workflow-guard-state/`
  Durable workflow contracts such as `research_program`, `paper_ingestion`, `ideation_contract`, `paper_story_state`, `review_pressure_packet`, and `writing_contract`.
- `tools/workflow-guard-stages/`
  Stage-specific missing-signal gates for `setup`, `graph_build`, `frontier_mapping`, `idea`, `plan`, `code`, `experiment`, `analyze`, `review`, `write`, and `submit`.
- `tools/workflow-guard-project/`
  Project-root resolution, `PROJECTS_STATE`/gate helpers, and workflow snapshot assembly.
- `tools/workflow-guard-policies/`
  Role policy tables, tool guards, and channel handoff sanitization.
- `tools/workflow-guard-writing/`
  Writing/review/theory/citation readiness and quality evaluation helpers.
- `tools/workflow-guard-setters/`
  `set*State(...)` families for research, writing, review, and ingestion/runtime state mutation.
- `tools/workflow-guard-materializers/`
  Workflow-owned contract generation for ideation, paper story, and review pressure packets.
- `tools/workflow-guard-summaries/`
  Status and summary helpers used by `/workflow-status` and related runtime views.
- `tools/workflow-guard-guidance/`
  Dynamic task generation and concern-specific guidance such as PaperNexus and writing prompts.

`tools/workflow-commands/` is also now a formal submodule for parser / formatter / type extraction from `workflow-commands.ts`; command registration and runtime dispatch still remain in the parent file.

### Track Lifecycle

Each track in `{PROJ}/TRACK_REGISTRY.json` must be in exactly one of:

- `candidate` — generated but not yet selected
- `active` — currently receiving plan / code / experiment budget
- `parked` — promising, but deferred in favor of stronger tracks
- `merged` — absorbed into another track
- `killed` — terminated; write failure reason to memory

Default portfolio rule:

- at most **2 active tracks**
- at most **1 parked track**
- all remaining tracks must be merged or killed

### Survey-Only Review Mode

When the user invokes `/survey-review`, the system creates or reuses a lightweight survey workspace and keeps the project inside one top-level stage:

- `survey_review`

The authoritative progress contract is `PROJECT_MANIFEST.json.survey_review`, not any single Markdown file.

Durable survey artifacts:

- `{PROJ}/researcher/SURVEY_QUERY_REGISTRY.json`
- `{PROJ}/researcher/LITERATURE.md`
- `{PROJ}/researcher/REVIEW_PROTOCOL.md`
- `{PROJ}/researcher/INCLUDED_PAPERS.json`
- `{PROJ}/researcher/EXCLUDED_PAPERS.json`
- `{PROJ}/researcher/LITERATURE_REVIEW.md`
- `{PROJ}/researcher/SOTA_MATRIX.md`
- `{PROJ}/researcher/GAP_SYNTHESIS.md`
- `{PROJ}/researcher/COVERAGE_SUMMARY.md`
- `{PROJ}/researcher/SURVEY_BRIEF.md`

The survey materializer must reconcile these artifacts back into the manifest after each retrieval, screening, or synthesis pass. This is required to avoid the old failure mode where files existed on disk but the workflow still blocked on stale in-memory or stale-manifest state.

Survey review internal phases:

1. `bootstrap`
2. `retrieval`
3. `screening`
4. `synthesis`
5. `complete`

Survey mode rules:

- prefer broad retrieval saturation over bounded startup research coverage
- keep explicit included/excluded decisions
- keep coverage gaps durable
- stop after survey synthesis; do not automatically route into experiment planning

### Graph-Grounded Brainstorming Contract

PaperNexus is not just a pre-processing step. Before any idea divergence, the pipeline must build a **brainstorm pack** grounded in the graph.

At minimum, the brainstorming flow must use the workflow-declared PaperNexus graph access path:

- if `papernexusAccessMode = remote_mcp` or `auto` resolves to `remote_mcp`, use the configured remote PaperNexus HTTP MCP control plane: `research_lookup` for query/context/impact/ideas/brainstorm, `research_briefing` for brief/chain outputs, and `idea_catalyst` for cross-domain ideation packets
- if `papernexusAccessMode = remote_api` or `auto` resolves to `remote_api`, use the authenticated compatibility wrappers (`pn_graph_query.py`, `pn_research_chains.py`) instead of raw REST, and treat them as a fallback when remote MCP is not available
- if `papernexusAccessMode = local_mcp`, use the local PaperNexus MCP tools for graph reads and writes
- `research_workflow.run_brainstorm_cycle` — persist the selected brainstorm / chain bundle so question packets, working memory, evidence chains, and synthesis packets survive restarts and agent handoffs

When PaperNexus `idea_catalyst` runs in `live_discovery` or `hybrid` mode, the MCP response is not enough by itself. AutoResearch must materialize the returned packet bundle into project-local durable artifacts under `{PROJ}/researcher/idea-catalyst/`:

- `live_packet_bundle.json`
- `LIVE_DISCOVERY_RUN_MANIFEST.json`
- `LIVE_DISCOVERY_EVIDENCE_CARDS.json`
- `LIVE_DISCOVERY_READ_MODEL.json`

The read model must record target/source retrieval counts, source-domain pruning decisions, evidence IDs, pairwise ranking backend, temporal cutoff/leakage policy, and a `ready` or `degraded` status. Metadata-only or heuristic live-discovery output can enrich ideation, but it does not replace source-backed graph proof for downstream claims.

The graph-backed brainstorming pack should preserve:

- frontier lens (`limitation / contradiction / transfer / composition`)
- anchor nodes and relation patterns from the graph
- why the opportunity matters
- one plausible pilot
- one plausible falsifier / failure condition

Before graph build, Researcher must also maintain a project-local paper selection that points into the remote shared PaperNexus graph:

- use `/papers-cool` for rough keyword search and venue sweep
- when stable and available, also use `/pasa-paper-search` as a second retrieval source and merge by canonical identity; if PASA fails, continue with `papers-cool`
- once a concrete paper identity is known (for example arXiv ID or paper URL), immediately prefer `/hugging-face-paper-pages` to save full-paper markdown into `{PROJ}/researcher/paper-staging/`
- if Hugging Face does not provide valid markdown for an arXiv paper, try `/arxiv2md-api`, then `/arxiv2md`
- if both markdown sources are unavailable, fall back to `/papers-cool` PDF download
- record every selected canonical paper in `{PROJ}/researcher/PAPER_SOURCE_INDEX.json`
- if the local Zotero MCP server is configured, use that local Zotero server directly and keep a per-project bibliography tree under the configured Zotero project path synchronized with the selected / included / excluded / baseline paper sets; Zotero is the organizer, while PaperNexus remains the full-text and graph source of truth
- if new PDFs or Markdown arrive through the PaperNexus UI or Web/API, prefer the queued wrapper path (`pn_stage_sync.py`, `pn_import_submit.py`, `pn_import_queue.py`, `pn_batch_import.py`) and durable `research_workflow.set_paper_ingestion` updates; do not manually copy those ad hoc uploads into local shared storage during automation
- do not hand-write `/api/*` REST calls in workflow execution; live graph work should go through remote HTTP MCP, and compatibility mode should still go through the authenticated wrappers instead of ad hoc curl/fetch
- if `papernexusAccessMode = remote_mcp`, use the configured remote HTTP MCP endpoint (`streamable-http`) plus the shared bearer token for graph reads and writes; prefer `research_lookup`, `research_briefing`, `idea_catalyst`, and `import_workflow`
- if `papernexusAccessMode = local_mcp`, use PaperNexus MCP tools for graph reads and writes instead of the Python wrapper path
- if `papernexusAccessMode = auto`, prefer remote HTTP MCP first, then the authenticated remote wrapper/API compatibility path, and only fall back to local MCP when workflow guidance explicitly permits it
- if the current shared graph does not already contain a newly found key paper, Researcher must queue automatic graph catch-up before novelty or innovation analysis
- only after full-text ingestion and graph presence checks should Researcher run downstream brainstorming

Paper source layout and refresh rules:

- keep temporary staging files under `{PROJ}/researcher/paper-staging/`; treat the remote PaperNexus service as the source of truth for shared graph state
- project state should record which canonical papers are in scope via `PAPER_SOURCE_INDEX.json`; do not create a separate project-local corpus
- use canonical filenames prefixed by arXiv ID, e.g. `<arxiv-id>--<normalized-title>.md`
- deduplicate by canonical paper identity, not by raw filename
- refresh graph readiness immediately if a newly ingested paper changes the novelty baseline or closest prior work
- otherwise refresh graph readiness when 3+ genuinely new canonical papers, or 2+ new overlapping recent venue papers, accumulate since the last graph sync
- for ideation, prefer the brainstorm-quality node layer (`brainstormEligible`, `brainstormScore`, `brainstormTier`) over the raw full graph when choosing anchors for `ideas`, `brainstorm`, and typed brief / chain endpoints
- keep a durable Zotero sync note under `{PROJ}/researcher/ZOTERO_PACKET.md`, including the effective project Zotero path, shortlist counts, baseline collection status, unresolved metadata cleanup work, and whether the last sync was `synced`, `unavailable`, `failed`, or `needs_manual_followup`
- agents may add or update understanding in the shared graph, but must not delete shared corpus data or run `backup-export`, `backup-unpack`, or `backup-load` unless the user explicitly asks

### Experiment-Informed Innovation Reflection Contract

PaperNexus-backed brainstorming must not forget experiment history.
Once `{PROJ}/researcher/EXPERIMENT_LEDGER.json` contains reflectable results, the next serious innovation proposal must first pass through a reflection step grounded in both the graph and the experiment ledger.

The reflection flow must:

- read the latest experiment memory via `research_workflow.get_experiment_memory`
- inspect the latest `innovation_reflection` state from `{PROJ}/PROJECT_MANIFEST.json` or `research_workflow.get_innovation_reflection`
- use authenticated PaperNexus MCP-first tool families such as `research_lookup`, `research_briefing`, and `idea_catalyst` as needed to reinterpret the latest experiment evidence
- produce `{PROJ}/researcher/INNOVATION_REFLECTION.md`
- record the refresh through `research_workflow.record_innovation_reflection` instead of hand-editing `PROJECT_MANIFEST.json`

The experiment-informed reflection should preserve:

- which experiments materially changed the innovation picture
- what worked, what failed, and what remains ambiguous
- which assumptions were falsified or weakened
- transferable graph-grounded lessons for the next idea round
- brainstorm anchors and "do not repeat" constraints for the next innovation proposal

If new experiment evidence exists after the last reflection, Researcher must refresh `INNOVATION_REFLECTION.md` before writing new idea outputs or changing the active innovation direction.

### Query-Grounded Graph Reasoning Contract

Graph-backed research automation must not stop at "the graph exists" or "the frontier report looks reasonable".
Before Researcher locks a serious candidate into the portfolio, it must run an explicit query-grounded graph reasoning loop inspired by iterative graph agents such as DoG and ToG-3:

1. **Grounding and anchoring**
   - identify the concrete question, task, dataset, method family, and key entities
   - resolve them to graph anchors or explicitly mark them unresolved
   - record the closest prior work and the initial stop condition
2. **Exploration and trial-and-error**
   - traverse the graph with `query`, `context`, `impact`, `ideas`, and `brainstorm`
   - after each hop, decide whether to `expand`, `refine_query`, `answer_try`, or `stop`
   - record rejected branches and false-positive relations instead of silently reusing them later
3. **Memory and synthesis**
   - accumulate accepted facts, evidence paths, contradictions, open unknowns, and next actions in durable working memory
   - stop when evidence is sufficient, exploration becomes repetitive, contradiction requires escalation, or the hop budget is exhausted
   - write a bounded synthesis packet that clearly separates `graph/source-backed facts`, `inferences`, and `open uncertainty`

For each active or near-active track, Researcher must maintain:

- `{PROJ}/researcher/reasoning/<track-id>/QUESTION_PACKET.md`
- `{PROJ}/researcher/reasoning/<track-id>/WORKING_MEMORY.json`
- `{PROJ}/researcher/reasoning/<track-id>/REASONING_TRACE.jsonl`
- `{PROJ}/researcher/reasoning/<track-id>/SYNTHESIS_PACKET.md`

If a key paper or claim is missing from the graph, stop the reasoning loop and refresh the corpus and graph before continuing.

---

## Pipeline Overview

```
 ┌─────────────────────────────────────────────────────────────────────┐
 │                     RESEARCH PIPELINE                               │
 │                                                                     │
 │  [START] ──► GRAPH_BUILD ──► FRONTIER_MAPPING ──► IDEA            │
 │                                   │                  │             │
 │                                   └──────► ◆ GATE-1 ─┴─► PLAN     │
 │                                                      │              │
 │              ▲                              CODE ◄───┘              │
 │              │                               │                     │
 │           REVISE ◄── ◆ GATE-5               ▼                     │
 │              │         │             EXPERIMENT                     │
 │              │         │                   │                        │
 │           WRITE        │            ◆ GATE-3                       │
 │              │         │                   │                        │
 │              └── ◄─────┘             ANALYZE                       │
 │                                            │                        │
 │                                      REVIEW (internal)              │
 │                                            │                        │
 │                                      WRITE ──► CROSS-REVIEW         │
 │                                            │                        │
 │                                      ◆ GATE-4 ──► SUBMIT           │
 │                                                        │            │
 │                                                    [DONE / LOOP]   │
 └─────────────────────────────────────────────────────────────────────┘
```

**◆ = HITL Gate** — agent pauses here and posts a summary for human review.
If `AUTO_PROCEED=true`, all **optional** gates are skipped (gate message is posted as a log entry only).
**GATE-2 is semi-required**: even when AUTO_PROCEED=true, you must not advance to CODE until PLAN.md and TODOS.md exist (see "Stage transition preconditions" below).

---

## Stage transition preconditions (mandatory)

**Researcher must NOT advance to the next stage until the current stage's completion signals exist.**  
This applies regardless of `AUTO_PROCEED`. Skipping a stage (e.g. going IDEA → CODE without PLAN) is forbidden.

| From stage | To stage | Completion signals (all must exist) |
|------------|----------|--------------------------------------|
| SETUP      | GRAPH_BUILD | `{PROJ}/PROJECT_MANIFEST.json` with `idle_research` block present, `{PROJ}/TRACK_REGISTRY.json`, `{PROJ}/CLAIM_POLICY.md`, `{PROJ}/researcher/EXPERIMENT_LEDGER.json`, `{PROJ}/graph/` |
| GRAPH_BUILD | FRONTIER_MAPPING | `{PROJ}/graph/PAPERNEXUS_SYNC_STATE.json` with source-backed graph readiness, a valid graph build receipt/certification, and compatible manifest projections such as `paper_ingestion.papernexus_sync_can_continue = true`; legacy `paper_ingestion.graph_presence_status = ready` is only a compatibility projection, not the source of truth |
| FRONTIER_MAPPING | IDEA | `{PROJ}/researcher/FRONTIER_REPORT.md`, frontier files under `{PROJ}/graph/` (or legacy non-empty `{PROJ}/graph/subgraphs/`), and `current_micro_stage = frontiers_packaged` |
| IDEA       | PLAN     | `{PROJ}/researcher/IDEA_REPORT.md`, `{PROJ}/researcher/IDEA_AUDIT.md`, `{PROJ}/TRACK_REGISTRY.json` with 1–2 `active` tracks, graph-backed innovation evidence recorded for each active track, a non-empty reasoning packet under `{PROJ}/researcher/reasoning/<track-id>/` for each active track, and when experiment memory contains newer evidence than the last ideation reflection, `{PROJ}/researcher/INNOVATION_REFLECTION.md` refreshed after the latest experiment results |
| **PLAN**   | **CODE** | **`{PROJ}/orchestrator/PLAN.md`** AND **`{PROJ}/orchestrator/TODOS.md`** AND **`{PROJ}/orchestrator/PLAN_AUDIT.md`** |
| CODE       | EXPERIMENT | At least one runnable experiment bundle with `train.py` (or equivalent), `README.md`, and `EXPERIMENT_MANIFEST.json` carrying `track_id`, `question`, `hypothesis`, `novelty_basis`, `baseline_reference`, `primary_baseline_metric`, `target_improvement`, `baseline_training_protocol`, `baseline_eval_protocol`, `innovation_points`, `validation_steps`, and `ablation_plan`; in aggressive mode the bundle must also pass the CODE innovation review quorum before advancement |
| EXPERIMENT | ANALYZE | `{PROJ}/researcher/artifacts/results/` non-empty, `{PROJ}/researcher/EXPERIMENT_REGISTRY.md` updated, `{PROJ}/researcher/EXPERIMENT_LEDGER.json` updated, `PROJECT_MANIFEST.json.experiment_memory.last_ledger_update_at` recorded, and `TRACK_REGISTRY.json` updated with experiment outcomes |
| ANALYZE   | REVIEW  | `{PROJ}/analyzer/NARRATIVE_REPORT.md`, `{PROJ}/analyzer/CLAIM_EVIDENCE_MATRIX.md`, `{PROJ}/analyzer/TRACK_VERDICTS.md`, `{PROJ}/analyzer/UNSUPPORTED_CLAIMS.md`, `{PROJ}/analyzer/QUALITY_AUDIT.md` |
| REVIEW    | WRITE   | `{PROJ}/reviewer/REVIEW_REPORT.md` or review loop marked complete in REVIEW_STATE.json, and no `UNSUPPORTED` primary claims remain in the selected writing scope |
| WRITE     | SUBMIT  | `{PROJ}/academic_writer/paper/main.pdf` (or equivalent), `{PROJ}/academic_writer/WRITING_SIGNALS.md`, and outline/prose cross-review artifacts saved under `{PROJ}/cross-reviewer/` |
| SUBMIT    | DONE    | `{PROJ}/reviewer/external_review_{date}.md`, `{PROJ}/reviewer/rebuttal_{date}.md`, and a recorded GATE-5 human decision |

Advisory files such as `THEORY_SUPPORT_NOTE.md`, `STORYLINE_SKETCH.md`, and `WRITING_SIGNALS.md` should be produced when possible, but they are not transition blockers.

**If a completion signal is missing:**

- Do **not** write `GATE_STATE.json` with `current_stage` = next stage.
- Do **not** spawn the next stage's agent (e.g. Coder) until the previous owner (e.g. Orchestrator) has produced the required files.
- **Proactively wake the owning agent:** when a signal is missing, Researcher must **actively spawn (wake)** that stage's agent to produce the outputs — do not assume the user or another process will run it. Example: if `PLAN.md` or `TODOS.md` are missing before CODE, **wake Orchestrator** (spawn with instruction to run `/plan-research` using `{PROJ}/researcher/IDEA_REPORT.md`), then wait until both files exist (poll or wait for session completion). Only then advance to CODE.

---

## Structured State Contract (mandatory)

The workflow is not allowed to rely on prose alone.

Before a stage can be considered complete, the durable state files must be structurally usable by another agent after restart:

- `{PROJ}/PROJECT_MANIFEST.json` must carry the current `project_id`, `owner_agent`, `current_stage`, `current_micro_stage`, `next_action`, `resume_action`, `required_artifacts`, `blocking_reason`, `last_heartbeat_at`, `last_handoff_at`, optional shared-graph override pointers such as `papernexus_corpus` / `paper_source_dir`, `memory_scope`, `audit`, latest graph-reasoning status, an `idle_research` block with the configured topic, budget, cooldown, and latest runtime summary, an `innovation_reflection` block with freshness status and the latest reflected experiment boundary, and a `writing_contract` block with template path, section order, and paragraph-logic state.
- `{PROJ}/TRACK_REGISTRY.json` must carry explicit per-track fields for status, hypothesis, graph grounding, reasoning packet location, working memory location, synthesis packet location, evidence pointers, failure signature, retry condition, and last decision.
- `{PROJ}/researcher/EXPERIMENT_LEDGER.json` must carry a structured per-experiment record with experiment id, track id, kind, status, checkpoint stage, config reference, result pointers, decision, and PaperNexus sync status.
- `PROJECT_MANIFEST.json.experiment_memory` must mirror the latest ledger summary (`ledger_path`, `last_ledger_update_at`, `last_completed_experiment_id`, `last_failed_experiment_id`, `best_known_config_ref`, `papernexus_sync_status`, `papernexus_sync_required`).
- when graph-backed experiment memory is enabled, `PROJECT_MANIFEST.json.experiment_memory` should also point at the distilled experiment-memory packet and sync-status artifact used by planner/coder/reflection flows.
- If a required field is missing, the stage is incomplete even if the narrative report exists.
- Researcher is the top-level state steward: sub-agents emit structured handoff summaries in their own folders; Researcher mirrors the authoritative handoff state into `{PROJ}/PROJECT_MANIFEST.json`.

## Automatic Audit Contract (mandatory)

High-quality automation requires explicit self-audit at each stage:

- Researcher writes `{PROJ}/researcher/IDEA_AUDIT.md` before IDEA can hand off to PLAN.
- Orchestrator writes `{PROJ}/orchestrator/PLAN_AUDIT.md` before PLAN can hand off to CODE.
- Analyzer writes `{PROJ}/analyzer/QUALITY_AUDIT.md` before ANALYZE can hand off to REVIEW.
- Academic Writer must keep `{PROJ}/academic_writer/WRITING_SIGNALS.md` current before WRITE can hand off to SUBMIT.
- Reviewer remains the final internal audit gate through `{PROJ}/reviewer/REVIEW_REPORT.md`.

## Deterministic Lobster Handoff

After a stage owner finishes that stage's mandatory durable artifacts and the stage is genuinely ready to advance, the owner should run the Lobster handoff workflow:

- `lobster/workflows/research-stage-handoff.lobster`

The handoff should:

- run `research_workflow.auto_iterator_tick`
- confirm the effective next stage and next owner
- dispatch work to the next owner when ownership changed
- keep the stage-broadcast message consistent on the project channel

Use Lobster handoff only for true forward progression.

Do **not** hand off forward when:

- the stage is still missing a required artifact
- the current result triggered a revise / retry / more-experiments loop
- a human or internal review decided to stay in the current stage
- the current owner still owes a bounded repair inside the same stage

In those cases, remain in the current stage or roll back explicitly according to the gate outcome. Lobster handoff is for deterministic owner-to-owner continuation, not for bypassing revision loops.

Each audit must include:

- what was checked
- what is still weak or missing
- whether the stage is safe to advance
- concrete rollback trigger if the answer is "not yet"

Researcher must also mirror the freshest audit paths into `{PROJ}/PROJECT_MANIFEST.json.audit`.

## Strong Recovery & Handoff Contract (mandatory)

Every agent handoff must survive restarts and context loss.

- Before a long action or wait state, the current owner must ensure the manifest records `owner_agent`, `next_action`, `resume_action`, `required_artifacts`, and `blocking_reason`.
- On every meaningful milestone, Researcher updates `last_heartbeat_at` and `last_handoff_at` in `{PROJ}/PROJECT_MANIFEST.json`.
- When a sub-agent completes or blocks, it must emit a short structured handoff summary in its own folder; Researcher copies the authoritative next-step state into the manifest.
- Restart recovery always prefers durable state over remembered chat context.
- If durable state and on-disk artifacts disagree, the pipeline must reconcile first and only then continue.

Discord status reports are broadcast summaries, not routing commands.

- Never post raw `@coder`, `@researcher`, `@writer`, `@reviewer`, or `@openclaw` inside routine status tables or heartbeat updates.
- Use plain labels such as `[coder]`, `[researcher]`, `[writer]`, `[reviewer]`, `[openclaw]`.
- If one agent truly needs another, use the approved workflow path (`sessions_send`, `sessions_spawn`, or `research_workflow.send_mailbox`) instead of a decorative `@` in Discord.
- Short-term repeated routing is forbidden: after one agent routes work to another, do not route again to the same target until the workflow contact cooldown expires unless a new durable blocker or artifact changes the request.

## Strong Isolation Contract (mandatory)

Shared workspaces do not justify shared project cognition.

- Every write must be scoped to exactly one `{PROJ}` and one `project_id`.
- When an agent switches from one project to another in a shared workspace, it must re-read the new project's manifest and run `/resume-pipeline` before doing fresh work.
- Project facts stay inside `{PROJ}/` and `{PROJ}/memory/`; only generalized heuristics may be promoted outside the project boundary.
- Coder treats dataset roots as read-only inputs: no in-place preprocessing, annotation rewrites, permission changes, or cache dumps under shared `datasets/` directories.
- Reviewer and Cross-Reviewer stay packet-isolated: they should judge the supplied materials, not browse another agent's hidden workspace context.
- Background tasks may improve preparedness, but they must not silently change active tracks, claims, or stage ownership without an explicit state update.

---

## Micro-Stage Map (mandatory)

`PROJECT_MANIFEST.json` must record both `current_stage` and `current_micro_stage`.

For graph-grounded ideation and novelty analysis, prefer this micro-stage progression:

- `literature_collected`
- `uploading`
- `verifying`
- `brainstorm_refresh`
- `frontiers_packaged`
- `question_anchored`
- `graph_exploring`
- `working_memory_compacted`
- `synthesis_packet_ready`
- `idea_portfolio_locked`

| Stage | Required micro-stages before exit |
|-------|-----------------------------------|
| SETUP | `project_init` → `identity_locked` → `state_templates_ready` |
| GRAPH_BUILD | `uploading` → `verifying` → `brainstorm_refresh` |
| FRONTIER_MAPPING | `query_pack_built` → `anchors_extracted` → `frontiers_packaged` |
| IDEA | `graph_diverge_complete` → `graph_converge_complete` → `innovation_construction_complete` → `duplicate_risk_checked` → `attacker_pass_complete` → `novelty_checked` → `idea_audited` → `portfolio_selected` |
| PLAN | `innovation_package_locked` → `track_plan_written` → `budgeted` → `stop_rules_defined` → `plan_audited` |
| CODE | `pilot_bundle_ready` or `full_bundle_ready` |
| EXPERIMENT | `pilot_runs_complete` → `track_decision_made` → `execution_reconciled` → `experiment_memory_synced` → `full_runs_complete` |
| ANALYZE | `claims_packed` → `track_verdicts_written` → `quality_audited` → `theory_note_written` |
| REVIEW | `soundness_checked` → `scope_checked` → `publishability_checked` |
| WRITE | `claim_safe_outline` → `storyline_sketch_ready` → `draft_complete` → `logic_signals_logged` → `writing_audited` → `venue_safe_pdf` |

---

## Stage Definitions

Each stage specifies: owning agent, inputs, outputs, skills, and success condition.

---

### Stage 0 · SETUP
**Owner:** Researcher  
**Trigger:** New project or `sessions start`

```
Actions:
  1. Read WORKFLOW.md (this file)
  2. Read SOUL.md, AGENTS.md
  3. Ensure {PROJ}/PROJECT_MANIFEST.json, {PROJ}/TRACK_REGISTRY.json, {PROJ}/CLAIM_POLICY.md, {PROJ}/researcher/EXPERIMENT_LEDGER.json, and {PROJ}/graph/ exist
  4. If any state file is missing, initialize it from templates/
  5. Load {PROJ}/PROJECT_MANIFEST.json and confirm `project_id`, `owner_agent`, and `memory_scope.project_isolated`
  5a. Complete the guided onboarding contract through `/project-init` before leaving SETUP:
      - `research_program.goal`
      - `research_program.problem_statement`
      - `research_program.baseline_reference`
      - `research_program.primary_metric`
      - `research_program.datasets`
      - `research_program.success_criteria`
      - `research_program.zotero_project_path = <zoteroProjectRoot>/<project-id>` (plugin-global root defaults to `bot` unless the project overrides it explicitly)
  6. Load {PROJ}/TRACK_REGISTRY.json
  7. Load {PROJ}/CLAIM_POLICY.md
  8. Load {PROJ}/memory/ideation-memory.md, {PROJ}/memory/experiment-memory.md, and {PROJ}/researcher/EXPERIMENT_LEDGER.json (project-isolated + restart-safe)
  9. Check {PROJECTS_ROOT}/PROJECTS_STATE.json for active projects
  10. Set `current_micro_stage: "identity_locked"` once project identity and write target are confirmed
  11. If active project found → resume at last incomplete stage + micro-stage
  12. If onboarding checklist is incomplete → stay in SETUP and surface `/project-init` as `next_action`
  13. If setup checklist is complete → proceed to GRAPH_BUILD stage
  14. Post Session Ready message (see BOOTSTRAP.md)
  15. All writes to ideation memory, experiment memory, daily logs, and REVIEW_STATE must go through the `research_memory` plugin tool rather than raw file appends
  16. All writes to {PROJ}/researcher/EXPERIMENT_LEDGER.json must go through `research_workflow.upsert_experiment`; do not hand-edit the ledger during active runs
  17. All runtime writes to `PROJECT_MANIFEST.json.idle_research` should go through `research_workflow.set_idle_research` or `research_workflow.record_idle_research_run` when the plugin tool is available
```

---

### Stage 0A · GRAPH_BUILD
**Owner:** Researcher
**Skills:** `/graph-build`, `/zotero-project-library`
**Inputs:** `{PROJ}/researcher/LITERATURE.md`, `{PROJ}/researcher/PAPER_SOURCE_INDEX.json`, shared global PaperNexus graph
**Outputs:**
- `{PROJ}/graph/PAPERNEXUS_STATUS.json` — shared PaperNexus graph status for this project's selected papers
- `{PROJ}/graph/GRAPH_BUILD_REPORT.md` — graph-readiness plus brainstorm-refresh summary
- `{PROJ}/researcher/RESEARCH_BRAINSTORM.md` — preliminary brainstorm scaffold built during literature work
- `{PROJ}/researcher/ZOTERO_PACKET.md` — synced Zotero project bibliography status and shortlist summary

```
Procedure:
  1. Run /research-lit first if the project has not yet recorded key papers in `{PROJ}/researcher/PAPER_SOURCE_INDEX.json`
  2. Use `/papers-cool` for broad discovery and venue sweep; if stable, also query `/pasa-paper-search` and merge by canonical identity
  3. As soon as a key paper's identity is confirmed, call `/hugging-face-paper-pages` to fetch full markdown into `{PROJ}/researcher/paper-staging/`; if that fails and the paper is on arXiv, try `/arxiv2md-api`, then `/arxiv2md`; only if all markdown sources are unavailable, save PDF via `/papers-cool`
  3a. Keep Zotero synchronized through `/zotero-project-library`: selected papers belong in `<zoteroProjectPath>/selected`, and baseline-defining papers also belong in `<zoteroProjectPath>/baselines`
  3b. If material enters through the PaperNexus dashboard or Web/API upload path, prefer the queued wrapper flow (`pn_stage_sync.py`, `pn_import_submit.py`, `pn_import_queue.py`, `pn_batch_import.py`) instead of copying those files by hand
  4. Apply the graph refresh trigger rule:
     - refresh now if 1 new paper changes novelty / closest prior work
     - refresh now if 3+ genuinely new canonical papers accumulated
     - refresh now if 2+ overlapping recent venue papers accumulated
     - otherwise defer until the next major checkpoint
  5. Check remote graph-readiness status before trusting an existing graph
  6. Run /graph-build as a bounded status pass: verify automatic graph catch-up, refresh graph readiness metadata, update the brainstorm bundle, and synchronize Zotero `<zoteroProjectPath>/selected` plus `baselines`; do not create a project-scoped corpus or manually rebuild the shared graph
  7. If required papers are still missing, queue or request wrapper-driven import / catch-up instead of rebuilding a project-local corpus
  8. During literature work itself, maintain a preliminary brainstorm scaffold under {PROJ}/researcher/RESEARCH_BRAINSTORM.md; do not wait for IDEA to start the first serious brainstorm
  9. Persist typed brainstorm artifacts through `research_workflow.run_brainstorm_cycle` once graph readiness is sufficient
  10. Save status + build report under {PROJ}/graph/
  11. Update {PROJ}/PROJECT_MANIFEST.json with graph readiness metadata, brainstorm bundle status, and `current_micro_stage: "graph_validated"`
  12. → proceed to FRONTIER_MAPPING
```

---

### Stage 0B · FRONTIER_MAPPING
**Owner:** Researcher
**Skills:** `/frontier-mapping`
**Inputs:** `{PROJ}/graph/PAPERNEXUS_STATUS.json`, shared global graph, `{PROJ}/researcher/PAPER_SOURCE_INDEX.json`, `{PROJ}/researcher/RESEARCH_BRAINSTORM.md`
**Outputs:**
- `{PROJ}/researcher/FRONTIER_REPORT.md` — candidate frontiers from the graph
- `{PROJ}/graph/LIMITATION_FRONTIER.md`, `{PROJ}/graph/CONTRADICTION_FRONTIER.md`, `{PROJ}/graph/TRANSFER_FRONTIER.md`, `{PROJ}/graph/COMPOSITION_FRONTIER.md`, `{PROJ}/graph/ANCHOR_INDEX.md` — graph query snapshots

```
Procedure:
  1. Run `query`, `research-brief`, `ideas`, and `brainstorm` / `brainstorm-brief` divergence against the shared global graph constrained by this project's selected papers
  1a. Prefer the brainstorm-quality node view (`brainstormEligible`, `brainstormScore`, `brainstormTier`) over the noisy raw full graph when choosing primary anchors
  2. For each promising anchor, run `context`, `impact`, and typed `path-trace` / `evidence-chain` when the anchor needs a more explicit logic path
  3. Extract at least four frontier lenses: limitation, contradiction, transfer, composition
  4. Save concrete graph anchors, relation patterns, plausible pilots, and falsifiers
  5. Package compact frontier prompts and graph frontier files for later idea divergence / convergence
  6. If literature changed materially since last graph build, or corpus status looks stale: return to GRAPH_BUILD first
  7. Update {PROJ}/PROJECT_MANIFEST.json with `current_micro_stage: "frontiers_packaged"`
  8. → proceed to IDEA
```

Before leaving FRONTIER_MAPPING, Researcher should trigger Lobster handoff only if `FRONTIER_REPORT.md` exists, the required frontier files under `graph/` exist (legacy `graph/subgraphs/` is still acceptable for older projects), the brainstorm pack is packaged, and no explicit refresh / rebuild / re-query loop remains open.

---

### Stage 1 · IDEA
**Owner:** Researcher  
**Skills:** `/idea-phase` → `/research-ideation` → IDEA-CATALYST sub-pipeline (`/idea-catalyst-decompose` → `/idea-catalyst-translate` → `/idea-catalyst-scout` → `/idea-catalyst-gatekeeper` → `/idea-catalyst-integrator` → `/idea-catalyst-judge`) → `/scientific-brainstorming` → `/innovation-reflection` (when due) → `/idea-generator` → `/novelty-check` → `/idea-tournament`  
**Inputs:** Research domain or topic (from user, or from memory), `{PROJ}/researcher/FRONTIER_REPORT.md`
**Outputs:**
- `{PROJ}/researcher/IDEA_REPORT.md` — top-ranked idea with novelty assessment
- `{PROJ}/researcher/IDEA_AUDIT.md` — duplicate-risk, evidence, retry, and isolation audit for active tracks
- `{PROJ}/researcher/INNOVATION_REFLECTION.md` — refreshed experiment-informed ideation constraints when prior experiments exist
- `{PROJ}/researcher/LITERATURE.md` — supporting literature
- `{PROJ}/researcher/IDEA_TOURNAMENT_STATE.json` — pilot scores (if tournament ran)
- `{PROJ}/researcher/ideation/GRAPH_IDEATION_PACKET.json` — graph-first ideation basis packet
- `{PROJ}/researcher/ideation/NOVELTY_TREE.md`, `CHALLENGE_INSIGHT_TREE.md`, `WELL_ESTABLISHED_SOLUTION_CHECK.md`
- `{PROJ}/researcher/ideation/CANDIDATE_POOL.json`, `TOURNAMENT_SCOREBOARD.json`, `TOP3_DIRECTION_SUMMARY.md`, `RESEARCH_PROPOSAL.md`
- `{PROJ}/TRACK_REGISTRY.json` — track portfolio with candidate / active / parked / killed decisions

```
Procedure:
  1. Confirm {PROJ}/researcher/FRONTIER_REPORT.md and the required frontier files under graph/ exist; if missing, go back to FRONTIER_MAPPING
  2. If experiment memory contains reflectable evidence and `innovation_reflection` is stale or missing, run /innovation-reflection before proposing a new track set
  3. Run /idea-phase as a graph-grounded dialectic loop, not a one-shot prompt brainstorm
  4. Use `/scientific-brainstorming` as a bounded divergence pass on top of the graph-grounded brainstorm bundle, then diverge 4–8 candidate tracks across the frontier lenses plus PaperNexus `ideas`, `brainstorm`, and `brainstorm-brief` outputs, preferring brainstorm-quality anchors over raw graph prominence
  5. Reuse `{PROJ}/researcher/INNOVATION_REFLECTION.md` as a negative-constraint and transfer-lesson packet whenever prior experiment evidence exists
  6. For each track, preserve a graph evidence packet:
     - anchor nodes / relations
     - why this matters
     - weakest assumption
     - one falsifier pilot
  7. Run attacker / novelty pass on each track
  8. Use a converge pass on the shortlist before locking the portfolio
  9. If interdisciplinary transfer is central to the candidate set, run IDEA-CATALYST as a formal IDEA sub-pipeline:
     - `/idea-catalyst-decompose`
     - `/idea-catalyst-translate`
     - `/idea-catalyst-scout`
     - `/idea-catalyst-gatekeeper`
     - if the gate passes: `/idea-catalyst-integrator` then `/idea-catalyst-judge`
     - if the gate emits a requisition: feed it back into ingestion / graph refresh before resuming IDEA
  10. If ≥2 tracks survive: run `/idea-tournament` with tree expansion, propose/review/refine, equal-weight Elo-style ranking, and top-3 summary
  11. Select the portfolio:
     - max 2 active tracks
     - max 1 parked track
     - all others merged or killed
  12. Update {PROJ}/TRACK_REGISTRY.json with explicit decisions, rationale, graph grounding, and which reflection lesson influenced each surviving track
  13. Write IDEA_AUDIT.md covering duplicate risk, closest prior work, evidence pointers, failure signatures, retry conditions, and experiment-informed reflection takeaways for each surviving track
  14. Update {PROJ}/PROJECT_MANIFEST.json with `active_track_ids`, `parked_track_ids`, `audit.idea_audit_path`, and `current_micro_stage: "portfolio_selected"`
  15. Select the current leading track → write IDEA_REPORT.md
  16. Run `research_workflow.materialize_ideation_contract` so workflow-owned code scaffolds GRAPH_IDEATION_PACKET, novelty tree, challenge-insight tree, solution check, scoreboard, top-3 summary, and research proposal from the current graph + brainstorm bundle
  17. Sync `ideation_contract` in PROJECT_MANIFEST.json through workflow tools so IDEA becomes a durable contract, not just a report
  18. If the literature set changed materially during ideation: refresh GRAPH_BUILD + FRONTIER_MAPPING before locking the idea
  19. → POST GATE-1
```

Before leaving IDEA, Researcher should trigger Lobster handoff only if `IDEA_REPORT.md`, `IDEA_AUDIT.md`, the required reasoning packets, and the narrowed active portfolio already exist, and there is no pending novelty / attacker / reflection retry.

---

## Continuous Research Loop (mandatory while other agents run)

Researcher should never become idle while the project is active.

When Orchestrator, Coder, Analyzer, Reviewer, or Writer are executing their own stage work, Researcher should keep doing one or more of:

- if `PROJECT_MANIFEST.json.idle_research.enabled = true` and the topic is due, run `/idle-research` for that exact topic before generic literature drift
- run `/papers-cool` keyword and venue sweeps for newly relevant work, and optionally `/pasa-paper-search` as a second retrieval source when it is responsive
- ingest newly found key papers via `/hugging-face-paper-pages`, then `/arxiv2md`, and only then `/papers-cool` PDF fallback into the PaperNexus source tree
- prepare a graph refresh if the literature frontier changed materially
- analyze innovation deltas with the current track portfolio and discuss novelty / composition opportunities with the relevant sub-agent
- keep the `paper_source_dir` canonical and deduplicated; do not let duplicate downloads masquerade as new literature
- reconcile newly completed experiments into `{PROJ}/researcher/EXPERIMENT_LEDGER.json` and, when possible, mirror high-value experiment details into PaperNexus
- when new experiment evidence materially changes future ideation, queue or run `/innovation-reflection` before the next track rewrite
- if paper inflow becomes steady, keep `papernexus watch` alive and let `/resume-pipeline` reconcile it after restarts

This continuous loop must not silently change the active track set or overwrite the current experiment plan. Any material portfolio change still requires an explicit track decision and state update.

---

## Idle Research Contract (mandatory while waiting)

`PROJECT_MANIFEST.json.idle_research` is the authoritative background-topic contract for Researcher.

When `idle_research.enabled = true`, Researcher must treat it as a bounded queue, not as a vague reminder:

1. Read the current state via `research_workflow.get_idle_research` before starting a round.
2. If the round is not due yet, do not rerun it early unless the user explicitly overrides the cooldown.
3. If the round is due, prefer `/idle-research` on `idle_research.topic` over ad hoc literature browsing.
4. Respect `max_papers_per_cycle`, `cooldown_minutes`, `query_seeds`, and `preferred_venues`.
5. Use the required acquisition order:
   - `/papers-cool` for guaranteed search and venue sweep
   - `/pasa-paper-search` as optional supplementary search; merge results when it succeeds
   - `/hugging-face-paper-pages` for full-paper Markdown
   - `/arxiv2md` as the second markdown source for arXiv papers
   - `/papers-cool` PDF fallback only when both markdown sources are unavailable
6. Save the round digest under `{PROJ}/researcher/idle-research/ROUND-YYYY-MM-DD_HHMM.md`.
7. Record the runtime outcome through `research_workflow.record_idle_research_run`, including `last_run_at`, `last_digest_path`, `status`, canonical-paper counts, and any graph-refresh follow-up.
8. If the round discovers new core papers and `refresh_graph_on_new_core_papers = true`, mark graph refresh as required before the next novelty, ideation, or revision decision.

Idle research must not silently:

- change the active track set
- rewrite `PLAN.md`
- launch experiments
- treat abstract-only evidence as enough for innovation claims

---

## Background Duty Matrix (mandatory while waiting)

When an agent is blocked on another agent or a human gate, it should not invent a new stage. It should either perform bounded background work inside its own role or stay idle by design.

| Agent | Allowed background work while waiting | Forbidden during background mode |
|-------|--------------------------------------|----------------------------------|
| Researcher | idle-research topic loop, literature watch, full-text ingestion, graph refresh prep, graph-grounded reflection, memory consolidation, experiment-ledger reconciliation, PaperNexus experiment sync, queue triage | silently changing active tracks, running generic literature drift when `idle_research` is enabled and due, rewriting plan, changing claims without state update |
| Orchestrator | plan stress-test, compute what-if analysis, fallback trees, risk register, graph-backed innovation tightening | launching code, changing active track ownership, mutating another agent's files |
| Coder | smoke tests, reproducibility hardening, launcher templates, environment snapshots, baseline harness cleanup | literature survey as the primary owner, changing research scope, launching unassigned experiments |
| Analyzer | partial-result QC, figure/table scaffolds, claim extraction, graph reflection summaries, anomaly triage | running new experiments, rewriting the plan, promoting unsupported claims |
| Academic Writer | citation queue, related-work packet, outline polish, rebuttal prep, wording downgrades for weak claims | inventing new claims, changing figures, silently broadening scope |
| Reviewer | rubric refinement, external review polling, rebuttal issue clustering, generic review memory updates | proactive project browsing without a review packet, code execution, hidden collaboration with Researcher context |
| Cross-Reviewer | none by default; stateless on-demand review only | any proactive background work or persistent project memory |

If there is no safe bounded background task for the current agent, the correct behavior is to wait rather than drift.

---

### ◆ GATE-1 · Idea Approval
**Type:** OPTIONAL (skipped if AUTO_PROCEED=true)

```
## ⏸ GATE-1: Idea Ready for Review

**Project:** {proj-id}
**Leading track:** {track-id} — {one-sentence summary}
**Active tracks:** {track_a, track_b}
**Parked tracks:** {track_c or none}
**Frontier lens:** {limitation / contradiction / transfer / composition}
**Graph anchors:** {key nodes / relations}
**Novelty score:** {X}/10
**Closest prior work:** {paper title, year}
**Estimated compute:** {N} GPU-hours
**Pilot result (if tournament ran):** {metric: value}

Key outputs:
  → {PROJ}/researcher/IDEA_REPORT.md
  → {PROJ}/researcher/LITERATURE.md
  → {PROJ}/researcher/FRONTIER_REPORT.md
  → {PROJ}/TRACK_REGISTRY.json

Options:
  [continue]          — approve active tracks, proceed to planning
  [reject: <reason>]  — discard current leading track, revisit portfolio
  [modify: <notes>]   — change track portfolio (merge / park / activate)
  [stop]              — pause pipeline here

Waiting for response... (auto-continue in {GATE_TIMEOUT_HOURS}h if no reply)
```

---

### Stage 2 · PLAN
**Owner:** Orchestrator (spawned by Researcher via `sessions_spawn`)  
**Skills:** `/plan-research`  
**Inputs:** `{PROJ}/researcher/IDEA_REPORT.md`, `{PROJ}/TRACK_REGISTRY.json`
**Outputs:**
- `{PROJ}/orchestrator/PLAN.md` — full experiment plan
- `{PROJ}/orchestrator/TODOS.md` — task checklist
- `{PROJ}/orchestrator/PLAN_AUDIT.md` — plan-side audit of controls, baselines, reproducibility, and stop rules

**Completion signal (required before leaving this stage):** `{PROJ}/orchestrator/PLAN.md`, `{PROJ}/orchestrator/TODOS.md`, and `{PROJ}/orchestrator/PLAN_AUDIT.md` must exist and be non-empty. Do not advance to CODE or write `GATE_STATE.json` with `current_stage: "CODE"` until all three files exist.

**Wake Orchestrator on demand:** Whenever PLAN or TODOS are missing (e.g. before entering CODE, or on resume when `current_stage` is CODE but `orchestrator/` is empty), Researcher must **proactively spawn (wake)** the Orchestrator agent with instruction to run `/plan-research`, and wait for both files before proceeding. Do not skip this step or assume someone else will run Orchestrator.

```
Procedure:
  1. Researcher spawns Orchestrator with clear instruction:
     "Run /plan-research using {PROJ}/researcher/IDEA_REPORT.md and {PROJ}/TRACK_REGISTRY.json. Write PLAN.md and TODOS.md to {PROJ}/orchestrator/."
  2. Wait for Orchestrator to complete:
     - Option A: Wait for Orchestrator session to return/finish.
     - Option B: Poll until both {PROJ}/orchestrator/PLAN.md and {PROJ}/orchestrator/TODOS.md exist (e.g. every 30s, max 10 min).
  3. If after timeout both files are still missing: re-spawn Orchestrator with same instruction; do not advance to CODE.
  4. Once both files exist: Researcher reads PLAN.md and validates:
     - one plan section per active track
     - compute budget per track
     - stop / rollback / kill rules per track
  5. Require PLAN_AUDIT.md to confirm baseline coverage, controls, seed policy, rollback triggers, and leakage checks
  6. Update {PROJ}/PROJECT_MANIFEST.json with `audit.plan_audit_path` and `current_micro_stage: "plan_audited"`
  7. → POST GATE-2 (or if AUTO_PROCEED=true, log to GATES_LOG.md and set current_stage=CODE only after step 5).
```

When PLAN is complete and the project is truly ready to move into CODE, Orchestrator should trigger Lobster handoff. If PLAN is sent back for narrowing, budgeting, or audit fixes, remain in PLAN and do not hand off.

---

### ◆ GATE-2 · Plan Approval
**Type:** OPTIONAL (human wait skipped if AUTO_PROCEED=true).  
**Stage work is never skipped:** PLAN stage (Orchestrator producing PLAN.md + TODOS.md) must complete before you may advance to CODE or write `current_stage: "CODE"` in GATE_STATE.json.

```
## ⏸ GATE-2: Experiment Plan Ready

**Project:** {proj-id}
**Plan summary:** {2-3 sentence description}
**Active tracks planned:** {track_a, track_b}
**Experiments defined:** {N}
**GPU estimate:** {N} hours across {N} GPUs
**Per-track budget:** {track_a: Xh, track_b: Yh}
**Key baselines:** {list}
**Track stop rules:** {brief summary}

Key outputs:
  → {PROJ}/orchestrator/PLAN.md
  → {PROJ}/orchestrator/TODOS.md

Options:
  [continue]          — approve plan, start coding
  [revise: <notes>]   — send back to Orchestrator with feedback
  [stop]              — pause here

Waiting for response...
```

Researcher should trigger Lobster handoff only when EXPERIMENT has produced the required durable outputs and the track decision is to proceed into ANALYZE. If the result requires more experiments, bounded relaunch, or `restart-idea`, stay in EXPERIMENT or roll back explicitly instead of handing off forward.

---

### Stage 3 · CODE
**Owner:** Coder (spawned by Researcher via `sessions_spawn`)
**Skills:** `/implement-experiment`, `/scientific-visualization`, `/github-download`, `/resume-pipeline`
**Inputs:** `{PROJ}/orchestrator/PLAN.md`, `{PROJ}/TRACK_REGISTRY.json`
**Outputs:**
- `{PROJ}/coder/{experiment-name}/` — runnable code
- `{PROJ}/coder/{experiment-name}/README.md` — setup + run instructions
- `{PROJ}/coder/experiments/<track-id>/<experiment-id>__<slug>/EXPERIMENT_MANIFEST.json` — baseline-grounded experiment contract
- `{PROJ}/planner/EXPERIMENT_SEARCH_SPEC.json` — approved search envelope when coder-side local search is allowed
- `{PROJ}/coder/experiments/<track-id>/<experiment-id>__<slug>/SEARCH_STATE.json` — search-session runtime memory when coder-side local search is allowed

**Precondition (mandatory):** Before spawning Coder, both `{PROJ}/orchestrator/PLAN.md` and `{PROJ}/orchestrator/TODOS.md` must exist. If either is missing, do **not** spawn Coder; go back to Stage 2 (PLAN), spawn Orchestrator, and wait for both files to be written.

```
Procedure:
  1. Verify PLAN.md and TODOS.md exist under {PROJ}/orchestrator/. If not → run Stage 2 (PLAN) first.
  2. Researcher spawns Coder with path to PLAN.md and the active track set
  3. Coder runs /implement-experiment for the highest-priority active track first
  3a. Coder treats dataset paths as read-only and writes any preprocessing outputs, caches, or converted artifacts under {PROJ}/coder/{experiment-name}/ or remote scratch/results, never back into dataset roots
  3b. Every experiment bundle must encode the active track contract in `EXPERIMENT_MANIFEST.json`: `track_id`, `question`, `hypothesis`, and `novelty_basis` must match the active innovation track before coding can be considered handoff-ready
  3c. The manifest must also declare the baseline contract: `baseline_reference`, `primary_baseline_metric`, `target_improvement`, `baseline_training_protocol`, `baseline_eval_protocol`, `innovation_points`, `validation_steps`, and `ablation_plan`
  3d. Validation must stay incremental: every innovation point must be covered by at least one validation step or ablation instead of hiding multiple novelties in one opaque run
  3e. Unless the manifest explicitly documents an allowed deviation, Coder must preserve the baseline training setup and evaluation method
  3f. If coder-side search is enabled, Coder must initialize git lineage explicitly: incumbent branch, base commit, search-state path, and promotion policy must be visible before EXPERIMENT can safely recurse
  4. Coder marks TODOS.md item as complete
  5. Coder does local dry-run validation and reports the launch command
  5a. If quick sanity-check figures or baseline-vs-proposed plots would reduce implementation risk, Coder may use `/scientific-visualization` under `{PROJ}/coder/.../figures/` before handoff
  6. If validation fails → Coder fixes
  7. In aggressive mode, CODE cannot advance until the automatic multi-agent code innovation review approves the packet:
     - Researcher checks innovation alignment and baseline-centered metric targeting
     - Orchestrator checks that validation_steps / ablation_plan can verify each innovation sub-point step by step
     - Reviewer checks execution faithfulness, baseline protocol fidelity, and eval-method consistency
  8. When multiple active tracks exist, only implement the next track if budget remains justified by the plan
  9. → proceed to EXPERIMENT only after the bundle is runnable and the CODE review gate is satisfied
```

When CODE is complete and the required experiment bundle exists, Coder should trigger Lobster handoff. If dry-run, reproducibility, or implementation review still requires fixes, remain in CODE and do not hand off.

---

### Stage 4 · EXPERIMENT
**Owner:** Researcher
**Skills:** `/experiment-phase` → reviewed-auto prelaunch review (`/experiment-plan`, `/experiment-design-review`, `/experiment-attack`) → spawned Coder `/run-experiment` or `/search-experiment` → `/monitor-experiment`
**Inputs:** `{PROJ}/coder/{experiment-name}/`, `{PROJ}/orchestrator/PLAN.md`  
**Outputs:**
- `{PROJ}/researcher/artifacts/results/` — raw results
- `{PROJ}/researcher/EXPERIMENT_LEDGER.json` — restart-safe structured experiment memory
- `{PROJ}/researcher/EXPERIMENT_REGISTRY.md` — run status
- updated `{PROJ}/TRACK_REGISTRY.json` — track evidence status and decision
- when `autonomous_execution.experiment_launch_mode = reviewed_auto`:
  - `{PROJ}/planner/EXPERIMENT_REVIEW_PACKET.json`
  - `{PROJ}/planner/EXPERIMENT_PLAN.md`
  - `{PROJ}/analyzer/EXPERIMENT_REASONABLENESS_REPORT.md`
  - `{PROJ}/cross-reviewer/EXPERIMENT_ATTACK_REPORT.md`
  - `{PROJ}/researcher/EXPERIMENT_LAUNCH_DECISION.json`

```
Procedure:
  1. Researcher builds the dispatch plan and allocates GPU slots
  2. If reviewed-auto launch is enabled and no runs exist yet, execute the experiment micro-stage loop first:
     - `planning`: Planner assembles the bounded launch packet
     - `analyzer_review`: Analyzer checks attribution purity, baseline fairness, metric sufficiency, stop rules, and artifact completeness
     - `cross_review`: Cross-Reviewer stress-tests confounds, falsifiers, novelty risk, cherry-picking risk, and launch-worthiness
     - `synthesis`: Researcher records launch approval or revision requirements in `researcher/EXPERIMENT_LAUNCH_DECISION.json`
     - only approved packets may proceed to Coder launch
  3. For each active track, decide whether this round is:
     - pilot execution
     - full experiment
     - repair experiment
  4. Dispatch experiments (use /parallel-experiments if N>1; per-bundle launch is assigned to Coder via /run-experiment)
     - in reviewed-auto mode, Coder must launch strictly from the approved planner packet fingerprint and launch decision
     - if the approved packet also includes a bounded search envelope, prefer delegating the inner loop to Coder via `/search-experiment` instead of hand-queuing each micro-candidate
     - inside `/search-experiment`, candidate worktree creation plus promote/discard branch actions must be requested through workflow review tools and may execute only after planner + analyzer + cross-reviewer approve the git action
  5. Monitor with /monitor-experiment
     - once remote runs exist, this becomes the default experiment-stage heartbeat
     - auto mode should keep re-entering `/monitor-experiment` on bounded passes until the remote runs are terminal and the result bundle is analysis-ready
  6. On completion: collect results to artifacts/results/
  7. Update EXPERIMENT_REGISTRY.md
  8. After every meaningful checkpoint (queued, launched, running, done, failed, decision made), upsert `{PROJ}/researcher/EXPERIMENT_LEDGER.json` with:
     - experiment id / track id / kind
     - config reference, screen name, server, GPU
     - status, checkpoint stage, metrics, result pointers
     - failure signature or decision (`advance` / `merge` / `park` / `kill`)
     - `papernexus_sync.status`
  9. Mirror the latest experiment-memory summary into `{PROJ}/PROJECT_MANIFEST.json.experiment_memory`
     - reviewed promote/discard actions should trigger this through workflow-owned ledger + memory materialization, not ad hoc manual edits
  10. If the project has a PaperNexus corpus, use idle time or post-run reconciliation to sync important experiment details into PaperNexus and mark sync status in the ledger
      - sync the distilled retained-vs-discarded experiment memory, not raw logs
  11. Mark `{PROJ}/PROJECT_MANIFEST.json.innovation_reflection` as pending whenever the latest experiment evidence changes future ideation assumptions
  12. Run a track decision pass:
     - `advance`
     - `merge`
     - `park`
     - `kill`
  13. Update {PROJ}/TRACK_REGISTRY.json and {PROJ}/PROJECT_MANIFEST.json with the new decision
  14. Set `current_micro_stage: "experiment_memory_synced"` only after registry, ledger, manifest summary, and innovation-reflection freshness state agree
     - and only after `experiment_search` is honestly `ready_for_analysis` rather than merely "training finished"
  15. → POST GATE-3
```

---

### ◆ GATE-3 · Results Review
**Type:** OPTIONAL (skipped if AUTO_PROCEED=true)

```
## ⏸ GATE-3: Experiment Results Ready

**Project:** {proj-id}
**Experiments completed:** {N}/{N}
**Key metric:** {metric name}: {value} (baseline: {baseline_value})
**Improvement:** {+/- X%}
**Status:** {promising / marginal / negative}
**Track decisions:** {track_a: advance, track_b: park}

Key outputs:
  → {PROJ}/researcher/artifacts/results/
  → {PROJ}/researcher/EXPERIMENT_LEDGER.json
  → {PROJ}/researcher/EXPERIMENT_REGISTRY.md
  → {PROJ}/TRACK_REGISTRY.json

Options:
  [continue]               — proceed to analysis and writing
  [more-experiments: <idea>] — run additional ablations/baselines
  [restart-idea]           — results too negative, return to IDEA stage / portfolio selection
  [stop]                   — pause here

Waiting for response...
```

---

### Stage 5 · ANALYZE
**Owner:** Analyzer (spawned by Researcher)  
**Skills:** `/analyze-results`, `/theory-phase`, `/scientific-figures`  
**Inputs:** `{PROJ}/researcher/artifacts/results/`  
**Outputs:**
- `{PROJ}/analyzer/NARRATIVE_REPORT.md` — findings narrative
- `{PROJ}/analyzer/CLAIM_EVIDENCE_MATRIX.md` — claim-by-claim support status
- `{PROJ}/analyzer/TRACK_VERDICTS.md` — per-track advance / merge / park / kill recommendations
- `{PROJ}/analyzer/UNSUPPORTED_CLAIMS.md` — claims that must be downgraded or removed
- `{PROJ}/analyzer/QUALITY_AUDIT.md` — audit of seeds, controls, anomaly handling, artifact completeness, and unsupported claims
- `{PROJ}/analyzer/THEORY_SUPPORT_NOTE.md` — rough theory / mechanism support memo with `green` / `red` signal
- `{PROJ}/analyzer/THEORY_STATE.json` — structured theorem / lemma candidate state
- `{PROJ}/analyzer/proof-packets/` — theorem / lemma / proposition proof packets for Writer and appendix planning
- `{PROJ}/academic_writer/THEORY_APPENDIX_PLAN.md` — generated appendix planning scaffold derived from packets
- `{PROJ}/academic_writer/paper/sections/appendix_theory.tex` — generated appendix derivation draft derived from packets
- `{PROJ}/analyzer/figures/` — publication-ready figures
- `{PROJ}/analyzer/tables/` — result tables

```
Procedure:
  1. Researcher spawns Analyzer with results path
  2. Analyzer runs /analyze-results → metrics, figures, tables
  3. Analyzer writes NARRATIVE_REPORT.md
  4. Analyzer builds CLAIM_EVIDENCE_MATRIX.md and UNSUPPORTED_CLAIMS.md
  5. Analyzer writes TRACK_VERDICTS.md
  6. Analyzer writes QUALITY_AUDIT.md covering seed count, CI/error bars, baseline coverage, anomalies, artifact completeness, and residual risks
  7. Analyzer writes THEORY_SUPPORT_NOTE.md with a rough `green` / `red` theory signal
  8. Analyzer runs /theory-phase so theory candidates become THEORY_STATE.json + proof-packets/ + THEORY_APPENDIX_PLAN.md + appendix_theory.tex
  9. Analyzer calls `research_workflow.materialize_paper_story_state` so claim support counts, track verdict hooks, and unsupported-claim hooks are mirrored into the durable story contract
  10. → proceed to REVIEW (no gate — analysis is internal)
```

When ANALYZE artifacts are complete and the current decision is to move into REVIEW, Analyzer should trigger Lobster handoff. If analysis uncovered unsupported central claims that require more experiments or a return to EXPERIMENT, do not hand off forward.

---

### Stage 6 · REVIEW (Internal)
**Owner:** Reviewer (invoked by Researcher via `sessions_send`)  
**Skills:** `/review-phase`, `/scientific-critical-thinking`, `/scholar-evaluation`, `/peer-review`, `/evidence-grading`, `/citation-integrity-gate`  
**Inputs:** `{PROJ}/analyzer/NARRATIVE_REPORT.md`, `{PROJ}/analyzer/CLAIM_EVIDENCE_MATRIX.md`, `{PROJ}/analyzer/TRACK_VERDICTS.md`, `{PROJ}/analyzer/UNSUPPORTED_CLAIMS.md`, `{PROJ}/analyzer/THEORY_SUPPORT_NOTE.md`, `{PROJ}/CLAIM_POLICY.md`, `{PROJ}/researcher/artifacts/`
**Outputs:**
- `{PROJ}/reviewer/REVIEW_REPORT.md` — structured review
- `{PROJ}/reviewer/story-pressure/REJECT_FIRST_REVIEW.md`, `NOVELTY_ATTACK.md`, `UNSUPPORTED_CLAIM_AUDIT.md`, `REVERSE_OUTLINE.md`, `FIGURE_TABLE_QC.md`, `LIMITATION_AUDIT.md`
- `{PROJ}/researcher/REVIEW_STATE.json` — review loop state

```
Procedure:
  1. Researcher invokes Reviewer with NARRATIVE_REPORT.md + claim matrix + track verdicts + theory support note
  2. Reviewer uses `/scientific-critical-thinking` for rigor / bias / protocol defects, `/scholar-evaluation` for structured dimension scoring, and `/peer-review` for the integrated reviewer voice
  3. Reviewer scores: Soundness, Significance, Reproducibility, Claim Support Coverage, Scope Discipline, Publishability
  4. Reviewer also emits an advisory theory signal (`green` / `red`) for later writing
  5. If score < 6/10 or any primary claim is UNSUPPORTED → flag specific weak points
  6. If the work is already paper-worthy but missing polish, prefer scope narrowing over more experiments
  7. If theory signal is `red`, carry it forward to WRITE; do not block draft generation
  8. Researcher addresses weak points (re-experiment, downgrade claims, clarify, or stop a weak track)
  9. Loop max 3 rounds
  10. Reviewer first calls `research_workflow.materialize_review_pressure_packet`, then persists any bounded follow-up edits through workflow tools so WRITE can treat the packet as a hard gate
  11. This is not the final publication-facing review. A compiled PDF must still go through Stage 8 external AI review via `/paperreview-submit`.
  12. → proceed to WRITE
```

Reviewer should trigger Lobster handoff only when the internal review loop is actually complete and the project is ready to enter WRITE. If review requests more experiments, narrower scope, or additional fixes, remain in REVIEW or send the project backward according to the gate result.

---

### Stage 7 · WRITE
**Owner:** Academic Writer (spawned by Researcher)  
**Skills:** `/paper-plan`, `/citation-management`, `/venue-templates`, `/paper-write`, `/citation-preflight`, `/paper-compile`, `/ai-research-prompt`, `/research-paper-writing`  
**Inputs:** `{PROJ}/analyzer/NARRATIVE_REPORT.md`, `{PROJ}/analyzer/CLAIM_EVIDENCE_MATRIX.md`, `{PROJ}/analyzer/TRACK_VERDICTS.md`, `{PROJ}/analyzer/UNSUPPORTED_CLAIMS.md`, `{PROJ}/analyzer/THEORY_SUPPORT_NOTE.md`, `{PROJ}/analyzer/THEORY_STATE.json`, `{PROJ}/analyzer/proof-packets/`, `{PROJ}/academic_writer/THEORY_APPENDIX_PLAN.md`, `{PROJ}/academic_writer/paper/sections/appendix_theory.tex`, `{PROJ}/researcher/ZOTERO_PACKET.md`, `{PROJ}/CLAIM_POLICY.md`, `{PROJ}/analyzer/figures/`, and `{PROJ}/PROJECT_MANIFEST.json.writing_contract`
**Outputs:**
- `{PROJ}/academic_writer/PAPER_PLAN.md` — paper outline
- `{PROJ}/academic_writer/STORYLINE_SKETCH.md` — rough paper thesis and evidence spine
- `{PROJ}/academic_writer/THEORY_APPENDIX_PLAN.md` — proof / derivation plan for appendix-only detail
- `{PROJ}/academic_writer/story/` — durable story contract (`TASK_SUMMARY.md`, `CHALLENGE_STATEMENT.md`, `INSIGHT_SUMMARY.md`, `CONTRIBUTION_MAP.md`, `ADVANTAGE_MAP.md`, `STORY_SPINE.md`, `PIPELINE_FIGURE_SKETCH.md`, `MODULE_MOTIVATION_MAP.md`, `CLAIM_TO_EXPERIMENT_MAP.md`, `FALLBACK_NARRATIVE.md`, `REJECTION_RISK_TABLE.md`)
- `{PROJ}/academic_writer/paper/sections/appendix_theory.tex` — appendix derivation draft generated from proof packets
- `{PROJ}/academic_writer/TEMPLATE_MAPPING.md` — how the user template maps onto this paper's outline and section order
- `{PROJ}/academic_writer/WRITING_SIGNALS.md` — `green` / `red` writing advisory for theory, storyline, paragraph logic
- `{PROJ}/academic_writer/paper/sections/` — individual section drafts
- `{PROJ}/academic_writer/paper/main.pdf` — compiled PDF

```
Procedure:
  1. Researcher spawns Academic Writer with narrative report + claim matrix + track verdicts + theory support note + figures path
  2. Writer reads `PROJECT_MANIFEST.json.writing_contract`; if a user template is configured, Writer must read the project-local copied template before any outline or prose drafting
  3. Writer runs /paper-plan and `/venue-templates` to lock template / section / page-budget constraints, then updates PAPER_PLAN.md + STORYLINE_SKETCH.md + THEORY_APPENDIX_PLAN.md + TEMPLATE_MAPPING.md + initial WRITING_SIGNALS.md
  3a. Writer calls `research_workflow.materialize_paper_story_state` so the durable story packet is scaffolded from ideation / graph-backed evidence before large drafting passes
  4. Writer limits the paper to active / winning tracks only
  5. Writer removes or downgrades unsupported primary claims before prose drafting
  5a. Writer reads the durable story packet under `academic_writer/story/` and the reviewer story-pressure packet under `reviewer/story-pressure/` before drafting core sections
  6. If theory or storyline signal is `red`, Writer still continues but marks the risky sections for human review
  7. Cross-Reviewer checks outline (sessions_send, Outline Mode)
     → saved to {PROJ}/cross-reviewer/outline/{date}.md
  8. Writer runs /paper-write section by section, starts from the generated THEORY_APPENDIX_PLAN.md + appendix_theory.tex, keeps theorem / lemma statements concise in the body, and pushes detailed derivations to the appendix path from `writing_contract`
  9. For each section, Writer performs a reverse-outline pass and paragraph transition audit before treating the section as stable
  10. Writer uses `/citation-management` to pull the paper queue from Zotero `<zoteroProjectPath>/writing-shortlist`, then runs /citation-preflight to verify refs.bib against real metadata sources and remove or downgrade suspicious references before reviewer-side citation verification
  11. Final paper section order must follow `writing_contract.section_order` / `TEMPLATE_MAPPING.md` when a user template is configured
  12. Cross-Reviewer checks each section (Prose Mode)
  13. Sync `paper_story_state` in PROJECT_MANIFEST.json through workflow tools before draft completion; use `materialize_paper_story_state` for scaffold and `set_paper_story_state` only for bounded patches
  14. Writer runs /paper-compile → main.pdf
  15. → POST GATE-4
```

Academic Writer should trigger Lobster handoff only when WRITE is complete and the recommendation is to move into SUBMIT. If Cross-Reviewer, Reviewer, or the user requests another writing revision pass, remain in WRITE and do not hand off forward.

---

### ◆ GATE-4 · Paper Ready for Submission Review
**Type:** OPTIONAL (skipped if AUTO_PROCEED=true)

```
## ⏸ GATE-4: Paper Draft Complete

**Project:** {proj-id}
**Title:** {paper title}
**Sections:** Abstract, Introduction, Related Work, Method, Experiments, Conclusion
**Cross-review score:** {X}/10 (Novelty: X, Clarity: X, Soundness: X)
**Primary claims supported:** {X}/{Y}
**Included tracks:** {track_a only / track_a + track_b}
**Advisory signals:** theory={green/red}, storyline={green/red}, paragraph_logic={green/red}
**PDF:** {PROJ}/academic_writer/paper/main.pdf

Key outputs:
  → {PROJ}/academic_writer/paper/main.pdf
  → {PROJ}/academic_writer/PAPER_PLAN.md
  → {PROJ}/academic_writer/WRITING_SIGNALS.md

Options:
  [submit]             — continue to the mandatory external AI review stage
  [revise: <section>]  — send specific section back to Writer
  [stop]               — pause here (user reads PDF first)

Waiting for response...
```

---

### Stage 8 · SUBMIT & EXTERNAL REVIEW
**Owner:** Reviewer  
**Skills:** `/citation-integrity-gate`, `/paperreview-submit`, `/review-response`  
**Inputs:** `{PROJ}/academic_writer/paper/main.pdf`  
**Outputs:**
- `{PROJ}/reviewer/external_review_{date}.md` — AI reviewer feedback
- `{PROJ}/reviewer/rebuttal_{date}.md` — draft rebuttal (if needed)

```
Procedure:
  1. This stage is mandatory for every paper-ready draft. Do not skip it when `main.pdf` exists.
  2. Reviewer first runs /citation-integrity-gate and writes reviewer/CITATION_VERIFICATION.md
  3. If citation verification is not `verified`, return to WRITE and do not submit
  4. Reviewer submits PDF to paperreview.ai via /paperreview-submit
  5. Polls for results (auto-retry every 5 min, max 2h)
  6. Saves structured review to external_review_{date}.md
  7. Runs /review-response to draft rebuttal
  8. Record submission metadata and latest external review status in {PROJ}/researcher/GATE_STATE.json or project state
  9. → POST GATE-5
```

---

### ◆ GATE-5 · Revision Decision
**Type:** REQUIRED (always pause — human must decide revision scope)

```
## ⏸ GATE-5 [REQUIRED]: External Review Received

**Project:** {proj-id}
**Review source:** paperreview.ai (Stanford Agentic Reviewer)
**Overall score:** {X}/10
**Main concerns:**
  1. {concern 1}
  2. {concern 2}
  3. {concern 3}
**Rebuttal draft:** {PROJ}/reviewer/rebuttal_{date}.md

Options:
  [major-revision]     — return to EXPERIMENT stage with reviewer notes
  [minor-revision]     — return to WRITE stage with specific sections to fix
  [accept-as-is]       — mark project complete, archive
  [stop]               — pause for human to read review carefully

⚠ This gate is REQUIRED — always waits for human response regardless of AUTO_PROCEED.
```

---

### Stage 9 · REVISE
**Owner:** Researcher (orchestrates revision)

```
Procedure:
  1. Classify revision type from GATE-5 response:
     - major → loop back to EXPERIMENT (Stage 4)
     - minor → loop back to WRITE (Stage 7) with section notes
  2. Update {PROJECTS_ROOT}/PROJECTS_STATE.json: stage → "revise"
  3. Increment revision counter in project dir (rev_1/, rev_2/, ...)
  4. Resume pipeline from target stage
```

---

### Stage 10 · DONE
**Owner:** Researcher

```
Procedure:
  1. Archive project: compress {PROJ}/ → {WS}/archive/{proj-id}_{date}.tar.gz
  2. Update {PROJECTS_ROOT}/PROJECTS_STATE.json: status → "completed"
  3. Distill learnings → {PROJ}/memory/ideation-memory.md, experiment-memory.md
  4. Record why each non-winning track was parked / killed
  5. If PROJECT_MODE=queue: load next project from queue → Stage 0
  6. If PROJECT_MODE=single: post completion summary, await new instruction
```

---

## Gate State File

The researcher persists gate state to allow resuming after session restart:

```json
// {PROJ}/researcher/GATE_STATE.json
{
  "current_stage": "EXPERIMENT",
  "last_gate": "GATE-2",
  "gate_status": "approved",
  "gate_timestamp": "2026-03-16T10:00:00Z",
  "auto_proceed": false,
  "revision_count": 0,
  "notes": "User asked to add ablation on learning rate"
}
```

On session restart: the owning agent should run `/resume-pipeline`, re-read durable state, and reconcile artifacts before doing new work. Researcher uses `GATE_STATE.json` + `PROJECT_MANIFEST.json` as the top-level source of truth, but must cross-check them against `{PROJ}/researcher/EXPERIMENT_LEDGER.json` before trusting remembered experiment history.

---

## Stop / Rollback / Kill Rules

The workflow must prefer explicit decisions over drift.

| Situation | Required action |
|-----------|-----------------|
| No track survives novelty / attacker pass | Roll back to FRONTIER_MAPPING or regenerate tracks |
| More than 2 tracks remain attractive after pilots | Park all but the top 2 by evidence-adjusted value |
| A track exceeds its budget without strong positive evidence | Park or kill the track |
| A primary claim becomes `UNSUPPORTED` | Roll back to ANALYZE, REVIEW, or EXPERIMENT before further writing |
| Review says "paper-worthy but too broad" | Narrow scope instead of adding new weak experiments |
| Two tracks converge to the same mechanism or contribution | Merge them and pick a primary narrative owner |
| Results are negative but informative | Kill the track, log failure mode to memory, and preserve artifacts |

---

## Autonomous Mode (AUTO_PROCEED=true)

When `AUTO_PROCEED=true`, the pipeline behaves like `autoresearch/program.md` **except**:

- Stage reconciliation is performed by the plugin-backed auto iterator: on heartbeat, bootstrap, and explicit recovery turns, Researcher should call `research_workflow.auto_iterator_tick` first so stage rollback / advance / owner routing / `PROJECTS_STATE.json` sync happen deterministically instead of relying only on prompt memory.
- Graph grounding is mandatory for every new project: do not skip GRAPH_BUILD or FRONTIER_MAPPING before ideation.
- The active track limit still applies: do not silently let 4–5 tracks continue consuming budget.
- **Stage order and completion signals are still mandatory.** You must not skip the Orchestrator (PLAN) stage: always spawn Orchestrator, wait for `PLAN.md` and `TODOS.md` to exist, then advance to CODE. Same for all other stage transitions — see "Stage transition preconditions" above.
- External AI review is mandatory once `main.pdf` exists: always run Stage 8 `/paperreview-submit` before a project can reach DONE.
- All **optional** gates (GATE-1, GATE-2, GATE-3, GATE-4) are skipped in the sense of "no human wait": researcher logs the gate message to `{PROJ}/researcher/GATES_LOG.md` and auto-continues. The **work** of each stage (e.g. Orchestrator producing PLAN) is never skipped.
- GATE-5 (revision decision) is **always required** — the one mandatory human checkpoint.
- Researcher loops: DONE → picks next project from queue (if queue mode) or repeats with new idea.
- Human can interrupt at any time by sending a message; researcher acknowledges and pauses after current stage completes.

```
LOOP FOREVER (when AUTO_PROCEED=true):
  GRAPH_BUILD → FRONTIER_MAPPING → IDEA → [wait for IDEA_REPORT] → PLAN → [spawn Orchestrator, wait for PLAN.md+TODOS.md] → CODE → ...
    → if major revision: back to EXPERIMENT
    → if minor revision: back to WRITE
    → if done: next project or new idea
    → GATE-5 always pauses for human decision
```

---

## Error Recovery

| Failure | Recovery |
|---------|---------|
| Too many active tracks | Park lower-value tracks until only 1–2 remain active |
| Budget overrun on weak evidence | Trigger `/research-reflect`, then park or kill the weakest track |
| Shared PaperNexus graph missing/stale | Re-run `/graph-build`, refresh `{PROJ}/graph/PAPERNEXUS_STATUS.json`, confirm shared-graph status, then rerun `/frontier-mapping` before allowing IDEA to continue |
| **Orchestrator skipped / PLAN.md or TODOS.md missing** | **Wake Orchestrator:** spawn Orchestrator with "Run /plan-research using {PROJ}/researcher/IDEA_REPORT.md; write PLAN.md and TODOS.md to {PROJ}/orchestrator/." Wait until both files exist. Optionally set `current_stage` back to PLAN first; then re-advance to CODE. Do not spawn Coder until both files exist. |
| Experiment crash (OOM/bug) | Fix code → re-run; after 3 failures → post GATE with "experiment failed" |
| No GPU available | Wait 30 min, retry; after 2h → post alert |
| Coder produces invalid code | Researcher does minimal fix; after 3 rounds → spawn new Coder session |
| Review score < 4/10 | Restart from IDEA stage with lessons learned |
| Unsupported primary claim discovered during writing | Remove it from outline and roll back to ANALYZE / REVIEW if it is central |
| paperreview.ai timeout | Save partial results, post GATE-5 with what was received |
| Sub-agent silent failure | Check TODOS.md for completion signal; re-spawn if absent after 30 min |

---

## Stage → Agent Mapping Quick Reference

| Stage | Owner | Skills Used |
|-------|-------|-------------|
| SETUP | Researcher | BOOTSTRAP.md |
| GRAPH_BUILD | Researcher | graph-build, zotero-project-library |
| FRONTIER_MAPPING | Researcher | frontier-mapping |
| IDEA | Researcher | idea-phase, research-ideation, idea-catalyst-decompose, idea-catalyst-translate, idea-catalyst-scout, idea-catalyst-gatekeeper, idea-catalyst-integrator, scientific-brainstorming, idea-generator, novelty-check, idea-tournament, resume-pipeline |
| PLAN | Orchestrator | plan-research |
| CODE | Coder | implement-experiment, scientific-visualization, github-download, run-experiment, resume-pipeline |
| EXPERIMENT | Researcher | experiment-phase, parallel-experiments, monitor-experiment, resume-pipeline |
| ANALYZE | Analyzer | analyze-results, scientific-figures, resume-pipeline |
| REVIEW | Reviewer | review-phase, scientific-critical-thinking, scholar-evaluation, peer-review, paper-review, idea-catalyst-judge, evidence-grading, resume-pipeline |
| WRITE | Academic Writer | paper-plan, citation-management, venue-templates, paper-write, paper-compile, resume-pipeline |
| CROSS-REVIEW | Cross-Reviewer | resume-pipeline (stateless) + sessions_send |
| SUBMIT | Reviewer | paperreview-submit, review-response |
| REVISE | Researcher | (orchestrates loop-back) |

Background-only Researcher skills during wait states: `idle-research`, `research-lit`, `papers-cool`, `hugging-face-paper-pages`, `papernexus`, `resume-pipeline`.
