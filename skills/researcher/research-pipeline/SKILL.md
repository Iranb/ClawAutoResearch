---
name: research-pipeline
description: "End-to-end automated research pipeline: idea → experiment → review → paper. Supports single-project and multi-project parallel modes. Use /research-pipeline for a single topic, /research-queue for managing multiple parallel projects."
argument-hint: "[research-direction or topic] [-- AUTO_PROCEED: true/false] [-- MULTI: true/false]"
allowed-tools:
  - Bash(*)
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - WebSearch
  - WebFetch
  - Agent
  - Skill
  - research_workflow
---

# Research Pipeline

End-to-end automated research pipeline with three levels of parallelism and state-machine control.

## Research Rigor Constraints

- Preserve **one variable per experiment** across the whole pipeline: each promoted track, ablation, or repair should stay attributable to one intended change.
- **Record everything** in durable project artifacts, including literature decisions, experiment hypotheses, code-impacting changes, failures, and gate outcomes.
- Keep the **experiment and code change linked** so every result can be traced to a concrete bundle, manifest, config, or commit-worthy delta.
- **Verify before claiming** at every stage: pilot runs do not justify full claims, and unsupported observations must stay downgraded.
- **Never manipulate evaluation** by drifting metrics, baselines, datasets, or decision thresholds mid-pipeline.
- **Never fabricate citations** anywhere in the pipeline; verify metadata against primary sources first.

## 🚀 EXECUTION ENTRY POINT (MANDATORY)

**When this skill is invoked via `/research-pipeline "[topic]"`:**

1. **Parse arguments:**
   - Extract the research topic/direction from `$ARGUMENTS` (everything before `--`)
   - Parse overrides: `AUTO_PROCEED: true/false`, `MULTI: true/false`, `TOP_K_IDEAS: N`
   - Parse internal marker: `__BACKGROUND_CONTINUATION__: true/false`
   - If no topic provided → **STOP and ask user**: "Please provide a research direction, e.g., `/research-pipeline \"based vision transformer small object detection\"`"

2. **Determine mode:**
   - If `MULTI=true` → delegate to `/research-queue "[topic]"`
   - If `MULTI=false` (default) → proceed with single-project pipeline below

3. **Slash fast path (mandatory unless already in background continuation):**
   - If `__BACKGROUND_CONTINUATION__ != true`, do **not** run the full workflow inline
   - First call `research_workflow`:
     - `action = "start_background_run"`
     - `backgroundRun.kind = "research_pipeline"`
     - `backgroundRun.topic = [topic]`
     - `backgroundRun.title = [topic]`
     - `backgroundRun.summary = "Starting research pipeline for [topic]"`
     - `backgroundRun.commandText = /research-pipeline "[topic]" ... -- __BACKGROUND_CONTINUATION__: true`
   - After the tool returns:
     - Reply briefly that the pipeline has started in the background
     - Include `project_id` / `project_root` if the tool returned them
     - **STOP**
   - The background continuation will do the real work and post progress updates to the channel or mailbox

4. **Resolve project context in background continuation:**
   - Call `research_workflow` with `action = "bind_channel_project"`
   - Pass `channelBinding.projectId = [derived project_id]`
   - Pass `channelBinding.topic = [topic]`
   - If the current channel is not yet bound, the plugin should read configured `projectsRoot`, create `{PROJ}` automatically when missing, and then bind the current channel to it
   - Treat the returned `projectRoot` as authoritative `{PROJ}`

