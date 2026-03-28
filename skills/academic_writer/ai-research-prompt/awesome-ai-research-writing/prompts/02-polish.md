# Polish

## Purpose

Improve academic text without changing its scientific content. This spec supports four operations:

- `shorten`
- `expand`
- `polish_en`
- `polish_zh`

## When to Use

Use this spec when the user wants the same argument expressed better rather than translated into another language.

- Choose `shorten` when the draft is slightly too long or repetitive.
- Choose `expand` when the draft is under-explained and can be clarified without inventing new evidence.
- Choose `polish_en` for English academic prose that needs clearer, more publication-ready wording.
- Choose `polish_zh` for Chinese academic prose that needs cleaner, more formal wording.

## Input Contract

Collect or infer:

- `operation`: one of `shorten`, `expand`, `polish_en`, `polish_zh`
- `source_text`
- `target_medium`: `latex`, `word`, or `plain_text`
- `aggressiveness`: `light`, `moderate`, or `heavy`
- `must_preserve`: equations, citations, method names, metrics, section intent
- `user_goal`: for example page limit, clarity, tone, or grammar

Reasonable defaults:

- Default to `light` or `moderate` edits.
- Prefer `light` edits when the user only asks for polishing.
- Treat unmentioned equations, citations, and numbers as must-preserve content.

## Output Contract

Return the revised text first.

- If the text changed materially, add a short change summary.
- If the text is already strong, say so briefly and keep changes minimal.
- For `shorten`, preserve all key information while reducing redundancy.
- For `expand`, make implicit logic explicit without adding unsupported claims.
- For `polish_en`, produce fluent conference-style English.
- For `polish_zh`, produce clean academic Chinese suitable for direct use.

## Hard Constraints

- Do not change numerical claims, causal claims, or scope unless the user asks for substantive rewriting.
- Do not fabricate motivation, limitations, or comparative claims.
- Do not replace precise technical language with vague prestige wording.
- Do not turn paragraphs into bullet lists unless the user explicitly asks for lists.
- Keep LaTeX commands intact for LaTeX-facing work.
- Avoid gratuitous edits made only to look active.

## Procedure

1. Identify the requested operation and the real editing goal.
2. Mark must-preserve content: numbers, equations, caveats, citations, and terminology.
3. Apply the smallest set of edits that improves the target quality:
   - `shorten`: compress syntax, remove filler, merge redundant phrases.
   - `expand`: surface missing logical bridges and clarify the intended contribution.
   - `polish_en`: improve grammar, flow, and academic tone.
   - `polish_zh`: remove colloquialisms and awkward literal-translation patterns.
4. Re-check whether the scientific meaning and certainty level still match the source.
5. If the text was already strong, revert unnecessary edits.

## Failure Modes

- Shortening that deletes a condition, assumption, or metric definition.
- Expansion that introduces unsupported motivation or stronger claims than the data supports.
- Polishing that preserves grammar but damages the paper's exact meaning.
- Over-editing that erases the author's intended emphasis or structure.
- Word-target output that still contains Markdown or LaTeX artifacts.
