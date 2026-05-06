# NMI AutoResearch Go/No-Go Evidence Memo

> Date: 2026-05-06
> Target venue: Nature Machine Intelligence
> Candidate article type: Article
> System: ClawAutoResearch / AutoResearch

## 1. Executive Decision

Current recommendation: **conditional go**.

The system is plausible for Nature Machine Intelligence only if the paper is framed as a contribution to **reliable autonomous scientific workflow control**, not as a demo that "LLM agents can write papers".

The publishable center is:

> AutoResearch is a durable-state, graph-grounded control plane for autonomous scientific workflows. It turns scientific work into explicit stage contracts, runtime-recoverable state, graph-backed novelty gates, owner-routed handoffs, and review-pressure artifacts, improving workflow reliability and evidence discipline compared with chat-fragile agent pipelines.

The current repository already has the right architectural surfaces:

- durable workflow state in `PROJECT_MANIFEST.json`, `TRACK_REGISTRY.json`, and `.openclaw-research/`
- explicit stage machine for experiment and survey tracks
- graph presence checks before novelty-sensitive work
- artifact-backed handoff and mailbox/runtime recovery
- claim-evidence, review pressure, citation integrity, and writing contracts

The missing requirement for NMI is not another feature. It is a **controlled evidence package** showing that these surfaces measurably improve robustness, reproducibility, and paper-facing evidence quality.

## 2. NMI Fit And Constraints

Relevant official constraints, checked on 2026-05-06:

- NMI Articles are expected to report original research of substantial interest to the machine intelligence community.
- Article main text is limited to about 3,500 words, with up to 6 display items and a 150-word abstract.
- Initial submission formatting is flexible, but the manuscript must still include enough methodological and reporting detail for editorial assessment.
- Code, data, and reporting standards matter. The submission needs clear Code Availability and Data Availability statements.
- LLM or generative AI use must be disclosed when it materially contributes to research, analysis, or writing. LLMs cannot be authors.
- Presubmission enquiries are not supported for NMI, so the go/no-go decision must happen internally before submission.

Official pages:

- https://www.nature.com/natmachintell/content
- https://www.nature.com/natmachintell/submission-guidelines/initial-formatting
- https://www.nature.com/natmachintell/submission-guidelines/preparing-your-submission
- https://www.nature.com/natmachintell/editorial-policies/reporting-standards
- https://www.nature.com/natmachintell/editorial-policies/ai
- https://www.nature.com/natmachintell/submission-guidelines/presubmission-enquiries

## 3. Core Contribution Claim

The paper should make one primary claim and three supporting claims.

Primary claim:

> Durable, artifact-backed workflow control improves the reliability and auditability of autonomous scientific research agents.

Supporting claims:

1. **State discipline reduces workflow drift.**
   AutoResearch externalizes stage, owner, readiness, handoff, and runtime facts into replayable project artifacts instead of leaving them in conversation context.

2. **Graph-gated research reduces unsupported novelty and citation claims.**
   The system blocks or repairs novelty-sensitive stages when required literature is absent from the PaperNexus graph.

3. **Review-pressure and claim-evidence contracts improve paper-facing quality.**
   Analyzer and reviewer packets force claims, experiments, unsupported claims, citation integrity, and writing readiness to be inspected before draft generation.

Claims to avoid:

- "fully autonomous science"
- "automatically produces publishable papers"
- "human-level researcher"
- "guaranteed novelty"
- "end-to-end submission without human gate"

Those claims are too broad and are not supported by the current system contract.

## 4. Proposed Paper Title Options

Best current title:

> Durable Workflow Control for Autonomous Scientific Research Agents

Alternatives:

- Graph-Grounded Control Planes for Reliable Autonomous Research Workflows
- Recoverable State Machines for LLM-Driven Scientific Discovery Pipelines
- Artifact-Backed Coordination for Autonomous Scientific Research

Avoid titles that foreground "paper writing" or "automatic publication".

