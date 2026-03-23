---
name: hugging-face-paper-pages
description: "Fetch Hugging Face paper pages as markdown plus structured paper metadata. Use to ingest full-paper markdown into the PaperNexus source tree before graph build."
argument-hint: "[arXiv ID / Hugging Face paper URL / arXiv URL]"
allowed-tools:
  - Bash(*)
  - Read
  - Write
  - Edit
  - Grep
  - Glob
---

# Hugging Face Paper Pages

Use Hugging Face paper pages as the preferred full-text markdown source before PaperNexus graph build.

> **Primary use in this repo**: save paper markdown into the PaperNexus paper source tree so `graph-build` can index it.

## Inputs

- arXiv ID such as `2502.00032`
- `https://huggingface.co/papers/<id>`
- `https://arxiv.org/abs/<id>`
- `https://arxiv.org/pdf/<id>`

## Preferred Output Locations

Resolve the PaperNexus source directory in this order:

1. `{PROJ}/PROJECT_MANIFEST.json` field `paper_source_dir` if present
2. `/Users/iranb/.papernexus/papers/{proj-id}`

Save:

- full markdown to `<paper_source_dir>/md/<normalized-paper-id>.md`
- metadata JSON to `{PROJ}/researcher/lit_papers/<paper-id>_hf.json`

If a same-paper PDF already exists under `<paper_source_dir>/pdf/`, keep it only as fallback. The Markdown file becomes the canonical graph-ingestion artifact for the next `/graph-build`.

## Commands

Parse the paper ID, then fetch:

```bash
curl -s "https://huggingface.co/papers/{PAPER_ID}.md"
curl -s "https://huggingface.co/api/papers/{PAPER_ID}"
```

If the markdown endpoint returns `404`, report that Hugging Face paper pages do not currently provide markdown for this paper. Do not fabricate content.

## Notes

- Prefer the `.md` endpoint for PaperNexus ingestion.
- Prefer the API endpoint when you need structured metadata such as GitHub repo, project page, linked models, or datasets.
- If markdown is unavailable, let the caller fall back to `/papers-cool` PDF download.
- Inside this repo, Markdown should land in the `md/` subdirectory so `graph-build` can stage a Markdown-first canonical corpus.
