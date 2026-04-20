# ClawAutoResearch

**ClawAutoResearch** is an automated research workflow plugin for OpenClaw.
It turns research execution into a recoverable workflow with durable state, graph-backed literature context, staged handoffs, and writing-ready evidence packages.

[Docs](https://iranb.github.io/ClawAutoResearch-Docs/) · [Installation](https://iranb.github.io/ClawAutoResearch-Docs/user-guide/installation) · [Usage](https://iranb.github.io/ClawAutoResearch-Docs/user-guide/usage) · [Workflow Tour](https://iranb.github.io/ClawAutoResearch-Docs/user-guide/workflow-tour) · [Slash Commands](https://iranb.github.io/ClawAutoResearch-Docs/user-guide/slash-commands) · [Discord Reporting](https://iranb.github.io/ClawAutoResearch-Docs/architecture/discord-reporting) · [Workflow Control Plane](https://iranb.github.io/ClawAutoResearch-Docs/architecture/workflow-control-plane)

New here? Start with the public [installation guide](https://iranb.github.io/ClawAutoResearch-Docs/user-guide/installation) and then the [usage guide](https://iranb.github.io/ClawAutoResearch-Docs/user-guide/usage).

## Highlights

- **Experiment workflow line**: move from topic to graph grounding, idea generation, planning, coding, experiments, analysis, review, writing, and submission.
- **Survey workflow line**: run a dedicated survey path for retrieval, coverage, synthesis, writing, and submission.
- **Graph-grounded research**: use shared graph presence and frontier mapping before novelty-sensitive stages.
- **Durable orchestration**: keep stage, owner, blockers, queue state, and recovery signals in persistent workflow state.
- **Discord-visible progress**: report stage changes, queued or blocked states, handoffs, and restart recovery into bound Discord channels.

## Workflow lines

### Experiment line

```text
setup -> graph_build -> frontier_mapping -> idea -> plan -> code -> experiment -> analyze -> review -> write -> submit
```

### Survey line

```text
setup -> survey_review -> write -> submit
```

## Install

From the repository root:

```bash
npm install
bash install.sh
```

Then continue with the public docs:

- [Installation guide](https://iranb.github.io/ClawAutoResearch-Docs/user-guide/installation)
- [Usage guide](https://iranb.github.io/ClawAutoResearch-Docs/user-guide/usage)
- [Workflow tour](https://iranb.github.io/ClawAutoResearch-Docs/user-guide/workflow-tour)

## Docs by goal

- New users: [Installation](https://iranb.github.io/ClawAutoResearch-Docs/user-guide/installation), [Usage](https://iranb.github.io/ClawAutoResearch-Docs/user-guide/usage), [Workflow Tour](https://iranb.github.io/ClawAutoResearch-Docs/user-guide/workflow-tour)
- Operators: [Slash Commands](https://iranb.github.io/ClawAutoResearch-Docs/user-guide/slash-commands), [Workflow Reporting Nodes for Discord](https://iranb.github.io/ClawAutoResearch-Docs/architecture/discord-reporting)
- Maintainers: [Architecture](https://iranb.github.io/ClawAutoResearch-Docs/architecture/), [System Workflows](https://iranb.github.io/ClawAutoResearch-Docs/architecture/system-workflows), [Workflow Control Plane](https://iranb.github.io/ClawAutoResearch-Docs/architecture/workflow-control-plane), [Commands & Tools](https://iranb.github.io/ClawAutoResearch-Docs/reference/commands-and-tools)

## Repository layout

- `docs/`: source for the documentation site
- `tools/`: workflow runtime, state, orchestration, and integration logic
- `skills/`: role and task specific skill surfaces
- `agents/`: agent-facing role configuration
- `templates/`: project bootstrap and state templates
- `tests/`: workflow, runtime, writing, and integration regressions

## Development

Useful commands:

```bash
npm run build
npm run docs:build
node --test tests/workflow-commands.test.mjs
```

Use the public docs site as the primary documentation entry point rather than the legacy `DOC/` tree.
