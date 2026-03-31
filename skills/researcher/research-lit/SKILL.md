---
name: research-lit
description: "Literature survey using papers.cool plus optional PASA retrieval, then markdown-first full-text ingestion and graph grounding. Use when starting a new research direction."
argument-hint: "[research topic or question]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - Skill
  - lobster
---

# Research Lit

Multi-source literature survey via `/papers-cool` plus optional `/pasa-paper-search`, building a structured research landscape with gaps and baselines.

> **File ownership**: Write ONLY to `{PROJ}/researcher/`. `{PROJ}` = `{PROJECTS_ROOT}/{proj-id}` (see `CONFIG.md` for `{PROJECTS_ROOT}`)

## Research Rigor Constraints

- When literature turns into candidate experiments, preserve **one variable per experiment** by keeping mechanism ideas isolated instead of merging several deltas at once.
- **Record everything**: queries, canonical paper ids, ingestion decisions, rejected papers, and emerging baseline hypotheses belong in durable project files.
- Keep the **experiment and code change linked** by noting which papers justify which future experiment deltas or baseline requirements.
- **Verify before claiming** novelty, contradiction, or support; abstracts and memory alone are not enough.
- **Never manipulate evaluation** by selecting only flattering baselines or citations from the literature sweep.
- **Never fabricate citations** or paper metadata; verify title, authors, year, venue, and identifier from the source.

Use `/papers-cool` as the guaranteed retrieval baseline. When available, use `/pasa-paper-search` as a second discovery source and merge the two result sets by canonical paper identity. Do not use `web_search` or `web_fetch` to find papers.

---

## 🚀 MANDATORY WORKFLOW (RESEARCH PIPELINE)

**When invoked by `/research-pipeline` or `/research-queue`:**

1. **Search multiple keywords** (3-5 queries covering different angles)
   - always run `papers-cool`
   - if possible, also run `pasa-paper-search` with equivalent English queries
   - if PASA fails, continue with `papers-cool` only
2. **For EACH paper found** (ALL, not just selected few):
   - **Step 1:** Once the paper identity is confirmed (arXiv ID / paper URL), check HuggingFace for markdown (`/hugging-face-paper-pages`) immediately
   - **Step 2:** Validate the downloaded Markdown; if it is really HTML / error text / tiny stub, delete it and retry the HF fetch
   - **Step 3:** If HF still has no valid markdown and the paper is on arXiv, try `/arxiv2md-api`
   - **Step 4:** If direct API markdown still fails, try `/arxiv2md`
   - **Step 5:** Validate the arXiv markdown; if it is HTML / error text / tiny stub, delete it and retry once
   - **Step 6:** If all Markdown sources fail → download PDF to the project-local staging dir under `paper_source_dir/pdf/`
   - **Step 7:** Validate the PDF; if it is HTML / ASCII error output instead of a real PDF, delete it and retry the next PDF source
   - **Step 8:** Ensure later `/graph-build` sees a canonical Markdown-first corpus where same-paper Markdown overrides PDF
   - **Step 9:** If the file enters through a PaperNexus UI/API upload path instead of the markdown/PDF fetcher flow, prefer the queued import-task wrappers (`python3 scripts/pn_import_submit.py` and `python3 scripts/pn_import_queue.py`) over manually copying the upload into workflow-owned shared storage
   - **Step 10:** Use exactly one paper per queued import call. Do not send multi-file `files[]` batches through the wrapper or the API; each paper must become its own remote task so timeout and progress are isolated
   - **Step 11:** Bound each queued import to at most 60 seconds total wait. If the task has not reached `completed` within 60 seconds, call `research_workflow.set_paper_ingestion` with `paper_operations=[{phase:\"import\",status:\"timed_out\",...}]`, report the timeout, and move on to the next paper instead of polling indefinitely
   - **Step 12:** When a queued PaperNexus import task truly reaches `completed`, call `research_workflow.set_paper_ingestion` with one `completed_papers` entry containing `canonical_id`, `title`, and `import_task_id` so the workflow can persist the completion and send one Discord-visible completion update
