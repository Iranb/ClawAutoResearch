# openclaw-research

`openclaw-research` is an OpenClaw plugin for automated research projects with:

- PaperNexus-grounded literature ingestion and graph reasoning
- deterministic workflow control and stage regression
- structured experiment memory and innovation reflection
- multi-agent planning, coding, analysis, review, and writing
- proof-aware writing with appendix derivations
- optional Lobster-based deterministic stage handoff

This repository is designed for long-running research projects that must survive restarts, agent switches, Discord routing, and repeated revision loops.

## Auto Mode Overview

The current system now includes a practical Auto mode instead of a purely advisory one.

### 1. Two automation levels

- `conservative`
  - tries to keep the workflow moving automatically
  - better as the default first deployment mode
- `aggressive`
  - pushes stage continuation, remediation, and gate handling more actively
  - better once you already trust the project layout and control loop

### 2. Risk does not immediately force a downgrade

The system no longer drops to a safer mode at the first sign of risk.

The new control loop is:

- detect risk
- launch a multi-agent discussion round
- attempt a bounded remediation pass
- downgrade only if repeated discussion rounds still fail to resolve the risk

### 3. Auto discussion and mitigation are visible

The risk discussion panel currently centers on:

- `researcher`
- `analyzer`
- `reviewer`

The system can aggregate their responses, derive action items and blockers, and route the remediation task to the most appropriate owner.

### 4. `/workflow-status` now exposes the real discussion trail

Running `/workflow-status` now shows:

- `configuredAutoMode`
- `effectiveAutoMode`
- risk reasons and mitigation rounds
- current auto discussion state
- current auto gate review state
- per-agent summaries, action items, blockers, and response excerpts

This makes it possible to check whether the system actually discussed a risk instead of only reporting that it did.

## What This System Does

The plugin turns research execution from a prompt-only conversation into a durable workflow driven by:

- project state files such as `PROJECT_MANIFEST.json`, `TRACK_REGISTRY.json`, and `EXPERIMENT_LEDGER.json`
- runtime tools such as `research_workflow` and `research_memory`
- workflow guard hooks that inject state, block unsafe actions, and preserve stage order
- role-specific skills for Researcher, Orchestrator, Coder, Analyzer, Writer, Reviewer, and Cross-Reviewer

The result is a research framework that can:

- create and resume projects
- ingest literature and build a PaperNexus-backed corpus
- generate and filter innovation tracks
- plan experiments and implement code
- run and monitor experiments
- analyze results and create structured theory/proof packets
- write papers against a template with appendix-aware derivations
- keep stage progress, owner routing, and channel updates synchronized

## Core Capabilities

### 1. Deterministic Workflow Control

The workflow is centered on `research_workflow.auto_iterator_tick` plus runtime workflow guard rules.

Key behaviors:

- explicit stage ownership
- hard stage preconditions
- regressions when required state is missing
- structured next-owner dispatch
- stage-change broadcast back to the project channel
- durable recovery through `resume-pipeline`

The main stage order is:

`setup -> graph_build -> frontier_mapping -> idea -> plan -> code -> experiment -> analyze -> review -> write -> submit -> done`

Revision loops are preserved. Forward handoff happens only when a stage is genuinely complete. If review or validation says “revise”, “more experiments”, or “roll back”, the project stays in the current stage or moves backward.

### 2. PaperNexus-First Literature And Graph Loop

The literature path is Markdown-first and graph-aware.

Preferred full-text acquisition order:

1. `papers-cool` as the guaranteed baseline search
2. optional `pasa-paper-search` as a second retrieval source
3. `hugging-face-paper-pages` for Markdown
4. `arxiv2md-api` as the direct raw-markdown fallback for arXiv papers
5. `arxiv2md` as the legacy Markdown fallback for arXiv papers
6. PDF only as the last fallback

Important guarantees:

- papers are merged by canonical identity
- `PAPER_SOURCE_INDEX.json` records source kind, source provider, and retrieval providers
- graph presence is checked against the canonical paper set before novelty-sensitive work
- stale or invalid downloads are rejected before they contaminate the shared graph inputs

The default source roots are shared PaperNexus paths such as:

- `~/.papernexus/papers`
- `~/.papernexus/index-store`

If a remote PaperNexus Web/API is configured in plugin policy, Researcher should prefer that remote endpoint for graph-heavy access and use the configured bearer-token env var instead of assuming anonymous local access. If a remote MinerU URL is also configured, PDF materialization should prefer that remote parser path before local Docling or Marker fallbacks.

Project-local `graph/` keeps workflow-facing reports, checks, and frontier files; it is not a separate corpus directory.

### 3. Brainstorming Starts During Research

Brainstorming is not delayed until the idea stage.

During `research-lit`, Researcher is now expected to maintain:

