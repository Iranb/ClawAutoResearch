---
name: graph-build
description: "Validate a project's automatic PaperNexus graph catch-up and refresh brainstorm artifacts before idea selection. Use on every new project and whenever the shared literature selection changes materially."
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

Validate that the current project's selected literature is already reflected in the shared global PaperNexus graph, then refresh the brainstorm package that later idea generation depends on. Queued import workers should do the real graph mutation automatically; this skill is the bounded readiness and brainstorm-refresh pass that keeps workflow state honest.

> **File ownership**: Write ONLY to `{PROJ}/graph/` and `{PROJ}/PROJECT_MANIFEST.json`.
> `{PROJ}` = `{PROJECTS_ROOT}/{proj-id}`

## Remote Access Requirement

Workflow-owned graph work must use the configured remote PaperNexus control plane exposed through the Python wrappers in `scripts/`. Do not resolve or use local PaperNexus runtime roots, shared-disk graph storage, or hand-written REST calls for graph readiness checks or brainstorm refresh when remote access is configured.

Read the remote access settings from the plugin-level workflow config:

- `plugins.entries.openclaw-research.config.papernexusApiBaseUrl`
- `plugins.entries.openclaw-research.config.papernexusApiTokenEnv`
- `plugins.entries.openclaw-research.config.papernexusApiTokenSource`
- `plugins.entries.openclaw-research.config.papernexusApiTokenService`
- `plugins.entries.openclaw-research.config.papernexusApiTokenAccount`
- optional `plugins.entries.openclaw-research.config.papernexusMineruHttpUrl`

Rules:

- when using remote PaperNexus, let the Python wrappers resolve auth from the configured token source
- for workflow-owned background graph work, prefer `research_workflow.run_papernexus_wrapper` to launch the wrappers in a durable dedicated subagent session
- `auto` means: env first, then native OS keychain
- native keychain means:
  - macOS Keychain on `darwin`
  - Secret Service / `secret-tool` on `linux`
  - PasswordVault on `win32`
- never paste the raw token into chat, prompts, or project files
- if PDF materialization is needed and `papernexusMineruHttpUrl` is configured, prefer remote MinerU before local Docling or Marker fallbacks
- do not fall back to local `papernexus` CLI graph-processing commands for workflow-owned graph readiness or brainstorm refresh
- prefer `python3 scripts/pn_stage_sync.py`, `python3 scripts/pn_import_submit.py`, `python3 scripts/pn_import_queue.py`, `python3 scripts/pn_batch_import.py`, `python3 scripts/pn_graph_query.py`, and `python3 scripts/pn_research_chains.py` over hand-written REST for remote graph reads and imports
- if the wrapper-resolved remote PaperNexus session is unavailable or unauthenticated, stop and report that remote access must be fixed before graph work can continue

## Choose Paper Selection Input

Pick the richest available project paper-selection input in this order:

1. explicit argument path if provided
2. `{PROJ}/researcher/PAPER_SOURCE_INDEX.json`
3. `{PROJ}/researcher/LITERATURE.md`
4. `{PROJ}/researcher/lit_search_*.json`
5. bootstrap fallback: use project literature notes directly until a proper `PAPER_SOURCE_INDEX.json` is available

Default policy:
- keep `papernexus_corpus`, `paper_source_dir`, and `graph_source_dir` unset unless the project explicitly overrides the shared-global defaults
- the authoritative graph lives behind the configured remote PaperNexus Web/API
- this skill should not create or name a per-project corpus
- the project should only record which canonical papers are in scope and whether those papers are present in the shared graph

Preferred source types:
- `PAPER_SOURCE_INDEX.json` with canonical identities
- full-paper Markdown / PDF already saved into project-local staging under `{PROJ}/researcher/paper-staging/`
- literature outputs that explain why the current paper set is in scope

## Shared Global Graph Rule (mandatory)

Do not create a second project-local graph corpus such as `{PROJ}/graph/source-corpus/`.
Do not run `papernexus analyze <source_dir> --name <proj-id>` as part of normal workflow-owned graph refreshes.

Use project-local staging plus the shared global graph exposed through the configured remote API:

```text
{PROJ}/researcher/paper-staging/
  md/
    <canonical-paper>.md
  pdf/
    <canonical-paper>.pdf
```

Rules:
- use `{PROJ}/researcher/PAPER_SOURCE_INDEX.json` if it exists to resolve canonical identity
- otherwise deduplicate by canonical paper identity in this order: arXiv ID, DOI, normalized title
- if both `md/<paper>.md` and `pdf/<paper>.pdf` exist for the same canonical paper, treat the Markdown file as authoritative
- include a PDF only when no Markdown exists for that canonical paper
- if a new Markdown arrives for a paper that previously only had a PDF, the shared graph should reconcile against the Markdown and keep the PDF only as fallback
- do not create a second analyzed source tree just to deduplicate files
- do not ingest invalid artifacts such as HTML pages saved as `.md` / `.pdf`, or text-like non-PDF error files
- this skill is about readiness reporting and brainstorm refresh, not corpus creation

Here `<canonical-paper>` should match the normalized download stem:

- arXiv ID if present, for example `2502.00032`
- otherwise a transliterated title slug such as `graph-retrieval-benchmarks`

These staged files are temporary workflow inputs for remote PaperNexus imports. They are not a shared local PaperNexus corpus and must not be read from home-directory shared PaperNexus storage.

## Validate Automatic Graph Catch-Up And Refresh Brainstorm Artifacts