5. **Initialize project:**
   - Read `{WS}/CONFIG.md` only as a reference; prefer the `projectRoot` returned by `research_workflow.bind_channel_project`
   - Generate `project_id` from topic: lowercase, replace spaces with `-`, truncate to 40 chars
   - Ensure `{PROJ}` exists
   - Copy templates to `{PROJ}/`:
     - `templates/PROJECT_MANIFEST.json` → update with `project_id`, `title`, `created_at`, `current_stage: "setup"`
     - `templates/TRACK_REGISTRY.json`
     - `templates/CLAIM_POLICY.md`
   - Create `{PROJ}/graph/`, `{PROJ}/memory/`, `{PROJ}/researcher/`, `{PROJ}/orchestrator/`, `{PROJ}/coder/`, `{PROJ}/analyzer/`, `{PROJ}/academic_writer/`, `{PROJ}/reviewer/`
   - Create `{PROJ}/memory/ideation-memory.md` and `{PROJ}/memory/experiment-memory.md` (copy from `templates/memory/` or create with section headers)
   - Copy `{WS}/WORKFLOW.md` → `{PROJ}/WORKFLOW.md`
   - Create `{PROJ}/researcher/workflow_snapshots/` and save timestamped copy

6. **Update state:**
   - Set `{PROJ}/PROJECT_MANIFEST.json`:
     - `current_stage: "graph_build"`
     - `current_micro_stage: "project_init"`
     - `paper_source_dir: "~/.papernexus/papers/{project_id}"`
     - `graph_source_dir: "~/.papernexus/papers/{project_id}"`
     - `memory_scope.project_isolated: true`

7. **Announce and begin Stage 0.5:**
   - Post: "🚀 Starting research pipeline for: [topic]"
   - Post: "Project ID: {project_id}"
   - Post: "Project path: {PROJ}"
   - Post: "Mode: AUTO_PROCEED={true/false}, TOP_K_IDEAS={N}"
   - **Immediately invoke:** `/research-lit "[topic]"` to begin literature collection

---

## Constants

- **AUTO_PROCEED = true** — Gates auto-select optimal option; set `false` for manual control
- **HUMAN_CHECKPOINT = false** — When `true`, review loop pauses each round for user input
- **MAX_REVIEW_ROUNDS = 4** — Auto-review loop hard limit
- **MULTI = false** — When `true`, uses `/research-queue` for multi-project orchestration
- **TOP_K_IDEAS = 2** — How many ideas advance from tournament to full experiment
- **MAX_PILOT_IDEAS = 3** — Ideas to pilot in parallel

> Override at invocation: `/research-pipeline "topic" — AUTO_PROCEED: false, TOP_K_IDEAS: 3`

---

## Path Variables

- `{WS}` = `~/.openclaw/workspace-researcher`
- `{PROJECTS_ROOT}` = configured project root (see `CONFIG.md`), `{PROJ}` = `{PROJECTS_ROOT}/{proj-id}`
- `{PMEM}` = `{PROJ}/memory`
- default PaperNexus source root = `~/.papernexus/papers/{proj-id}`
- default PaperNexus index root = `~/.papernexus/index-store`

Each agent writes ONLY to its designated subfolder under `{PROJ}/`. See `WORKSPACE.md` for full ownership rules.

---

## Stage 0: Project Init (Mandatory) — Snapshot WORKFLOW into Project

When starting a **new workflow run** for a project (i.e., when `{PROJ}/` is created or selected for this run), the Researcher MUST:

1. **Snapshot workflow**  
   - Write `{PROJ}/WORKFLOW.md` — verbatim copy of `{WS}/WORKFLOW.md` (overwrite to reflect the workflow used for this run).  
   - Write `{PROJ}/researcher/workflow_snapshots/WORKFLOW.{YYYY-MM-DD_HHMM}.md` — timestamped snapshot (create dirs if absent; never delete old snapshots). Literal copy, no edits.

2. **Ensure project memory dir exists**  
   - Create `{PROJ}/memory/` if absent.  
   - If `{PMEM}/ideation-memory.md` or `{PMEM}/experiment-memory.md` do not exist, create them (empty with minimal section headers, or copy from plugin `templates/memory/` templates if present).

