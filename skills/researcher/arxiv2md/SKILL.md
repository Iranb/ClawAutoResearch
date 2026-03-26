---
name: arxiv2md
description: "Fetch cleaned markdown from arxiv2md.org as a fallback when Hugging Face paper pages do not provide valid markdown."
argument-hint: "[arXiv ID / arXiv URL]"
metadata:
  {"openclaw": {"emoji": "2️⃣", "requires": {"bins": ["python3"]}}}
allowed-tools:
  - Bash(*)
  - Read
  - Write
  - Edit
  - Grep
  - Glob
---

# arxiv2md

Use [arxiv2md.org](https://arxiv2md.org/) as the second-choice markdown source for arXiv papers.

> In this repo, the preferred full-text order is: `hugging-face-paper-pages -> arxiv2md -> papers-cool PDF`.

## Inputs

- arXiv ID such as `2312.00752`
- `https://arxiv.org/abs/<id>`
- `https://arxiv.org/pdf/<id>`

## How arxiv2md works

The service is intentionally simple:

- original: `https://arxiv.org/abs/2312.00752`
- arxiv2md: `https://arxiv2md.org/abs/2312.00752`

Inside this repo, prefer the provided script instead of hand-written `curl` so the result is validated before it enters the paper source tree.

## Preferred Command

```bash
python scripts/fetch_arxiv2md.py <arxiv-id-or-url> \
  --output-dir "<paper_source_dir>/md"
```

This script will:

- convert the input into the matching `https://arxiv2md.org/abs/<id>` URL
- fetch the markdown
- validate that the saved file is real paper markdown rather than HTML / error-page content
- delete invalid files automatically
- retry before giving up

## Validation Rule

Treat the fetch as failed if the saved file looks like:

- HTML
- an error page or anti-bot page
- an obviously tiny stub instead of paper markdown

If validation fails:

1. delete the bad file
2. retry arxiv2md
3. if it still fails, report markdown unavailable and let the caller fall back to PDF download

## Output

Save validated markdown to:

- `<paper_source_dir>/md/<arxiv-id>.md`

Filename rule:

- keep the modern arXiv dot form, for example `2502.00032.md`
- strip version suffixes such as `v1`
- if an old-style arXiv ID contains `/`, replace it with `-` in the filename stem

The caller should then update `PAPER_SOURCE_INDEX.json` with `source_kind = "markdown"`, `source_provider = "arxiv2md"`, and merged `retrieval_providers`, then continue to `/graph-build` if the paper is new or important.