- `researcher/RESEARCH_BRAINSTORM.md`

This file captures:

- mechanism hypotheses
- part-level decomposition opportunities
- manifold or capacity hypotheses
- contradictions and unresolved tensions
- do-not-repeat constraints from previous failures or reflections

`frontier-mapping` must refine this scaffold instead of starting from zero.

### 4. Structured Experiment Memory

Experiment execution is tracked through:

- `researcher/EXPERIMENT_LEDGER.json`
- `researcher/EXPERIMENT_REGISTRY.md`
- `PROJECT_MANIFEST.json.experiment_memory`

This allows the system to:

- survive restarts
- know which experiments are queued, running, done, failed, or synced to PaperNexus
- feed innovation reflection from real results
- avoid repeating failed directions blindly

### 5. Innovation Reflection

When experiments produce evidence that changes the idea landscape, the plugin marks innovation reflection as stale.

Before serious re-ideation, Researcher must refresh:

- `researcher/INNOVATION_REFLECTION.md`

This keeps the next round of brainstorming grounded in:

- experiment history
- graph evidence
- explicit “do not repeat” constraints

### 6. Multi-Agent Role System

The current role split is:

- `researcher`: literature, graph, ideation, experiment coordination, state stewardship
- `orchestrator`: plan generation and budgeting
- `coder`: implementation and atomic remote launches
- `analyzer`: metrics, figures, claim matrix, theory/proof packets
- `reviewer`: internal scientific review and loop control
- `academic_writer`: paper plan, section drafting, compile, and final draft packaging
- `cross-reviewer`: prose and outline review

The plugin adds communication controls on top:

- raw Discord mentions are sanitized in normal messages
- mailbox remains durable
- agent-to-agent dispatch can actively wake the correct next owner
- cooldown prevents repeated spam to the same target

### 7. Discord Channel To Project Isolation

The plugin optionally supports channel-to-project bindings, so different Discord channels can drive different research projects in one OpenClaw deployment.

Important properties:

- one channel maps to one active project binding
- bindings are project-local when possible
- project creation and binding can happen through fast paths
- stage updates can be automatically broadcast back to the project channel

### 8. Lobster-Based Deterministic Stage Handoff

Lobster is used here as a deterministic owner-handoff wrapper, not as a replacement for the research skills themselves.

The Lobster handoff workflow:

- runs `auto_iterator_tick`
- confirms the next effective owner
- dispatches the next owner when needed
- preserves stage-broadcast behavior

This is especially useful when one agent finishes stage artifacts but the next agent does not reliably continue on its own.

See:

- [lobster/QUICKSTART.md](../lobster/QUICKSTART.md)

### 9. Proof-Aware Analysis And Writing

The system includes a minimal structured theory layer:

- `analyzer/THEORY_STATE.json`
- `analyzer/proof-packets/*.json`

Analyzer can materialize Writer-ready outputs such as:

- `academic_writer/THEORY_APPENDIX_PLAN.md`
- `academic_writer/paper/sections/appendix_theory.tex`

Writer then uses these structured proof objects so that:

- the main text stays concise
- theorem or lemma-like statements remain bounded and cautious
- long derivations live in the appendix

This is not a full theorem prover, but it already supports proof-aware scientific writing.

### 10. Template-Driven Writing

Writer can be constrained by `writing_contract`.

Features include:

- project-local template copies
- section-order control
- paragraph-logic checks
- conference and journal defaults
- proof-appendix path control
- citation integrity gate

Configured source templates are never modified in place. The plugin copies them into the project and Writer edits the copied bundle only.

## Repository Structure

Main entry points:

- [index.ts](../index.ts): plugin entry and runtime hook wiring
- [tools/workflow-guard.ts](../tools/workflow-guard.ts): workflow policy engine
- [tools/graph-presence.ts](../tools/graph-presence.ts): canonical graph presence checks
- [WORKFLOW.md](../WORKFLOW.md): full workflow contract
- [WORKSPACE.md](../WORKSPACE.md): project layout and ownership rules
- [CONFIG.md](../CONFIG.md): path and configuration cheat sheet
- [README.md](./README.md): documentation hub

Main content folders:

- `agents/`: role identities and lifecycle prompts
- `skills/`: operational contracts for each role
- `tools/`: plugin runtime logic
- `templates/`: project and state templates
- `lobster/`: Lobster workflow wrapper and quickstart
- `tests/`: repository-level regression tests

## Installation

### 1. Build The Plugin

```bash
cd "/Users/iranb/Library/Mobile Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research"
npm run build
```

### 2. Run The Installer

```bash
bash install.sh --dry-run
bash install.sh
```

If you do not want the script to create agents through the OpenClaw CLI:

```bash
bash install.sh --skip-agent-create
```

### 3. Merge Plugin Settings Into Your Real OpenClaw Config

