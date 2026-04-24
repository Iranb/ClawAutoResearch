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

If the local Zotero MCP server is configured, this same pass must also synchronize the verified project bibliography into the configured Zotero project tree and refresh `{PROJ}/researcher/ZOTERO_PACKET.md`. The plugin-global Zotero root defaults to `bot`, so the default project path is `<zoteroProjectRoot>/<project-id>` unless the project overrides it explicitly. If Zotero writes require authentication, rely on the Zotero MCP server's own `ZOTERO_API_KEY` / `ZOTERO_USER_ID` environment rather than plugin config. `/graph-build` is the point where graph readiness, brainstorm grounding, and bibliography organization should converge before frontier mapping.

Workflow soft-sync rule:

- the workflow coordinator may also queue a separate non-blocking Zotero background sync after a fresh graph update
- do not wait for that background Zotero pass before reporting graph readiness
- if this graph-build continuation already refreshed Zotero successfully, keep `{PROJ}/researcher/ZOTERO_SYNC_PACKET.json` / `{PROJ}/researcher/ZOTERO_PACKET.md` truthful so the coordinator does not immediately requeue duplicate work

> **File ownership**: Write ONLY to `{PROJ}/graph/` and `{PROJ}/PROJECT_MANIFEST.json`.
> `{PROJ}` = `{PROJECTS_ROOT}/{proj-id}`

## Workflow-Owned Micro-Stages

`graph_build` is a fixed three-step workflow phase:

1. `graph_build/uploading`
   - workflow-owned queued upload requests are still `queued`, `launching`, or `running`
   - remote import / graph catch-up may still be in flight
2. `graph_build/verifying`
   - upload work is idle
   - the workflow is checking whether required canonical papers are actually present in the shared graph
3. `graph_build/brainstorm_refresh`
   - graph presence is already `ready`
   - the workflow is refreshing the **core brainstorm provider contract** that downstream frontier/idea work consumes

Do not invent extra graph-build micro-stages in durable state. If graph presence is ready but the brainstorm contract is still stale, keep the project in `graph_build/brainstorm_refresh` instead of advancing.

## Core Brainstorm Provider Contract

The workflow treats brainstorm refresh as a replaceable provider, not a hard-coded single skill. The default core provider is `workflow_core_brainstorm`, but future providers may change as long as they still persist the same durable contract through `research_workflow.run_brainstorm_cycle`.

The provider contract must keep these fields current in `PROJECT_MANIFEST.json.brainstorm_cycle`:

- `provider`
- `provider_mode`
- `provider_status`
- `contract_version`
- the durable chain bundle artifacts:
  - `topic_summary_path`
  - `research_brief_path`
  - `brainstorm_brief_path`
  - `logic_chain_path`
  - `evidence_chain_path`
  - `reasoning_trace_path`
  - `question_packet_path`
  - `working_memory_path`
  - `synthesis_packet_path`

You may swap which brainstorm skill or wrapper creates the bundle later, but you must not change the contract that `graph_build` validates.

## Remote Access Requirement

Workflow-owned graph work must use the configured remote PaperNexus HTTP MCP control plane for live graph access. Do not resolve or use local PaperNexus runtime roots, shared-disk graph storage, or hand-written REST calls for graph readiness checks or brainstorm refresh when remote access is configured.

Read the remote access settings from the plugin-level workflow config:

- `plugins.entries.openclaw-research.config.papernexusApiBaseUrl`
- `plugins.entries.openclaw-research.config.papernexusApiTokenEnv`
- `plugins.entries.openclaw-research.config.papernexusApiTokenSource`
- `plugins.entries.openclaw-research.config.papernexusApiTokenService`
- `plugins.entries.openclaw-research.config.papernexusApiTokenAccount`
- optional `plugins.entries.openclaw-research.config.papernexusMineruHttpUrl`

Rules:

- when using remote PaperNexus, let the MCP-first tool families or their thin wrappers resolve auth from the configured token source
- for workflow-owned background graph work, schedule upload wrappers through `research_workflow.schedule_papernexus_import`; use remote HTTP MCP (`research_lookup`, `research_briefing`, `idea_catalyst`, `refresh_paper_graph`) for the live graph / brainstorm work that `/graph-build` still needs after upload
- `auto` means: env first, then native OS keychain
- native keychain means:
  - macOS Keychain on `darwin`
  - Secret Service / `secret-tool` on `linux`
  - PasswordVault on `win32`