3. **Ensure graph + state-machine files exist**
   - Create `{PROJ}/graph/` if absent.
   - If `{PROJ}/PROJECT_MANIFEST.json` does not exist, initialize it from `templates/PROJECT_MANIFEST.json`.
   - If `{PROJ}/TRACK_REGISTRY.json` does not exist, initialize it from `templates/TRACK_REGISTRY.json`.
   - If `{PROJ}/CLAIM_POLICY.md` does not exist, initialize it from `templates/CLAIM_POLICY.md`.
   - Update `{PROJ}/PROJECT_MANIFEST.json` with:
     - `project_id`
     - `title`
     - `created_at`
     - `status`
     - `current_stage: "setup"`
     - `current_micro_stage: "state_templates_ready"`

### Stage 0.5: Graph Foundation (Mandatory for new projects)

Before graph build, the Researcher must first gather papers and full text into a PaperNexus-readable source tree, then build a project-local graph frontier:

```
/research-lit "$ARGUMENTS"          → {PROJ}/researcher/LITERATURE.md + paper_source_dir
/research-lit "$ARGUMENTS"          → {PROJ}/researcher/RESEARCH_BRAINSTORM.md
/graph-build "$ARGUMENTS"           → {PROJ}/graph/PAPERNEXUS_STATUS.json
/frontier-mapping "$ARGUMENTS"      → {PROJ}/researcher/FRONTIER_REPORT.md
/papernexus-agentic-reasoning "$ARGUMENTS" → {PROJ}/researcher/reasoning/<track-id>/*
```

Rules:
- `/research-lit` is not only abstract survey; it must ingest full-paper markdown/PDF for the key papers
- `/research-lit` must already produce a preliminary brainstorm scaffold grounded in the literature and current graph view; brainstorming must begin during research, not only during IDEA
- after `/papers-cool` finds key papers, Researcher must verify graph presence; if the graph lacks a key paper, refresh graph state before innovation analysis
- Do **not** enter idea selection without `{PROJ}/researcher/FRONTIER_REPORT.md`
- Do **not** enter idea selection without `{PROJ}/researcher/RESEARCH_BRAINSTORM.md`
- Do **not** enter idea selection until `{PROJ}/graph/LIMITATION_FRONTIER.md`, `CONTRADICTION_FRONTIER.md`, `TRANSFER_FRONTIER.md`, `COMPOSITION_FRONTIER.md`, and `ANCHOR_INDEX.md` exist
- Do **not** lock or advance a serious track without a reasoning packet under `{PROJ}/researcher/reasoning/<track-id>/`
- If local literature changes materially during Stage 1, refresh graph state:
  - `/research-lit "$ARGUMENTS"` if the corpus itself needs more papers or refreshed full text
  - `/graph-build --force`
  - `/frontier-mapping "$ARGUMENTS"`
  - `/papernexus-agentic-reasoning "$ARGUMENTS"` for the surviving track or frontier item whose evidence changed
- After Stage 0.5, ensure `{PROJ}/PROJECT_MANIFEST.json` points to the latest corpus and frontier report

Graph refresh trigger:
- refresh immediately if 1 new paper changes the closest-prior-work or novelty picture
- refresh when 3+ genuinely new canonical papers accumulate since the last graph sync
- refresh when 2+ new recent venue papers materially overlap with the active topic
- otherwise defer to the next major checkpoint

## Mode A: Single Project Pipeline

Default mode (`MULTI=false`). All state under `{PROJ}/`.

### Stage 1: Idea Discovery

```
/research-lit "$ARGUMENTS"          → {PROJ}/researcher/LITERATURE.md
/papernexus-agentic-reasoning "$ARGUMENTS" → {PROJ}/researcher/reasoning/<track-id>/*
/innovation-reflection "$ARGUMENTS" → {PROJ}/researcher/INNOVATION_REFLECTION.md (when experiment evidence exists and reflection is due)
/idea-generator "$ARGUMENTS"        → {PROJ}/researcher/IDEA_REPORT.md (candidates) + {PROJ}/TRACK_REGISTRY.json
/novelty-check "[top ideas]"        → novelty verdicts + {PROJ}/cross-reviewer/novelty/*.md
/research-reflect "idea portfolio"  → track decisions
/idea-tournament                    → parallel pilots + ranking
```

