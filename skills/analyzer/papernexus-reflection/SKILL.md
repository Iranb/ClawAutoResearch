---
name: papernexus-reflection
description: Use this skill when an Analyzer or Coder agent needs reflection-overlay evidence from a live PaperNexus corpus through remote HTTP MCP instead of local live-graph CLI operations.
---

# PaperNexus Reflection

Use this skill when the task is about innovation-to-experiment-to-outcome reflection in a live PaperNexus corpus.

## Primary Interface

For workflow-owned work, prefer the remote HTTP MCP control plane:

- `research_lookup`
- `research_briefing`
- `idea_catalyst`

If a thin adapter layer is still needed, the wrappers remain valid because they are backed by MCP:

- `python3 scripts/pn_research_chains.py`
- `python3 scripts/pn_graph_query.py`

If new papers must be added first, use:

- `research_workflow.queue_paper_ingestion`
- `python3 scripts/pn_stage_sync.py`
- `python3 scripts/pn_import_submit.py`
- `python3 scripts/pn_import_queue.py`
- `python3 scripts/pn_batch_import.py`

Do not use local live-graph CLI rebuilds as the normal reflection path for a shared corpus.

## What This Skill Covers

This skill is for reflection overlays such as:

- innovation summaries
- experiment chains
- outcome verdicts
- reflection notes
- evidence-backed storyline or theory support

## Recommended Workflow

1. Confirm the relevant paper set is already present or queued.
2. If new sources are needed, queue ingestion and let workflow-owned graph passes trigger upload.
3. Read reflection-oriented graph outputs through MCP-first tools or their thin wrappers.
4. Summarize findings in a compact, evidence-backed form.

Preferred wrapper sequence:

```bash
research_briefing reflection-chain "<topic>"
research_briefing evidence-chain "<topic>"
research_briefing research-brief "<topic>"
research_briefing storyline-brief "<topic>"
```

When paper-local overlay detail is still needed:

```bash
research_briefing paper-enhancement --paper-id "<paper-id>"
```

## Output Style

Prefer this compact structure:

```text
Innovation:
Experiment:
Outcome:
Reflection:
Open risk:
```

## Safety Rules

- keep claims tied to extracted evidence
- distinguish clear wins from mixed or inconclusive outcomes
- surface failure modes and open risks explicitly
- if the graph is stale, refresh it before trusting the reflection
- if support is thin, record uncertainty instead of promoting a weak takeaway into a hard conclusion

## Do Not Do

- do not use local stage-by-stage graph rebuild commands as the default live reflection path
- do not rebuild the shared graph locally just to inspect one reflection overlay
- do not bypass the remote HTTP MCP control plane when the task belongs to workflow-owned graph reasoning
