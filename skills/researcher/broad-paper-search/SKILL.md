---
name: broad-paper-search
description: "Broad multi-provider literature search for keyword-only or paragraph-only inputs. Uses the workflow-owned retrieval backbone to expand beyond arXiv-heavy recall and persist merged candidates, coverage diagnostics, and metadata-only top-tier papers."
argument-hint: "[topic / keywords / related-work paragraph]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - research_workflow
---

# Broad Paper Search

Use this skill when the user only has:

- a few keywords
- a fuzzy topic statement
- a paragraph of related discussion

and wants the broadest stable literature sweep possible across conferences and journals.

## Primary Rule

Do not implement a second search stack inside this skill.

Always call the workflow-owned broad retrieval backbone:

```json
{
  "action": "run_broad_paper_search",
  "broadPaperSearch": {
    "topic": "<topic>",
    "depth": "default"
  }
}
```

## What This Skill Produces

- deterministic query plan artifacts
- multi-provider raw results
- merged canonical paper candidates
- staged OA / PDF resolutions when legally available
- metadata-only canonical entries for important papers without legal full text
- coverage audit artifacts
- bounded citation-expansion packet when coverage is thin

## Related Workflow

- Use this before or inside `/research-lit` when breadth matters more than a fast arXiv-only sweep.
- Keep `/papers-cool` and `/pasa-paper-search` as supplementary sources, not the only discovery layer.
- After new canonical papers are accepted, let the existing `PAPER_SOURCE_INDEX.json -> graph-build` path continue as usual.
