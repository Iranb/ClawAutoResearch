---
name: survey-review
description: "Projectless survey-only literature workflow that expands retrieval coverage, screens included/excluded papers, synthesizes gaps, and stops after a graph-grounded survey brief. Use when writing a review or survey instead of running experiments."
argument-hint: "[survey topic]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - Skill
  - research_workflow
---

# Survey Review

Run a survey-only workflow for a topic without entering plan/code/experiment. This skill is meant for review papers, rapid literature overviews, and saturation-oriented topic scouting.

Primary slash entry:

- `/survey-pipeline "topic"`

## Core Rule

Treat `PROJECT_MANIFEST.json.survey_review` as the authoritative state. Do not try to advance the survey by hand-editing a pile of Markdown files and hoping the workflow notices.

After each major pass, update or reconcile state through:

- `research_workflow.set_survey_review`
- `research_workflow.materialize_survey_review_state`

The workflow uses these durable paths:

- `researcher/SURVEY_QUERY_REGISTRY.json`
- `researcher/LITERATURE.md`
- `researcher/REVIEW_PROTOCOL.md`
- `researcher/INCLUDED_PAPERS.json`
- `researcher/EXCLUDED_PAPERS.json`
- `researcher/LITERATURE_REVIEW.md`
- `researcher/SOTA_MATRIX.md`
- `researcher/GAP_SYNTHESIS.md`
- `researcher/COVERAGE_SUMMARY.md`
- `researcher/SURVEY_BRIEF.md`

## Workflow Shape

The retrieval/screening/synthesis loop stays inside one top-level stage:

`survey_review`

The internal phases are:

1. `bootstrap`
2. `retrieval`
3. `screening`
4. `synthesis`
5. `complete`

Do not route into `plan`, `code`, or `experiment`.
Once the survey packet is truly complete, the workflow may hand off into `write` with `paper_mode=survey`; that handoff is for writing only, not for experimental planning.

## Retrieval Strategy

Survey mode is broader than startup research mode.

- Use more query families, not just one seed query.
- Sweep synonyms, task aliases, baseline families, neighboring problems, and contradiction phrases.
- Prefer broad coverage first, then tighten inclusion criteria.
- Reuse existing retrieval tools:
  - `/papers-cool`
  - `/pasa-paper-search` when available
  - `/hugging-face-paper-pages`
  - `/arxiv2md-api`
  - `/arxiv2md`
  - PaperNexus graph expansion and citation-neighbor lookup
  - `research_workflow.audit_literature_coverage` for non-blocking survey coverage diagnostics
  - `research_workflow.plan_citation_expansion` for bounded seed-based follow-up search
- Keep canonical identities merged in the survey packet; do not count duplicates as new coverage.

Record every retrieval round in `SURVEY_QUERY_REGISTRY.json` with:

- query family
- raw query
- provider
- candidate count
- notes on duplicates / failures / coverage gaps

When coverage still looks thin after a broad pass:

- run `research_workflow.audit_literature_coverage` to make baseline and recency gaps explicit
- if only a few anchor papers look strong, use `research_workflow.plan_citation_expansion` to generate one bounded seed packet
- do not turn survey mode into an infinite citation crawl

## Screening Contract

Once the candidate pool is large enough to screen, write:

- `REVIEW_PROTOCOL.md`
- `INCLUDED_PAPERS.json`
- `EXCLUDED_PAPERS.json`

Every screened paper must have:

- canonical id
- title
- include / exclude / background-only decision
- one short reason

Do not silently drop papers from the survey.

## Synthesis Contract

Before marking the survey complete, produce:

- `LITERATURE_REVIEW.md`
- `SOTA_MATRIX.md`
- `GAP_SYNTHESIS.md`
- `COVERAGE_SUMMARY.md`
- `SURVEY_BRIEF.md`

`SURVEY_BRIEF.md` should be the shortest high-signal output:

- topic
- coverage scope
- included count
- main method families
- strongest baselines / benchmark clusters
- unresolved gaps
- disagreement or contradiction areas
- recommended next reading or next sweep

## Mandatory State Alignment

At the end of each phase, reconcile state instead of trusting file timestamps alone.

Suggested cadence:

1. After retrieval rounds:
   - update `SURVEY_QUERY_REGISTRY.json`
   - call `research_workflow.materialize_survey_review_state`
2. After screening:
   - update protocol + included/excluded files
   - call `research_workflow.materialize_survey_review_state`
3. After synthesis:
   - write review, SoTA, gap, coverage, brief
   - call `research_workflow.materialize_survey_review_state`

If you need to seed status before files exist, use `research_workflow.set_survey_review`, then immediately let `materialize_survey_review_state` reconcile from artifacts.

## Quality Bar

The survey is not done unless:

- retrieval rounds are durably recorded
- included and excluded sets are explicit
- the review packet says what is missing, not just what was found
- `SURVEY_BRIEF.md` exists and is graph-grounded enough for downstream reading

Avoid:

- tiny candidate pools presented as “survey complete”
- free-form notes without screening decisions
- mixing project ideation with survey completion
- entering experiment planning from this skill