3. **After EACH merged search query** (≥20 papers or a materially new PASA cluster):
   - Trigger `/graph-build` if ≥3 new papers ingested
   - Update `PROJECT_MANIFEST.json` with `paper_ingestion` metadata
   - Run one bounded brainstorm synthesis pass over the currently ingested papers; this is mandatory during research, not postponed to IDEA
4. **After ALL searches complete**:
   - Write `{PROJ}/researcher/RESEARCH_BRAINSTORM.md` with preliminary mechanism hypotheses, decomposition ideas, contradictions, and do-not-repeat constraints
   - Run `/graph-build` for final shared-graph reconciliation
   - Do not use `--force`; if graph build fails, hand the exact non-force graph-build command to the user
   - Run `/frontier-mapping` to extract research frontiers
   - Write `{PROJ}/researcher/LITERATURE.md` with full survey

**Do NOT:**
- Skip HuggingFace check
- Only process 1-2 papers from search results
- Delay shared-graph reconciliation until all searches complete (build incrementally)
- Write LITERATURE.md before graph reconciliation
- Keep invalid HTML / error-page downloads under `paper_source_dir`
- Manually move UI/API-uploaded papers into the shared source tree when the queued PaperNexus import-task path is available
- Call destructive PaperNexus backup / restore commands as part of normal literature work

---

## Paper Source Layout (mandatory)

`paper_source_dir` must use a stable, predictable layout:

```text
<paper_source_dir>/
  md/
    <canonical-paper>.md
  pdf/
    <canonical-paper>.pdf
```

Default path policy:
- for new projects, keep `paper_source_dir` and `graph_source_dir` unset in the manifest unless the project explicitly overrides the shared-global defaults
- in remote-only workflow mode, treat `paper_source_dir` as project-local staging under `{PROJ}/researcher/paper-staging/`, not as any home-directory shared PaperNexus storage

Preferred filenames:

- if arXiv ID exists: `<arxiv-id>.md` or `<arxiv-id>.pdf`
- if arXiv ID does not exist: `<normalized-title>.md` or `<normalized-title>.pdf`

Normalization rules:
- lowercase ASCII only
- if the paper has an arXiv ID, use that ID as the whole filename stem
- keep the `.` in modern arXiv IDs such as `2502.00032`
- strip version suffixes such as `v1`, `v2`
- if the ID uses the old slash form, replace `/` with `-`
- otherwise transliterate the paper title to ASCII, lowercase it, replace spaces / separators with `-`, and strip special characters
- collapse repeated `-`
- keep titles short and readable

Examples:
- `2502.00032.md`
- `2406.12345.pdf`
- `graph-contrastive-learning-for-retrieval.md`

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
- `/graph-build` must reconcile the project's canonical paper selection against the shared global graph; do not create a second graph-only source tree for the same project
- after each successful download, rename or save the file to the canonical stem immediately before updating `PAPER_SOURCE_INDEX.json`
- if a remote PaperNexus flow is used, go through the configured Python wrappers so auth and request shape are resolved consistently instead of assuming anonymous access
- do not treat any home-directory shared PaperNexus storage as workflow-owned when remote access is configured

Maintain `{PROJ}/researcher/PAPER_SOURCE_INDEX.json` with one entry per canonical paper so later stages can detect real additions instead of filename noise.

Recommended per-paper fields:

```json
{
  "canonical_id": "arxiv:2502.00032",
  "arxiv_id": "2502.00032",
  "title": "Retrieval-Augmented Experiment Planning",
  "source_kind": "markdown",
  "source_provider": "arxiv2md",
  "source_path": "{paper_source_dir}/md/2502.00032.md",
  "retrieval_providers": ["papers-cool", "pasa-paper-search"]
}
```

`source_provider` should describe the full-text origin:

- `hf`
- `arxiv2md`
- `pdf`

`retrieval_providers` should list discovery channels such as:

- `papers-cool`
- `pasa-paper-search`

## Process

### Step 1: Check Existing Memory

Read `{PMEM}/ideation-memory.md` if it exists — note already-explored directions and known dead ends to avoid redundancy in search. `{PMEM}` = `{PROJ}/memory`

### Step 2: Keyword Search (core topic)

