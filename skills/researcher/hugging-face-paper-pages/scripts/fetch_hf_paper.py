#!/usr/bin/env python3
"""
Fetch Hugging Face paper markdown with validation so HTML/error pages do not get stored as canonical markdown.
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
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


def normalize_paper_id(raw: str) -> str:
    value = raw.strip()
    if not value:
        raise ValueError("paper id is required")
    if value.startswith("http"):
        parsed = urlparse(value)
        if parsed.netloc == "huggingface.co" and "/papers/" in parsed.path:
            return parsed.path.split("/papers/")[-1].strip("/").replace(".md", "")
        if parsed.netloc == "arxiv.org":
            parts = parsed.path.strip("/").split("/")
            if parts and parts[-1]:
                return parts[-1].replace(".pdf", "")
    return value.replace("https://huggingface.co/papers/", "").replace(".md", "").strip("/")


def pick_first_string(payload: object, keys: tuple[str, ...]) -> str | None:
    if not isinstance(payload, dict):
        return None
    for key in keys:
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    for nested_key in ("paper", "data", "metadata"):
        nested = payload.get(nested_key)
        if isinstance(nested, dict):
            for key in keys:
                value = nested.get(key)
                if isinstance(value, str) and value.strip():
                    return value.strip()
    return None


def fetch_url(url: str, accept: str | None = None) -> tuple[int, bytes, dict[str, str]]:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, **({"Accept": accept} if accept else {})})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            body = response.read()
            headers = {k.lower(): v for k, v in response.headers.items()}
            return response.status, body, headers
    except urllib.error.HTTPError as exc:
        body = exc.read()
        headers = {k.lower(): v for k, v in exc.headers.items()}
        return exc.code, body, headers


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def remove_if_exists(path: Path) -> None:
    try:
        if path.exists():
            path.unlink()
    except Exception:
        pass


def run(
    paper: str,
    output_dir: str,
    metadata_dir: str | None = None,
    title: str | None = None,
    retries: int = 2,
) -> int:
    paper_id = normalize_paper_id(paper)
    markdown_url = f"https://huggingface.co/papers/{paper_id}.md"
    metadata_url = f"https://huggingface.co/api/papers/{paper_id}"

    metadata_payload: object | None = None
    status, body, _headers = fetch_url(metadata_url, accept="application/json")
    if status == 200:
        try:
            metadata_payload = json.loads(body.decode("utf-8", errors="replace"))
        except json.JSONDecodeError:
            metadata_payload = {
                "paper_id": paper_id,
                "metadata_error": "invalid_json",
            }

    resolved_arxiv_id = normalize_arxiv_id(
        pick_first_string(metadata_payload, ("arxivId", "arxiv_id", "paper_id", "id")) or paper_id
    )
    resolved_title = title or pick_first_string(metadata_payload, ("title", "paper_title", "name")) or paper_id

    output_root = Path(output_dir).expanduser()
    output_root.mkdir(parents=True, exist_ok=True)
    canonical_stem = canonical_paper_stem(arxiv_id=resolved_arxiv_id, title=resolved_title)
    markdown_path = output_root / f"{canonical_stem}.md"

    last_reason = "unfetched"
    for attempt in range(1, retries + 2):
        status, body, headers = fetch_url(markdown_url, accept="text/markdown, text/plain;q=0.9, */*;q=0.1")
        if status == 404:
            print("Hugging Face paper pages do not provide markdown for this paper.", file=sys.stderr)
            return 1
        if status != 200:
            last_reason = f"http_{status}"
            continue

        write_text(markdown_path, body.decode("utf-8", errors="replace"))
        valid, reason = validate_markdown_file(markdown_path)
        if valid:
            if metadata_dir:
                metadata_root = Path(metadata_dir).expanduser()
                metadata_path = metadata_root / f"{canonical_stem}_hf.json"
                write_json(
                    metadata_path,
                    metadata_payload
                    if metadata_payload is not None
                    else {
                        "paper_id": paper_id,
                        "metadata_status": "unavailable",
                        "markdown_content_type": headers.get("content-type", ""),
                    },
                )
                print(f"metadata: {metadata_path}", file=sys.stderr)
            print(f"markdown: {markdown_path}", file=sys.stderr)
            return 0

        remove_if_exists(markdown_path)
        last_reason = reason
        print(f"markdown validation failed on attempt {attempt}: {reason}", file=sys.stderr)

    print(f"failed to fetch valid markdown after retries: {last_reason}", file=sys.stderr)
    return 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch validated Hugging Face paper markdown.")
    parser.add_argument("paper", help="arXiv ID, Hugging Face paper URL, or arXiv URL")
    parser.add_argument("--output-dir", required=True, help="Directory to write validated markdown")
    parser.add_argument("--metadata-dir", default=None, help="Optional directory to write metadata JSON")
    parser.add_argument("--title", default=None, help="Optional paper title used when no arXiv ID is available")
    parser.add_argument("--retries", type=int, default=2, help="Retry count after validation failure")
    return run(**vars(parser.parse_args()))


if __name__ == "__main__":
    raise SystemExit(main())
