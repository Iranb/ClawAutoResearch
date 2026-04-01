---
name: papernexus
description: Use this skill when working inside the PaperNexus repository to understand its API-first graph workflow, wrapper-first remote control plane, staging conventions, enhancement worker, and authenticated HTTP endpoints without depending on home-directory shared paper/index storage.
---

# PaperNexus

Use this skill when the task is about the PaperNexus codebase itself.

## What This Repo Is

PaperNexus is an API-first research knowledge graph system for papers.

Key capabilities:

- ingest PDF or Markdown sources
- use `docling` as the repo-default PDF-to-Markdown parser, while allowing deployments to override to remote `mineru` over HTTP or local `marker`
- build and incrementally update a multilayer research graph
- store the authoritative graph in Kuzu by default
- keep a lite JSON graph for fast read paths
- accept queued API imports with per-task logs and content-fingerprint dedupe
- run background theory/storyline enhancement workers
- run import and authoritative-sync background workers behind `serve`
- expose CLI, local web UI, and MCP server workflows

## Live Graph Access Policy

When touching a running user graph, use the authenticated HTTP API through the local Python wrappers in `scripts/` as the default control plane.

This applies to:

- uploading new PDF or Markdown sources into the graph
- checking import status
- reading corpus metadata or graph payloads
- reading enhancement overlays for a paper or corpus
- performing graph-backed query or reasoning requests

Do not use raw `curl`, repo-local CLI graph build/read commands, or hand-written REST calls against a live user graph.

## Default Script Entry Points

For live remote work, prefer these wrappers first:

- `python3 scripts/pn_stage_sync.py`
- `python3 scripts/pn_import_submit.py`
- `python3 scripts/pn_import_queue.py`
- `python3 scripts/pn_batch_import.py`
- `python3 scripts/pn_graph_query.py`
- `python3 scripts/pn_research_chains.py`

Why:

- they hide token handling and request shape details
- they reduce route-shape mistakes
- they make `rsync + --server-file-path + queue polling` the default import path
- they are easier for agents to call consistently than raw REST

Default live-graph wrapper coverage:

- `pn_stage_sync.py` stages local files onto the API server machine
- `pn_import_submit.py` submits one staged file at a time and returns the queued import task id
- `pn_import_queue.py list|status|log|wait` is the supported status/log surface for agents
- `pn_batch_import.py template|submit|status|wait` is the default manifest-driven path for 2 or more staged papers
- `pn_graph_query.py` handles typed graph reads such as `query`, `context`, `impact`, `ideas`, and `brainstorm`
- `pn_research_chains.py` handles `path-trace`, `evidence-chain`, `reflection-chain`, `research-brief`, `brainstorm-brief`, `theory-brief`, `storyline-brief`, and `paper-enhancement`

Wrapper auth rule:

- resolve API base URL, corpus, and token source from workflow/runtime config
- let the wrappers attach auth; do not hand-write `Authorization` headers or raw REST payloads unless the task is explicitly about debugging wrapper coverage
- inside `openclaw-research`, prefer launching these wrappers through `research_workflow.run_papernexus_wrapper` so the work runs in a durable dedicated session instead of the foreground chat turn

Important query policy:

- prefer the typed wrapper commands over raw graph downloads whenever they fit the task
- use wrapper-exposed raw payload helpers only when you truly need structural inspection beyond the typed commands
- if the available wrapper coverage is insufficient for the requested reasoning task, report the missing wrapper/API capability; do not fall back to local CLI against the live graph

## Important Paths

For workflow and operator usage, prefer these locations:

- project-local staging root: `{PROJ}/researcher/paper-staging`
- remote service base URL: configured `papernexusApiBaseUrl`
- remote import queue: `python3 scripts/pn_import_queue.py --api-base <url> --corpus <corpus> list|status|log|wait ...`
- remote graph reads: `python3 scripts/pn_graph_query.py ...` and `python3 scripts/pn_research_chains.py ...`
- runtime config / service logs: only inspect local service files when the task is explicitly about PaperNexus deployment debugging

