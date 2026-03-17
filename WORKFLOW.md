# WORKFLOW.md — Global Research Pipeline

> This is the **master control document** for the entire research pipeline.
> The Researcher agent reads this on every session start and uses it as the
> authoritative definition of what to do next, in what order, and when to pause.

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

## Pipeline Overview

```
 ┌─────────────────────────────────────────────────────────────────────┐
 │                     RESEARCH PIPELINE                               │
 │                                                                     │
 │  [START] ──► IDEA ──► ◆ GATE-1 ──► PLAN ──► ◆ GATE-2              │
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
| IDEA       | PLAN     | `{PROJ}/researcher/IDEA_REPORT.md` |
| **PLAN**   | **CODE** | **`{PROJ}/orchestrator/PLAN.md`** AND **`{PROJ}/orchestrator/TODOS.md`** |
| CODE       | EXPERIMENT | At least one `{PROJ}/coder/<experiment-name>/` with `train.py` (or equivalent) and `README.md` |
| EXPERIMENT | ANALYZE | `{PROJ}/researcher/artifacts/results/` non-empty, `EXPERIMENT_REGISTRY.md` updated |
| ANALYZE   | REVIEW  | `{PROJ}/analyzer/NARRATIVE_REPORT.md` |
| REVIEW    | WRITE   | `{PROJ}/reviewer/REVIEW_REPORT.md` or review loop marked complete in REVIEW_STATE.json |
| WRITE     | SUBMIT  | `{PROJ}/academic_writer/paper/main.pdf` (or equivalent) |

**If a completion signal is missing:**

- Do **not** write `GATE_STATE.json` with `current_stage` = next stage.
- Do **not** spawn the next stage's agent (e.g. Coder) until the previous owner (e.g. Orchestrator) has produced the required files.
- **Proactively wake the owning agent:** when a signal is missing, Researcher must **actively spawn (wake)** that stage's agent to produce the outputs — do not assume the user or another process will run it. Example: if `PLAN.md` or `TODOS.md` are missing before CODE, **wake Orchestrator** (spawn with instruction to run `/plan-research` using `{PROJ}/researcher/IDEA_REPORT.md`), then wait until both files exist (poll or wait for session completion). Only then advance to CODE.

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
  3. Load {PROJ}/memory/ideation-memory.md, {PROJ}/memory/experiment-memory.md (project-isolated)
   4. Check {PROJECTS_ROOT}/PROJECTS_STATE.json for active projects
  5. If active project found → resume at last incomplete stage
  6. If no active project → proceed to IDEA stage
  7. Post Session Ready message (see BOOTSTRAP.md)
```

---

### Stage 1 · IDEA
**Owner:** Researcher  
**Skills:** `/idea-phase` → `/idea-generator` → `/novelty-check` → `/idea-tournament`  
**Inputs:** Research domain or topic (from user, or from memory)  
**Outputs:**
- `{PROJ}/researcher/IDEA_REPORT.md` — top-ranked idea with novelty assessment
- `{PROJ}/researcher/LITERATURE.md` — supporting literature
- `{PROJ}/researcher/IDEA_TOURNAMENT_STATE.json` — pilot scores (if tournament ran)

```
Procedure:
  1. Run /idea-phase (literature survey + brainstorming)
  2. Run /novelty-check on top candidates
  3. If ≥2 ideas pass Gate 0 (novelty threshold): run /idea-tournament
  4. Select winning idea → write IDEA_REPORT.md
  5. → POST GATE-1
```

---

### ◆ GATE-1 · Idea Approval
**Type:** OPTIONAL (skipped if AUTO_PROCEED=true)

```
## ⏸ GATE-1: Idea Ready for Review

**Project:** {proj-id}
**Idea:** {one-sentence summary}
**Novelty score:** {X}/10
**Closest prior work:** {paper title, year}
**Estimated compute:** {N} GPU-hours
**Pilot result (if tournament ran):** {metric: value}

Key outputs:
  → {PROJ}/researcher/IDEA_REPORT.md
  → {PROJ}/researcher/LITERATURE.md

Options:
  [continue]          — approve idea, proceed to planning
  [reject: <reason>]  — discard idea, generate next candidate
  [modify: <notes>]   — accept idea with modifications noted
  [stop]              — pause pipeline here

Waiting for response... (auto-continue in {GATE_TIMEOUT_HOURS}h if no reply)
```