Run 3–5 targeted searches covering different angles of the topic. Always use `/papers-cool`, and optionally mirror the strongest queries through `/pasa-paper-search`:

```
/papers-cool Search for papers on "[CORE METHOD KEYWORDS]", return top 20 results sorted by time, save to {PROJ}/researcher/lit_search_1.json
```

```
/papers-cool Search for papers on "[TASK + DATASET KEYWORDS]", return top 15 results sorted by reading stars (most cited/discussed first), save to {PROJ}/researcher/lit_search_2.json
```

For the same theme, try PASA as an optional second source:

```bash
/pasa-paper-search --format json --limit 15 --save-json {PROJ}/researcher/lit_search_pasa_1.json "[ENGLISH CORE QUERY]"
```

If PASA returns an error, times out, or yields unusable output, record the failure in the round notes and continue with the `papers-cool` results only.

### Merge Rule (mandatory)

Before deciding which papers are genuinely new, merge `papers-cool` and PASA candidates by canonical identity:

1. arXiv ID
2. DOI
3. normalized title

Rules:

- keep the union of both sources, not the intersection
- record all successful discovery channels in `retrieval_providers`
- PASA scores are ranking hints only; do not let PASA-only ranking erase strong `papers-cool` recency or venue signals
- if both sources point to the same paper, keep one canonical entry and merge metadata

**For EACH paper in search results:**

1. **As soon as the paper identity is confirmed, check HuggingFace FIRST:**
   ```
   /hugging-face-paper-pages --arxiv <arxiv_id> --output-dir {paper_source_dir}/md/
   ```

2. **If HuggingFace has markdown:**
   - Saved to the project-local staging dir `paper_source_dir/md/`
   - Save or rename it to the canonical filename immediately: arXiv ID first, otherwise normalized title
   - Must pass format validation before being counted as ingested
   - Add to graph reconciliation queue
   - Continue to next paper

3. **If HuggingFace NO valid markdown and the paper has an arXiv ID:**
   - Try `/arxiv2md`:
     ```
     /arxiv2md <arxiv_id>
     ```
   - Save or rename the validated file to `<arxiv-id>.md`
   - The saved markdown must also pass format validation before being counted as ingested

4. **If both Markdown sources fail:**
   - Download PDF via `/papers-cool`:
     ```
     /papers-cool Download PDF for arxiv:<arxiv_id> to {paper_source_dir}/pdf/
     ```
   - Save or rename the validated PDF to the canonical filename immediately after download
   - The saved PDF must pass format validation; bad HTML / text responses must be deleted and retried

Do not postpone the HuggingFace attempt until after later filtering if the current search result already exposes a stable arXiv ID or paper URL.

### Step 3: Incremental Shared-Graph Reconciliation

**After EACH search query** (when ≥3 new papers ingested):

