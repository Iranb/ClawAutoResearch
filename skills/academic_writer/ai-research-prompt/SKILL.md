---
name: ai-research-writing
description: Use when the user needs agent-executable support for AI research writing, including translation, polishing, review, de-AI rewriting, figure and table planning, and experiment analysis.
---

# AI Research Writing

This skill is an agent-first writing pack for AI and machine learning papers. It is meant for direct execution by an agent, not for copy-paste prompt use by a human.

## Use This Skill For

- Translating research text between Chinese and English while preserving technical meaning.
- Polishing academic prose by shortening, expanding, or refining it.
- Running passage-level logic checks or reviewer-style manuscript critiques.
- Rewriting text to remove generic LLM tone while preserving claims.
- Planning figures, charts, captions, and table titles for papers.
- Turning experiment results into evidence-grounded paper paragraphs.

## Routing Rules

Select one primary prompt file for the current task unless the user explicitly asks for a combined workflow.

- Translation tasks: `awesome-ai-research-writing/prompts/01-translation.md`
- Polishing or rewriting tasks: `awesome-ai-research-writing/prompts/02-polish.md`
- Logic checks or review tasks: `awesome-ai-research-writing/prompts/03-logic-and-review.md`
- De-AI rewriting tasks: `awesome-ai-research-writing/prompts/04-de-ai.md`
- Figure, chart, caption, or title tasks: `awesome-ai-research-writing/prompts/05-figures-tables.md`
- Experiment-to-writing tasks: `awesome-ai-research-writing/prompts/06-experiments.md`

## Shared Execution Rules

- Preserve factual content unless the user explicitly asks for substantive changes.
- Do not fabricate citations, metrics, baselines, datasets, or qualitative findings.
- Keep mathematics, variable names, and technical terminology consistent with the input.
- Prefer paragraph-based academic writing over bullet-heavy output unless the user asks for lists.
- If the input is already strong, say so and avoid unnecessary rewriting.
- If required information is missing, make the smallest safe assumption and state it briefly.

## Output Style

- Put the transformed artifact first.
- Add concise notes only when they help the user verify meaning, changes, or risks.
- Match the destination medium:
  - LaTeX-facing tasks should preserve LaTeX-safe content.
  - Word-facing tasks should return clean plain text with no Markdown artifacts.
  - Review tasks should prioritize findings, severity, and concrete fixes.

## File Map

- Overview and maintenance notes: [awesome-ai-research-writing/README.md](awesome-ai-research-writing/README.md)
- Execution specs: `awesome-ai-research-writing/prompts/01-06`
