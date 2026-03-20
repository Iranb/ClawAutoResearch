# Parallel Research Redesign for OpenClaw

## Purpose

This document proposes a practical redesign for `openclaw-research` so the system can:

1. support true multi-agent parallel research instead of mostly stage-serial handoff
2. use PaperNexus as an explicit knowledge graph layer for brainstorming and novelty search
3. reduce cross-project memory confusion through stricter state and memory boundaries
4. improve paper quality by adding stronger evidence gates before writing and submission

The goal is not to replace the current architecture wholesale. The goal is to evolve the existing `Researcher / Orchestrator / Coder / Analyzer / Reviewer / Academic Writer / Cross-Reviewer` stack into something closer to a real research group.

---

## Current Diagnosis

### 1. The system is multi-agent, but the workflow is still mostly serial

`WORKFLOW.md` defines a single linear control path:

`IDEA -> PLAN -> CODE -> EXPERIMENT -> ANALYZE -> REVIEW -> WRITE -> SUBMIT`

This is disciplined, but it behaves like a relay race instead of a lab.

Practical consequence:

- only one main idea path is strongly represented
- brainstorming, planning, and review are not treated as concurrent research work
- most agents are passive until the previous stage fully finishes
- the only strong parallelism is experiment dispatch on GPUs

### 2. Idea generation is broad, but not dialectical

`idea-generator` produces one brainstorm batch, then filters and pilots it.
This is useful, but it does not simulate how humans produce better ideas:

- one person proposes
- another attacks assumptions
- another connects distant methods
- another checks literature threats
- the team converges on a better reframing

Current scoring is also overly scalar:

- novelty, impact, feasibility are compressed early into one rank
- strong but risky ideas are likely filtered too early
- there is little explicit modeling of contradiction, transferability, or composition

### 3. The knowledge graph is not yet a first-class control primitive

You already have a strong substrate in PaperNexus:

- explicit node types: `Problem`, `Method`, `Claim`, `Finding`, `Limitation`, `Assumption`, `Evidence`, `Dataset`, `Metric`, `FutureDirection`
- explicit relations: `SUPPORTED_BY`, `HAS_LIMITATION`, `FAILS_UNDER`, `CONTRADICTS`, `COMPATIBLE_WITH`, `COMBINES_WITH`, `MAY_BE_ADDRESSED_BY`
- commands for `query`, `context`, `impact`, `ideas`, `brainstorm`

But the current research workflow does not require agents to build or traverse graph subproblems before selecting ideas, planning experiments, or writing claims.

### 4. Memory is isolated by project directory, but not strongly typed by task intent

The current memory scheme is better than shared global memory, but still too coarse:

- `ideation-memory.md`
- `experiment-memory.md`
- daily logs

This is enough for recall, but not enough for safe coordination across:

- multiple projects in the same domain
- multiple competing idea tracks inside one project
- multiple experiment batches over time
- multiple review rounds

The current memory templates are mostly narrative summaries. They are not keyed by:

- `project_id`
- `track_id`
- `claim_id`
- `evidence_ref`
- `decision_status`
- `expiry / invalidation`

### 5. Multi-project support contains naming drift

`research-queue` is conceptually aligned with parallel projects, but it still uses inconsistent path names such as:

- `planner/` vs `orchestrator/`
- `writer/` vs `academic_writer/`
- `research/<project-id>/` vs `{PROJECTS_ROOT}/{proj-id}/`

This will cause queue orchestration, resumption, and memory lookup to drift from the actual workspace layout.

### 6. The pipeline quality bar is too late

The current workflow does strong review at:

- internal review after analysis
- cross-review during writing
- external review after PDF generation

What is missing is a stronger pre-writing evidence gate:

- which claims are actually supported
- which claims are only exploratory
- which experiments are still missing
- whether the idea remains novel after full implementation

Without that gate, the writer can end up polishing an unstable story.

---

## Design Principles

### Principle A: Parallelize cognition, not only compute

The system should support three layers of parallelism:

1. portfolio parallelism: multiple projects
2. track parallelism: multiple idea or experiment tracks inside one project
3. compute parallelism: multiple runs inside one track

### Principle B: Separate divergence from convergence

Brainstorming should not directly output "the best idea".
It should output a structured frontier of candidate directions, then converge through attack, synthesis, and evidence checks.

### Principle C: Treat graph state as durable research infrastructure

PaperNexus should not be a side tool.
It should become the shared research substrate for:

- idea search
- novelty checking
- experiment planning
- claim-evidence tracing
- related-work synthesis

### Principle D: Memory should be typed, scoped, and revocable

Every durable memory item should answer:

- which project does this belong to
- which track does this belong to
- what evidence supports it
- who wrote it
- at what stage it was created
- whether it is still active, superseded, or invalidated

### Principle E: Writing starts from evidence packets, not from the whole repo

The writer should consume a curated `claim -> evidence -> artifact` package, not raw logs plus intuition.

---

## Proposed Organization Model

## Keep the existing agents, but change their operating modes

### Researcher

Role:

- project manager
- portfolio scheduler
- evidence integrator
- final decision owner for track progression

Should no longer do:

- all brainstorming centrally
- all stage transitions as a strict single-threaded narrator

### Orchestrator

Role:

- planner
- reflection engine
- branch manager

New responsibility:

- maintain track graph and branch decisions after each major evidence update

### Coder

Role:

- implementation for one experiment track at a time

New responsibility:

- report code-level feasibility and implementation risk back to the track registry

### Analyzer

Role:

- statistics
- figures
- evidence normalization

New responsibility:

- generate claim-evidence packets, not only a narrative report

### Reviewer

Role:

- internal scientific reviewer

New responsibility:

- review evidence sufficiency before writing, not only after analysis

### Academic Writer

Role:

- paper construction from evidence packets

New responsibility:

- maintain `CLAIM_EVIDENCE_MATRIX.md`

### Cross-Reviewer

Role:

- adversarial critic

New responsibility:

- act earlier in the idea phase as a devil's advocate against novelty and framing

### Recommended New Logical Modes

These can be implemented as new agents or as explicit sub-modes of existing agents.

- `Scout`: searches graph neighborhoods and frontier gaps
- `Synthesizer`: composes methods or transfers ideas across clusters
- `Challenger`: attacks assumptions, novelty claims, and weak causality
- `Memory Steward`: validates what becomes durable memory

If you want minimal implementation change, do not add new top-level agents yet. Add these as invocation modes under `Researcher`, `Orchestrator`, and `Cross-Reviewer`.

---

## Proposed Project State Model

Each project should contain these durable control files:

```text
{PROJ}/
  PROJECT_MANIFEST.json
  TRACK_REGISTRY.json
  CLAIM_REGISTRY.json
  DECISION_LOG.md
  graph/
    PAPERNEXUS_CORPUS.json
    SUBGRAPH_CACHE/
  memory/
    ideation-memory.md
    experiment-memory.md
    decision-memory.md
    evidence-memory.md
```

### `PROJECT_MANIFEST.json`

Purpose:

- identity and boundaries for the project

Suggested fields:

```json
{
  "project_id": "proj_xxx",
  "title": "short title",
  "domain": "llm reasoning",
  "target_venues": ["ICLR", "NeurIPS"],
  "corpus_name": "proj_xxx-corpus",
  "active_track_ids": ["track_a", "track_b"],
  "primary_metric": "accuracy",
  "status": "active"
}
```

### `TRACK_REGISTRY.json`

Purpose:

- track multiple competing hypotheses or branches inside one project

Suggested fields per track:

```json
{
  "track_id": "track_a",
  "parent_track_id": null,
  "title": "limitation-driven hybrid retrieval",
  "hypothesis": "one sentence",
  "status": "diverging",
  "stage": "idea",
  "novelty_status": "cautious",
  "evidence_status": "pilot_positive",
  "owner": "researcher",
  "linked_graph_nodes": ["problem:xxx", "limitation:yyy", "method:zzz"],
  "last_decision": "advance_to_plan"
}
```