## 5. Six-Figure Storyboard

NMI Articles allow a small number of display items. The strongest version should use exactly six figures/tables.

### Figure 1: System Overview

Purpose: show AutoResearch as a control plane, not a single agent.

Panels:

- experiment track: `setup -> graph_build -> frontier_mapping -> idea -> plan -> code -> experiment -> analyze -> review -> write -> submit`
- survey track: `setup -> survey_review -> write -> submit`
- durable artifacts: manifest, track registry, mailbox, runtime queue/sessions, trace/diagnostics, claim-evidence packet
- owner routing: researcher, orchestrator, coder, analyzer, reviewer, academic writer

Source material:

- `README.md`
- `docs/architecture/workflow-control-plane.md`
- `docs/architecture/auto-pipeline-handoffs.md`
- `docs/reference/state-contracts.md`

### Figure 2: Reliability Benchmark

Purpose: prove that durable control reduces stalls and drift.

Experiment:

- run a fixed task suite under multiple system variants
- record completion, stalls, owner drift, unresolved handoffs, recovery success

Variants:

- single-agent chat baseline
- multi-agent without durable state
- durable state without graph gate
- durable state with graph gate but no structured handoff recovery
- full AutoResearch

Metrics:

- stage completion rate
- unresolved stall rate
- owner/stage drift rate
- mean successful stages per run
- recovery success after injected interruption
- number of manual interventions

### Figure 3: Recovery And Replay Study

Purpose: show the distinctive value of runtime queue/session/mailbox artifacts.

Injected failures:

- process restart during handoff
- stale `running` session
- missing or stale mailbox entry
- graph import incomplete
- experiment runtime signal missing
- write stage entered without review packet

Metrics:

- correct blocking reason identified
- correct next owner/action recovered
- time to recover
- false forward progress rate
- repair artifact created

Expected result:

- full AutoResearch should prefer `repair_artifact`, `background`, or `wait_human` over unsafe handoff when contracts are incomplete.

### Figure 4: Graph-Gated Novelty And Citation Discipline

Purpose: show that graph presence changes research quality, not only runtime behavior.

Experiment:

- compare ideation/writing with and without graph presence enforcement
- use a fixed corpus of topics and canonical papers
- have blinded reviewers or rubric score novelty grounding and citation support

Metrics:

- unsupported novelty claims
- missing closest-paper comparisons
- citation hallucination or unverifiable citation rate
- claim-to-source alignment score
- number of graph repair events before writing

### Figure 5: Review-Pressure And Claim-Evidence Quality

Purpose: show that analyzer/reviewer contracts improve paper-facing evidence.

Experiment:

- compare drafts produced before and after `CLAIM_EVIDENCE_MATRIX`, `UNSUPPORTED_CLAIMS`, `TRACK_VERDICTS`, and review pressure materialization

Metrics:

- unsupported headline claims
- claims with direct experiment evidence
- reviewer-objection coverage
- citation integrity pass rate
- human review score on clarity, evidence sufficiency, and overclaiming

### Figure 6: Cost, Latency, And Reproducibility Trade-Offs

Purpose: show the price of reliability and the practical operating envelope.

Metrics:

- wall-clock time per completed workflow
- token/API cost
- human interventions
- generated artifacts per run
- artifact replay success from clean checkout
- result regeneration success from released bundle

This figure prevents the paper from looking like a one-sided demo.

## 6. Benchmark Suite To Build

The minimum viable NMI benchmark should include at least three task families.

### Family A: Workflow-Control Tasks

Goal: test whether the system advances, blocks, or repairs correctly.

Tasks:

- initialize experiment project from topic
- initialize survey project from topic
- complete graph build readiness with partial missing papers
- route `idea -> plan`
- route `plan -> code`
- route `experiment -> analyze`
- route `review -> write`
- route `write -> submit`

Evidence:

