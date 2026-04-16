#!/usr/bin/env python3
"""
Fetch validated markdown from markxiv.org using curl.

markxiv serves markdown directly for arXiv papers, but its TLS behavior is
less reliable with urllib in some environments. Using curl here makes the
fallback lane more robust for workflow-owned staging.
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
PAPERS_COOL_SCRIPTS = SCRIPT_DIR.parent.parent / "papers-cool" / "scripts"
if str(PAPERS_COOL_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(PAPERS_COOL_SCRIPTS))

from validate_paper_source import validate_markdown_file  # noqa: E402
from paper_filename import canonical_paper_stem, normalize_arxiv_id  # noqa: E402

USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"


def remove_if_exists(path: Path) -> None:
    try:
        if path.exists():
            path.unlink()
    except Exception:
        pass


def fetch_markdown(url: str, output_path: Path) -> tuple[bool, str]:
    command = [
        "curl",
        "-L",
        "--fail",
        "--silent",
        "--show-error",
        "--max-time",
        "30",
        "-A",
        USER_AGENT,
        "-H",
        "Accept: text/markdown, text/plain;q=0.9, */*;q=0.1",
        "-o",
        str(output_path),
        url,
    ]
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0:
        stderr = (result.stderr or "").strip().lower()
        if "404" in stderr:
            return False, "http_404"
        if "timeout" in stderr:
            return False, "timeout"
        return False, "curl_failed"
    return True, "ok"


def run(paper: str, output_dir: str, title: str | None = None, retries: int = 2) -> int:
    arxiv_id = normalize_arxiv_id(paper)
    if not arxiv_id:
        raise ValueError("arXiv id is required")

    url = f"https://markxiv.org/abs/{arxiv_id}"
    output_root = Path(output_dir).expanduser()
    output_root.mkdir(parents=True, exist_ok=True)
    output_path = output_root / f"{canonical_paper_stem(arxiv_id=arxiv_id, title=title or arxiv_id)}.md"

    last_reason = "unfetched"
    for attempt in range(1, retries + 2):
        ok, reason = fetch_markdown(url, output_path)
        if not ok:
            last_reason = reason
            continue

        valid, validation_reason = validate_markdown_file(output_path)
        if valid:
            print(f"markdown: {output_path}", file=sys.stderr)
            return 0

        remove_if_exists(output_path)
        last_reason = validation_reason
        print(f"markxiv validation failed on attempt {attempt}: {validation_reason}", file=sys.stderr)

    if last_reason == "http_404":
        print("markxiv does not currently provide markdown for this paper.", file=sys.stderr)
    else:
        print(f"failed to fetch valid markxiv markdown after retries: {last_reason}", file=sys.stderr)
    return 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch validated markdown from markxiv.org.")
    parser.add_argument("paper", help="arXiv ID or arXiv URL")
    parser.add_argument("--output-dir", required=True, help="Directory to write validated markdown")
    parser.add_argument("--title", default=None, help="Optional paper title used when no arXiv ID is available")
    parser.add_argument("--retries", type=int, default=2, help="Retry count after validation failure")
    return run(**vars(parser.parse_args()))


if __name__ == "__main__":
    raise SystemExit(main())
