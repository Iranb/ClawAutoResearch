---
name: research-lit
description: "Literature survey using the workflow-owned broad retrieval backbone plus papers.cool/PASA supplementary recall, then markdown-first full-text ingestion and graph grounding. Use when starting a new research direction."
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

Multi-source literature survey via the workflow-owned broad retrieval backbone, with `/papers-cool` plus optional `/pasa-paper-search` retained as supplementary recall for arXiv- and venue-heavy AI topics.

> **File ownership**: Write ONLY to `{PROJ}/researcher/`. `{PROJ}` = `{PROJECTS_ROOT}/{proj-id}` (see `CONFIG.md` for `{PROJECTS_ROOT}`)

## Research Rigor Constraints

- When literature turns into candidate experiments, preserve **one variable per experiment** by keeping mechanism ideas isolated instead of merging several deltas at once.
- **Record everything**: queries, canonical paper ids, ingestion decisions, rejected papers, and emerging baseline hypotheses belong in durable project files.
- **Keep bibliography state durable too**: if local Zotero MCP is available, keep the configured project Zotero collection synchronized with selected, included, excluded, baseline, and writing-shortlist sets. The plugin-global root defaults to `bot`, so the default project path is `<zoteroProjectRoot>/<project-id>` unless the project overrides it explicitly. If Zotero writes require authentication, rely on the Zotero MCP server's own `ZOTERO_API_KEY` / `ZOTERO_USER_ID` environment rather than plugin config.
- Keep the **experiment and code change linked** by noting which papers justify which future experiment deltas or baseline requirements.
- **Verify before claiming** novelty, contradiction, or support; abstracts and memory alone are not enough.
- **Never manipulate evaluation** by selecting only flattering baselines or citations from the literature sweep.
- **Never fabricate citations** or paper metadata; verify title, authors, year, venue, and identifier from the source.

Use the workflow-owned broad retrieval backbone as the primary discovery path when coverage breadth matters. Keep `/papers-cool` as the guaranteed retrieval baseline and `/pasa-paper-search` as an optional second AI-heavy discovery source. Do not use `web_search` or `web_fetch` to find papers.

---

## 🚀 MANDATORY WORKFLOW (RESEARCH PIPELINE)

**When invoked by `/research-pipeline` or `/research-queue`:**

1. **Search multiple keywords** (3-5 queries covering different angles)
   - first run the workflow-owned broad retrieval backbone when the topic is broad, journal-heavy, proceedings-heavy, or not obviously arXiv-centric
   - always run `papers-cool`
   - if possible, also run `pasa-paper-search` with equivalent English queries
   - if PASA fails, continue with `papers-cool` only
