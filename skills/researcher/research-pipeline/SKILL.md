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
---

# Research Pipeline

End-to-end automated research pipeline with three levels of parallelism.

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
- `{PROJECTS_ROOT}` = 配置的项目根（见 CONFIG.md），`{PROJ}` = `{PROJECTS_ROOT}/{proj-id}`
- `{PMEM}` = `{PROJ}/memory`

Each agent writes ONLY to its designated subfolder under `{PROJ}/`. See `WORKSPACE.md` for full ownership rules.

---

## Stage 0: Project Init (Mandatory) — Snapshot WORKFLOW into Project

When starting a **new workflow run** for a project (i.e., when `{PROJ}/` is created or selected for this run), the Researcher MUST:

1. **Snapshot workflow**  
   - Write `{PROJ}/WORKFLOW.md` — verbatim copy of `{WS}/WORKFLOW.md` (overwrite to reflect the workflow used for this run).  
   - Write `{PROJ}/researcher/workflow_snapshots/WORKFLOW.{YYYY-MM-DD_HHMM}.md` — timestamped snapshot (create dirs if absent; never delete old snapshots). Literal copy, no edits.

2. **Ensure project memory dir exists**  
   - Create `{PROJ}/memory/` if absent.  
   - If `{PMEM}/ideation-memory.md` or `{PMEM}/experiment-memory.md` do not exist, create them (empty with minimal section headers, or copy from plugin `memory/` templates if present).

## Mode A: Single Project Pipeline

Default mode (`MULTI=false`). All state under `{PROJ}/`.

### Stage 1: Idea Discovery

```
/research-lit "$ARGUMENTS"          → {PROJ}/researcher/LITERATURE.md
/idea-generator "$ARGUMENTS"        → {PROJ}/researcher/IDEA_REPORT.md (candidates)
/novelty-check "[top ideas]"        → novelty verdicts + {PROJ}/cross-reviewer/novelty/*.md
/idea-tournament                    → parallel pilots + ranking
```

**Gate 1 — Idea Selection:**

```
Display: Tournament results table
  Rank 1: [Title] — STRONG_POSITIVE (+X.X%) ★★★
  Rank 2: [Title] — POSITIVE (+X.X%) ★★
  [Combination option if applicable]

AUTO_PROCEED=false → wait for user:
  - "proceed"         → advance top-K to experiment
  - "combine 1 3"     → merge ideas 1 and 3
  - "only 1"          → advance only rank 1
  - "rerun 2"         → re-pilot idea 2 at larger scale
  - "generate more"   → back to idea-generator with new constraints

AUTO_PROCEED=true → wait 15s → auto-select top-K by score
  Log: "AUTO_PROCEED: advancing Idea 1 ({title}) and Idea 2 ({title})"
```

**Output**: Confirmed ideas in `{PROJ}/researcher/IDEA_REPORT.md`

### Stage 2: Planning

For EACH confirmed idea (parallel if TOP_K_IDEAS > 1):

```
spawn orchestrator → /plan-research "[idea title]" (input: {PROJ}/researcher/IDEA_REPORT.md)
```

**Output:** `{PROJ}/orchestrator/PLAN.md`, `{PROJ}/orchestrator/TODOS.md`

**Mandatory before Stage 3:** Do **not** advance to Implementation or spawn Coder until **both** `{PROJ}/orchestrator/PLAN.md` and `{PROJ}/orchestrator/TODOS.md` exist. **Proactively wake Orchestrator** when either file is missing: spawn Orchestrator with `/plan-research`, wait for session completion or poll until both files appear; if still missing after timeout, re-spawn. Do not assume someone else will run Orchestrator.

**Gate 2 — Plan Confirmation:**
- Present experiment count and estimated GPU hours
- `AUTO_PROCEED=false`: wait for approval
- `AUTO_PROCEED=true`: auto-confirm if total GPU estimate ≤ 20h (only after PLAN.md and TODOS.md exist)

### Stage 3: Implementation

**Precondition:** `{PROJ}/orchestrator/PLAN.md` and `{PROJ}/orchestrator/TODOS.md` must exist. If either is missing, go back to Stage 2 and wait for Orchestrator output.

```
spawn coder → /implement-experiment "[confirmed plan]"
```

Coder produces code + dry-run validation for each idea.

### Stage 4: Experiment Execution

```
/experiment-phase                    → dispatches via /parallel-experiments
```