- project snapshot before/after
- `auto_iterator_tick` decision
- `workflow-events.jsonl`
- `workflow-trace.jsonl`
- runtime queue/session/mailbox snapshots

### Family B: Fault-Injection Tasks

Goal: test recovery rather than happy-path completion.

Faults:

- corrupt or stale owner in manifest
- stale runtime queue entry
- stale runtime session
- missing mailbox acknowledgement
- missing review pressure packet
- missing paper story state
- graph presence incomplete
- experiment ledger and runtime signal disagreement

Expected outputs:

- blocking reason
- layer classification: readiness, owner routing, handoff delivery, or runtime replay
- repair action or safe wait state
- no unsafe stage advancement

### Family C: Research-Quality Tasks

Goal: test whether control-plane artifacts improve scientific artifacts.

Tasks:

- generate ideation packet for fixed topic/corpus
- produce research program from ideation contract
- materialize claim-evidence matrix from experiment summary
- run review-pressure audit
- produce writing-support artifacts

Metrics:

- novelty grounding score
- closest-prior-work coverage
- unsupported-claim count
- claim-evidence coverage
- reviewer objection coverage
- citation integrity pass rate

## 7. Ablation Matrix

Required ablations:

| Variant | Removed component | Main question |
| --- | --- | --- |
| Full AutoResearch | none | best achievable reliability and evidence discipline |
| No durable runtime | queue/session/mailbox/trace removed or ignored | does replayable runtime state reduce stalls? |
| No graph gate | graph presence not enforced | does graph grounding reduce unsupported novelty and citation drift? |
| No structured handoff | owner changes via free-form messages | do prepared handoffs reduce owner/stage drift? |
| No review pressure | reviewer packet omitted | does reject-first review reduce unsupported claims? |
| No materializers | contracts remain inline or implicit | do artifact-backed packets improve recovery and reproducibility? |

Each ablation should run over the same task suite and use the same model/provider settings where feasible.

## 8. Statistical Requirements

Minimum reporting bar:

- at least 20 independent runs per workflow-control condition, or fewer only if cost is prohibitive and confidence intervals are still reported
- at least 5-10 topics for research-quality tasks
- fixed random seeds or logged nondeterministic provider settings
- bootstrap confidence intervals for completion/recovery metrics
- paired tests where the same task is run under multiple variants
- exact denominators for every rate
- explicit failure taxonomy, not just aggregate failure count

Required tables:

- task suite summary
- variant-level completion/recovery table
- fault-injection recovery table
- human review rubric table
- cost/latency table

## 9. Release And Reproducibility Package

Before submission, create a frozen artifact pack:

- repository release tag
- dependency lockfile
- benchmark runner command
- benchmark task definitions
- anonymized workflow state bundles
- raw JSONL traces and diagnostics
- result aggregation script
- generated tables and figures
- model/provider configuration template with secrets removed
- Code Availability statement
- Data Availability statement

Do not submit without a clean-machine replay check.

The replay check should verify:

- `npm test`
- `npm run build`
- benchmark runner on a small fixture subset
- table regeneration from raw results
- figure regeneration from tables
- no secret/token leakage in released artifacts

## 10. Draft Manuscript Outline

### Abstract

One paragraph:

- problem: autonomous research agents are brittle because workflow state, ownership, and evidence contracts are often implicit
- method: durable state machine, graph-gated readiness, structured handoff, runtime replay, review-pressure artifacts
- results: reliability/recovery/evidence improvements on benchmark suite
- implication: autonomous scientific workflows need control-plane design, not just stronger models

### Introduction

Core argument:

- LLM agents can generate plausible scientific artifacts, but plausibility is not enough for scientific workflows.
- Failures often occur at the control plane: stale state, owner drift, missing handoffs, incomplete literature grounding, unsupported claims.
- AutoResearch operationalizes scientific workflows as recoverable, artifact-backed state machines.

### Results

Suggested sections:

