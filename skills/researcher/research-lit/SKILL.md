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

---

## 🚀 MANDATORY WORKFLOW (RESEARCH PIPELINE)

**When invoked by `/research-pipeline` or `/research-queue`:**

1. **Search multiple keywords** (3-5 queries covering different angles)
2. **For EACH paper found** (ALL, not just selected few):
   - **Step 1:** Check HuggingFace for markdown (`/hugging-face-paper-pages`)
   - **Step 2:** If HF has markdown → save to `paper_source_dir/md/`
   - **Step 3:** If HF no markdown → download PDF to `paper_source_dir/pdf/`
3. **After EACH search query** (≥20 papers):
   - Trigger `/graph-build` if ≥3 new papers ingested
   - Update `PROJECT_MANIFEST.json` with `paper_ingestion` metadata
4. **After ALL searches complete**:
   - Run `/graph-build --force` for final corpus build
   - Run `/frontier-mapping` to extract research frontiers
   - Write `{PROJ}/researcher/LITERATURE.md` with full survey

**Do NOT:**
- Skip HuggingFace check
- Only process 1-2 papers from search results
- Delay graph build until all searches complete (build incrementally)
- Write LITERATURE.md before graph build

---

## Paper Source Layout (mandatory)

`paper_source_dir` must use a stable, predictable layout:

```text
<paper_source_dir>/
  md/
    <arxiv-id>--<normalized-title>.md
  pdf/
    <arxiv-id>--<normalized-title>.pdf
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

**For EACH paper in search results:**

1. **Check HuggingFace FIRST:**
   ```
   /hugging-face-paper-pages --arxiv <arxiv_id> --output-dir {PROJ}/researcher/paper_source/md/
   ```

2. **If HuggingFace has markdown:**
   - Saved to `paper_source_dir/md/`
   - Add to graph build queue
   - Continue to next paper

3. **If HuggingFace NO markdown:**
   - Download PDF via `/papers-cool`:
     ```
     /papers-cool Download PDF for arxiv:<arxiv_id> to {PROJ}/researcher/paper_source/pdf/
     ```

### Step 3: Incremental Graph Build

**After EACH search query** (when ≥3 new papers ingested):

```bash
node <PAPERNEXUS>/src/cli/index.js analyze <paper_source_dir> --name <proj-id>
```

Update `{PROJ}/PROJECT_MANIFEST.json`:
```json
{
  "paper_ingestion": {
    "last_ingested_at": "<ISO timestamp>",
    "last_graph_sync_at": "<ISO timestamp>",
    "new_files_since_graph": <count>,
    "graph_presence_checked_at": "<ISO timestamp>"
  }
}
```

### Step 4: Write Literature Report

After all searches and graph builds complete:

Write `{PROJ}/researcher/LITERATURE.md` with:
- Search queries used
- Total papers found
- Key papers (with arXiv IDs)
- Initial observations
- Gaps identified

---

## HuggingFace Integration (PRIORITY 1)

**Always check HuggingFace before downloading PDFs.**

### Why HuggingFace?

- Markdown is **ready for PaperNexus** (no PDF parsing needed)
- Faster ingestion (skip docling/marker)
- Often includes structured metadata

### How to Use

For each arXiv ID from search results:

```bash
/hugging-face-paper-pages --arxiv <arxiv_id> --output-dir {paper_source_dir}/md/
```

**Success:** Markdown saved, ready for graph build  
**Failure:** Fall back to PDF download

### Batch Processing

For efficiency, process papers in batches of 10:

```python
# Check 10 papers at once
arxiv_batch = [id1, id2, ..., id10]
for arxiv_id in arxiv_batch:
    /hugging-face-paper-pages --arxiv {arxiv_id} ...
```

---

## Graph Build Integration

**Trigger graph build when:**

1. ≥3 new papers ingested since last build
2. A key paper (changes novelty baseline) is ingested
3. All searches complete (final build)

**Graph build command:**

```bash
PAPERNEXUS_PYTHON=/Users/iranb/mambaforge/bin/python \
  node <PAPERNEXUS>/src/cli/index.js analyze <paper_source_dir> --name <proj-id>
```

**After graph build:**

1. Check status: `node <PAPERNEXUS>/src/cli/index.js status --corpus <proj-id>`
2. Update `PROJECT_MANIFEST.json` with:
   - `graph_last_built_at`
   - `papernexus_corpus`
   - `graph_source_dir`

---

## Related Skills

- `/papers-cool` — Paper search and download
- `/hugging-face-paper-pages` — Fetch markdown from HuggingFace
- `/graph-build` — Build PaperNexus corpus
- `/frontier-mapping` — Extract research frontiers from graph

---

## Output Files

| File | Description |
|------|-------------|
| `lit_search_*.json` | Raw search results |
| `paper_source/md/*.md` | HuggingFace markdown papers |
| `paper_source/pdf/*.pdf` | Downloaded PDFs |
| `PAPER_SOURCE_INDEX.json` | Canonical paper index |
| `LITERATURE.md` | Literature survey report |
