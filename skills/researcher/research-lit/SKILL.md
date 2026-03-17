---
name: research-lit
description: "Literature survey using papers.cool: keyword search, venue browsing, abstract fetch, and Kimi analysis. Builds a structured landscape report. Use when starting a new research direction."
argument-hint: "[research topic or question]"
allowed-tools:
  - Read
  - Write
  - Grep
  - Glob
  - Skill
---

# Research Lit

Multi-source literature survey via `/papers-cool`, building a structured research landscape with gaps and baselines.

> **File ownership**: Write ONLY to `{PROJ}/researcher/`. `{PROJ}` = `{PROJECTS_ROOT}/{proj-id}`（{PROJECTS_ROOT} 见 CONFIG.md）

All paper discovery is delegated to `/papers-cool`. Do not use `web_search` or `web_fetch` to find papers.

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

### Step 5: Kimi Analysis for Key Papers

For the top 5 most important papers (primary baselines, most closely related work), retrieve the on-page Kimi analysis:

```
/papers-cool Fetch Kimi analysis for arXiv paper [ARXIV_ID], save to {PROJ}/researcher/lit_papers/[ARXIV_ID]_kimi.json
```

The `kimi_analysis` field contains a structured summary: problem, method, contributions, limitations — no additional LLM summarization needed.

### Step 6: Synthesize Landscape Report

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
