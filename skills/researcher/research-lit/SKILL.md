---
name: research-lit
description: "Literature survey using papers.cool: keyword search, venue browsing, abstract fetch, and Kimi analysis. Builds a structured landscape report. Use when starting a new research direction."
argument-hint: "[research topic or question]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - Skill
---

# Research Lit

Multi-source literature survey via `/papers-cool`, building a structured research landscape with gaps and baselines.

> **File ownership**: Write ONLY to `{PROJ}/researcher/`. `{PROJ}` = `{PROJECTS_ROOT}/{proj-id}` (see `CONFIG.md` for `{PROJECTS_ROOT}`)

All paper discovery is delegated to `/papers-cool`. Do not use `web_search` or `web_fetch` to find papers.

## Paper Source Layout (mandatory)

`paper_source_dir` must use a stable, predictable layout:

```text
<paper_source_dir>/
  md/
  pdf/
```

Preferred filenames:

- markdown: `<arxiv-id>--<normalized-title>.md`
- pdf: `<arxiv-id>--<normalized-title>.pdf`

Normalization rules:
- lowercase ASCII only
- replace spaces / underscores with `-`
- strip punctuation except `-`
- keep titles short and readable
- prefer arXiv ID as the canonical prefix

Examples:
- `2502.00032--retrieval-augmented-experiment-planning.md`
- `2406.12345--graph-contrastive-learning.pdf`

## Dedup Rules (mandatory)

Use this canonical identity order:

1. arXiv ID
2. DOI if arXiv ID is unavailable
3. normalized title

Rules:
- never save the same canonical paper twice under different filenames
- if both markdown and PDF exist for the same paper, markdown is the preferred PaperNexus ingestion source
- if a new markdown arrives for a paper that already has a PDF, keep the PDF only as fallback; do not treat it as a new paper
- version-only changes such as `v1` → `v2` do not count as a new paper unless the content materially changes

Maintain `{PROJ}/researcher/PAPER_SOURCE_INDEX.json` with one entry per canonical paper so later stages can detect real additions instead of filename noise.

## Process

### Step 1: Check Existing Memory

Read `{PMEM}/ideation-memory.md` if it exists — note already-explored directions and known dead ends to avoid redundancy in search. `{PMEM}` = `{PROJ}/memory`

### Step 2: Keyword Search (core topic)

Run 3–5 targeted searches covering different angles of the topic. Delegate each to `/papers-cool`:

```
/papers-cool Search for papers on "[CORE METHOD KEYWORDS]", return top 20 results sorted by time, save to {PROJ}/researcher/lit_search_1.json
```

```
/papers-cool Search for papers on "[TASK + DATASET KEYWORDS]", return top 15 results sorted by reading stars (most cited/discussed first), save to {PROJ}/researcher/lit_search_2.json
```

```
/papers-cool Search for papers on "[RECENT TREND KEYWORDS]", return top 15 results sorted by time, save to {PROJ}/researcher/lit_search_3.json
```

After each search, reflect:
- Have the key baseline methods been found?
- Are recent papers (last 12 months) covered?
- What direction is still missing?

Continue until the landscape is clear (max 5 keyword searches).

### Step 3: Venue Sweep

Browse recent papers from the 2–3 most relevant venues to catch work not yet on arXiv or indexed by keyword:

```
/papers-cool List papers from NeurIPS.2024, show top 100, save to {PROJ}/researcher/lit_neurips2024.json
```

```
/papers-cool List papers from ICML.2024, show top 100, save to {PROJ}/researcher/lit_icml2024.json
```

```
/papers-cool List Oral papers from ICLR.2025, show top 50, save to {PROJ}/researcher/lit_iclr2025_oral.json
```

Filter each result file: keep entries whose title/abstract meaningfully overlaps with the research topic.

### Step 4: Fetch Full Abstracts for Top Papers

For up to 15 papers identified as highly relevant, fetch the complete abstract:

```
/papers-cool Fetch full abstract for arXiv paper [ARXIV_ID], save to {PROJ}/researcher/lit_papers/[ARXIV_ID].json
```

### Step 5: Full-Text Acquisition for PaperNexus

For the top 5-15 most relevant papers, build a reusable local full-text corpus before idea generation.

Resolve the preferred PaperNexus source directory in this order:
- `{PROJ}/PROJECT_MANIFEST.json` field `paper_source_dir` if present
- default `/Users/iranb/.papernexus/papers/{proj-id}`

Ensure this directory layout exists:
- `<paper_source_dir>/md/`
- `<paper_source_dir>/pdf/`

For each selected paper:

1. Try `/hugging-face-paper-pages [ARXIV_ID]`
   - save full markdown to `<paper_source_dir>/md/<paper-id>--<normalized-title>.md`
   - save metadata to `{PROJ}/researcher/lit_papers/[ARXIV_ID]_hf.json`
2. If Hugging Face markdown is unavailable, fall back to `/papers-cool` PDF download:

