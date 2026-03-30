---
name: hugging-face-paper-pages
description: "Fetch Hugging Face paper pages as markdown plus structured paper metadata. Use to ingest full-paper markdown into project-local staging before remote PaperNexus import and graph build."
argument-hint: "[arXiv ID / Hugging Face paper URL / arXiv URL]"
metadata:
  {"openclaw": {"emoji": "🤗", "requires": {"bins": ["python3"]}}}
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

> **Primary use in this repo**: save paper markdown into project-local staging so the workflow can upload/import it through the configured remote PaperNexus API before `graph-build`.
> **Preferred fallback order in this repo**: `hugging-face-paper-pages -> arxiv2md-api -> arxiv2md -> papers-cool PDF`.

## Inputs

- arXiv ID such as `2502.00032`
- `https://huggingface.co/papers/<id>`
- `https://arxiv.org/abs/<id>`
- `https://arxiv.org/pdf/<id>`

## Preferred Output Locations

Resolve the PaperNexus source directory in this order:

1. `{PROJ}/PROJECT_MANIFEST.json` field `paper_source_dir` if present
2. `{PROJ}/researcher/paper-staging`

Save:

- full markdown to `<paper_source_dir>/md/<canonical-paper>.md`
- metadata JSON to `{PROJ}/researcher/lit_papers/<canonical-paper>_hf.json`

Canonical filename rule:

- if arXiv ID exists, use the arXiv ID as the whole filename stem, for example `2502.00032.md`
- if arXiv ID does not exist, use a transliterated title slug, for example `graph-retrieval-benchmarks.md`
- transliterate special characters to ASCII when possible, lowercase the result, replace separators with `-`, and strip the remaining punctuation
- strip arXiv version suffixes such as `v1`

If a same-paper PDF already exists under `<paper_source_dir>/pdf/`, keep it only as fallback. The Markdown file becomes the canonical remote-import artifact for the next `/graph-build`.

## Commands

Preferred command in this repo:

```bash
python scripts/fetch_hf_paper.py <paper-id-or-url> \
  --output-dir "<paper_source_dir>/md" \
  --metadata-dir "{PROJ}/researcher/lit_papers"
```

If the paper does not have an arXiv ID but you already know the title, pass:

```bash
python scripts/fetch_hf_paper.py <paper-id-or-url> \
  --output-dir "<paper_source_dir>/md" \
  --metadata-dir "{PROJ}/researcher/lit_papers" \
  --title "<paper title>"
```

This script will:

- fetch `https://huggingface.co/papers/{PAPER_ID}.md`
- validate that the saved file is real paper markdown rather than HTML / error-page text
- delete invalid files automatically
- retry the markdown fetch before giving up
- save metadata JSON when requested

If you need to inspect manually, the underlying endpoints are:

```bash
curl -s "https://huggingface.co/papers/{PAPER_ID}.md"
curl -s "https://huggingface.co/api/papers/{PAPER_ID}"
```

## Validation Rule (mandatory)

Do not keep a downloaded `.md` file just because the HTTP request succeeded.

Treat the fetch as failed if the saved file looks like:

- HTML
- access-denied / rate-limit / Cloudflare text
- an error page masquerading as markdown
- an obviously too-short stub instead of full-paper markdown

If validation fails:

1. delete the bad file
2. retry the Hugging Face markdown fetch
3. if it still fails, report Markdown unavailable and let the caller try `/arxiv2md-api`
4. if the direct raw-markdown API also fails, let the caller try `/arxiv2md`
5. only after both markdown fallbacks fail should the caller use `/papers-cool` PDF download

If the markdown endpoint returns `404`, report that Hugging Face paper pages do not currently provide markdown for this paper. Do not fabricate content.

## Notes

- Prefer the `.md` endpoint for PaperNexus ingestion.
- Prefer the API endpoint when you need structured metadata such as GitHub repo, project page, linked models, or datasets.
- If markdown is unavailable, let the caller try `/arxiv2md-api` first, then `/arxiv2md`, then `/papers-cool` PDF download.
- Inside this repo, Markdown should land in the `md/` subdirectory of project-local staging so the workflow can upload/import a Markdown-first canonical corpus through remote PaperNexus.