Do not assume home-directory shared paper storage or home-directory index roots as the source of truth for workflow tasks. For live systems, the source of truth is the authenticated remote API plus project-local staging inputs.

## Paper Markdown Storage Conventions

If full-paper Markdown files already exist, store them as source inputs under a project-local staging directory, not inside `.papernexus`.

Recommended location:

- `{PROJ}/researcher/paper-staging/md`

### File Naming

Prefer stable, readable ASCII filenames:

- use lowercase
- use hyphen-separated words
- avoid spaces
- avoid non-ASCII unless the source collection already uses them consistently
- prefer the paper title or a short normalized title
- add a year or venue suffix only when needed to disambiguate

Good examples:

- `retrieval-augmented-experiment-planning.md`
- `graph-augmented-literature-mapping.md`
- `self-refine-2023.md`

Avoid:

- `final version!!.md`
- `Paper Notes.md`
- `论文1.md` unless the whole collection consistently uses Chinese filenames

### Subdirectory Layout

PaperNexus can recurse through subdirectories, so organize for human maintenance first.

Recommended patterns:

- by topic
- by project
- by venue or year

Examples:

```text
{PROJ}/researcher/paper-staging/
  md/
    self-refine-2023.md
    reflexion-2023.md
    graph-augmented-literature-mapping.md
    retrieval-augmented-experiment-planning.md
```

Guidelines:

- keep one paper per Markdown file
- do not place generated graph artifacts under the paper source tree
- mixed PDF and Markdown source directories are supported; the ingestion pipeline now materializes both and dedupes same-paper pairs before graph construction
- both PDF inputs and raw Markdown inputs are cached under the corpus markdown cache so later analyzes can reuse the cached markdown path
- both `papernexus analyze` and `papernexus analyze --force` are cache-first now: they prefer the corpus markdown cache when the source fingerprint is unchanged, and only refresh the cache when the source file itself changed or the cache is missing
- if you need to force regeneration of every PDF-derived markdown cache, use `papernexus analyze --force --rebuild-pdf-markdown`
- prefer a clean source tree over deep nesting
- in `openclaw-research` workflow-owned literature graph refreshes, do **not** use `--force` or `--rebuild-pdf-markdown` unless a human explicitly requests a rebuild; prefer cache-first `papernexus analyze`, and if it fails, hand the exact command to the user

## Current Behavior To Know

