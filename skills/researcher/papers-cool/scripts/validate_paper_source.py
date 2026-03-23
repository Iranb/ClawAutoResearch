#!/usr/bin/env python3
"""
Validate downloaded paper source files so HTML/error pages do not masquerade as PDF or markdown.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

HTML_MARKERS = (
    "<!doctype html",
    "<html",
    "<head",
    "<body",
    "<script",
    "<title>",
)

ERROR_MARKERS = (
    "access denied",
    "forbidden",
    "not found",
    "404",
    "429",
    "too many requests",
    "just a moment",
    "cloudflare",
    "bad gateway",
    "gateway timeout",
    "service unavailable",
    "please enable javascript",
)


def _read_head_bytes(path: Path, size: int = 4096) -> bytes:
    with path.open("rb") as f:
        return f.read(size)


def _decode_preview(data: bytes) -> str:
    return data.decode("utf-8", errors="replace").strip().lower()


def _looks_like_html_or_error(text: str) -> bool:
    compact = re.sub(r"\s+", " ", text.lower())
    return any(marker in compact for marker in HTML_MARKERS) or any(
        marker in compact for marker in ERROR_MARKERS
    )


def validate_pdf_file(path: os.PathLike[str] | str) -> tuple[bool, str]:
    file_path = Path(path)
    if not file_path.exists():
        return False, "missing"
    if file_path.stat().st_size < 512:
        return False, "too_small"

    head = _read_head_bytes(file_path)
    if head.startswith(b"%PDF-"):
        return True, "pdf_header_ok"

    preview = _decode_preview(head)
    if _looks_like_html_or_error(preview):
        return False, "html_or_error_page"

    printable = sum(32 <= b <= 126 or b in (9, 10, 13) for b in head)
    ratio = printable / max(len(head), 1)
    if ratio > 0.9:
        return False, "text_like_not_pdf"

    return False, "missing_pdf_header"


def validate_markdown_file(path: os.PathLike[str] | str) -> tuple[bool, str]:
    file_path = Path(path)
    if not file_path.exists():
        return False, "missing"
    if file_path.stat().st_size < 200:
        return False, "too_small"

    text = file_path.read_text(encoding="utf-8", errors="replace")
    preview = text[:6000].strip().lower()
    if not preview:
        return False, "empty"
    if _looks_like_html_or_error(preview):
        return False, "html_or_error_page"

    strong_markdown_signals = (
        "\n#",
        "\n##",
        "\n###",
        "\n- ",
        "\n* ",
        "\n1. ",
        "abstract",
        "introduction",
    )
    if len(preview) < 400 and not any(signal in preview for signal in strong_markdown_signals):
        return False, "too_short_for_paper_markdown"

    html_tag_hits = len(re.findall(r"<(html|head|body|script|style|div|span|meta|link)\b", preview))
    if html_tag_hits >= 3:
        return False, "html_like_markup"

    return True, "markdown_ok"


def validate_paper_source(path: os.PathLike[str] | str, expected: str) -> tuple[bool, str]:
    normalized = expected.lower().strip()
    if normalized in {"pdf"}:
        return validate_pdf_file(path)
    if normalized in {"markdown", "md"}:
        return validate_markdown_file(path)
    raise ValueError(f"Unsupported expected type: {expected}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate paper source files (pdf or markdown).")
    parser.add_argument("path", help="Path to the downloaded file")
    parser.add_argument("--expected", required=True, choices=["pdf", "markdown", "md"])
    parser.add_argument("--json", action="store_true", help="Print JSON output")
    args = parser.parse_args()

    valid, reason = validate_paper_source(args.path, args.expected)
    payload = {
      "path": str(Path(args.path)),
      "expected": "markdown" if args.expected == "md" else args.expected,
      "valid": valid,
      "reason": reason,
    }
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print(f"{payload['expected']}: {'valid' if valid else 'invalid'} ({reason})")
    return 0 if valid else 1


if __name__ == "__main__":
    raise SystemExit(main())