2. **For EACH paper found** (ALL, not just selected few):
   - **Step 1:** Once the paper identity is confirmed (arXiv ID / paper URL), check HuggingFace for markdown (`/hugging-face-paper-pages`) immediately
   - **Step 2:** Validate the downloaded Markdown; if it is really HTML / error text / tiny stub, delete it and retry the HF fetch
   - **Step 3:** If HF still has no valid markdown and the paper is on arXiv, try `/arxiv2md-api`
   - **Step 4:** If direct API markdown still fails, try `/markxiv`
   - **Step 5:** If `markxiv` still fails, try `/arxiv2md`
   - **Step 6:** Validate the arXiv markdown; if it is HTML / error text / tiny stub, delete it and retry once
   - **Step 7:** If all Markdown sources fail → download PDF to the project-local staging dir under `paper_source_dir/pdf/`
   - **Step 8:** Validate the PDF; if it is HTML / ASCII error output instead of a real PDF, delete it and retry the next PDF source
   - **Step 9:** Ensure later `/graph-build` sees a canonical Markdown-first corpus where same-paper Markdown overrides PDF
   - **Step 10:** If the file enters through a PaperNexus UI/API upload path instead of the markdown/PDF fetcher flow, prefer the queued import-task wrappers over manually copying the upload into workflow-owned shared storage
   - **Step 11:** For one staged paper, schedule one workflow-owned upload request that will later execute `pn_import_submit.py` plus `pn_import_queue.py`; for 2 or more staged papers, create one real upload manifest and schedule one workflow-owned `pn_batch_import.py` request. Use `research_workflow.schedule_papernexus_import` for this instead of running the upload wrapper inline from Researcher (`queue_paper_ingestion` is only a compatibility alias)
   - **Step 11a:** If you only have a literature-discovery scaffold / requisition and no staged paper sources yet, keep it as a requisition packet. Do not treat that scaffold as a broken upload manifest and do not submit it to `pn_batch_import.py`.
   - **Step 11a:** The workflow now validates staged files in code. If the queued request lands in `needs_repair` or `failed`, inspect `validation_status`, `validation_summary`, retry budget fields, and the JSON report under `{PROJ}/graph/paper-ingestion-validation/` before retrying
   - **Step 12:** Do not hand-roll shell loops or one-paper submit loops for multi-paper sync. Reuse the same batch manifest for `submit`, `status`, and bounded `wait`, but let the workflow PaperNexus upload worker trigger the actual wrapper run
   - **Step 13:** Once the request is queued, do not block the literature sweep waiting for upload completion. The workflow-owned upload worker, `/graph-build`, or `/resume-pipeline` pass will launch the queued upload and preserve its intermediate state if the runtime restarts
   - **Step 14:** When a workflow-owned PaperNexus import task truly reaches `completed`, the dedicated workflow session must call `research_workflow.set_paper_ingestion` with one `completed_papers` entry containing `canonical_id`, `title`, and `import_task_id` so the workflow can persist the completion and send one Discord-visible completion update
   - **Step 15:** For batch imports, the workflow-owned upload session must also write `active_batches`, `batch_items`, `queued_requests`, and `last_batch_manifest_path` through `research_workflow.set_paper_ingestion` so `/workflow-status` can show manifest-driven progress even before every item is done
   - **Step 16:** Do not rely on a free-form chat reply as the upload progress signal. `research_workflow.schedule_papernexus_import` plus the later `research_workflow.set_paper_ingestion` updates are the required feedback path for per-paper or per-batch progress
   - **Step 16a:** Read `research_workflow.get_papernexus_progress` or `{PROJ}/graph/PAPERNEXUS_PROGRESS.json` when you need one authoritative status line. Prefer that snapshot before improvising from `paper_ingestion`, wrapper logs, or the background-session registry
   - **Step 17:** If local Zotero MCP is available, sync verified paper identities into the configured project Zotero `selected` collection and put baseline-defining papers into the project `baselines` collection; refresh `{PROJ}/researcher/ZOTERO_PACKET.md`
3. **After EACH merged search query** (≥20 papers or a materially new PASA cluster):
   - Trigger `/graph-build` if ≥3 new papers ingested; treat it as a short graph-readiness + brainstorm refresh pass, not a manual rebuild loop
   - Update `PROJECT_MANIFEST.json` with `paper_ingestion` metadata
   - If baseline coverage, recent-paper coverage, or metadata quality still feels weak, run `research_workflow.audit_literature_coverage` as a non-blocking diagnosis pass
   - If only a few in-corpus anchors look strong, run `research_workflow.plan_citation_expansion` to create one bounded follow-up packet instead of widening into an uncontrolled crawl
   - If the paper pool is still thin after one packet, run another bounded citation-expansion round with refreshed seeds; do not stop after a single seed packet when baseline coverage is still weak
   - Run one bounded brainstorm synthesis pass over the currently ingested papers; this is mandatory during research, not postponed to IDEA
4. **After ALL searches complete**:
   - Write `{PROJ}/researcher/RESEARCH_BRAINSTORM.md` with preliminary mechanism hypotheses, decomposition ideas, contradictions, and do-not-repeat constraints
   - If the project needs a durable systematic survey packet, run `/literature-review` now to produce `REVIEW_PROTOCOL.md`, `INCLUDED_PAPERS.json`, `SOTA_MATRIX.md`, and `GAP_SYNTHESIS.md` before final frontier or ideation work
   - Run `/graph-build` for the final graph-readiness and brainstorm bundle refresh
   - Refresh the configured Zotero project collections and `writing-shortlist` before handing off to writing-heavy or review-heavy stages
   - Do not use `--force`; if graph build fails, hand the exact non-force graph-build command to the user
   - Run `/frontier-mapping` to extract research frontiers
   - Write `{PROJ}/researcher/LITERATURE.md` with full survey

