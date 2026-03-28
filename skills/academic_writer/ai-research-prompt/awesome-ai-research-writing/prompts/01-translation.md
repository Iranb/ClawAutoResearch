# Translation

## Purpose

Provide faithful research-text translation and language conversion for three common cases:

- Chinese draft to English paper prose
- English research text to Chinese comprehension text
- Chinese draft to polished Chinese academic prose

## When to Use

Use this spec when the user wants translation, language conversion, or meaning-preserving rewriting across Chinese and English.

- Route to `zh_to_en` when the target artifact is an English paper fragment, usually for LaTeX.
- Route to `en_to_zh` when the user wants to understand existing English text quickly and accurately.
- Route to `zh_to_zh` when the user has a rough Chinese draft and wants it rewritten into formal academic Chinese.

## Input Contract

Collect or infer the following:

- `variant`: one of `zh_to_en`, `en_to_zh`, `zh_to_zh`
- `source_text`: the exact text to process
- `source_format`: `latex`, `plain_text`, or `mixed`
- `target_medium`: `latex`, `word`, or `plain_text`
- `fidelity_priority`: `strict`, `balanced`, or `readable`
- `preserve_commands`: `true` or `false`

Reasonable defaults:

- Default to `balanced` fidelity.
- Default `preserve_commands=true` for LaTeX-facing work.
- Default `preserve_commands=false` for comprehension-oriented translation.

## Output Contract

Return the transformed artifact first.

- `zh_to_en`: return clean English academic prose, preserving equations and essential LaTeX-safe tokens.
- `en_to_zh`: return readable Chinese text for comprehension, removing non-essential LaTeX scaffolding unless the user asks to keep it.
- `zh_to_zh`: return polished Chinese academic prose suitable for direct use in a paper or report.

Add a short verification note only when it helps, for example:

- ambiguities in the source
- terminology choices that materially affect meaning
- information that could not be preserved exactly

## Hard Constraints

- Do not add claims, data, citations, baselines, or conclusions that are not present in the source.
- Preserve mathematical meaning, variable names, dataset names, and method names.
- Do not translate technical terms mechanically when the field-standard term should remain unchanged.
- Do not over-polish comprehension-oriented translation into a different argument.
- For LaTeX targets, keep math intact and escape unsafe characters when necessary.
- For Word targets, return plain text without Markdown artifacts.

## Procedure

1. Determine the translation variant from the user goal and output medium.
2. Identify technical nouns, equations, citations, and venue-sensitive phrasing that must be preserved.
3. Translate sentence by sentence while preserving logical relations, scope, and certainty level.
4. Normalize only what the selected variant requires:
   - `zh_to_en`: improve academic fluency and remove literal-translation artifacts.
   - `en_to_zh`: prefer faithful comprehension over elegant rewriting.
   - `zh_to_zh`: reorganize the text into a coherent academic paragraph when the draft is rough.
5. Run a final check for factual drift, terminology inconsistency, and formatting leakage.

## Failure Modes

- Literal translation that preserves words but breaks the technical meaning.
- Polishing so aggressively that new claims or stronger certainty are introduced.
- Dropping qualifiers such as `may`, `approximately`, `under this setting`, or `on average`.
- Corrupting LaTeX math, variable names, or citation commands.
- Translating field-standard terms into unnatural phrases that researchers would not use.
