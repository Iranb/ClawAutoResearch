# De-AI Rewriting

## Purpose

Rewrite research text that sounds overly generic, over-produced, or obviously LLM-generated while preserving the original scientific substance.

This spec supports two common targets:

- English LaTeX paper prose
- Chinese Word-friendly academic prose

## When to Use

Use this spec when the user explicitly asks to remove AI tone, make the writing sound more human, or reduce generic LLM phrasing.

Do not use this spec for ordinary grammar cleanup. Use it when the main problem is voice, cadence, and unnatural wording rather than correctness alone.

## Input Contract

Collect or infer:

- `language`: `en` or `zh`
- `source_text`
- `target_medium`: `latex`, `word`, or `plain_text`
- `rewrite_strength`: `light`, `moderate`, or `heavy`
- `must_preserve`: claims, numbers, equations, citations, method names, and intended emphasis

Defaults:

- Default to `light` or `moderate` rewrite strength.
- Preserve all technical content unless the user explicitly asks for deeper reframing.

## Output Contract

Return the rewritten text first.

- If the original text is already natural, keep it nearly unchanged and say so briefly.
- If changes were necessary, optionally add a concise note describing the main tone fixes.
- For LaTeX targets, preserve LaTeX-safe content.
- For Word targets, return plain text with no Markdown artifacts.

## Hard Constraints

- Do not remove technical precision in the name of sounding human.
- Do not replace simple clear wording with flashy synonyms.
- Do not add hype, emotional framing, or exaggerated novelty claims.
- Do not smooth away uncertainty markers that matter scientifically.
- Do not change claims, numbers, or comparative conclusions.
- Avoid obvious LLM patterns such as empty scene-setting, stacked transition words, and inflated abstract nouns.

## Procedure

1. Identify whether the text actually has an LLM-style problem.
2. Mark phrases that sound templated, inflated, or mechanically transitional.
3. Rewrite at the sentence and paragraph level to achieve:
   - more direct claims
   - less rhetorical filler
   - more natural transitions
   - cleaner local syntax
4. Preserve scientific scope, caveats, and evidence level.
5. Re-read the result and revert any edit that only changes surface texture without improving the prose.

## Failure Modes

- Rewriting so aggressively that the scientific claim changes.
- Replacing one type of artificial wording with another.
- Deleting useful connective logic while trying to reduce transition words.
- Making the prose simpler but less precise.
- Touching already-natural text just to show activity.