```
/papers-cool Download PDF for arXiv paper [ARXIV_ID], save to <paper_source_dir>/pdf/<paper-id>--<normalized-title>.pdf
```

After each acquisition:
- check `PAPER_SOURCE_INDEX.json` first and skip duplicates
- update or insert the canonical paper entry
- record whether this was `new_markdown`, `new_pdf_fallback`, `upgraded_pdf_to_markdown`, or `duplicate_skipped`

The goal is not just to summarize papers, but to accumulate a project-local corpus that PaperNexus can analyze directly.

### Step 5.5: Evaluate Whether Graph Refresh Is Needed

After ingestion, classify the literature delta using these rules:

- `refresh_required = true` if at least 1 newly ingested paper directly affects the active topic's core baseline, closest prior work, or novelty claim
- `refresh_required = true` if there are 3 or more genuinely new canonical papers since the last graph sync
- `refresh_required = true` if there are 2 or more newly ingested recent venue papers that materially overlap with the current active track
- otherwise set `refresh_required = false` and defer refresh to the next major checkpoint

### Step 5.6: Graph Presence Check (mandatory)

Before any frontier extraction, novelty check, or innovation analysis:

- inspect `PAPER_SOURCE_INDEX.json` to confirm which canonical papers are newly added or upgraded
- compare those canonical papers against the current graph status
- if a newly found key paper is missing from the graph, stop the idea workflow and hand off to `/graph-build`
- only continue once the graph contains the new paper or the refresh result is explicitly recorded as failed / deferred

This is a hard rule:

- `papers-cool` search alone is never enough for innovation analysis
- a key paper found by search must become graph-readable full text first
- if markdown is available, prefer markdown over PDF for graph ingestion
- graph-grounded innovation analysis must cite graph anchors, not only paper titles or abstracts

### Step 6: Kimi Analysis for Key Papers

For the top 5 most important papers (primary baselines, most closely related work), retrieve the on-page Kimi analysis:

```
/papers-cool Fetch Kimi analysis for arXiv paper [ARXIV_ID], save to {PROJ}/researcher/lit_papers/[ARXIV_ID]_kimi.json
```

The `kimi_analysis` field contains a structured summary: problem, method, contributions, limitations — no additional LLM summarization needed.

### Step 7: Synthesize Landscape Report

Read all collected paper data. Build the structured report.

## Output

Write `{PROJ}/researcher/LITERATURE.md`:

```markdown
# Literature Survey: [topic]
**Date**: YYYY-MM-DD
**Searches run**: [list keywords used]
**Papers reviewed**: N total (N with Kimi analysis)

---

## Landscape

### Direction 1: [Name]
- **What**: [one-sentence description of this research line]
- **Key methods**: [Method A (arxiv_id, venue, year), Method B ...]
- **Strengths**: ...
- **Weaknesses / Limitations**: ...
- **Representative papers**:
  - [Title] — [arxiv_id] — [venue year] — [one-sentence contribution]

### Direction 2: [Name]
...

---

## Key Gaps

| # | Gap | Why It Matters | Difficulty |
|---|-----|---------------|------------|
| 1 | [description] | [impact if solved] | High / Med / Low |

---

## Baselines

| Method | Venue | Year | Dataset | Metric | Score | arXiv ID |
|--------|-------|------|---------|--------|-------|----------|
| [name] | NeurIPS | 2024 | CIFAR-100 | Acc | 85.2% | [id] |

---

## Search Log

| Search # | Query | Sort | Results Found | Key Papers Found |
|----------|-------|------|--------------|-----------------|
| 1 | "contrastive learning" | time | 20 | Baseline A, B |
| 2 | "few-shot CIFAR" | stars | 15 | Benchmark setup |

---

## Sources

[1] [Title] — https://papers.cool/arxiv/[arxiv_id]
[2] ...
```

Also update `{PROJ}/PROJECT_MANIFEST.json` with:
- `paper_source_dir`
- `paper_ingestion.last_ingested_at`
- `paper_ingestion.new_files_since_graph`
- `paper_ingestion.refresh_required`
- `paper_ingestion.refresh_reason`
- `paper_ingestion.graph_presence_checked_at`
- `updated_at`

Write `{PROJ}/researcher/PAPER_SOURCE_INDEX.json`:

```json
{
  "paper_source_dir": "/Users/iranb/.papernexus/papers/proj_xxx",
  "updated_at": "ISO-TS",
  "papers": [
    {
      "paper_key": "2502.00032",
      "title": "Retrieval-Augmented Experiment Planning",
      "normalized_title": "retrieval-augmented-experiment-planning",
      "preferred_source": "md",
      "md_path": "/Users/iranb/.papernexus/papers/proj_xxx/md/2502.00032--retrieval-augmented-experiment-planning.md",
      "pdf_path": "/Users/iranb/.papernexus/papers/proj_xxx/pdf/2502.00032--retrieval-augmented-experiment-planning.pdf",
      "status": "ready",
      "last_seen_at": "ISO-TS"
    }
  ]
}
```
