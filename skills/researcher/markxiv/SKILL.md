---
name: markxiv
description: "Fetch Markdown from markxiv.org as the second arXiv-specific fallback after the direct arxiv2md API and before the legacy arxiv2md webpage fetch."
argument-hint: "[arXiv ID / arXiv URL]"
metadata:
  {"openclaw": {"emoji": "📝", "requires": {"bins": ["python3", "curl"]}}}
allowed-tools:
  - Bash(*)
  - Read
  - Write
  - Edit
  - Grep
  - Glob
---

# markxiv

Use [markxiv.org](https://markxiv.org/) as a Markdown-first arXiv fallback after `/arxiv2md-api` and before the legacy `/arxiv2md` page fetch.

> In this repo, the preferred full-text order is: `hugging-face-paper-pages -> arxiv2md-api -> markxiv -> arxiv2md -> papers-cool PDF`.

## Why This Skill Exists

According to [markxiv.org](https://markxiv.org/), the service works by replacing the `arxiv` host in an arXiv URL with `markxiv` and returning the paper as Markdown:

- `arxiv.org/abs/1234.56789` -> `markxiv.org/abs/1234.56789`

The site also advertises an MCP server for agent usage, but inside this repo the most stable immediate integration is the plain Markdown HTTP endpoint.

## Inputs

- arXiv ID such as `1706.03762`
- `https://arxiv.org/abs/<id>`
- `https://arxiv.org/pdf/<id>`
- `https://markxiv.org/abs/<id>`

## Preferred Command

```bash
python scripts/fetch_markxiv.py <arxiv-id-or-url> \
  --output-dir "<paper_source_dir>/md"
```

If the paper does not have an arXiv ID but you already know the title, pass:

```bash
python scripts/fetch_markxiv.py <arxiv-id-or-url> \
  --output-dir "<paper_source_dir>/md" \
  --title "<paper title>"
```

This script will:

- fetch `https://markxiv.org/abs/<arxiv-id>`
- validate that the saved file is real paper Markdown rather than HTML / rate-limit / error-page content
- delete invalid files automatically
- retry before giving up

## Validation Rule

Treat the fetch as failed if the saved file looks like:

- HTML
- an error page or anti-bot page
- an obviously tiny stub instead of paper Markdown

If validation fails:

1. delete the bad file
2. retry markxiv
3. if it still fails, report Markdown unavailable and let the caller try `/arxiv2md`
4. only after all Markdown fallbacks fail should the caller fall back to `/papers-cool` PDF download

## Output

Save validated Markdown to:

- `<paper_source_dir>/md/<canonical-paper>.md`

Filename rule:

- keep the modern arXiv dot form when available, for example `2502.00032.md`
- strip version suffixes such as `v1`
- if no arXiv ID exists, use a transliterated title slug

The caller should then update `PAPER_SOURCE_INDEX.json` with:

- `source_kind = "markdown"`
- `source_provider = "markxiv"`
- merged `retrieval_providers`

Then continue to `/graph-build` if the paper is new or important.