---

### Stage 2 · PLAN
**Owner:** Orchestrator (spawned by Researcher via `sessions_spawn`)  
**Skills:** `/plan-research`  
**Inputs:** `{PROJ}/researcher/IDEA_REPORT.md`  
**Outputs:**
- `{PROJ}/orchestrator/PLAN.md` — full experiment plan
- `{PROJ}/orchestrator/TODOS.md` — task checklist

**Completion signal (required before leaving this stage):** Both `{PROJ}/orchestrator/PLAN.md` and `{PROJ}/orchestrator/TODOS.md` must exist and be non-empty. Do not advance to CODE or write `GATE_STATE.json` with `current_stage: "CODE"` until both files exist.

**Wake Orchestrator on demand:** Whenever PLAN or TODOS are missing (e.g. before entering CODE, or on resume when `current_stage` is CODE but `orchestrator/` is empty), Researcher must **proactively spawn (wake)** the Orchestrator agent with instruction to run `/plan-research`, and wait for both files before proceeding. Do not skip this step or assume someone else will run Orchestrator.

```
Procedure:
  1. Researcher spawns Orchestrator with clear instruction:
     "Run /plan-research using {PROJ}/researcher/IDEA_REPORT.md. Write PLAN.md and TODOS.md to {PROJ}/orchestrator/."
  2. Wait for Orchestrator to complete:
     - Option A: Wait for Orchestrator session to return/finish.
     - Option B: Poll until both {PROJ}/orchestrator/PLAN.md and {PROJ}/orchestrator/TODOS.md exist (e.g. every 30s, max 10 min).
  3. If after timeout both files are still missing: re-spawn Orchestrator with same instruction; do not advance to CODE.
  4. Once both files exist: Researcher reads PLAN.md and validates feasibility.
  5. → POST GATE-2 (or if AUTO_PROCEED=true, log to GATES_LOG.md and set current_stage=CODE only after step 4).
```

---

### ◆ GATE-2 · Plan Approval
**Type:** OPTIONAL (human wait skipped if AUTO_PROCEED=true).  
**Stage work is never skipped:** PLAN stage (Orchestrator producing PLAN.md + TODOS.md) must complete before you may advance to CODE or write `current_stage: "CODE"` in GATE_STATE.json.

```
## ⏸ GATE-2: Experiment Plan Ready

**Project:** {proj-id}
**Plan summary:** {2-3 sentence description}
**Experiments defined:** {N}
**GPU estimate:** {N} hours across {N} GPUs
**Key baselines:** {list}

Key outputs:
  → {PROJ}/orchestrator/PLAN.md
  → {PROJ}/orchestrator/TODOS.md

Options:
  [continue]          — approve plan, start coding
  [revise: <notes>]   — send back to Planner with feedback
  [stop]              — pause here

Waiting for response...
```

---

### Stage 3 · CODE
**Owner:** Coder (spawned by Researcher via `sessions_spawn`)  
**Skills:** `/implement-experiment`, `/github-download`  
**Inputs:** `{PROJ}/orchestrator/PLAN.md`  
**Outputs:**
- `{PROJ}/coder/{experiment-name}/` — runnable code
- `{PROJ}/coder/{experiment-name}/README.md` — setup + run instructions

**Precondition (mandatory):** Before spawning Coder, both `{PROJ}/orchestrator/PLAN.md` and `{PROJ}/orchestrator/TODOS.md` must exist. If either is missing, do **not** spawn Coder; go back to Stage 2 (PLAN), spawn Orchestrator, and wait for both files to be written.

```
Procedure:
  1. Verify PLAN.md and TODOS.md exist under {PROJ}/orchestrator/. If not → run Stage 2 (PLAN) first.
  2. Researcher spawns Coder with path to PLAN.md
  3. Coder runs /implement-experiment
  4. Coder marks TODOS.md item as complete
  5. Researcher does local dry-run validation
  6. If validation fails → Coder fixes
  7. → proceed to EXPERIMENT (no gate — coding is internal)
```

---

### Stage 4 · EXPERIMENT
**Owner:** Researcher  
**Skills:** `/experiment-phase` → `/parallel-experiments`, `/run-experiment`, `/monitor-experiment`  
**Inputs:** `{PROJ}/coder/{experiment-name}/`, `{PROJ}/orchestrator/PLAN.md`  
**Outputs:**
- `{PROJ}/researcher/artifacts/results/` — raw results
- `{PROJ}/researcher/EXPERIMENT_REGISTRY.md` — run status