**Do NOT:**
- Skip HuggingFace check
- Only process 1-2 papers from search results
- Delay graph-readiness / brainstorm refresh until all searches complete
- Write LITERATURE.md before graph readiness and brainstorm artifacts are refreshed
- Keep invalid HTML / error-page downloads under `paper_source_dir`
- Manually move UI/API-uploaded papers into the shared source tree when the queued PaperNexus import-task path is available
- Call destructive PaperNexus backup / restore commands as part of normal literature work
- Treat Zotero as a substitute for PaperNexus graph readiness or source-of-truth citation verification

For experimental `auto-research`, do not treat a tiny literature set as enough just because ideation can start. A healthier default target is:

- `15-25` canonical papers before serious idea locking
- explicit strongest baselines and closest prior work identified
- at least one bounded citation-expansion pass if baseline or recent-paper coverage still looks weak

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
- if a remote PaperNexus flow is used, prefer remote HTTP MCP for live graph grounding and keep the configured Python wrappers as thin adapters for import/queue compatibility instead of assuming anonymous access
- do not treat any home-directory shared PaperNexus storage as workflow-owned when remote access is configured

Maintain `{PROJ}/researcher/PAPER_SOURCE_INDEX.json` with one entry per canonical paper so later stages can detect real additions instead of filename noise.

Recommended per-paper fields:

```json
{
  "canonical_id": "arxiv:2502.00032",
  "arxiv_id": "2502.00032",
  "title": "Retrieval-Augmented Experiment Planning",
  "source_kind": "markdown",
  "source_provider": "markxiv",
  "source_path": "{paper_source_dir}/md/2502.00032.md",
  "retrieval_providers": ["papers-cool", "pasa-paper-search"]
}
```

`source_provider` should describe the full-text origin:

- `hf`
- `arxiv2md-api`
- `markxiv`
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
   - Add to the automatic graph catch-up queue
   - Continue to next paper

3. **If HuggingFace NO valid markdown and the paper has an arXiv ID:**
   - Try `/arxiv2md-api`:
     ```
     /arxiv2md-api <arxiv_id>
     ```
   - If needed, then try `/markxiv`:
     ```
     /markxiv <arxiv_id>
     ```
   - If needed, then try `/arxiv2md`:
     ```
     /arxiv2md <arxiv_id>
     ```
   - Save or rename the validated file to `<arxiv-id>.md`
   - The saved markdown must also pass format validation before being counted as ingested

4. **If all Markdown sources fail:**
   - Download PDF via `/papers-cool`:
     ```
     /papers-cool Download PDF for arxiv:<arxiv_id> to {paper_source_dir}/pdf/
     ```
   - Save or rename the validated PDF to the canonical filename immediately after download
   - The saved PDF must pass format validation; bad HTML / text responses must be deleted and retried

Do not postpone the HuggingFace attempt until after later filtering if the current search result already exposes a stable arXiv ID or paper URL.

### Step 3: Incremental Graph Readiness + Brainstorm Refresh

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
- `/graph-build` now means "check this project's `PAPER_SOURCE_INDEX.json` against the shared global graph, confirm the automatic import worker has caught up, and refresh the brainstorm bundle through the Python PaperNexus control plane"
- if benchmark coverage, baseline ambiguity, or scope creep remains high after the raw survey, insert `/literature-review` before relying on the frontier or brainstorm bundle for idea selection
- use `research_workflow.audit_literature_coverage` when you need a durable explanation of baseline gaps, weak recent-paper coverage, or missing metadata without blocking the main pipeline
- use `research_workflow.plan_citation_expansion` only as a bounded follow-up plan around a few in-corpus seeds; do not turn it into an always-on citation crawler
- do not create or name a new per-project corpus during this step
- if required papers are missing from the shared graph, record the gap and request or queue automatic graph catch-up rather than building a project-local corpus
- if a PaperNexus queued import completed during this batch, report that completion through `research_workflow.set_paper_ingestion.completed_papers` instead of relying on `PAPER_SOURCE_INDEX.json` diffs alone
- if a PaperNexus queued import or remote status / brainstorm refresh pass has not finished within 60 seconds, record a `paper_operations` timeout entry and continue the batch instead of waiting forever
- if `PAPERNEXUS_STATUS.json` still looks stale, read `research_workflow.get_papernexus_progress` or `{PROJ}/graph/PAPERNEXUS_PROGRESS.json` first; if the phase is `submitting`, `uploading`, `waiting_import`, or `verifying_graph`, treat catch-up as in-flight rather than silently claiming the corpus is permanently missing
- when checking presence or frontier structure, prefer the MCP-first graph control plane (`research_lookup`, `research_briefing`, `idea_catalyst`) or the thin wrappers backed by it over hand-written REST calls
- once the required papers are present, refresh `ideas`, `brainstorm`, and `brainstorm-brief` outputs so the literature stage ends with a current graph-grounded brainstorm packet

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