`/idea-generator` must read both:
- `{PROJ}/researcher/LITERATURE.md`
- `{PROJ}/researcher/FRONTIER_REPORT.md`
- `{PROJ}/graph/LIMITATION_FRONTIER.md`
- `{PROJ}/graph/CONTRADICTION_FRONTIER.md`
- `{PROJ}/graph/TRANSFER_FRONTIER.md`
- `{PROJ}/graph/COMPOSITION_FRONTIER.md`
- `{PROJ}/graph/ANCHOR_INDEX.md`
- `{PROJ}/researcher/reasoning/<track-id>/SYNTHESIS_PACKET.md` when it exists
- `{PROJ}/researcher/reasoning/<track-id>/WORKING_MEMORY.json` for surviving or re-opened tracks
- `{PROJ}/researcher/INNOVATION_REFLECTION.md` when experiment-informed reflection exists or `research_workflow.get_innovation_reflection` reports `due: true`

Idea-stage control rules:
- generate 4–8 candidate tracks
- diverge from multiple graph lenses, then converge before locking the portfolio
- use graph-backed innovation evidence, not abstract-only summaries, for each surviving track
- if experiments have produced new evidence since the last reflection, refresh `/innovation-reflection` before writing or locking new idea outputs
- treat `INNOVATION_REFLECTION.md` as both a transfer packet and a negative-constraint packet for the next brainstorm
- for each serious candidate, first anchor the question, then explore the graph with an explicit working-memory loop before turning it into a track
- each reasoning step must decide `expand`, `refine_query`, `answer_try`, or `stop`; do not traverse blindly
- rejected branches, false-positive relations, and unresolved entities must be written into the reasoning packet
- a surviving track must have a bounded synthesis packet that separates direct evidence, inference, and open uncertainty
- if needed, ask Orchestrator to turn a surviving graph-backed opportunity into a tighter innovation package before plan locking
- keep at most 2 `active` tracks
- keep at most 1 `parked` track
- all other tracks must be `merged` or `killed`
- persist every decision in `{PROJ}/TRACK_REGISTRY.json`

Researcher continuous-duty rule:
- when Orchestrator / Coder / Analyzer / Writer are working, Researcher should continue literature watch, papers ingestion, graph refresh preparation, and innovation analysis instead of idling
- if `PROJECT_MANIFEST.json.idle_research.enabled = true`, prioritize `/idle-research` for that topic during wait states, obey `max_papers_per_cycle` and `cooldown_minutes`, and record each round through `research_workflow.record_idle_research_run`
- new papers discovered during execution should be added to `paper_source_dir`; if they materially change the frontier, refresh graph state before the next major idea or revision decision
- prefer `papernexus watch` for active projects with steady paper inflow, and make `/resume-pipeline` reconcile watcher status after restarts
- use waiting time to reopen unresolved graph questions, compact working memory, refresh synthesis packets for active or parked tracks, and refresh experiment-informed innovation reflection when it becomes due, without silently changing track ownership

**Gate 1 — Idea Selection:**

```
Display: Tournament results table
  Rank 1: [Title] — STRONG_POSITIVE (+X.X%) ★★★
  Rank 2: [Title] — POSITIVE (+X.X%) ★★
  [Combination option if applicable]

AUTO_PROCEED=false → wait for user:
  - "proceed"         → advance selected tracks to planning
  - "combine 1 3"     → merge tracks 1 and 3
  - "only 1"          → keep only track 1 active
  - "park 2"          → keep track 2 parked
  - "rerun 2"         → re-pilot track 2 at larger scale
  - "generate more"   → back to idea-generator with new constraints

AUTO_PROCEED=true → wait 15s → auto-select top-K by score
  Log: "AUTO_PROCEED: advancing Track 1 ({title}) and Track 2 ({title})"
```

