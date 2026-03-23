---
name: idle-research
description: "Bounded background literature monitoring for the configured idle_research topic. Use when Researcher is waiting on another agent or gate and the project manifest says the topic is due."
argument-hint: "[optional topic override or setup request]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - Skill
  - research_workflow
---

# Idle Research

Bounded background-topic research for Researcher. This is not a free-form brainstorm loop.

The authoritative state lives in `{PROJ}/PROJECT_MANIFEST.json.idle_research`, and the preferred runtime API is:

- `research_workflow.get_idle_research`
- `research_workflow.set_idle_research`
- `research_workflow.record_idle_research_run`

## When To Use

Run this skill when one of the following is true:

- Researcher is waiting on another agent, a remote experiment, or a human gate
- `idle_research.enabled = true` and the round is due
- the user explicitly wants to configure or update the background topic

Do not run a new round when the critical path is active and owned by Researcher, unless the user explicitly says to do background work anyway.

## Configuration Contract

The `idle_research` block should carry at least:

- `enabled`
- `topic`
- `objective`
- `query_seeds`
- `preferred_venues`
- `max_papers_per_cycle`
- `cooldown_minutes`
- `refresh_graph_on_new_core_papers`

Runtime fields such as `last_run_at`, `last_digest_path`, `last_source_update_at`, `status`, `pending_reason`, `next_query_hint`, `last_round_new_canonical_papers`, and `last_round_new_core_papers` should be updated through the plugin tool when available, not by ad hoc manual edits.

## Execution

1. Read `{PROJ}/PROJECT_MANIFEST.json` and call `research_workflow.get_idle_research`.
2. If `$ARGUMENTS` includes a setup or override request, patch the state through `research_workflow.set_idle_research` before doing any paper work.
3. If `enabled = false` or `topic` is empty, stop after reporting that idle research is disabled or unconfigured.
4. If the round is not due yet, stop and report the next due time instead of rerunning it.
5. Build 1-3 targeted search queries from `topic`, `query_seeds`, and `preferred_venues`.
6. Use `/papers-cool` first for discovery and venue sweep. Hard-cap the round to `max_papers_per_cycle` candidate papers.
7. For each candidate paper:
   - try `/hugging-face-paper-pages` first and save Markdown into `paper_source_dir/md/`
   - if Markdown is unavailable, use `/papers-cool` PDF fallback into `paper_source_dir/pdf/`
   - update `{PROJ}/researcher/PAPER_SOURCE_INDEX.json` by canonical identity
8. Write the round digest to `{PROJ}/researcher/idle-research/ROUND-YYYY-MM-DD_HHMM.md`.
9. If the round adds new core papers and `refresh_graph_on_new_core_papers = true`, mark graph refresh as required before the next novelty, ideation, or revision decision.
10. Call `research_workflow.record_idle_research_run` with the round summary so the cooldown and digest pointer stay restart-safe.

## Hard Limits

- Respect `max_papers_per_cycle`.
- Respect `cooldown_minutes`.
- Do not silently change `TRACK_REGISTRY.json`.
- Do not rewrite `PLAN.md`.
- Do not launch experiments.
- Do not treat abstract-only evidence as enough for innovation claims.
- Prefer Markdown over PDF when both are possible.

## Round Digest Template

The digest should contain:

- topic and objective
- queries used
- venues checked
- papers touched
- new canonical papers count
- new core papers count
- graph-refresh follow-up
- next query hint

## Recommended Flow

```text
research_workflow.get_idle_research
  -> /papers-cool
  -> /hugging-face-paper-pages
  -> /papers-cool (PDF fallback)
  -> update PAPER_SOURCE_INDEX.json
  -> write ROUND-*.md digest
  -> research_workflow.record_idle_research_run
```