Multi-level parallelism:
- **Within one idea**: baseline + proposed + ablations run simultaneously
- **Across top-K ideas**: if TOP_K_IDEAS > 1 and enough GPUs, run both ideas' experiments in parallel

GPU allocation across ideas:
```
If total GPU slots ≥ Idea1_exps + Idea2_exps:
  → launch all simultaneously
Else:
  → priority: Idea 1 (higher pilot signal) gets more slots
  → Idea 2 queued, launched when Idea 1 slots free up
```

**Output**: `{PROJ}/researcher/EXPERIMENT_REGISTRY.md`, `{PROJ}/researcher/EXPERIMENT_LOG.md`, `{PROJ}/researcher/artifacts/`

### Stage 5: Auto Review

```
/review-phase                        → cross-agent review loop
```

If multiple ideas were pursued, review each independently:
- Idea 1 gets first review slot (highest priority)
- Idea 2 reviewed when Idea 1 review completes or in parallel if reviewer agent allows
- Review output saved to `{PROJ}/reviewer/AUTO_REVIEW.md`

**Gate 3** (per-idea, controlled by HUMAN_CHECKPOINT):
- Show score + action items
- `HUMAN_CHECKPOINT=true`: pause each round
- `HUMAN_CHECKPOINT=false`: auto-fix and continue

**Divergence handling**: If Idea 1 passes review but Idea 2 does not:
- Idea 1 proceeds to paper
- Idea 2 enters repair loop (up to MAX_REVIEW_ROUNDS)
- If Idea 2 still fails: archive it, focus on Idea 1

### Stage 6: Paper Writing

```
spawn academic_writer → /paper-phase
```

If TOP_K_IDEAS > 1 and both ideas pass review:
- **Combined paper**: both ideas become contributions in a single paper
  - Idea 1 = Main Method
  - Idea 2 = Variant or Extension
  - Strengthens the contribution narrative
- **Separate papers**: if ideas are too different to combine (different tasks/domains)
  - Each gets its own paper directory: `{PROJ}/academic_writer/paper_idea1/` and `paper_idea2/`
  - Researcher decides at Gate 4

**Gate 4 — Paper Strategy:**
- `AUTO_PROCEED=false`: present combination vs. separate option
- `AUTO_PROCEED=true`: combine if same task/domain, else separate

**Output**: `{PROJ}/academic_writer/paper/main.pdf` (or two papers)

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
├── README.md                        ← OWNED BY: researcher
│
├── researcher/                      ← OWNED BY: researcher
│   ├── IDEA_REPORT.md               Stage 1 output (tournament results)
│   ├── IDEA_TOURNAMENT_STATE.json   Pilot tracking + recovery
│   ├── LITERATURE.md                Stage 1 output (landscape)
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
│   ├── PLAN.md                      Stage 2 output (experiment plan)
│   └── TODOS.md                     Stage 2–6 shared task list
│
├── coder/                           ← OWNED BY: coder
│   └── {experiment-name}/           Stage 3 output (code)
│
├── analyzer/                        ← OWNED BY: analyzer
│   ├── NARRATIVE_REPORT.md          Stage 4 output (analysis report)
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
│   └── AUTO_REVIEW.md               Stage 5 output (review history)
│
└── cross-reviewer/                  ← OWNED BY: cross-reviewer (saved by calling agent)
    ├── novelty/                     Stage 1 novelty assessments
    ├── outline/                     Stage 6 outline reviews
    └── prose/                       Stage 6 per-section prose reviews

{PROJECTS_ROOT}/PROJECTS_STATE.json  Multi-project registry (Mode B)
```

## Key Rules

- Gate control is determined by `AUTO_PROCEED`
- **Never skip Stage 2 (Planning):** even when AUTO_PROCEED=true, wait for `PLAN.md` and `TODOS.md` before spawning Coder. When either is missing, **proactively wake Orchestrator** (spawn with /plan-research) to produce them. See WORKFLOW.md "Stage transition preconditions" and "Wake Orchestrator on demand".
- Stages 3–6 can run autonomously after Gate 1 (overnight mode)
- Review max 4 rounds; if exceeded → stop and report
- Multi-idea mode: both ideas share the same memory files
- Failed ideas always update `{PMEM}/ideation-memory.md` (IVE)
- Successful experiments always update `{PMEM}/experiment-memory.md` (ESE)
- Each agent writes ONLY to its owned subfolder — see `WORKSPACE.md`
- Failures are reported gracefully with suggested alternatives
