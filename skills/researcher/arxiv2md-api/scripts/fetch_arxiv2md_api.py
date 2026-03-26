#!/usr/bin/env python3
"""
Fetch direct markdown from the arxiv2md.org API and validate it before saving.
"""
from __future__ import annotations

import argparse
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

SCRIPT_DIR = Path(__file__).resolve().parent
PAPERS_COOL_SCRIPTS = SCRIPT_DIR.parent.parent / "papers-cool" / "scripts"
if str(PAPERS_COOL_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(PAPERS_COOL_SCRIPTS))

from validate_paper_source import validate_markdown_file  # noqa: E402
from paper_filename import canonical_paper_stem, normalize_arxiv_id  # noqa: E402

USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"


def normalize_api_input(raw: str) -> tuple[str, str | None]:
    value = raw.strip()
    if not value:
        raise ValueError("paper id is required")

    normalized_arxiv_id = normalize_arxiv_id(value)
    if normalized_arxiv_id:
        return normalized_arxiv_id, normalized_arxiv_id

    if value.startswith("http"):
        parsed = urlparse(value)
        if parsed.netloc == "arxiv.org":
            arxiv_id = normalize_arxiv_id(value)
            if arxiv_id:
                return arxiv_id, arxiv_id
        return value, normalize_arxiv_id(value)

    return value, None


def fetch_bytes(url: str) -> tuple[int, bytes]:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "text/markdown, text/plain;q=0.9, */*;q=0.1",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read()


def remove_if_exists(path: Path) -> None:
    try:
        if path.exists():
            path.unlink()
    except Exception:
        pass


def run(
    paper: str,
    output_dir: str,
    title: str | None = None,
    retries: int = 2,
) -> int:
    api_input, resolved_arxiv_id = normalize_api_input(paper)
    query = urllib.parse.urlencode(
        {
            "url": api_input,
            "remove_refs": "true",
            "remove_toc": "true",
            "remove_citations": "true",
        }
    )
    url = f"https://arxiv2md.org/api/markdown?url={urllib.parse.quote(api_input, safe='')}"
    if query:
        url = f"https://arxiv2md.org/api/markdown?{query}"

    output_root = Path(output_dir).expanduser()
    output_root.mkdir(parents=True, exist_ok=True)
    output_path = output_root / f"{canonical_paper_stem(arxiv_id=resolved_arxiv_id, title=title or api_input)}.md"

    last_reason = "unfetched"
    for attempt in range(1, retries + 2):
        status, body = fetch_bytes(url)
        if status == 404:
            print("arxiv2md API does not currently provide markdown for this paper.", file=sys.stderr)
            return 1
        if status != 200:
            last_reason = f"http_{status}"
            continue

        output_path.write_text(body.decode("utf-8", errors="replace"), encoding="utf-8")
        valid, reason = validate_markdown_file(output_path)
        if valid:
            print(f"markdown: {output_path}", file=sys.stderr)
            return 0

        remove_if_exists(output_path)
        last_reason = reason
        print(f"arxiv2md API validation failed on attempt {attempt}: {reason}", file=sys.stderr)

    print(f"failed to fetch valid arxiv2md API markdown after retries: {last_reason}", file=sys.stderr)
    return 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch validated markdown from the arxiv2md.org raw API.")
    parser.add_argument("paper", help="arXiv ID or arXiv URL")
    parser.add_argument("--output-dir", required=True, help="Directory to write validated markdown")
    parser.add_argument("--title", default=None, help="Optional paper title used when no arXiv ID is available")
    parser.add_argument("--retries", type=int, default=2, help="Retry count after validation failure")
    return run(**vars(parser.parse_args()))


if __name__ == "__main__":
    raise SystemExit(main())