After all searches and graph-readiness / brainstorm refresh passes complete:

Write `{PROJ}/researcher/LITERATURE.md` with:
- Search queries used
- Total papers found
- Key papers (with arXiv IDs)
- Initial observations
- Gaps identified

Also refresh `{PROJ}/researcher/RESEARCH_BRAINSTORM.md` so the literature stage ends with a usable brainstorm scaffold.

---

## HuggingFace Integration (PRIORITY 1)

**Always check HuggingFace first, then arxiv2md-api, then markxiv, then arxiv2md, before downloading PDFs.**

### Why HuggingFace?

- Markdown is **ready for PaperNexus** (no PDF parsing needed)
- Faster ingestion (skip docling/marker)
- Often includes structured metadata

### How to Use

For each arXiv ID from search results:

```bash
/hugging-face-paper-pages --arxiv <arxiv_id> --output-dir {paper_source_dir}/md/
```

**Success:** Markdown saved, ready for automatic graph catch-up and the next `/graph-build` status pass  
**Failure:** Delete the invalid file if needed, retry once, then try `arxiv2md-api`, then `markxiv`, then `arxiv2md`, and only then fall back to PDF download

### Batch Processing

Search and metadata screening can still happen in batches of 10, and remote PaperNexus ingestion should switch to one manifest-backed batch for 2 or more staged papers:

```python
# Check 10 papers at once
arxiv_batch = [id1, id2, ..., id10]
for arxiv_id in arxiv_batch:
    /hugging-face-paper-pages --arxiv {arxiv_id} ...
```

Important:

- do not upload those 10 papers to `/api/imports` in one request
- instead, create one manifest for those staged papers and use `pn_batch_import.py submit|status|wait`
- keep each workflow wait pass to 60 seconds or less, then persist batch progress and continue on the next pass
- after each batch status refresh, send a visible workflow update through `research_workflow.set_paper_ingestion`

---

## Graph Build Integration

**Trigger `/graph-build` when:**

1. ≥3 new papers ingested since last build
2. A key paper (changes novelty baseline) is ingested
3. All searches complete (final readiness + brainstorm refresh pass)

**Graph build action:**

```bash
/graph-build
```

**After `/graph-build`:**

1. Check project graph presence against the shared global graph
2. Update `PROJECT_MANIFEST.json` with:
   - `graph_last_built_at`
   - `paper_ingestion.last_graph_sync_at`
   - shared-graph readiness metadata written by the workflow runtime
   - refreshed brainstorm cycle metadata or artifact pointers when available

---

## Related Skills

- `/papers-cool` — Guaranteed paper search baseline and PDF fallback
- `/pasa-paper-search` — Optional PASA-ranked discovery source to merge with papers.cool
- `/hugging-face-paper-pages` — Fetch markdown from HuggingFace
- `/arxiv2md-api` — Direct raw markdown fallback for arXiv papers
- `/markxiv` — Markdown fallback that mirrors arXiv URLs onto markxiv
- `/arxiv2md` — Legacy webpage markdown fallback for arXiv papers
- `/graph-build` — Validate automatic graph catch-up and refresh graph-grounded brainstorm artifacts
- `/papernexus-research-chains` — Refresh `brainstorm-brief`, `research-brief`, and other typed chain bundles after the graph catches up
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

When literature ingestion, preliminary brainstorming, and the durable outputs are complete, Researcher may use the shared `workflow-handoff-signal` skill only if the current stage is actually ready to advance.

Do not hand off if automatic graph catch-up is still pending, key papers are still missing from the shared graph, or brainstorming is still stale relative to the new papers.