- Multiple corpora are supported, but commands usually operate on one corpus at a time via `--corpus`.
- Default operator assumption in this repo: treat the configured corpus as a single authoritative graph. Do not point stage commands at a random subdirectory once a graph already exists.
- Multiple `sources.inputs` may feed one corpus; that is not the same as cross-corpus federation.
- `~` expansion in config paths is supported and should resolve to the user home directory.
- The graph backend defaults to Kuzu when the `kuzu` package is available.
- Repo default: `docling` is the default PDF parser unless config overrides it.
- Deployment policy: do not assume the parser from repo defaults alone. Check `config.json`, CLI flags, or the running service config first. Many deployed corpora pin `analyze.pdfParser = "mineru"` with `analyze.mineruHttpUrl`.
- For MinerU HTTP API, use `analyze.mineruHttpUrl` or `--mineru-http-url` to specify the remote endpoint (e.g., `http://211.71.76.29:30000`).
- If a live deployment is already configured for remote MinerU, prefer staying on that configured path rather than switching parsers ad hoc.
- Remote MinerU failure handling should default to stopping with a warning. Only use `--mineru-remote-failure docling` when the task explicitly wants an automatic fallback.
- For local macOS OCR with Docling, use `analyze.doclingOcrEngine = "ocrmac"` or `--docling-ocr-engine ocrmac`.
- For Docling PDF parsing backend, use `analyze.doclingPdfBackend` or `--docling-pdf-backend`. Available backends: `pypdfium2` (recommended), `pdfplumber`, `fitz`, `pypdf`.
- Semantic extraction supports `auto`, `heuristic-only`, `llm-assisted`, and `llm-primary` via `analyze.semanticExtraction` or `--semantic-extraction`. Default is `auto`: use LLM assistance when model config is available, otherwise fall back to heuristics.
- Node admission is now stricter before graph projection. Low-signal surface forms such as single-word generic nouns, title fragments, and citation-like fragments are filtered out instead of being promoted into brainstorm-facing graph nodes.
- Kept research nodes may carry `brainstormEligible`, `brainstormScore`, and `brainstormTier` properties. These mark the high-quality ideation layer used by brainstorming features.
- `ideas` and `brainstorm` now prefer the brainstorm-quality node view rather than the full noisy graph.
- LLM-assisted relation extraction is controlled by `llm.relations: true` in config.
- LLM semantic extraction and per-paper relation optimization now support batched requests during `analyze`; tune with `llm.batchSize` or `--batch-size`.
- If your provider supports high throughput, increase `analyze.concurrency` or `--concurrency`; the pipeline no longer forces a low LLM concurrency cap for non-marker parsers.
- The pipeline still has cache-first resumable internal stages for materialization, LLM enrichment, staged graph projection, canonical merge cleanup, and authoritative commit. For workflow-owned graph work, treat those stages as implementation details behind the Python wrappers, not as direct agent commands.
- Ad hoc PDF/Markdown uploads should normally enter through queued import tasks under `.papernexus/imports/`, not by moving files directly into the main paper source tree during automation.
- Import tasks keep per-task `events.log` files and stay in a separate directory even after their parsed content is merged into the main graph.
- Wrapper-first import behavior:
  - use `pn_stage_sync.py` when a paper exists only on the local agent machine
  - use `pn_import_submit.py --server-file-path <remote-file>` for one-paper queued imports
  - use `pn_batch_import.py --manifest <json> submit|status|wait` for 2 or more staged papers
  - use `pn_import_queue.py` for one-paper `list`, `status`, `log`, and bounded `wait`
  - if the same staged content is submitted again, expect the service to reuse or dedupe the existing task instead of forcing a brand-new import
  - avoid inline request-body uploads unless a human explicitly approves a small-file wrapper-debugging exception
- Completed import task directories should not be treated as long-lived active scan roots. Completed imported sources are preserved through manifest-backed reuse instead of repeated directory rescans.
- Agent live-graph policy:
  - ingest one paper through `pn_import_submit.py` or many papers through `pn_batch_import.py`
  - inspect queue state through `pn_import_queue.py` or `pn_batch_import.py status|wait`
  - read graph state through `pn_graph_query.py` and `pn_research_chains.py` first
  - if an operation exists only in raw HTTP and not in the wrappers, report the limitation instead of inventing requests or using local CLI against the live graph
- Import-task execution should rebuild against the current committed corpus manifest and merge the task's `sourcesDir` on top of that base graph. Do not trust stored `task.inputPaths` as the authoritative rebuild root if they look stale or cross-machine.
- Single-graph safety:
  - Once a corpus already exists at an index root, Stage 1-4 commands must keep using that same configured input scope.
  - If you pass a narrower or different path on the same index root, PaperNexus now refuses instead of silently shrinking the graph.
  - In normal operation, omit the positional path and let `sources.inputs` drive the pipeline.
- Stage 3 persists a staged graph under `.papernexus/staged/`; the merge stage rewrites that staged graph in place; Stage 4 consumes the merged staged graph and removes it after a successful commit.
- Stage semantics:
  - Stage 1 `--continue` reuses markdown cache and snapshots when fingerprints still match; `--force` rematerializes source states; add `--rebuild-pdf-markdown` only when you really want to regenerate every PDF-derived markdown cache.
  - Stage 2 `--continue` is now dirty-only: it only reruns papers whose semantic objects or relation extraction are stale for the current config, failed but still retryable, or genuinely changed. If nothing is dirty, Stage 2 returns `reused: true` and does not rewrite the manifest.
  - Stage 2 keeps separate semantic/relation freshness state per snapshot, so unchanged papers and already-complete sub-stages are reused directly.
  - Stage 3 `--continue` reuses the staged graph if it still matches the latest manifest snapshot state, not just a fresh timestamp; a no-op Stage 2 should no longer invalidate Stage 3 by itself.
  - `merge-graph --continue` reuses an already-merged staged graph when it is still fresh; `--force` reruns canonicalization from the Stage 3 graph.
  - LLM-driven staged node deletion/renaming is currently disabled. Do not rely on `--node-llm-check` for merge-time pruning.