**Output**:
- Confirmed leading idea in `{PROJ}/researcher/IDEA_REPORT.md`
- Full portfolio in `{PROJ}/TRACK_REGISTRY.json`
- `{PROJ}/PROJECT_MANIFEST.json` updated with active / parked track ids

### Stage 2: Planning

For EACH active track (parallel if TOP_K_IDEAS > 1):

```
spawn orchestrator → /plan-research "[track title]" (input: {PROJ}/researcher/IDEA_REPORT.md + {PROJ}/TRACK_REGISTRY.json)
```

**Output:** `{PROJ}/orchestrator/PLAN.md`, `{PROJ}/orchestrator/TODOS.md`, `{PROJ}/orchestrator/PLAN_AUDIT.md`

Planning rules:
- one plan section per active track
- one compute budget per active track
- one explicit `stop / rollback / kill` rule set per active track

**Mandatory before Stage 3:** Do **not** advance to Implementation or spawn Coder until `{PROJ}/orchestrator/PLAN.md`, `{PROJ}/orchestrator/TODOS.md`, and `{PROJ}/orchestrator/PLAN_AUDIT.md` all exist. `PLAN_AUDIT.md` must say the project is ready for CODE. **Proactively wake Orchestrator** when any of the required files are missing: spawn Orchestrator with `/plan-research`, wait for session completion or poll until all required files appear; if still missing after timeout, re-spawn. Do not assume someone else will run Orchestrator.

**Gate 2 — Plan Confirmation:**
- Present experiment count and estimated GPU hours
- `AUTO_PROCEED=false`: wait for approval
- `AUTO_PROCEED=true`: auto-confirm if total GPU estimate ≤ 20h (only after PLAN.md, TODOS.md, and a ready PLAN_AUDIT.md exist)

### Stage 3: Implementation

**Precondition:** `{PROJ}/orchestrator/PLAN.md`, `{PROJ}/orchestrator/TODOS.md`, and a ready `{PROJ}/orchestrator/PLAN_AUDIT.md` must exist. If any is missing, go back to Stage 2 and wait for Orchestrator output.

```
spawn coder → /implement-experiment "[confirmed plan]"
```

Coder produces code + dry-run validation for each idea.

### Stage 4: Experiment Execution

```
/experiment-phase                    → dispatches via /parallel-experiments
```

Multi-level parallelism:
- **Within one track**: baseline + proposed + ablations run simultaneously
- **Across active tracks**: if TOP_K_IDEAS > 1 and enough GPUs, run both tracks' experiments in parallel

GPU allocation across tracks:
```
If total GPU slots ≥ Track1_exps + Track2_exps:
  → launch all simultaneously
Else:
  → priority: higher-signal track gets more slots
  → lower-priority track queued, launched when slots free up
```

**Output**: `{PROJ}/researcher/EXPERIMENT_REGISTRY.md`, `{PROJ}/researcher/EXPERIMENT_LOG.md`, `{PROJ}/researcher/artifacts/`, updated `{PROJ}/TRACK_REGISTRY.json`

Experiment control rules:
- every round must end with a track decision (`advance` / `merge` / `park` / `kill`)
- do not enter full experiments for a weak track that failed its pilot
- if budget is tight, prefer one strong track over two marginal ones

### Stage 5: Auto Review

```
/review-phase                        → cross-agent review loop
```

Precondition before Stage 5:
- `{PROJ}/analyzer/NARRATIVE_REPORT.md` exists
- `{PROJ}/analyzer/CLAIM_EVIDENCE_MATRIX.md` exists
- `{PROJ}/analyzer/QUALITY_AUDIT.md` exists and says the project is ready for REVIEW

