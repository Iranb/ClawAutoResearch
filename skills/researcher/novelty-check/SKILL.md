---
name: novelty-check
description: "Verify research idea novelty through papers.cool multi-source search and Cross-Reviewer agent validation. Use after idea-generator produces candidate ideas."
argument-hint: "[idea title + hypothesis description]"
allowed-tools:
  - Read
  - Write
  - Glob
  - Grep
  - Agent
  - Skill
---

# Novelty Check

papers.cool keyword search + venue sweep + Cross-Reviewer agent validation.

> **File ownership**: Write ONLY to `{PROJ}/researcher/`. `{PROJ}` = `{PROJECTS_ROOT}/{proj-id}`

All paper discovery is delegated to `/papers-cool`. Do not use `web_search` or `web_fetch` to find papers.

## Process

### Step 1: Multi-Source Paper Search

Search for prior work that could overlap with the idea's hypothesis.

**1a. Keyword search — method/technique terms**

```
/papers-cool Search for papers on "[CORE METHOD KEYWORDS]", return top 20 sorted by reading stars, save to {PROJ}/researcher/novelty_search_1.json
```

**1b. Keyword search — task + dataset terms**

```
/papers-cool Search for papers on "[TASK + DATASET KEYWORDS]", return top 15 sorted by time, save to {PROJ}/researcher/novelty_search_2.json
```

**1c. Venue sweep — recent top venues**

Check the three most relevant venues for any similar work published in the last 1–2 years:

```
/papers-cool List papers from NeurIPS.2024, show top 200, save to {PROJ}/researcher/novelty_venue_neurips.json
```

```
/papers-cool List papers from ICML.2024, show top 200, save to {PROJ}/researcher/novelty_venue_icml.json
```

```
/papers-cool List papers from ICLR.2025, show top 200, save to {PROJ}/researcher/novelty_venue_iclr.json
```

Filter venue results: keep only papers whose title/abstract meaningfully overlaps with the idea.

**1d. Fetch full abstracts for top 5 most similar papers**

```
/papers-cool Fetch full abstract for arXiv paper [ARXIV_ID], save to {PROJ}/researcher/novelty_papers/[ARXIV_ID].json
```

**Build `related_work_summary`** from collected results:

```markdown
| # | Title | arXiv ID | Venue | Similarity | How it differs (or overlaps) |
|---|-------|----------|-------|-----------|------------------------------|
| 1 | [title] | [id] | NeurIPS'24 | HIGH | Uses [X], but not [our Y] |
| 2 | [title] | [id] | arXiv | MEDIUM | Similar motivation, different approach |
```

### Step 2: Cross-Agent Validation

Send the idea and search results to the **Cross-Reviewer Agent**:

```
sessions_send agent="cross-reviewer":

CROSS_REVIEW_REQUEST
mode: novelty
context: [research domain, target venue, stage: idea validation]

Idea title: [title]
Hypothesis: [one sentence]
Domain: [ML subfield]
Target venue: [NeurIPS / ICML / ICLR / etc.]

Related work found (via /papers-cool search):
[related_work_summary table]

Top 3 most similar papers (full abstracts):
[paste from fetch outputs]

Full idea description:
[from IDEA_REPORT.md]

END_REQUEST
```

Wait for the structured `## Novelty Assessment` response.

### Step 3: Decision

Parse the `**Verdict**` field from Cross-Reviewer:

| Verdict | Action |
|---------|--------|
| **PROCEED** | Novelty confirmed — continue to idea-tournament |
| **PROCEED_WITH_CAUTION** | Proceed, but add required differentiations to hypothesis |
| **ABANDON** | Too similar to existing work — remove from candidates |

## Output

Update `{PROJ}/researcher/IDEA_REPORT.md` for the checked idea:

```markdown
### [Idea Title] — Novelty: CONFIRMED / CAUTIOUS / ABANDONED

**papers.cool searches**: [N papers reviewed, keywords used]
**Cross-Reviewer verdict**: PROCEED / PROCEED_WITH_CAUTION / ABANDON
**Most similar prior work**: [paper title] — [arxiv_id] — [venue]
**Key differentiator**: [what makes this novel, if anything]
**Scooping risk**: LOW / MEDIUM / HIGH
**Required clarifications** (if CAUTIOUS): [list]
```

If ABANDON: append to `{PMEM}/ideation-memory.md` under "Failed Idea Catalog" (`{PMEM}` = `{PROJ}/memory`):
```markdown
### [Idea Title] — [date] (ABANDONED — not novel)
- **Failure mode**: Substantially similar to [paper arxiv_id] — [title]
- **Do not retry unless**: [condition from Cross-Reviewer's pivot suggestion]
```