```
Procedure:
  1. Sync code to GPU server via rsync
  2. Dispatch experiments (use /parallel-experiments if N>1)
  3. Monitor with /monitor-experiment
  4. On completion: collect results to artifacts/results/
  5. Update EXPERIMENT_REGISTRY.md
  6. → POST GATE-3
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

Key outputs:
  → {PROJ}/researcher/artifacts/results/
  → {PROJ}/researcher/EXPERIMENT_REGISTRY.md

Options:
  [continue]               — proceed to analysis and writing
  [more-experiments: <idea>] — run additional ablations/baselines
  [restart-idea]           — results too negative, return to IDEA stage
  [stop]                   — pause here

Waiting for response...
```

---

### Stage 5 · ANALYZE
**Owner:** Analyzer (spawned by Researcher)  
**Skills:** `/analyze-results`, `/scientific-figures`  
**Inputs:** `{PROJ}/researcher/artifacts/results/`  
**Outputs:**
- `{PROJ}/analyzer/NARRATIVE_REPORT.md` — findings narrative
- `{PROJ}/analyzer/figures/` — publication-ready figures
- `{PROJ}/analyzer/tables/` — result tables

```
Procedure:
  1. Researcher spawns Analyzer with results path
  2. Analyzer runs /analyze-results → metrics, figures, tables
  3. Analyzer writes NARRATIVE_REPORT.md
  4. → proceed to REVIEW (no gate — analysis is internal)
```

---

### Stage 6 · REVIEW (Internal)
**Owner:** Reviewer (invoked by Researcher via `sessions_send`)  
**Skills:** `/review-phase`, `/evidence-grading`  
**Inputs:** `{PROJ}/analyzer/NARRATIVE_REPORT.md`, `{PROJ}/researcher/artifacts/`  
**Outputs:**
- `{PROJ}/reviewer/REVIEW_REPORT.md` — structured review
- `{PROJ}/researcher/REVIEW_STATE.json` — review loop state

```
Procedure:
  1. Researcher invokes Reviewer with NARRATIVE_REPORT.md
  2. Reviewer scores: Soundness, Significance, Reproducibility
  3. If score < 6/10 → flag specific weak points
  4. Researcher addresses weak points (re-experiment or clarify)
  5. Loop max 3 rounds
  6. → proceed to WRITE
```

---

### Stage 7 · WRITE
**Owner:** Academic Writer (spawned by Researcher)  
**Skills:** `/paper-plan`, `/paper-write`, `/paper-compile`, `/ai-research-prompt`, `/research-paper-writing`  
**Inputs:** `{PROJ}/analyzer/NARRATIVE_REPORT.md`, `{PROJ}/analyzer/figures/`  
**Outputs:**
- `{PROJ}/academic_writer/PAPER_PLAN.md` — paper outline
- `{PROJ}/academic_writer/paper/sections/` — individual section drafts
- `{PROJ}/academic_writer/paper/main.pdf` — compiled PDF

```
Procedure:
  1. Researcher spawns Academic Writer with NARRATIVE_REPORT.md + figures path
  2. Writer runs /paper-plan → PAPER_PLAN.md
  3. Cross-Reviewer checks outline (sessions_send, Outline Mode)
     → saved to {PROJ}/cross-reviewer/outline/{date}.md
  4. Writer runs /paper-write section by section
  5. Cross-Reviewer checks each section (Prose Mode)
  6. Writer runs /paper-compile → main.pdf
  7. → POST GATE-4
```

---

### ◆ GATE-4 · Paper Ready for Submission Review
**Type:** OPTIONAL (skipped if AUTO_PROCEED=true)

```
## ⏸ GATE-4: Paper Draft Complete

**Project:** {proj-id}
**Title:** {paper title}
**Sections:** Abstract, Introduction, Related Work, Method, Experiments, Conclusion
**Cross-review score:** {X}/10 (Novelty: X, Clarity: X, Soundness: X)
**PDF:** {PROJ}/academic_writer/paper/main.pdf

Key outputs:
  → {PROJ}/academic_writer/paper/main.pdf
  → {PROJ}/academic_writer/PAPER_PLAN.md

Options:
  [submit]             — submit to paperreview.ai for external AI review
  [revise: <section>]  — send specific section back to Writer
  [stop]               — pause here (user reads PDF first)

Waiting for response...
```