Use these references:

- [openclaw.RECOMMENDED.json](../openclaw.RECOMMENDED.json)
- [openclaw.plugin.json](../openclaw.plugin.json)
- [reference/configuration.md](./reference/configuration.md)

Important note:

- your actual runtime config is usually `~/.openclaw/openclaw.json`
- this repository only provides reference snippets such as `openclaw.RECOMMENDED.json`; they are not automatically loaded by OpenClaw

## Required OpenClaw Configuration

At minimum, make sure your real OpenClaw config:

- loads `~/.openclaw/plugins`
- enables `openclaw-research`
- sets `plugins.entries.openclaw-research.config.projectsRoot`
- allows `research_workflow` for active roles
- keeps `researcher` as the default owner for this workflow
- configures heartbeat per agent instead of relying on one global default

A minimal plugin config looks like:

```json
{
  "plugins": {
    "entries": {
      "openclaw-research": {
        "enabled": true,
        "config": {
          "projectsRoot": "/Users/iranb/Downloads/AutoResearchProjects",
          "injectWorkflowContext": true,
          "enforceWorkflowBoundaries": true,
          "blockDiscordAgentMentions": true,
          "enableWorkflowMailbox": true,
          "heartbeatBackgroundChecks": true,
          "maxWorkflowInboxMessages": 6,
          "agentContactCooldownSeconds": 300,
          "enableChannelProjectBindings": true,
          "defaultConferenceTemplatePath": "",
          "defaultJournalTemplatePath": ""
        }
      }
    }
  }
}
```

## Recommended Agent Permissions

As a rule of thumb:

- `researcher`: full workflow control
- `orchestrator`: planning plus `research_workflow`
- `coder`: implementation plus `research_workflow`
- `analyzer`: analysis plus `research_workflow`
- `reviewer`: review plus `research_workflow`
- `academic_writer`: writing plus `research_workflow`
- roles that should use Lobster handoff should also be allowed to use `lobster`

## Starting A New Research Project

The normal entry point is:

```text
/research-pipeline "your research topic" -- AUTO_PROCEED: true
```

What happens:

1. the plugin resolves or creates the project
2. the current channel can be bound to that project
3. the project state is initialized
4. literature ingestion begins
5. graph-building, frontier mapping, ideation, planning, coding, experiments, analysis, review, and writing continue through the workflow

If you work from Discord and want explicit binding:

```json
{
  "action": "bind_channel_project",
  "channelBinding": {
    "projectRoot": "/absolute/path/to/project"
  }
}
```

## Daily Usage Pattern

### Researcher

Use `Researcher` to:

- start the project
- maintain literature and graph state
- run ideation and reflection
- orchestrate experiments
- keep project state reconciled

### Other Roles

The usual flow is:

- Researcher finishes a stage and produces durable artifacts
- if the stage is truly complete, the role triggers Lobster handoff
- Lobster confirms the next owner and dispatches the next role
- if the stage needs revision, the workflow stays in the current stage instead of handing off

This preserves loops for:

- code revision
- more experiments
- review-driven narrowing
- writing revisions

## Template Configuration For Conference Or Journal Papers

You can set global default templates in plugin config:

```json
{
  "plugins": {
    "entries": {
      "openclaw-research": {
        "enabled": true,
        "config": {
          "defaultConferenceTemplatePath": "/absolute/path/to/conference-template/main.tex",
          "defaultJournalTemplatePath": "/absolute/path/to/journal-template/main.tex"
        }
      }
    }
  }
}
```

Then set the project’s writing mode through `writing_contract`, for example `conference` or `journal`.

Runtime behavior:

- the configured template is copied into the project
- the copied template becomes the active writing bundle
- Writer edits only the project-local copy

## How Lobster Is Meant To Be Used

Lobster is not the place where research reasoning happens.

It is used as:

- a deterministic handoff wrapper
- a way to make owner transitions explicit
- a way to reduce stalls after stage completion

Do not use forward handoff when:

- Writer still needs revision
- Coder still owes implementation fixes
- Reviewer requests more experiments
- Researcher re-opens ideation or experiment loops

See:

- [lobster/QUICKSTART.md](../lobster/QUICKSTART.md)

## Documentation Map

Start here:

- [README.md](./README.md)

Useful next stops:

- [guides/getting-started.md](./guides/getting-started.md)
- [guides/install-and-enable.md](./guides/install-and-enable.md)
- [reference/configuration.md](./reference/configuration.md)
- [reference/plugin-tools.md](./reference/plugin-tools.md)
- [reference/state-files.md](./reference/state-files.md)
- [reference/agents.md](./reference/agents.md)
- [reference/skills.md](./reference/skills.md)

## Validation

Before deployment or after significant edits, run:

```bash
npm test
npm run build
```

The repository regression suite should remain green before install or release.
