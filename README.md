# openclaw-research

An OpenClaw plugin for end-to-end automated research, from topic discovery to paper draft.

The current version emphasizes three things:

- Build a local PaperNexus graph before idea discovery
- Use file-backed state to support multi-project execution and reduce memory leakage across projects
- Enforce a `CLAIM_EVIDENCE_MATRIX` evidence gate before paper writing

It also upgrades the workflow from a simple ordered checklist to a state machine with a track portfolio:

- `PROJECT_MANIFEST.json` maintains coarse stage, micro-stage, budget, and gate state
- `TRACK_REGISTRY.json` maintains candidate / active / parked / killed hypothesis tracks
- `CLAIM_POLICY.md` defines how claims can move from analysis into writing

## Architecture

**Dual-agent architecture** (with memory isolation):

- **Researcher Agent** — orchestration side: topic discovery, track decisions, stage progression, and recovery
- **Coder Agent** — execution side: experiment implementation and atomic remote experiment launch
- **Reviewer Agent** — review side: independent evaluation without implementation details (read-only, no code execution)

**Hybrid review mode**:

- Day-to-day iteration: same-model reflection for fast fixes
- Critical checkpoints: cross-agent review for independent evaluation and reduced self-review blind spots

**Memory system**:

- QMD backend with per-agent isolation
- Project-level isolation: the project root is configurable via `projectsRoot`, and memory lives under `{PROJ}/memory/` (`ideation-memory`, `experiment-memory`, daily logs)
- Memory evolution types: IDE (idea discovery), IVE (idea validation failure), ESE (experiment strategy evolution)

**Graph-enhanced ideation**:

- Use PaperNexus to turn local PDF / Markdown literature into an explicit knowledge graph
- Run `research-lit` before brainstorming, pull full text for key papers, then run `graph-build` and `frontier-mapping`
- Let `idea-generator` read `FRONTIER_REPORT.md` and ideate from limitation / contradiction / transfer / composition frontiers
- If `papers-cool` finds a key paper that is not yet in the graph, ingest it before novelty or innovation analysis
- Maintain a track portfolio instead of picking a single top-1 idea, then apply `advance / merge / park / kill` after pilots

**Pre-writing quality gate**:

- Analyzer must produce `CLAIM_EVIDENCE_MATRIX.md`
- Analyzer also produces `TRACK_VERDICTS.md` to state whether each track should continue
- Writer may only elevate evidence-backed claims; unsupported claims must be downgraded to exploratory wording or sent back for more evidence

**Soft writing constraints**:

- Analyzer provides `THEORY_SUPPORT_NOTE.md` with only `green / red`
- Writer produces `STORYLINE_SKETCH.md` first, then summarizes theory / storyline / paragraph logic in `WRITING_SIGNALS.md`
- `red` does not block draft generation; it only requires more conservative automated writing and explicit risk handoff to human review

## Skills

| Skill | Type | Description |
|------|------|------|
| `research-pipeline` | Orchestration | End-to-end pipeline |
| `graph-build` | Atomic | Build or refresh the project-scoped PaperNexus literature graph |
| `frontier-mapping` | Atomic | Extract limitation / contradiction / transfer / composition frontiers from the graph |
| `idea-phase` | Orchestration | Idea discovery stage |
| `research-lit` | Atomic | Literature research |
| `papernexus` | Atomic | PaperNexus corpus/status/watch/refresh operations |
| `papernexus-agentic-reasoning` | Atomic | Structured graph-grounded innovation analysis |
| `idea-generator` | Atomic | Idea generation plus pilots |
| `novelty-check` | Atomic | Novelty verification |
| `experiment-phase` | Orchestration | Experiment stage |
| `run-experiment` | Atomic | SSH-based experiment deployment |
| `monitor-experiment` | Atomic | Experiment monitoring |
| `resume-pipeline` | Recovery | Per-agent pipeline recovery from state files |
| `analyze-results` | Atomic | Result analysis |
| `papernexus-reflection` | Atomic | Use reflection overlays to explain why experiments succeeded or failed |
| `review-phase` | Orchestration | Hybrid review loop |
| `paperreview-submit` | Atomic | Submit a PDF to paperreview.ai for external AI review |
| `paper-phase` | Orchestration | Paper-writing stage |
| `paper-plan` | Atomic | Paper outline generation |
| `paper-write` | Atomic | LaTeX writing |
| `paper-compile` | Atomic | PDF compilation |
| `research-reflect` | Atomic | Reflection checkpoint |

## Quick Start

1. Configure `openclaw.json` (see the bundled `openclaw.json` template)
2. Edit [agents/researcher/SERVER.md](/Users/iranb/Library/Mobile%20Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/agents/researcher/SERVER.md) with your GPU server information
3. Make sure passwordless SSH is configured
4. Make sure the `PaperNexus` repository is reachable: prefer `PAPERNEXUS_ROOT`, otherwise the plugin looks for a sibling `PaperNexus/` directory
5. Launch: `/research-pipeline "your research topic"`

After the first initialization, the project root should contain:

- `PROJECT_MANIFEST.json`
- `TRACK_REGISTRY.json`
- `CLAIM_POLICY.md`
- `graph/`

## Design References

- **EvoScientist** — multi-agent collaboration, memory evolution, and think_tool-style reflection
- **ARIS** — Claude Code-style skill orchestration, cross-model review, and file-driven state
