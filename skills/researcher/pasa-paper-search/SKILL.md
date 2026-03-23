---
name: pasa-paper-search
description: Search arXiv papers through the PASA (Paper Search Agent) backend by launching new PASA queries or resuming existing `https://pasa-agent.ai/home?...&session=...` links. Use when Researcher needs a second candidate-paper source in addition to papers.cool.
---

# PASA Paper Search

Use `{baseDir}/scripts/pasa_search.py` to talk directly to the PASA backend instead of driving the browser UI. This skill is an optional retrieval source inside `openclaw-research`.

> `papers-cool` remains the guaranteed baseline retrieval path. If PASA fails, times out, or returns unusable output, continue with `papers-cool` only.

## Quick Start

Run a fresh search and get structured JSON:

```bash
python3 {baseDir}/scripts/pasa_search.py --format json "generalized category discovery"
```

Resume an existing PASA session from the full home URL:

```bash
python3 {baseDir}/scripts/pasa_search.py \
  --format markdown \
  "https://pasa-agent.ai/home?query=generalized&session=1774235091806131914"
```

Filter by year and export BibTeX for the returned items:

```bash
python3 {baseDir}/scripts/pasa_search.py \
  --format json \
  --min-year 2021 \
  --limit 15 \
  --save-bib /tmp/pasa-top15.bib \
  "graph anomaly detection transfer learning"
```

## Workflow Inside openclaw-research

1. Rewrite the research intent into a concise English query before calling PASA. The backend only supports English input reliably.
2. Use `--format json` when the caller wants to merge PASA output with `papers-cool`.
3. Treat PASA as a supplementary candidate source:
   - always keep the `papers-cool` result set
   - if PASA succeeds, merge the two result sets by canonical identity
   - if PASA fails, log the failure and continue with `papers-cool` only
4. Treat `score` as a ranking hint, not as calibrated relevance.
5. When you write or update `PAPER_SOURCE_INDEX.json`, keep PASA in `retrieval_providers`, not `source_provider`.

## Practical Guidance

- Prefer `--limit 10` to `--limit 20` for quick triage.
- Prefer `--format json` for agent workflows and `--format markdown` for quick human review.
- Use `--save-json` when you want a reusable artifact for later merge or dedup.
- Use `--save-bib` when the user wants a bibliography draft.
- If the script times out with `finished: false`, rerun it with the same `--session-id` or the same PASA home URL to continue polling the existing search.
- If network access is blocked or PASA is unstable, do not block the literature workflow; fall back to `papers-cool`.

## Resources

- `{baseDir}/scripts/pasa_search.py`: Start or resume PASA searches, poll results, filter by year, and emit JSON or Markdown.
- `{baseDir}/references/pasa-api.md`: Reverse-engineered notes on the PASA endpoints, response schema, and session behavior.
