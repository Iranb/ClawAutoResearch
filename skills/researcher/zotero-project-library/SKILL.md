---
name: zotero-project-library
description: Use when a project needs durable bibliography management in the local Zotero bot folder through a configured Zotero MCP connector, especially during research-lit, literature-review, frontier setup, and pre-writing citation preparation.
---

# Zotero Project Library

Use the configured local Zotero MCP server directly to keep a restart-safe project bibliography under the configured Zotero project path (default `<zoteroProjectRoot>/<project-id>`, where `zoteroProjectRoot` defaults to `bot`).

## Core Rules

- Zotero is the project's bibliography organizer, reading queue, and note index.
- PaperNexus remains the source of truth for full text, graph state, and graph-grounded reasoning.
- Never invent metadata in Zotero. Every entry must map to a real DOI, arXiv ID, PMID, DBLP record, or other primary identifier.

## Collection Layout

Create or reuse this structure in Zotero:

```text
bot/
  <project-id>/
    selected
    included
    excluded
    baselines
    writing-shortlist
```

Minimum expectations:

- `selected`: all canonical papers currently in scope
- `included`: papers that survive structured review
- `excluded`: screened-out papers with short reason notes
- `baselines`: papers that define the baseline contract
- `writing-shortlist`: papers likely to enter `refs.bib`

## When To Run

- After `/research-lit`, sync the current candidate set into Zotero.
- After `/literature-review`, mirror `INCLUDED_PAPERS.json`, `EXCLUDED_PAPERS.json`, `SOTA_MATRIX.md`, and baseline papers into the corresponding Zotero collections/tags.
- Before `/paper-plan` or `/citation-preflight`, refresh the `writing-shortlist` collection.

## Required Project Artifact

Maintain:

- `{PROJ}/researcher/ZOTERO_PACKET.md`

Record:

- Zotero collection path: the effective configured project path
- last sync time
- selected / included / excluded / baseline counts
- any missing identifiers or manual cleanup tasks

## API Key Rule

- If local Zotero MCP or add-item flows require `apiKey`, use the plugin-configured Zotero key source.
- Prefer `zoteroApiKeyEnv` when available; `zoteroApiKey` is allowed for trusted local setups.
- Never print or persist the raw API key in chat, prompts, logs, or project files.
- If Zotero requires `apiKey` and none is configured, mark the sync as `unavailable` or `needs_manual_followup` instead of blocking the workflow.

## Sync Rules

- Deduplicate by canonical paper identity, not by Zotero title text alone.
- Prefer stable identifiers in notes/tags:
  - `arxiv:<id>`
  - `doi:<id>`
  - `pmid:<id>`
  - `track:<track-id>`
  - `baseline`
  - `writing-shortlist`
- If a paper lacks a stable identifier, keep it out of the writing shortlist until verified.

## Output

At the end of a sync pass, update `{PROJ}/researcher/ZOTERO_PACKET.md` with:

- collection path
- synced collections
- unresolved duplicates
- missing metadata requiring follow-up
- next suggested action for Writer or Reviewer
