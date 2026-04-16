---
name: arxiv2md-api
description: "Fetch direct raw markdown from the arxiv2md.org API as the first arXiv-specific fallback after Hugging Face paper pages."
argument-hint: "[arXiv ID / arXiv URL]"
metadata:
  {"openclaw": {"emoji": "🧩", "requires": {"bins": ["python3"]}}}
allowed-tools:
  - Bash(*)
  - Read
  - Write
  - Edit
  - Grep
  - Glob
---

# arxiv2md API

Use the direct raw-markdown API from [arxiv2md.org](https://arxiv2md.org/) as the preferred agent-friendly fallback for arXiv papers when Hugging Face paper pages do not provide valid markdown.

> In this repo, the preferred full-text order is: `hugging-face-paper-pages -> arxiv2md-api -> markxiv -> arxiv2md -> papers-cool PDF`.

## Why This Skill Exists

The upstream `timf34/arxiv2md` project exposes a raw markdown endpoint designed for AI agents:

- `https://arxiv2md.org/api/markdown?url=<arxiv-id-or-url>`

This endpoint returns markdown directly, without going through PDF parsing, and is therefore a better first fallback than PDF-based ingestion when the paper has an arXiv identity.

## Inputs

- arXiv ID such as `2312.00752`
- `https://arxiv.org/abs/<id>`
- `https://arxiv.org/pdf/<id>`

## Preferred Command

```bash
python scripts/fetch_arxiv2md_api.py <arxiv-id-or-url> \
  --output-dir "<paper_source_dir>/md"
```

If the paper does not have an arXiv ID but you already know the title, pass:

```bash
python scripts/fetch_arxiv2md_api.py <arxiv-id-or-url> \
  --output-dir "<paper_source_dir>/md" \
  --title "<paper title>"
```

This script will:

- call `https://arxiv2md.org/api/markdown?url=<paper>`
- validate that the saved file is real paper markdown rather than HTML / rate-limit / error-page content
- delete invalid files automatically
- retry before giving up

## Validation Rule

Treat the fetch as failed if the saved file looks like:

- HTML
- an error page or anti-bot page
- an obviously tiny stub instead of paper markdown

If validation fails:

1. delete the bad file
2. retry the API fetch
3. if it still fails, report direct markdown unavailable and let the caller try `/markxiv`
4. if `markxiv` also fails, let the caller try `/arxiv2md`
5. only after all markdown fallbacks fail should the caller fall back to `/papers-cool` PDF download

## Output

Save validated markdown to:

- `<paper_source_dir>/md/<canonical-paper>.md`

Filename rule:

- keep the modern arXiv dot form when available, for example `2502.00032.md`
- strip version suffixes such as `v1`
- if no arXiv ID exists, use a transliterated title slug

The caller should then update `PAPER_SOURCE_INDEX.json` with:

- `source_kind = "markdown"`
- `source_provider = "arxiv2md-api"`
- merged `retrieval_providers`

Then continue to `/graph-build` if the paper is new or important.
