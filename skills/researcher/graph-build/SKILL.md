---
name: graph-build
description: "Build or refresh a project-local PaperNexus corpus before idea selection. Use on every new project and whenever the local literature set changes materially."
argument-hint: "[topic or optional source dir]"
allowed-tools:
  - Bash(*)
  - Read
  - Write
  - Edit
  - Grep
  - Glob
---

# Graph Build

Build a project-local literature graph with PaperNexus so later idea generation can traverse explicit problems, methods, claims, limitations, and evidence instead of relying only on flat summaries.

> **File ownership**: Write ONLY to `{PROJ}/graph/` and `{PROJ}/PROJECT_MANIFEST.json`.
> `{PROJ}` = `{PROJECTS_ROOT}/{proj-id}`

## Resolve PaperNexus Root

Use this order:

1. `$PAPERNEXUS_ROOT` if set and contains `src/cli/index.js`
2. Sibling repo `../PaperNexus` relative to the current `openclaw-research` checkout
3. Sibling repo `{PROJECTS_ROOT}/../PaperNexus`

If none exists, stop and report that PaperNexus is unavailable. Do not silently skip this stage for a new project.

## Choose Source Corpus

Pick the richest available source directory in this order:

1. explicit argument path if provided
2. `graph_source_dir` recorded in `{PROJ}/PROJECT_MANIFEST.json`
3. `paper_source_dir` recorded in `{PROJ}/PROJECT_MANIFEST.json`
4. `/Users/iranb/.papernexus/papers/{proj-id}` as the local default PaperNexus source tree
5. `{PROJ}/papers/`
6. `{PROJ}/literature/`
7. `{PROJ}/researcher/lit_papers/`
8. bootstrap fallback: create `{PROJ}/graph/bootstrap/` and place project markdown literature notes there (for example `LITERATURE.md`)

Default policy:
- if the manifest does not yet pin `graph_source_dir`, treat `/Users/iranb/.papernexus/papers/{proj-id}` as the default source corpus
- `graph_source_dir` should record the actual source tree used to build the current corpus
- the authoritative graph files still live in PaperNexus storage, typically under `~/.papernexus/index-store/.papernexus/`, not inside the paper source tree

Preferred source types:
- full-paper Markdown
- local converted paper markdown
- PDF papers only when Markdown is unavailable for the same canonical paper

## Canonical Corpus Assembly (mandatory)

Do not point PaperNexus directly at a mixed raw directory when both Markdown and PDF copies exist for the same paper.

Before each build, assemble a canonical source tree under:

```text
{PROJ}/graph/source-corpus/
```

Rules:
- use `{PROJ}/researcher/PAPER_SOURCE_INDEX.json` if it exists to resolve canonical identity
- otherwise deduplicate by canonical paper identity in this order: arXiv ID, DOI, normalized title
- if both `md/<paper>.md` and `pdf/<paper>.pdf` exist for the same canonical paper, include only the Markdown file in the canonical source tree
- include a PDF only when no Markdown exists for that canonical paper
- if a new Markdown arrives for a paper that previously only had a PDF, replace the PDF entry in the canonical source tree on the next build
- treat `{paper_source_dir}/md/` as the highest-priority ingestion source
- do not let duplicate PDF and Markdown files for the same paper both enter the analyzed corpus
- do not ingest invalid artifacts such as HTML pages saved as `.md` / `.pdf`, or text-like non-PDF error files

Suggested layout:

```text
{PROJ}/graph/source-corpus/
  md/
    <canonical-paper>.md
  pdf/
    <canonical-paper>.pdf
```

The analyzed source dir should be this canonical staged corpus, not the raw mixed download tree.

## Build / Refresh the Corpus

Use a project-stable corpus name:

```bash
node <PAPERNEXUS_ROOT>/src/cli/index.js analyze {PROJ}/graph/source-corpus --name <proj-id>
node <PAPERNEXUS_ROOT>/src/cli/index.js status --corpus <proj-id>
```

If the source corpus changed materially since the last build, rerun with `--force`.

Use these refresh triggers:
- 1 newly ingested paper that changes the novelty baseline or closest prior work
- 3 or more genuinely new canonical papers since the last graph sync
- 2 or more new recent venue papers that materially overlap with the active track

If the source tree changes frequently, prefer:

```bash
node <PAPERNEXUS_ROOT>/src/cli/index.js watch <source_dir> --name <proj-id>
```

## Output Files

Write `{PROJ}/graph/PAPERNEXUS_STATUS.json`:

```json
{
  "project_id": "proj_xxx",
  "corpus_name": "proj_xxx",
  "papernexus_root": "/abs/path/to/PaperNexus",
  "source_dir": "/abs/path/to/source",
  "built_at": "YYYY-MM-DDTHH:MM:SSZ",
  "status": "ready"
}
```

Write `{PROJ}/graph/GRAPH_BUILD_REPORT.md`:

```markdown
# Graph Build Report

- Project: [proj-id]
- PaperNexus root: [path]
- Source dir: [path]
- Raw paper source dir: [path]
- Corpus name: [proj-id]
- Build status: ready / failed
- Notes: [coverage quality, Markdown-vs-PDF counts, missing Markdown fallbacks, bootstrap fallback, etc.]
```

Update `{PROJ}/PROJECT_MANIFEST.json` with:
- `papernexus_root`
- `papernexus_corpus`
- `paper_source_dir`
- `graph_source_dir` pointing to `{PROJ}/graph/source-corpus/` when the canonical staged corpus is used
- `graph_last_built_at`
- `paper_ingestion.last_graph_sync_at`
- `paper_ingestion.new_files_since_graph: 0`
- `paper_ingestion.changed_files_since_graph: 0`
- `paper_ingestion.refresh_required: false`
- `paper_ingestion.refresh_reason: null`
- `graph_watch.enabled`
- `current_stage: "graph_build"`
- `current_micro_stage: "graph_validated"`
- `updated_at`
- `gates.quality: "pending"` until frontier mapping and track selection complete

## Hard Stop Conditions

Do not advance to frontier mapping if:
- PaperNexus root cannot be resolved
- the source directory is empty
- the built corpus has effectively no useful content (for example 0 paper nodes or only a trivial bootstrap note)
- the canonical source tree still contains duplicate Markdown and PDF entries for the same canonical paper
- the source tree still contains obviously invalid HTML / error-page artifacts that were not cleaned up
