---
name: papernexus
description: "Operate PaperNexus as the project-local research graph system: resolve corpus paths, ingest markdown/PDF sources, check graph status, and keep watch/refresh healthy for active projects."
argument-hint: "[project corpus name or topic]"
allowed-tools:
  - Bash(*)
  - Read
  - Write
  - Edit
  - Grep
  - Glob
---

# PaperNexus

Use this skill when Researcher needs to operate the local PaperNexus corpus for a project, not when doing generic web search.

PaperNexus is the project-local research knowledge graph system. In this repository, it is used as the grounded literature memory for paper ingestion, graph refresh, graph-backed brainstorming, and ongoing watcher recovery.

## Responsibilities

- resolve the effective `paper_source_dir`
- check whether a key paper is already present in the corpus
- run or resume graph refresh commands
- verify `watch` / `serve` health for active corpora
- treat the existing graph as read-mostly
- use graph mutation only for narrow, high-confidence corrective curation
- prefer adding new nodes or edges over editing existing graph structure when extending knowledge

## Default Paths

Prefer these locations unless `{PROJ}/PROJECT_MANIFEST.json` says otherwise:

- paper source: `/Users/iranb/.papernexus/papers/{proj-id}`
- index root: `/Users/iranb/.papernexus/index-store`
- runtime config: `/Users/iranb/.papernexus/config.json`
- logs: `/Users/iranb/.papernexus/logs`

Inside each corpus root, PaperNexus normally writes:

- `.papernexus/graph.kuzu`
- `.papernexus/graph.lite.json`
- `.papernexus/meta.json`
- `.papernexus/sources.json`
- `.papernexus/papers/*.json`

## Paper Source Conventions

If full-paper Markdown files already exist, store them under the source tree, not inside `.papernexus`.

Preferred layout under `paper_source_dir`:

- `md/<canonical-name>.md`
- `pdf/<canonical-name>.pdf`

Naming guidance:

- use lowercase ASCII when possible
- use hyphen-separated words
- avoid spaces
- prefer `<arxiv-id>--<normalized-title>` when the paper has an arXiv id
- otherwise prefer DOI-derived or normalized-title filenames

Directory guidance:

- keep one paper per file
- do not place generated graph artifacts under the source tree
- mixed PDF and Markdown inputs are allowed, but dedupe them by canonical paper identity before graph reasoning

## Current Behavior To Know

- PaperNexus can support multiple corpora, but project work should operate on one corpus at a time
- multiple `sources.inputs` can feed one corpus
- `~` expansion in config paths should resolve through config helpers
- Kuzu is the preferred graph backend when available
- `watch` keeps the graph fresh and `serve` keeps the dashboard, API, and enhancement worker alive

## Required Command Order

When a new key paper is found:

1. confirm whether the canonical paper already exists in `PAPER_SOURCE_INDEX.json`
2. confirm whether the current graph already contains that paper
3. if missing from the graph, ingest markdown or PDF into `paper_source_dir`
4. run graph refresh before any novelty or innovation reasoning

Use this skill when the task is about operating PaperNexus as the local research graph system, not only when working inside the PaperNexus repo itself.

Typical commands:

```bash
papernexus status --corpus <name>
papernexus analyze --force --corpus <name>
papernexus watch --corpus <name>
papernexus enhance --once --corpus <name>
papernexus service status --services watch,serve
```

Prefer the globally linked CLI:

```bash
papernexus <command>
```

Fallback:

```bash
node ./src/cli/index.js <command>
```

## Working Rules

- use `rg` for search and `sed -n` for focused reads when checking PaperNexus state
- use `apply_patch` for edits
- do not assume repo-local `config.json` is authoritative if the runtime is using a different config path
- when storage or persistence behavior changes, verify both graph refresh and service health

## Validation Checklist

Before saying the graph side is healthy, check:

- the source tree exists and matches `paper_source_dir`
- the expected corpus resolves correctly
- `papernexus status --corpus <name>` succeeds
- `watch` or `serve` state is known
- the graph contains the newly ingested key paper before novelty reasoning starts

## Graph Mutation Support

PaperNexus currently supports graph mutation for the indexed corpus.

Default stance:

- do not edit existing graph structure unless there is a clear error
- adding new nodes or edges is allowed when they are source-backed, schema-valid, and locally scoped

What is appropriate:

- a clear schema-level graph error
- an obviously duplicated or mislabeled node
- a wrong or missing relationship with direct support
- a narrow property correction
- adding a new node with direct paper support
- adding a new relationship from a new node into the existing local neighborhood

What is not a good long-term use:

- treating graph mutation as the only source of truth
- editing source Markdown through graph mutation
- promoting thin interpretation into canonical graph fact
- casually rewriting existing nodes, labels, or links just because a different framing seems better

Mutation policy:

- use MCP `mutate_graph` with `dryRun: true` first
- prefer local corrective cleanup and source-backed additive extension, not speculative synthesis edits
- remember that a later full `papernexus analyze --force` can overwrite graph mutations
- for additive changes, record source support and why the new node or edge is needed in the project graph report

So use mutation for:

- corrective local fixes
- source-backed additive nodes or edges
- preview curation experiments
- operator-approved graph cleanup

## Output Contract

When used inside the research pipeline, update:

- `{PROJ}/graph/PAPERNEXUS_STATUS.json`
- `{PROJ}/graph/GRAPH_BUILD_REPORT.md`
- `{PROJ}/PROJECT_MANIFEST.json`

and record:

- whether the paper was already present
- whether graph refresh was required
- whether watcher recovery was needed
- whether any graph mutation was proposed, dry-run only, or actually applied
- the resolved `paper_source_dir`
- the corpus name and active backend if known