- Stage 4 `--continue` commits the staged graph that Stage 3 and `merge-graph` already prepared; `--force` recommits that staged graph. Stage 4 now validates against the staged manifest, not raw input rescans.
- `write-index` stays backward-compatible: if the staged graph has not gone through `merge-graph` yet, it will auto-merge similar evaluation nodes before committing.
- Important Stage 4 boundary: if raw paper files changed after Stage 3, Stage 4 can still commit the already-built staged graph. Those newer raw changes are not included until you rerun Stage 1-3 and then Stage 4.
- Agent force policy:
  - Do not add `--force` by default when building or refreshing a graph.
  - Prefer `papernexus analyze`, `papernexus optimize`, or stage commands with `--continue` for normal operation.
  - Only use `--force` when the user explicitly asks for a full rebuild, when staged/cached artifacts are known bad and normal resume cannot recover, or when you intentionally need `--rebuild-pdf-markdown`.
  - If the cache-first command still fails and the user can operate locally, hand the exact command to the user instead of escalating to a forced rebuild.
- If `sources.inputs` is configured in `config.json`, `analyze`, `materialize`, `llm-optimize`, `build-graph`, `merge-graph`, `write-index`, `optimize`, and `watch` can run without a positional path.
- Per-paper semantic snapshots now record whether LLM assistance was requested, whether it actually participated, the effective mode, and the failure reason when it did not.
- Incremental `analyze` retries papers whose prior LLM build failed because of request/network/model availability issues, while reusing snapshots for papers that already succeeded.
- When using `mineru` with a remote HTTP backend, PaperNexus now probes reachability first. Default behavior is to stop on unreachable backends. Set `--mineru-remote-failure docling` or `analyze.mineruRemoteFailureMode = "docling"` to fall back to Docling instead.
- filesystem watcher force flags only matter for the initial startup pass; later file-change reindexes stay incremental.
- `service install` defaults to both `watch` and `serve` if `--services` is omitted.
- `serve` starts the dashboard/API plus the enhancement worker, import worker, and authoritative sync worker.
- When a MinerU HTTP backend is configured, `serve` also performs a best-effort background MinerU warmup on startup. This should never block server startup, so warmup success belongs in logs, not startup gating.
- `papernexus logs watch` prints the current auto-index tmp log path and current log contents.
- All `/api/*` routes served by `papernexus serve` now require a token.
- Configure the server token with `serve.apiToken` or `PAPERNEXUS_API_TOKEN`.
- Browser access to the dashboard can supply the token once via `?token=<secret>`; the web client will reuse it for later API calls.
- Stage 4 progress labels now distinguish `acquiring corpus commit lock` from `waiting for corpus commit lock`; seeing `waiting` now means there is real lock contention.
- Chart/axis noise from OCR (e.g., "0.50 0.45 0.40 [SSR] [CLIP]") is automatically filtered during text extraction and entity sanitization.
- Set `PAPERNEXUS_GRAPH_BACKEND=json` to force legacy JSON graph storage.
- Environment variables: `PAPERNEXUS_PDF_PARSER`, `PAPERNEXUS_MINERU_CMD`, `PAPERNEXUS_MINERU_HTTP_URL`, `PAPERNEXUS_DOCLING_CMD`, `PAPERNEXUS_DOCLING_OCR_ENGINE`, `PAPERNEXUS_DOCLING_PDF_BACKEND`, `PAPERNEXUS_MARKER_CMD`, `PAPERNEXUS_GRAPH_BACKEND`, `PAPERNEXUS_HOME`.

## Preferred Control Style

For live or workflow-owned graph work, prefer the wrapper-first path:

```bash
research_workflow.run_papernexus_wrapper -> python3 scripts/pn_stage_sync.py ...
research_workflow.run_papernexus_wrapper -> python3 scripts/pn_import_submit.py ...
research_workflow.run_papernexus_wrapper -> python3 scripts/pn_import_queue.py ...
research_workflow.run_papernexus_wrapper -> python3 scripts/pn_batch_import.py ...
research_workflow.run_papernexus_wrapper -> python3 scripts/pn_graph_query.py ...
research_workflow.run_papernexus_wrapper -> python3 scripts/pn_research_chains.py ...
```