1. AutoResearch represents scientific workflows as durable stage contracts.
2. Durable control improves workflow completion and reduces unsafe advancement.
3. Runtime artifacts enable recovery from injected workflow failures.
4. Graph gating and review-pressure packets improve research-quality artifacts.
5. Reliability has measurable cost and latency trade-offs.

### Discussion

Key points:

- The result is not fully autonomous science.
- The contribution is a control-plane design pattern for AI research agents.
- Human gates remain necessary for final claims and submission.
- Limitations include model/provider dependence, benchmark size, domain coverage, and evaluation cost.

### Methods

Include:

- system implementation
- workflow stage definitions
- benchmark tasks
- ablations
- fault injection
- human review protocol
- statistical analysis
- artifact release and reproducibility protocol
- AI/LLM use disclosure

## 11. Go/No-Go Gates

### Go Gate 1: Reliability

Proceed only if full AutoResearch beats all weaker variants on:

- completion rate
- unresolved stall rate
- recovery success
- owner/stage drift

The effect does not need to be huge, but it must be consistent and statistically visible.

### Go Gate 2: Research Quality

Proceed only if graph gating and review-pressure packets reduce:

- unsupported novelty claims
- citation drift
- unsupported headline claims
- missing closest-work comparisons

If the improvement is only anecdotal, downgrade target venue.

### Go Gate 3: Reproducibility

Proceed only if a fresh checkout can:

- run the fixture benchmark
- regenerate tables
- regenerate figures
- inspect released workflow traces

### Go Gate 4: Scope Honesty

Proceed only if the manuscript clearly states:

- the system is not fully autonomous submission
- human gate remains mandatory
- LLM outputs are audited rather than trusted
- benchmark is about workflow reliability and evidence discipline, not proof of scientific creativity

## 12. Highest Rejection Risks

1. **"This is engineering, not science."**
   Counter with controlled ablations, fault injection, and generalizable control-plane principles.

2. **"The benchmark is self-serving."**
   Counter with fixed tasks, released artifacts, blinded review rubrics, and baselines.

3. **"The system depends on proprietary LLMs."**
   Counter with model-agnostic architecture, logged provider settings, and sensitivity analysis where possible.

4. **"It writes plausible text, not verified science."**
   Counter by making the paper about state/recovery/evidence discipline, not automatic discovery.

5. **"The contribution is incremental versus existing agent frameworks."**
   Counter with concrete mechanisms: durable contracts, graph readiness, owner-routed handoff, runtime replay, and review-pressure materialization.

## 13. Immediate Work Plan

### Week 1: Freeze The Evaluation Contract

- define task suite
- define variants
- define fault injections
- define metrics
- define released artifact schema
- write benchmark runner spec

Deliverable:

- `NMI_BENCHMARK_PROTOCOL.md`

### Week 2: Implement And Run Fixture Benchmark

- implement deterministic fixture-mode benchmark
- collect workflow state bundles
- aggregate reliability and recovery metrics
- validate table regeneration

Deliverable:

- first reliability/recovery result table

### Week 3: Run Research-Quality Evaluation

- choose topics/corpora
- run graph/no-graph and review/no-review variants
- build blinded rubric packet
- score unsupported claims and citation grounding

Deliverable:

- research-quality evaluation table

### Week 4: Draft Manuscript Skeleton

- write abstract, introduction, results skeleton, methods
- generate figures 1-3 from actual data
- prepare Code/Data Availability drafts

Deliverable:

- NMI initial manuscript draft v0.1

## 14. Bottom Line

AutoResearch has a credible NMI story if the paper is disciplined:

- make the contribution about **control-plane reliability for autonomous scientific workflows**
- prove it with **benchmark, ablation, fault injection, and released traces**
- avoid claims of autonomous scientific creativity unless directly supported
- keep human gates and AI-use disclosure explicit

Without the benchmark and ablation package, the work should not be submitted to NMI. With that package, it becomes a serious Article candidate.