Normal workflow-owned action:

```bash
/graph-build
```

This should:
- check whether the canonical papers recorded in `{PROJ}/researcher/PAPER_SOURCE_INDEX.json` are already present in the shared global graph
- update project-local readiness metadata
- record whether automatic shared-graph catch-up is still required
- avoid rebuilding a project-specific corpus
- treat remote graph advancement as queued import-worker progress, not a second manual rebuild step
- after each completed paper import or each batch status pass, run a short status pass and report progress before the next workflow tick
- once the required papers are present, run one bounded brainstorm refresh using the typed wrappers (`pn_graph_query.py ideas|brainstorm` and `pn_research_chains.py brainstorm-brief|research-brief`) and persist the resulting durable bundle through `research_workflow.run_brainstorm_cycle`

Hard rule:

- do **not** use `--force` during literature research graph builds
- do **not** use `--rebuild-pdf-markdown` during workflow-owned graph refreshes
- if automatic graph catch-up is still pending and the automated path fails, report the exact non-force command to the user and let the user run it manually instead of escalating to a forced rebuild
- do **not** wait indefinitely for one remote paper import, one batch wait, or one status/brainstorm refresh attempt; cap each workflow wait pass at 60 seconds, record durable progress, and continue on the next pass
- for 2 or more staged papers, prefer one `pn_batch_import.py` manifest over repeated one-paper submit loops; the workflow needs manifest-level progress plus per-item visibility
- when remote PaperNexus status looks stale, cross-check `PROJECT_MANIFEST.json.paper_ingestion` before declaring a hard missing-corpus failure; `waiting_import`, `waiting_graph`, or `reconciling` means the wrapper-driven catch-up is still in flight
- every per-paper terminal state, every batch summary/item refresh, and every brainstorm bundle refresh must be reflected through `research_workflow.set_paper_ingestion` or `research_workflow.run_brainstorm_cycle`, because that is what feeds `/workflow-status` and the Discord-visible completion/progress updates

Use these refresh triggers:
- 1 newly ingested paper that changes the novelty baseline or closest prior work
- 3 or more genuinely new canonical papers since the last graph sync
- 2 or more new recent venue papers that materially overlap with the active track
- when running a multi-paper batch, refresh readiness after each completed paper and keep the final `/graph-build` pass short; it should summarize readiness and refresh the brainstorm bundle, not become an unbounded wait loop

If remote ingestion keeps falling behind, stop and report that the configured remote PaperNexus service or import worker needs attention. Do not fall back to local watch/analyze commands. Do not schedule a second explicit graph rebuild after a successful queued upload; the upload worker is already responsible for committing graph changes.

Feedback rule:
- if graph build delegated wrapper work into a background subagent, require progress to come back through `research_workflow.set_paper_ingestion` and the workflow status broadcast path
- do not wait for a free-form subagent reply before updating channel-visible status
- if graph readiness is already satisfied, spend the remaining `/graph-build` budget on refreshing the brainstorm bundle rather than re-running a fake manual reconciliation loop

## Output Files

Write `{PROJ}/graph/PAPERNEXUS_STATUS.json`:

```json
{
  "project_id": "proj_xxx",
  "corpus_name": "shared-global-graph",
  "remote_api_base_url": "https://papernexus.example/api",
  "corpus_root": "https://papernexus.example/api",
  "checked_at": "YYYY-MM-DDTHH:MM:SSZ",
  "status": "ready",
  "mode": "remote_api",
  "missing_papers": []
}
```

Write `{PROJ}/graph/GRAPH_BUILD_REPORT.md`:

```markdown
# Graph Build Report

- Project: [proj-id]
- PaperNexus access: [remote api base url]
- Shared corpus root: [path]
- Shared corpus name: [shared-global-graph or configured corpus]
- Build status: ready / missing_papers / refresh_required / failed
- Notes: [coverage quality, missing papers, Markdown-vs-PDF counts, missing Markdown fallbacks, manual command if refresh failed, etc.]
```

Update `{PROJ}/PROJECT_MANIFEST.json` with:
- leave `papernexus_corpus`, `paper_source_dir`, and `graph_source_dir` unset unless the project intentionally overrides the shared-global defaults
- `graph_last_built_at`
- `paper_ingestion.last_graph_sync_at`
- `paper_ingestion.new_files_since_graph: 0`
- `paper_ingestion.changed_files_since_graph: 0`
- `paper_ingestion.refresh_required: false`
- `paper_ingestion.refresh_reason: null`
- refreshed `brainstorm_cycle` artifact pointers or `latest_run_at` when this pass updates the brainstorm bundle
- `graph_watch.enabled`
- `current_stage: "graph_build"`
- `current_micro_stage: "graph_validated"`
- `updated_at`
- `gates.quality: "pending"` until frontier mapping and track selection complete

## Hard Stop Conditions

Do not advance to frontier mapping if:
- remote PaperNexus access cannot be resolved
- the project has no canonical papers recorded in `PAPER_SOURCE_INDEX.json`
- the shared graph is missing required canonical papers
- the shared graph has effectively no useful content for the project's selected papers
- the shared graph may contain the papers, but no fresh brainstorm bundle / typed brief package has been refreshed for the current topic after the latest ingestion changes
- the shared source tree still contains duplicate Markdown and PDF entries for the same canonical paper and the Markdown/PDF precedence is not clear
- the shared source tree still contains obviously invalid HTML / error-page artifacts that were not cleaned up