---

### Stage 8 · SUBMIT & EXTERNAL REVIEW
**Owner:** Reviewer  
**Skills:** `/paperreview-submit`, `/review-response`  
**Inputs:** `{PROJ}/academic_writer/paper/main.pdf`  
**Outputs:**
- `{PROJ}/reviewer/external_review_{date}.md` — AI reviewer feedback
- `{PROJ}/reviewer/rebuttal_{date}.md` — draft rebuttal (if needed)

```
Procedure:
  1. Reviewer submits PDF to paperreview.ai via /paperreview-submit
  2. Polls for results (auto-retry every 5 min, max 2h)
  3. Saves structured review to external_review_{date}.md
  4. Runs /review-response to draft rebuttal
  5. → POST GATE-5
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
  4. If PROJECT_MODE=queue: load next project from queue → Stage 0
  5. If PROJECT_MODE=single: post completion summary, await new instruction
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

On session restart: researcher reads GATE_STATE.json → resumes at `current_stage`.

---

## Autonomous Mode (AUTO_PROCEED=true)

When `AUTO_PROCEED=true`, the pipeline behaves like `autoresearch/program.md` **except**:

- **Stage order and completion signals are still mandatory.** You must not skip the Orchestrator (PLAN) stage: always spawn Orchestrator, wait for `PLAN.md` and `TODOS.md` to exist, then advance to CODE. Same for all other stage transitions — see "Stage transition preconditions" above.
- All **optional** gates (GATE-1, GATE-2, GATE-3, GATE-4) are skipped in the sense of "no human wait": researcher logs the gate message to `{PROJ}/researcher/GATES_LOG.md` and auto-continues. The **work** of each stage (e.g. Orchestrator producing PLAN) is never skipped.
- GATE-5 (revision decision) is **always required** — the one mandatory human checkpoint.
- Researcher loops: DONE → picks next project from queue (if queue mode) or repeats with new idea.
- Human can interrupt at any time by sending a message; researcher acknowledges and pauses after current stage completes.

```
LOOP FOREVER (when AUTO_PROCEED=true):
  IDEA → [wait for IDEA_REPORT] → PLAN → [spawn Orchestrator, wait for PLAN.md+TODOS.md] → CODE → ...
    → if major revision: back to EXPERIMENT
    → if minor revision: back to WRITE
    → if done: next project or new idea
    → GATE-5 always pauses for human decision
```

---

## Error Recovery

| Failure | Recovery |
|---------|---------|
| **Orchestrator skipped / PLAN.md or TODOS.md missing** | **Wake Orchestrator:** spawn Orchestrator with "Run /plan-research using {PROJ}/researcher/IDEA_REPORT.md; write PLAN.md and TODOS.md to {PROJ}/orchestrator/." Wait until both files exist. Optionally set `current_stage` back to PLAN first; then re-advance to CODE. Do not spawn Coder until both files exist. |
| Experiment crash (OOM/bug) | Fix code → re-run; after 3 failures → post GATE with "experiment failed" |
| No GPU available | Wait 30 min, retry; after 2h → post alert |
| Coder produces invalid code | Researcher does minimal fix; after 3 rounds → spawn new Coder session |
| Review score < 4/10 | Restart from IDEA stage with lessons learned |
| paperreview.ai timeout | Save partial results, post GATE-5 with what was received |
| Sub-agent silent failure | Check TODOS.md for completion signal; re-spawn if absent after 30 min |

---

## Stage → Agent Mapping Quick Reference

| Stage | Owner | Skills Used |
|-------|-------|-------------|
| SETUP | Researcher | BOOTSTRAP.md |
| IDEA | Researcher | idea-phase, idea-generator, novelty-check, idea-tournament |
| PLAN | Planner | plan-research |
| CODE | Coder | implement-experiment, github-download |
| EXPERIMENT | Researcher | experiment-phase, parallel-experiments, run-experiment |
| ANALYZE | Analyzer | analyze-results, scientific-figures |
| REVIEW | Reviewer | review-phase, evidence-grading |
| WRITE | Writer | paper-plan, paper-write, paper-compile |
| CROSS-REVIEW | Cross-Reviewer | (invoked via sessions_send) |
| SUBMIT | Reviewer | paperreview-submit, review-response |
| REVISE | Researcher | (orchestrates loop-back) |
