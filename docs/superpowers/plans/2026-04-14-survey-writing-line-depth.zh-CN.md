# 2026-04-14 Survey Writing Line Depth

## Goal

Improve the survey / review writing lane so it produces broader, less thin, more comparative manuscripts without turning survey writing into a brittle file checklist.

## Problems Observed

1. Survey drafts can read like stitched summaries instead of comparative synthesis.
2. The writer lane has survey section ordering, but not enough survey-specific section guidance.
3. Existing writing reference bundles are biased toward experiment-paper sections.
4. Survey story packets mention themes and gaps, but do not explicitly scaffold:
   - comparison axes
   - tradeoff narratives
   - contradiction handling
   - reviewer-style self-audit for coverage and unsupported synthesis

## Stable Fix Strategy

1. Add survey-specific writing references derived from the current workflow needs and the external paper-writing guidance:
   - survey writing
   - section-by-section survey guidance
   - comparison / tradeoff synthesis
2. Materialize survey-specific writer support artifacts instead of relying on memory:
   - comparison synthesis pack
   - section brief pack
   - survey self-review checklist
3. Teach writer skills to use:
   - mini-outline first
   - paragraph-by-paragraph comparative synthesis
   - reverse outline
   - claim-evidence map
   - skeptical self-review
4. Keep handoff gates permissive:
   - do not require these survey support files as hard submit blockers
   - use them to enrich the draft path, not to freeze progress

## Acceptance Criteria

1. Survey writing reference bundles expose survey-specific references and section bundles.
2. `materialize_writing_support_artifacts` emits survey-specific support files when `paper_mode=survey`.
3. Writer skills explicitly require comparative synthesis and self-review for survey mode.
4. Tests verify the support artifacts and reference bundle behavior.