### `CLAIM_REGISTRY.json`

Purpose:

- writing-quality control before writing starts

Suggested fields per claim:

```json
{
  "claim_id": "c01",
  "text": "Our method improves X under Y.",
  "claim_type": "main_result",
  "track_id": "track_a",
  "supported_by": ["table:t1", "figure:f2", "exp:e004"],
  "status": "supported",
  "writer_safe": true
}
```

---

## PaperNexus Integration Model

## Where the graph enters the workflow

### Stage G0: Corpus Build

Before idea generation:

1. ingest project paper folder into PaperNexus
2. keep a named corpus per project
3. store corpus name in `PROJECT_MANIFEST.json`

Commands:

```bash
node ./src/cli/index.js analyze ./papers --name <proj-corpus>
node ./src/cli/index.js status --corpus <proj-corpus>
```

### Stage G1: Frontier Mapping

Before brainstorming, require four graph passes:

1. `problem frontier`
2. `limitation frontier`
3. `contradiction frontier`
4. `composition frontier`

Suggested commands:

```bash
node ./src/cli/index.js query "<topic>" --corpus <proj-corpus>
node ./src/cli/index.js context "<problem or method>" --corpus <proj-corpus>
node ./src/cli/index.js impact "<method>" --corpus <proj-corpus>
node ./src/cli/index.js brainstorm "<topic>" --corpus <proj-corpus> --mode diverge
node ./src/cli/index.js ideas "<topic>" --corpus <proj-corpus>
```

### Stage G2: Subgraph Packaging

Do not pass the whole graph to every agent.
Package small subgraphs for tasks such as:

- `subgraph_problem_gap.json`
- `subgraph_method_transfer.json`
- `subgraph_contradiction_cluster.json`
- `subgraph_claim_evidence.json`

This is important because agents brainstorm better from focused structure than from a giant raw corpus.

---

## How the graph should drive brainstorming

## Replace one-shot brainstorming with a graph-grounded dialectic loop

### Step 1: Diverge from different graph lenses

Create at least four candidate sets:

1. limitation-driven ideas
2. contradiction-driven ideas
3. transfer-driven ideas
4. composition-driven ideas

Example mappings:

- `HAS_LIMITATION + MAY_BE_ADDRESSED_BY` -> "fix a known weakness"
- `CONTRADICTS` -> "resolve a disagreement in the literature"
- `TRANSFERABLE_TO` -> "move a method across domains"
- `COMPATIBLE_WITH + COMBINES_WITH` -> "compose two non-conflicting mechanisms"

### Step 2: Force adversarial attack before ranking

For each candidate idea, require a challenger pass:

- What prior work can kill this?
- Is the novelty real or just a repackaging?
- What assumption is weakest?
- What negative pilot would falsify it?

### Step 3: Converge by frontier portfolio, not one scalar score

Instead of one top-1 rank, keep a portfolio:

- `safe-bet track`
- `high-upside track`
- `bridge/composition track`

This matches real labs better. Humans often carry one reliable paper path plus one more ambitious path.

### Step 4: Pilot by track, then merge or kill

Use pilot evidence to do one of four actions:

- advance
- merge with another track
- park for later
- kill and write to failed memory

---

## Proposed Workflow V2

## New stage graph

```text
SETUP
  -> GRAPH_BUILD
  -> FRONTIER_MAPPING
  -> DIVERGE_IDEAS
  -> ATTACK_AND_NOVELTY
  -> TRACK_SELECTION
  -> PARALLEL_PLAN
  -> PILOT_IMPLEMENT
  -> PILOT_EXECUTE
  -> TRACK_DECISION
  -> FULL_EXPERIMENT
  -> EVIDENCE_PACKAGING
  -> INTERNAL_REVIEW
  -> PAPER_CONSTRUCTION
  -> PRE_SUBMISSION_REVIEW
  -> SUBMIT
  -> REVISE / DONE
```

## Stage-by-stage definition