For repo-local implementation debugging inside the PaperNexus repository, inspect the relevant source files and tests first. If you truly need to exercise an internal CLI stage while debugging the PaperNexus codebase itself, treat it as repo-internal implementation work rather than the agent-facing workflow contract.

## Core Files

Read these first when you need orientation:

- `src/cli/index.js`
- `src/core/ingestion/pipeline.js`
- `src/storage/corpus-store.js`
- `src/storage/kuzu-store.js`
- `src/core/enhancements/worker.js`
- `src/server/http.js`
- `README.md`

## Working Rules

- Use `rg` for search and `sed -n` for focused file reads.
- Use `apply_patch` for edits.
- Be careful with repo-local `config.json`; some tests intentionally bypass it with `--no-config=true`.
- Do not assume paths using `~` are safe unless they go through the config helpers.
- Treat `--force` as exceptional, not routine. If the user did not explicitly ask for a full rebuild, assume the safe default is `papernexus analyze` or a staged `--continue` path.
- Agent database-safety policy:
  - only perform additive or update-style operations on the current single graph
  - do not delete corpus data, remove source files, wipe staged data, or restore/import whole-database archives unless a human explicitly asks
  - do not run `backup-export`, `backup-unpack`, or `backup-load` on the user's behalf as part of normal agent operation
- Prefer remote MinerU for PDF work. If an agent is about to run `analyze`, `materialize`, or any parser debug flow against PDFs, assume `mineruHttpUrl` is the first-choice path and mention that choice in the reasoning or command examples.
- Treat local Docling and Marker as fallback or special-case tools, not the default recommendation, unless the user explicitly asks for local parsing.
- If a task involves ad hoc uploaded PDFs or Markdown from a UI/API flow, prefer the queued import-task path over manually copying those files into the main paper source directory.
- If an import, stage, or worker run appears stuck, report the exact stage, latest task log lines, elapsed time, and the most likely blocker or stale-path cause. Do not keep retrying the same command in a loop without new evidence.
- If a task involves the live graph, assume the Python wrappers are the only allowed control plane unless the user explicitly asks for isolated local repo testing.
- If a task needs remote auth, let the wrappers resolve the configured token source; do not hand-write `Authorization` headers unless the task is explicitly about debugging the wrapper or HTTP layer.
- Do not fall back from a missing wrapper/API feature to local CLI graph operations. Report the missing endpoint or unsupported workflow clearly.
- When an ingestion run failed only because LLM requests were unavailable, prefer rerunning the bounded wrapper-first import/reconcile path before reaching for any rebuild semantics.
- Prefer the materialization step first when debugging PDF parsing or markdown cache issues, the LLM-enrichment step when debugging extraction, the staged graph projection step when debugging graph structure, the canonical merge cleanup step when debugging duplicate or low-quality evaluation nodes, and the final commit step when debugging persistence.
- If the staged graph already exists and you specifically need to inspect or fix duplicate `Dataset` / `Benchmark` nodes before commit, debug the canonical merge cleanup stage rather than bypassing the wrapper/runtime contract in workflow-owned work.
- If the staged graph contains generic evaluation nodes such as `training dataset`, inspect and clean that logic through merge heuristics or later manual review; do not rely on `--node-llm-check` right now.
- If the staged graph already succeeded and you only need to finish the commit, reuse the commit stage rather than rebuilding from scratch.
- If new raw papers were added and you want them included in the next committed graph, rerun Stage 1-3 before Stage 4. Stage 4 alone only commits the staged graph it already has.
- When changing persistence behavior, run tests that cover CLI, workflow, and enhancements.

## Validation Checklist

For storage, indexing, or CLI changes, prefer:

```bash
node --test test/workflow.test.js
node --test test/enhancements.test.js
node --test test/cli.test.js
```

For broad verification:

```bash
npm test
```

## Service Model