```bash
/graph-build
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

Notes:
- `/graph-build` now means "reconcile this project's `PAPER_SOURCE_INDEX.json` against the shared global graph through the Python PaperNexus control plane"
- do not create or name a new per-project corpus during this step
- if required papers are missing from the shared graph, record the gap and request or queue a shared-graph refresh rather than building a project-local corpus
- if a PaperNexus queued import completed during this batch, report that completion through `research_workflow.set_paper_ingestion.completed_papers` instead of relying on `PAPER_SOURCE_INDEX.json` diffs alone
- if a PaperNexus queued import or remote graph reconcile has not finished within 60 seconds for one paper, record a `paper_operations` timeout entry and continue the batch instead of waiting forever
- when checking presence or frontier structure, prefer `research_workflow.run_papernexus_wrapper` with `python3 scripts/pn_graph_query.py` and `python3 scripts/pn_research_chains.py` over hand-written REST calls

### Step 3.5: Brainstorm During Research (mandatory)

Do not wait for `IDEA` to begin the first serious brainstorm.
During literature work itself, after each materially new batch of papers:

- cluster the new papers into mechanisms, assumptions, and failure modes
- note at least 3 candidate problem framings or innovation hooks
- note at least 2 explicit falsifiers or "why this may fail" constraints
- prefer graph-grounded or citation-grounded prompts whenever the graph is already usable

Maintain `{PROJ}/researcher/RESEARCH_BRAINSTORM.md` with sections such as:

- `Mechanism hypotheses`
- `Part-level decomposition opportunities`
- `Manifold / capacity hypotheses`
- `Contradictions and unresolved tensions`
- `Do-not-repeat constraints`

Frontier mapping should refine and package this brainstorm scaffold, not start it from zero.

### Step 4: Write Literature Report

After all searches and shared-graph reconciliations complete:

Write `{PROJ}/researcher/LITERATURE.md` with:
- Search queries used
- Total papers found
- Key papers (with arXiv IDs)
- Initial observations
- Gaps identified

Also refresh `{PROJ}/researcher/RESEARCH_BRAINSTORM.md` so the literature stage ends with a usable brainstorm scaffold.

---

## HuggingFace Integration (PRIORITY 1)

**Always check HuggingFace first, then arxiv2md-api, then arxiv2md, before downloading PDFs.**

### Why HuggingFace?

- Markdown is **ready for PaperNexus** (no PDF parsing needed)
- Faster ingestion (skip docling/marker)
- Often includes structured metadata

### How to Use

For each arXiv ID from search results:

```bash
/hugging-face-paper-pages --arxiv <arxiv_id> --output-dir {paper_source_dir}/md/
```

**Success:** Markdown saved, ready for shared-graph reconciliation  
**Failure:** Delete the invalid file if needed, retry once, then try `arxiv2md-api`, then `arxiv2md`, and only then fall back to PDF download

### Batch Processing

Search and metadata screening can still happen in batches of 10, but remote PaperNexus ingestion must stay single-paper:

```python
# Check 10 papers at once
arxiv_batch = [id1, id2, ..., id10]
for arxiv_id in arxiv_batch:
    /hugging-face-paper-pages --arxiv {arxiv_id} ...
```

Important:

- do not upload those 10 papers to `/api/imports` in one request
- instead, enqueue one paper per `/api/imports` call
- wait at most 60 seconds for that paper's remote task
- after completion or timeout, send a visible workflow update and continue with the next paper

---

## Graph Build Integration

**Trigger shared-graph reconciliation when:**

1. ≥3 new papers ingested since last build
2. A key paper (changes novelty baseline) is ingested
3. All searches complete (final reconciliation pass)

**Graph build action:**

```bash
/graph-build
```

**After graph reconciliation:**

1. Check project graph presence against the shared global graph
2. Update `PROJECT_MANIFEST.json` with:
   - `graph_last_built_at`
   - `paper_ingestion.last_graph_sync_at`
   - shared-graph readiness metadata written by the workflow runtime

---

## Related Skills

- `/papers-cool` — Guaranteed paper search baseline and PDF fallback
- `/pasa-paper-search` — Optional PASA-ranked discovery source to merge with papers.cool
- `/hugging-face-paper-pages` — Fetch markdown from HuggingFace
- `/arxiv2md-api` — Direct raw markdown fallback for arXiv papers
- `/arxiv2md` — Legacy webpage markdown fallback for arXiv papers
- `/graph-build` — Reconcile project paper selection against the shared global graph
- `/frontier-mapping` — Extract research frontiers from graph

---

## Output Files

| File | Description |
|------|-------------|
| `lit_search_*.json` | Raw search results |
| `lit_search_pasa_*.json` | Optional PASA search results |
| `{paper_source_dir}/md/*.md` | Shared-source markdown papers |
| `{paper_source_dir}/pdf/*.pdf` | Shared-source PDF fallbacks |
| `PAPER_SOURCE_INDEX.json` | Canonical paper index |
| `RESEARCH_BRAINSTORM.md` | Brainstorm scaffold generated during research |
| `LITERATURE.md` | Literature survey report |

## Stage Closeout

When literature ingestion, preliminary brainstorming, and the durable outputs are complete, Researcher may trigger the Lobster handoff workflow only if the current stage is actually ready to advance.

Do not hand off if the shared graph still needs reconciliation, key papers are still missing from the shared graph, or brainstorming is still stale relative to the new papers.