- never paste the raw token into chat, prompts, or project files
- if PDF materialization is needed and `papernexusMineruHttpUrl` is configured, prefer remote MinerU before local Docling or Marker fallbacks
- do not fall back to local `papernexus` CLI graph-processing commands for workflow-owned graph readiness or brainstorm refresh
- prefer remote HTTP MCP for graph reads and brainstorm refresh, and keep `python3 skills/papernexus/scripts/pn_import_submit.py`, `python3 skills/papernexus/scripts/pn_import_queue.py`, `python3 skills/papernexus/scripts/pn_batch_import.py`, `python3 skills/papernexus/scripts/pn_graph_query.py`, `python3 skills/papernexus/scripts/pn_research_chains.py`, and `python3 skills/papernexus-paper-refresh/scripts/pn_paper_refresh.py` as queued import or thin-MCP adapter paths instead of hand-written REST
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
- the authoritative graph lives behind the configured remote PaperNexus service, with remote HTTP MCP as the default live-graph interface
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
- trigger any durable queued upload request first; `/graph-build` is allowed to launch queued `schedule_papernexus_import` / legacy `queue_paper_ingestion` work before it starts the readiness pass
- treat discovery requisitions and upload manifests as different contracts; a requisition scaffold with no staged paper sources is not an upload failure and must not be launched as `pn_batch_import.py`
- if a queued upload request is stuck in `needs_repair` or `failed`, inspect `validation_status`, `validation_summary`, retry budget fields, and any dead-letter reason before blaming graph readiness itself
- check whether the canonical papers recorded in `{PROJ}/researcher/PAPER_SOURCE_INDEX.json` are already present in the shared global graph
- if `PAPER_SOURCE_INDEX.json` already records explicit graph-backed confirmation such as `graph_paper_id`, `graph_presence=confirmed_*`, `import_status=deduped|completed|indexed|graph_synced`, or a fresh `graph_presence_override.status=ready`, trust that durable evidence and skip duplicate import/re-index work
- update project-local readiness metadata
- record whether automatic shared-graph catch-up is still required
- avoid rebuilding a project-specific corpus
- treat remote graph advancement as queued import-worker progress, not a second manual rebuild step
- if uploads are still missing, create or repair one queued upload request and let the workflow-owned continuation run the actual wrappers; do not turn Researcher into the direct uploader
- after each completed paper import or each batch status pass, run a short status pass and report progress before the next workflow tick
- once the required papers are present, move the workflow to `graph_build/brainstorm_refresh`, run one bounded core-provider refresh using `research_lookup` / `research_briefing` (or their thin wrappers `pn_graph_query.py` and `pn_research_chains.py`) or a future compatible provider, and persist the resulting durable bundle through `research_workflow.run_brainstorm_cycle`
- if the local Zotero MCP server is available, sync the verified canonical set into the configured project `selected` collection, put baseline-defining papers into the project `baselines` collection, keep `writing-shortlist` untouched unless the project is already entering writing-heavy work, and refresh `{PROJ}/researcher/ZOTERO_PACKET.md`

Hard rule:

- do **not** use `--force` during literature research graph builds
- do **not** use `--rebuild-pdf-markdown` during workflow-owned graph refreshes
- if automatic graph catch-up is still pending and the automated path fails, report the exact non-force command to the user and let the user run it manually instead of escalating to a forced rebuild
- do **not** wait indefinitely for one remote paper import, one batch wait, or one status/brainstorm refresh attempt; cap each workflow wait pass at 60 seconds, record durable progress, and continue on the next pass
- for 2 or more staged papers, prefer one `pn_batch_import.py` manifest over repeated one-paper submit loops; the workflow needs manifest-level progress plus per-item visibility
- Researcher should stage papers and queue the upload request; the workflow PaperNexus upload worker, `/graph-build`, or `/resume-pipeline` is the workflow-owned place that actually launches the queued request and preserves `queued_requests` state across restarts
- if a queued request has `dead_letter_at`, treat it as a hard stop for this pass and surface the repair reason instead of silently requeueing forever
- when remote PaperNexus status looks stale, read `research_workflow.get_papernexus_progress` or `{PROJ}/graph/PAPERNEXUS_PROGRESS.json` before declaring a hard missing-corpus failure; phases `submitting`, `uploading`, `waiting_import`, or `verifying_graph` mean the wrapper-driven catch-up is still in flight
- every per-paper terminal state, every batch summary/item refresh, and every brainstorm bundle refresh must be reflected through `research_workflow.set_paper_ingestion` or `research_workflow.run_brainstorm_cycle`, because that is what feeds `/workflow-status` and the Discord-visible completion/progress updates
- stale active background sessions are bookkeeping, not proof of live work; trust `queued_requests` plus `PAPERNEXUS_PROGRESS.json` first, batch/item counters second, and the background-session registry last
- if the local Zotero MCP server is unavailable, record that explicitly in `{PROJ}/researcher/ZOTERO_PACKET.md` instead of silently skipping bibliography sync

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
- if graph readiness is already satisfied, spend the remaining `/graph-build` budget on refreshing the brainstorm bundle and the configured Zotero project collections rather than re-running a fake manual reconciliation loop

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
- refreshed `brainstorm_cycle.provider*`, `contract_version`, artifact pointers, and `latest_run_at` when this pass updates the brainstorm bundle
- `graph_watch.enabled`
- `current_stage: "graph_build"`
- `current_micro_stage: "uploading" | "verifying" | "brainstorm_refresh"` while the stage is still active
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
