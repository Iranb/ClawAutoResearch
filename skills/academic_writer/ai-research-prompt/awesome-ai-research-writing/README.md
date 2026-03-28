# Awesome AI Research Writing

This directory is a compact execution library for research-writing agents. It replaces copy-paste human prompts with task specifications that are easier for agents to route, interpret, and execute consistently.

## Design Goals

- Keep instructions in English so downstream agents can follow them directly.
- Encode each writing task as an execution contract instead of a long role-play prompt.
- Preserve the practical coverage of the original pack: translation, polishing, review, de-AI rewriting, figures, tables, and experiment analysis.
- Favor low-hallucination academic writing over stylistic theatrics.

## Directory Layout

| File | Purpose |
| --- | --- |
| [prompts/01-translation.md](prompts/01-translation.md) | Translation and language conversion for research text |
| [prompts/02-polish.md](prompts/02-polish.md) | Shortening, expansion, and language polishing |
| [prompts/03-logic-and-review.md](prompts/03-logic-and-review.md) | Logic checks and reviewer-style critique |
| [prompts/04-de-ai.md](prompts/04-de-ai.md) | Naturalizing LLM-heavy prose without changing substance |
| [prompts/05-figures-tables.md](prompts/05-figures-tables.md) | Figure concepts, chart recommendations, and title writing |
| [prompts/06-experiments.md](prompts/06-experiments.md) | Experiment interpretation and paragraph drafting |

## How Agents Should Use This Pack

1. Identify the user goal.
2. Select one primary prompt file.
3. Read the task-specific contract.
4. Ask at most one focused clarification only if the missing detail changes the output materially.
5. Produce the requested artifact first, then provide concise verification or review notes if helpful.

## Shared Quality Bar

- Do not invent missing evidence.
- Preserve core claims, equations, variable names, and venue-appropriate tone.
- Prefer clean paragraphs over decorative formatting.
- Adapt to the delivery medium:
  - LaTeX tasks should preserve LaTeX-safe content.
  - Word tasks should return clean plain text.
  - Review tasks should return findings and suggested fixes.

## Maintenance Notes

- This pack intentionally focuses on the active writing and review workflows.
- Deleted legacy files are not part of the active routing surface.
- If you extend the pack, follow the same structure used by the current prompt files:
  - `## Purpose`
  - `## When to Use`
  - `## Input Contract`
  - `## Output Contract`
  - `## Hard Constraints`
  - `## Procedure`
  - `## Failure Modes`