If multiple tracks were pursued, review each independently:
- strongest track gets first review slot
- secondary track reviewed when the first completes or in parallel if reviewer agent allows
- Review output saved to `{PROJ}/reviewer/REVIEW_REPORT.md`

**Gate 3** (per-idea, controlled by HUMAN_CHECKPOINT):
- Show score + action items
- `HUMAN_CHECKPOINT=true`: pause each round
- `HUMAN_CHECKPOINT=false`: auto-fix and continue

**Divergence handling**: If Track 1 passes review but Track 2 does not:
- Track 1 proceeds to paper
- Track 2 enters repair loop (up to MAX_REVIEW_ROUNDS)
- If Track 2 still fails: park or kill it, focus on Track 1

### Stage 6: Paper Writing

```
spawn academic_writer → /paper-phase
```

Writer produces LaTeX paper with cross-review at each section.

**Gate 4** — Paper draft complete, ready for external AI review.

### Stage 7: External AI Review (Mandatory)

```
/paperreview-submit "{PROJ}/academic_writer/paper/main.pdf"
```

Submit to paperreview.ai (Stanford Agentic Reviewer). Wait for results, save to `{PROJ}/reviewer/external_review_{date}.md`.

After the external review lands, invoke:

```
/review-response
```

to write `{PROJ}/reviewer/rebuttal_{date}.md`.

**Gate 5 [REQUIRED]** — Human decides: major-revision / minor-revision / accept-as-is.

### Stage 8: Revise

Based on Gate 5 decision:
- `major-revision` → back to Stage 4 (EXPERIMENT)
- `minor-revision` → back to Stage 6 (WRITE)
- `accept-as-is` → Stage 9 (DONE)

### Stage 9: DONE

Archive project, update state, distill learnings to memory.

---

## Mode B: Multi-Project Queue (`MULTI=true`)

Delegates entirely to `/research-queue`:

```
/research-queue overnight
```

See `/research-queue` for full documentation.

Typical overnight workflow:
```
> /research-pipeline "topic1" -- MULTI: true  (adds to queue, runs idea phase)
> /research-pipeline "topic2" -- MULTI: true  (adds second project)
> /research-queue overnight                   (launches all, runs until morning)
```

---

## State Files Reference

