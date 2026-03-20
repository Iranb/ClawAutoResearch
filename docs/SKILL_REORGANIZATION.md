# Skill Reorganization Notes

## Goal

Reduce the default skill surface of the `researcher` agent so it mostly carries workflow-critical skills, while moving generic or infrequently used utilities out of the default load path.

## What Changed

### Researcher core skills kept in `skills/researcher/`

These are directly referenced by the main workflow, by `agents/researcher/AGENTS.md`, or by other core researcher skills:

- `graph-build`
- `frontier-mapping`
- `hugging-face-paper-pages`
- `idea-phase`
- `idea-generator`
- `idea-tournament`
- `novelty-check`
- `research-lit`
- `papers-cool`
- `experiment-phase`
- `parallel-experiments`
- `monitor-experiment`
- `research-reflect`
- `research-pipeline`
- `research-queue`

### Researcher optional skills moved to `skills-optional/researcher/`

These are useful extensions, but they are not part of the default staged pipeline:

- `brainstorming-research-ideas`
- `consensus-mapping`
- `crawl4ai-search`
- `creative-thinking-for-research`
- `cross-paper-synthesis`
- `gap-detection`
- `paper2md`
- `rss-papers`
- `scrapling`

Note:

- `hugging-face-paper-pages` was later promoted back into `skills/researcher/` because the default literature-ingestion workflow now requires full-paper Markdown retrieval for key papers before graph-grounded novelty reasoning.

### Removed from Researcher default set

- `github-download`
- `run-experiment`

Reason:
- `github-download` belongs to the `CODE` stage, which is owned by the `coder` agent in [WORKFLOW.md](/Users/iranb/Library/Mobile Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/WORKFLOW.md).
- `run-experiment` is now treated as an atomic execution capability of `coder`, while `researcher` retains experiment-stage orchestration.

## Why Researcher Felt Too Heavy

Before this cleanup, `researcher` mixed three different kinds of skills:

1. Stage owners in the main pipeline
2. Internal helper skills used by those stages
3. Generic research utilities and one-off external tools

That made the default skill tree look bloated even though only a subset is required for the normal pipeline.

## Recommended Mental Model

### Keep under `researcher` by default

Only keep skills that satisfy at least one of these:

- they own a workflow stage
- they are called by another core researcher skill
- they are part of the normal single-project path

### Move out of default load

Move to `skills-optional/` if a skill is:

- generic and not workflow-specific
- only useful for special ingestion or scraping cases
- an ideation aid rather than part of the standard state machine
- a niche paper-processing helper

## Skills That Are Still Debatable But Kept

- `research-queue`
  Reason: optional in practice, but still referenced by `research-pipeline` for multi-project mode.
- `monitor-experiment`
- `parallel-experiments`
  Reason: these look granular, but `experiment-phase` delegates to them explicitly, so removing them would break the current design.

## Remaining Structural Issues Not Changed Here

- `paperreview-submit` is under `reviewer`, but the current reviewer tool policy in [openclaw.json](/Users/iranb/Library/Mobile Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research/openclaw.json) denies `bash/exec/process`, so the skill cannot run as-is.
- `paper-compile` and `paper-phase` expect shell access, but the current `academic_writer` tool policy also denies `bash`.

These are configuration and ownership issues, separate from the Researcher skill bloat cleanup.
