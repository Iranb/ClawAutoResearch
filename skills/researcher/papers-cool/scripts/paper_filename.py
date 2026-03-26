#!/usr/bin/env python3
"""
Helpers for canonical paper filenames used across the researcher download pipeline.
"""
from __future__ import annotations

import re
import unicodedata
from urllib.parse import unquote, urlparse

NEW_ARXIV_ID_PATTERN = re.compile(r"^(\d{4}\.\d{4,5})(?:v\d+)?$", re.IGNORECASE)
OLD_ARXIV_ID_PATTERN = re.compile(r"^([A-Za-z][A-Za-z.\-]+/\d{7})(?:v\d+)?$", re.IGNORECASE)
ARXIV_VERSION_SUFFIX = re.compile(r"v\d+$", re.IGNORECASE)


def _strip_known_suffixes(value: str) -> str:
    return value.replace(".pdf", "").replace(".md", "").strip().strip("/")


def _extract_candidate(value: str) -> str:
    raw = value.strip()
    if not raw:
        return ""
    if not raw.startswith("http"):
        return _strip_known_suffixes(raw)

    parsed = urlparse(raw)
    path = unquote(parsed.path).strip("/")
    parts = [part for part in path.split("/") if part]
    if parsed.netloc.endswith("arxiv.org") and len(parts) >= 2 and parts[0] in {"abs", "pdf"}:
        return _strip_known_suffixes(parts[1])
    if parsed.netloc.endswith("huggingface.co") and len(parts) >= 2 and parts[0] == "papers":
        return _strip_known_suffixes(parts[1])
    if len(parts) >= 2 and parts[0] == "arxiv":
        return _strip_known_suffixes(parts[1])
    if parts:
        return _strip_known_suffixes(parts[-1])
    return _strip_known_suffixes(raw)


def normalize_arxiv_id(value: str | None) -> str | None:
    if not value:
        return None
    candidate = _extract_candidate(value)
    if not candidate:
        return None
    normalized = ARXIV_VERSION_SUFFIX.sub("", candidate)
    if NEW_ARXIV_ID_PATTERN.match(normalized) or OLD_ARXIV_ID_PATTERN.match(normalized):
        return normalized
    return None


def slugify_paper_title(title: str | None) -> str:
    if not title:
        return "paper"

    normalized = unicodedata.normalize("NFKD", title)
    normalized = normalized.replace("&", " and ")
    ascii_text = normalized.encode("ascii", "ignore").decode("ascii")
    ascii_text = ascii_text.lower()
    ascii_text = re.sub(r"[’'`]+", "", ascii_text)
    ascii_text = re.sub(r"[^a-z0-9]+", "-", ascii_text)
    ascii_text = re.sub(r"-{2,}", "-", ascii_text).strip("-")
    return ascii_text or "paper"


def canonical_paper_stem(
    *,
    arxiv_id: str | None = None,
    title: str | None = None,
) -> str:
    normalized_arxiv = normalize_arxiv_id(arxiv_id)
    if normalized_arxiv:
        return normalized_arxiv.replace("/", "-")
    return slugify_paper_title(title)


def canonical_paper_filename(
    extension: str,
    *,
    arxiv_id: str | None = None,
    title: str | None = None,
) -> str:
    suffix = extension if extension.startswith(".") else f".{extension}"
    return f"{canonical_paper_stem(arxiv_id=arxiv_id, title=title)}{suffix}"
