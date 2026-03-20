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
2. `paper_source_dir` recorded in `{PROJ}/PROJECT_MANIFEST.json`
3. `/Users/iranb/.papernexus/papers/{proj-id}`
4. `{PROJ}/papers/`
5. `{PROJ}/literature/`
6. `{PROJ}/researcher/lit_papers/`
7. bootstrap fallback: create `{PROJ}/graph/bootstrap/` and place project markdown literature notes there (for example `LITERATURE.md`)

Preferred source types:
- PDF papers
- Markdown paper notes
- local converted paper markdown

## Build / Refresh the Corpus

Use a project-stable corpus name:

```bash
node <PAPERNEXUS_ROOT>/src/cli/index.js analyze <source_dir> --name <proj-id>
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
- Corpus name: [proj-id]
- Build status: ready / failed
- Notes: [coverage quality, missing PDFs, bootstrap fallback, etc.]
```

Update `{PROJ}/PROJECT_MANIFEST.json` with:
- `papernexus_root`
- `papernexus_corpus`
- `paper_source_dir`
- `graph_source_dir`
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
