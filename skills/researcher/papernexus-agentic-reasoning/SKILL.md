---
name: papernexus-agentic-reasoning
description: Use this skill when an agent needs stepwise graph-grounded reasoning on top of a live PaperNexus corpus while keeping uploads and reads wrapper-first.
---

# PaperNexus Agentic Reasoning

Use this skill when the goal is not just retrieval, but disciplined reasoning over a live PaperNexus graph.

## Control Plane

For workflow-owned reasoning, prefer:

- `research_workflow.run_papernexus_wrapper`
- `python3 scripts/pn_graph_query.py`
- `python3 scripts/pn_research_chains.py`

If fresh papers must be added first, use:

- `research_workflow.queue_paper_ingestion`
- `python3 scripts/pn_stage_sync.py`
- `python3 scripts/pn_import_submit.py`
- `python3 scripts/pn_import_queue.py`
- `python3 scripts/pn_batch_import.py`

Do not use local live-graph CLI commands as the primary reasoning path for a shared corpus.

## Reasoning Loop

For any non-trivial task, use this loop:

1. Define the objective in one sentence.
2. Start with the narrowest typed wrapper that matches the question.
3. Record the current anchor, support, limitation, and next action.
4. Expand only if the previous step leaves a structural gap.
5. Stop when the remaining uncertainty is no longer graph-resolvable.

Use this compact state format:

```text
Objective:
Current anchor:
Known support:
Known limitation:
Open gap:
Next action:
```

## Preferred Wrapper Operations

For topic understanding:

- `pn_graph_query.py query`
- `pn_graph_query.py context`
- `pn_research_chains.py evidence-chain`

For ideation:

- `pn_graph_query.py ideas`
- `pn_graph_query.py brainstorm`
- `pn_research_chains.py brainstorm-brief`

For theory and reflection:

- `pn_research_chains.py theory-brief`
- `pn_research_chains.py reflection-chain`
- `pn_research_chains.py storyline-brief`

For causal or support traversal:

- `pn_research_chains.py path-trace`
- `pn_research_chains.py evidence-chain`

For paper-local overlays:

- `pn_research_chains.py paper-enhancement`

## Example Sequences

Understand a topic:

```bash
research_workflow.run_papernexus_wrapper -> pn_graph_query.py query "<topic>"
research_workflow.run_papernexus_wrapper -> pn_graph_query.py context "<topic>"
research_workflow.run_papernexus_wrapper -> pn_research_chains.py evidence-chain "<topic>"
```

Generate candidate directions:

```bash
research_workflow.run_papernexus_wrapper -> pn_graph_query.py ideas "<topic>"
research_workflow.run_papernexus_wrapper -> pn_graph_query.py brainstorm "<topic>"
research_workflow.run_papernexus_wrapper -> pn_research_chains.py brainstorm-brief "<topic>"
```

Evaluate support and risks:

```bash
research_workflow.run_papernexus_wrapper -> pn_research_chains.py evidence-chain "<topic>"
research_workflow.run_papernexus_wrapper -> pn_research_chains.py theory-brief "<topic>"
research_workflow.run_papernexus_wrapper -> pn_research_chains.py reflection-chain "<topic>"
```

## Upload Prerequisite Rules

If reasoning depends on papers not yet in the graph:

- for one paper, use `pn_import_submit.py`
- for multiple papers, use one `pn_batch_import.py` manifest
- check or wait through `pn_import_queue.py`

Do not:

- write ad-hoc upload loops
- manually drive the shared graph with local stage commands
- switch to raw route examples when wrappers already exist

## When To Stop

Stop the reasoning loop when:

- the typed wrappers already show enough support and limitation structure
- the remaining question needs new data rather than more traversal
- the graph is stale and must be refreshed before trustworthy reasoning can continue
