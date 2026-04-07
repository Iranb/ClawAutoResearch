---
name: papernexus-agentic-reasoning
description: Use this skill when an agent needs stepwise graph-grounded reasoning on top of a live PaperNexus corpus while keeping uploads wrapper-backed and live graph reads MCP-first.
---

# PaperNexus Agentic Reasoning

Use this skill when the goal is not just retrieval, but disciplined reasoning over a live PaperNexus graph.

## Control Plane

For workflow-owned reasoning, prefer the remote HTTP MCP control plane:

- `research_lookup`
- `research_briefing`
- `idea_catalyst`

When a thin adapter layer is still useful, the wrappers remain valid because they are MCP-backed:

- `python3 scripts/pn_graph_query.py`
- `python3 scripts/pn_research_chains.py`

If fresh papers must be added first, use:

- `research_workflow.queue_paper_ingestion`
- `python3 scripts/pn_stage_sync.py`
- `python3 scripts/pn_import_submit.py`
- `python3 scripts/pn_import_queue.py`
- `python3 scripts/pn_batch_import.py`

Do not use local live-graph CLI commands or raw `/api/*` calls as the primary reasoning path for a shared corpus.

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

## Preferred MCP Operations

For topic understanding:

- `research_lookup`
- `research_briefing`

For ideation:

- `research_lookup`
- `research_briefing`
- `idea_catalyst`

For theory and reflection:

- `research_briefing`

For causal or support traversal:

- `research_briefing`

For paper-local overlays:

- `research_briefing`

## Example Sequences

Understand a topic:

```bash
research_lookup "<topic>"
research_briefing evidence-chain "<topic>"
```

Generate candidate directions:

```bash
research_lookup ideas "<topic>"
research_briefing brainstorm-brief "<topic>"
idea_catalyst "<topic>"
```

Evaluate support and risks:

```bash
research_briefing evidence-chain "<topic>"
research_briefing theory-brief "<topic>"
research_briefing reflection-chain "<topic>"
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