```
{PROJ}/
├── PROJECT_MANIFEST.json           ← OWNED BY: researcher
├── TRACK_REGISTRY.json             ← OWNED BY: researcher
├── CLAIM_POLICY.md                 ← OWNED BY: researcher
│
├── README.md                        ← OWNED BY: researcher
│
├── graph/                           ← OWNED BY: researcher
│   ├── PAPERNEXUS_STATUS.json       Stage 0.5 output (corpus metadata)
│   ├── GRAPH_BUILD_REPORT.md        Stage 0.5 output (build log)
│   ├── LIMITATION_FRONTIER.md       Stage 0.5 output
│   ├── CONTRADICTION_FRONTIER.md    Stage 0.5 output
│   ├── TRANSFER_FRONTIER.md         Stage 0.5 output
│   ├── COMPOSITION_FRONTIER.md      Stage 0.5 output
│   └── ANCHOR_INDEX.md              Stage 0.5 output
│
├── researcher/                      ← OWNED BY: researcher
│   ├── IDEA_REPORT.md               Stage 1 output (tournament results)
│   ├── IDEA_TOURNAMENT_STATE.json   Pilot tracking + recovery
│   ├── LITERATURE.md                Stage 1 output (landscape)
│   ├── FRONTIER_REPORT.md           Stage 0.5 output (graph-grounded frontier)
│   ├── EXPERIMENT_REGISTRY.md       Stage 4 tracking (all GPU slots)
│   ├── PARALLEL_STATE.json          Stage 4 recovery
│   ├── EXPERIMENT_LOG.md            Stage 4 output (final log)
│   ├── REVIEW_STATE.json            Stage 5 recovery (round + threadId)
│   └── artifacts/
│       ├── pilots/                  Stage 1 pilot results
│       ├── results/                 Stage 4 full results (rsync'd from server)
│       └── logs/                    Stage 4 server logs (rsync'd)
│
├── orchestrator/                    ← OWNED BY: orchestrator
│   ├── PLAN.md                      Stage 2 output (track-aware experiment plan)
│   ├── PLAN_AUDIT.md                Stage 2 audit gate for CODE handoff
│   └── TODOS.md                     Stage 2–6 shared task list
│
├── coder/                           ← OWNED BY: coder
│   └── {experiment-name}/           Stage 3 output (code)
│
├── analyzer/                        ← OWNED BY: analyzer
│   ├── NARRATIVE_REPORT.md          Stage 4 output (analysis report)
│   ├── CLAIM_EVIDENCE_MATRIX.md     Stage 4 output (writing-safe claim ledger)
│   ├── TRACK_VERDICTS.md            Stage 4 output (advance / merge / park / kill memo)
│   ├── UNSUPPORTED_CLAIMS.md        Stage 4 output (claims needing downgrade or more evidence)
│   ├── QUALITY_AUDIT.md             Stage 4 audit gate for REVIEW handoff
│   ├── figures/                     Stage 4 output (plots)
│   └── tables/                      Stage 4 output (LaTeX tables)
│
├── academic_writer/                 ← OWNED BY: academic_writer
│   ├── PAPER_PLAN.md                Stage 6 outline
│   └── paper/
│       ├── main.tex
│       ├── sections/
│       ├── figures/                 Copied from analyzer/figures/ at paper-phase start
│       └── refs.bib
│
├── reviewer/                        ← OWNED BY: reviewer (saved by researcher)
│   ├── REVIEW_REPORT.md             Stage 5 output (internal review history)
│   ├── external_review_{date}.md    Stage 7 output (external AI review)
│   └── rebuttal_{date}.md           Stage 8 output (response draft)
│
└── cross-reviewer/                  ← OWNED BY: cross-reviewer (saved by calling agent)
    ├── novelty/                     Stage 1 novelty assessments
    ├── outline/                     Stage 6 outline reviews
    └── prose/                       Stage 6 per-section prose reviews

{PROJECTS_ROOT}/PROJECTS_STATE.json  Multi-project registry (Mode B)
```

## Key Rules

- Gate control is determined by `AUTO_PROCEED`
- **Never skip Stage 0.5 (Graph Foundation)** on a new project: build PaperNexus corpus and frontier report before idea selection
- **Always maintain the state machine**: update `{PROJ}/PROJECT_MANIFEST.json` and `{PROJ}/TRACK_REGISTRY.json` at each stage transition
- **Never let the track portfolio drift**: keep at most 2 active tracks unless budget explicitly allows more
- **Never skip Stage 2 (Planning):** even when AUTO_PROCEED=true, wait for `PLAN.md`, `TODOS.md`, and a ready `PLAN_AUDIT.md` before spawning Coder. When any is missing, **proactively wake Orchestrator** (spawn with /plan-research) to produce them. See WORKFLOW.md "Stage transition preconditions" and "Wake Orchestrator on demand".
- Stages 3–6 can run autonomously after Gate 1 (overnight mode)
- Review max 4 rounds; if exceeded → stop and report
- Multi-track mode: all tracks share the same project memory files but must remain explicitly separated in `TRACK_REGISTRY.json`
- Failed ideas always update `{PMEM}/ideation-memory.md` (IVE)
- Successful experiments always update `{PMEM}/experiment-memory.md` (ESE)
- Each agent writes ONLY to its owned subfolder — see `WORKSPACE.md`
- Failures are reported gracefully with suggested alternatives
- **Always stop at the final human decision gate after the external review arrives**