PaperNexus built-in background service installation currently targets macOS `launchd`.

Supported services:

- `serve`

Use the PaperNexus repo/operator documentation for service installation and status commands; workflow agents should not treat local service-management commands as the normal graph control plane.

### Linux PM2 Operation

On Linux, prefer a process supervisor such as `pm2` instead of `papernexus service install`.

If you only need the UI/API and import processing:

```bash
pm2 start "node ./src/cli/index.js serve --config /data16T/hyq/.papernexus/config.json" --name papernexus-serve --cwd /data16T/hyq/autoresearch/PaperNexus
```

If you also want background file watching:

```bash
pm2 start "node ./src/cli/index.js watch --config /data16T/hyq/.papernexus/config.json" --name papernexus-watch --cwd /data16T/hyq/autoresearch/PaperNexus
```

Persist across reboot:

```bash
pm2 save
pm2 startup systemd -u hyq --hp /data16T/hyq
```

Operational commands:

```bash
pm2 status
pm2 logs papernexus-serve
pm2 restart papernexus-serve
pm2 restart papernexus-watch
```

Notes:

- keep `serve.apiToken` in the config file or provide it through environment
- use `serve` alone when you only need the API/UI and queued import handling
- add `watch` only when you also want filesystem-triggered incremental reindexing
- after `pm2 startup`, run the generated `sudo` command once on the server so PM2 itself is restored on boot

## Graph Mutation Support

PaperNexus currently supports graph mutation for the indexed corpus.

## Brainstorm View

When working on ideation quality, distinguish between:

- the full graph: everything admitted into the research graph
- the brainstorm view: only nodes marked `brainstormEligible`

Use the brainstorm view when:

- generating research directions
- comparing problems and methods
- inspecting which nodes are good anchors for `ideas` or `brainstorm`

Do not assume every visible node in the raw graph is a good ideation anchor. Prefer nodes with:

- multi-word, reusable research-object names
- non-trivial evidence text
- `brainstormTier` of `medium` or `high`

Current ideation behavior to remember:

- `ideas` and `brainstorm` still start from the brainstorm-quality node view rather than the full noisy graph
- they now add a one-shot local Leiden community analysis at query time, not a persisted full-graph clustering index
- the local community graph is concept-only: brainstorm-eligible `Problem`, `Method`, `Claim`, `Finding`, `Limitation`, `Assumption`, `FutureDirection`, and `ResearchGoal` nodes participate directly
- `Paper` nodes only act as temporary bridge evidence for weak co-occurrence edges and do not appear as community members
- explicit concept-concept edges remain the backbone; paper co-occurrence only adds bounded weak edges
- if the local projected graph is too small, too sparse, or too slow, the search layer should fall back to the older heuristics instead of forcing a community result

What is supported:

- create node
- update node
- delete node
- create relationship
- update relationship
- delete relationship

Preferred entrypoint:

- MCP `mutate_graph` with `dryRun: true` first

When mutation is appropriate:

- the graph has a clear schema-level error
- a node is mislabeled or duplicated in an obvious way
- a relationship is wrong, missing, or points to the wrong anchor
- the correction is high-confidence and local

What agents can safely modify:

- node names
- node properties
- relationship endpoints
- relationship properties
- schema-valid node and relationship additions

What agents should not treat as permanently editable:

- source Markdown via graph mutation
- semantic paper snapshots as if they were manual truth
- enhancement overlays as long-term canonical edits

Important limitation:

- graph mutations apply to the current indexed graph
- a later full `analyze --force` or rebuild can overwrite those changes

So use mutation for:

- corrective local fixes
- previews and curation experiments
- operator-approved graph cleanup

Do not use mutation as the only long-term source of truth.

## Good Defaults For Agents

When making operational suggestions, prefer:

- corpus name from config if present
- project-local staging under `{PROJ}/researcher/paper-staging`
- authenticated remote API endpoints instead of shared-disk paper/index roots
- Kuzu as the default graph backend

When debugging unexpected directories under the repo, suspect:

- config path resolution
- repo-local `config.json`
- missing `~` expansion
- `PAPERNEXUS_HOME` overrides