### 0. SETUP

Outputs:

- `PROJECT_MANIFEST.json`
- empty `TRACK_REGISTRY.json`
- memory files initialized

Gate:

- none

### 1. GRAPH_BUILD

Owner:

- Researcher

Outputs:

- PaperNexus corpus
- graph metadata under `{PROJ}/graph/`

Exit condition:

- corpus indexed successfully

### 2. FRONTIER_MAPPING

Owner:

- Researcher in `Scout` mode

Outputs:

- `FRONTIER_REPORT.md`
- `subgraph_*` caches

Parallelism:

- problem mapping
- limitation mapping
- contradiction mapping
- transfer mapping

Exit condition:

- at least one high-signal subgraph per lens

### 3. DIVERGE_IDEAS

Owner:

- Researcher plus Cross-Reviewer in novelty mode

Outputs:

- `TRACK_REGISTRY.json` populated with 4-8 candidate tracks
- `IDEA_SPACE.md`

Parallelism:

- one branch per graph lens

Exit condition:

- each track linked to graph nodes and a falsifiable pilot

### 4. ATTACK_AND_NOVELTY

Owner:

- Cross-Reviewer
- Researcher

Outputs:

- novelty verdict per track
- attack memo per track

Exit condition:

- each live track has one of:
  - `confirmed`
  - `cautious`
  - `abandon`

### 5. TRACK_SELECTION

Owner:

- Researcher

Outputs:

- 2-3 active tracks
- 1 parked track maximum

Rule:

- keep a portfolio, not only one winner

### 6. PARALLEL_PLAN

Owner:

- Orchestrator

Outputs:

- one plan section per active track
- shared baseline matrix
- compute budget by track

Important change:

- `PLAN.md` should become track-aware
- `TODOS.md` should become dependency-aware

### 7. PILOT_IMPLEMENT

Owner:

- Coder

Parallelism:

- one pilot implementation bundle per track

Exit condition:

- all pilot bundles dry-run successfully

### 8. PILOT_EXECUTE

Owner:

- Researcher

Parallelism:

- one pilot batch per track

Exit condition:

- pilot evidence collected into comparable form

### 9. TRACK_DECISION

Owner:

- Researcher + Orchestrator reflection mode

Outputs:

- `advance`, `merge`, `park`, or `kill` per track

Important rule:

- do not enter full experiment with more than 2 active tracks unless resources are abundant

### 10. FULL_EXPERIMENT

Owner:

- Researcher + Coder + Analyzer

Parallelism:

- within-track experiment groups
- across-track experiments when independent

### 11. EVIDENCE_PACKAGING

Owner:

- Analyzer

Outputs:

- `CLAIM_EVIDENCE_MATRIX.md`
- `EVIDENCE_PACKETS/`
- `NARRATIVE_REPORT.md`

This stage is mandatory before writing.

### 12. INTERNAL_REVIEW

Owner:

- Reviewer

New decision categories:

- missing baseline
- missing ablation
- claim too strong
- narrative mismatch
- write-ready

### 13. PAPER_CONSTRUCTION

Owner:

- Academic Writer

Inputs:

- `CLAIM_EVIDENCE_MATRIX.md`
- evidence packets
- reviewed narrative

Rule:

- every major claim in the paper must map to explicit evidence IDs

### 14. PRE_SUBMISSION_REVIEW

Owner:

- Cross-Reviewer
- Reviewer

Rule:

- no PDF submission if any primary claim is `unsupported` or `exploratory_only`

---

## Quality Control Gates

## Replace generic stage gates with stronger scientific gates

### Gate Q1: Track Readiness

Before planning:

- each active track must have
  - graph grounding
  - novelty memo
  - falsifiable pilot

### Gate Q2: Pilot Decision

Before full experiments:

- each advancing track must have
  - positive pilot signal, or
  - a strong theoretical rationale plus bounded compute risk

### Gate Q3: Evidence Sufficiency

Before writing:

- primary claims supported by artifacts
- baselines complete
- minimum seed/statistics policy satisfied
- limitations explicitly logged

### Gate Q4: Paper Safety

Before submission:

- no unsupported headline claim
- contributions aligned with actual evidence
- related work covers nearest threats

---

## Memory Redesign

## Minimum viable memory hierarchy

### Layer 1: Project memory

Scope:

- only this project

Contains:

- track history
- project decisions
- claim/evidence states

### Layer 2: Domain memory

Scope:

- reusable patterns across projects in the same domain

Contains:

- recurring baselines
- common failure modes
- server and implementation heuristics

Should not contain:

- unresolved project-specific claims

### Layer 3: Session scratch memory

Scope:

- current run only

Contains:

- temporary notes
- incomplete hypotheses
- unverified interpretation

This layer should not be treated as durable memory until promoted by a steward step.

## Promotion rules

Only promote memory when all of the following exist:

- source stage
- project and track id
- evidence pointer
- confidence label

Recommended labels:

- `confirmed`
- `working_assumption`
- `failed`
- `superseded`

## Suggested file additions

```text
{PROJ}/memory/
  decision-memory.md
  evidence-memory.md
  scratch/
    session-<timestamp>.md
```

`decision-memory.md`:

- major branch decisions
- why a track was advanced or killed

`evidence-memory.md`:

- reusable experimental observations that are broader than one run

---

## Concrete Changes Recommended for This Repo

## Priority 0: Fix naming drift and queue mismatch

Update `research-queue` so it uses:

- `orchestrator/` instead of `planner/`
- `academic_writer/` instead of `writer/`
- `{PROJECTS_ROOT}/{proj-id}/` consistently

This is required before true multi-project orchestration is trustworthy.

## Priority 1: Add graph stages before idea generation

Update `WORKFLOW.md` so `SETUP` is followed by:

- `GRAPH_BUILD`
- `FRONTIER_MAPPING`

These should be mandatory for new projects.

## Priority 2: Make planning track-aware

Update `plan-research` so it can plan:

- shared baselines
- per-track experiments
- merge points
- kill criteria

## Priority 3: Add reflection after pilot and after full experiment groups

Borrow the strongest EvoScientist pattern:

- planner reflection after meaningful evidence arrives
- plan update JSON
- explicit modifications to next stages

## Priority 4: Add claim-evidence packaging before writing

Analyzer should output:

- `CLAIM_EVIDENCE_MATRIX.md`
- `UNSUPPORTED_CLAIMS.md`

Writer should refuse strong claims not marked supported.

## Priority 5: Integrate PaperNexus as MCP or CLI dependency for Researcher

The minimal integration path is:

1. build corpus at project start
2. save corpus name in project manifest
3. require `query/context/ideas/brainstorm` outputs in idea phase
4. cache subgraphs in project graph folder

---

## Minimal Implementation Roadmap

### Phase 1

- fix `research-queue` path inconsistencies
- add `PROJECT_MANIFEST.json`
- add `TRACK_REGISTRY.json`
- add graph build step to workflow

### Phase 2

- make `idea-phase` generate multiple typed tracks
- integrate PaperNexus subgraph reports
- add attack and novelty pass before selection

### Phase 3

- make `plan-research` track-aware
- add Orchestrator reflection mode
- add `CLAIM_EVIDENCE_MATRIX.md`

### Phase 4

- harden multi-project scheduler
- add memory promotion rules
- add evidence-based submission gate

---

## Bottom Line

Your current system already has the right skeleton:

- separated agent ownership
- file-driven stage transitions
- project-isolated memory
- internal and external review loops

What it lacks is not more agents. It lacks stronger intermediate state:

- graph-grounded frontier state
- track state
- claim-evidence state
- typed decision memory

If you add those four things, the whole system will start behaving much more like a real research team:

- multiple possible ideas stay alive longer
- brainstorming becomes graph-grounded instead of prompt-only
- review becomes evidence-aware instead of late-stage narrative repair
- multi-project execution becomes safer because project identity and memory boundaries are explicit

