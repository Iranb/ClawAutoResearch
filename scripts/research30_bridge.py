#!/usr/bin/env python3
"""
Bridge the external research30 skill into openclaw-research runtime flows.

This wrapper discovers a local research30 installation, runs one or more
multi-source literature searches, and emits a deterministic JSON payload that
our workflow runtime can persist as durable project artifacts.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import sys
from pathlib import Path
from typing import Any


SOURCE_FIELDS = [
    "openalex",
    "semanticscholar",
    "pubmed",
    "biorxiv",
    "medrxiv",
    "arxiv",
    "huggingface",
]


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def read_json(path: Path) -> Any:
    return json.loads(read_text(path))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run research30 searches for workflow integration")
    parser.add_argument("--queries-json", help="JSON file containing query objects")
    parser.add_argument(
        "--query",
        action="append",
        default=[],
        help="Inline query text; may be repeated when --queries-json is not used",
    )
    parser.add_argument("--days", type=int, default=3650, help="Search horizon in days")
    parser.add_argument(
        "--sources",
        default="all",
        help="research30 source mode: all/preprints/pubmed/huggingface/openalex/semanticscholar/biorxiv/medrxiv/arxiv",
    )
    parser.add_argument(
        "--depth",
        choices=["quick", "default", "deep"],
        default="default",
        help="Search depth",
    )
    parser.add_argument("--top-k", type=int, default=10, help="Top results per query")
    parser.add_argument("--mock", action="store_true", help="Use research30 mock fixtures")
    return parser.parse_args()


def discover_research30_script() -> Path | None:
    explicit_script = os.environ.get("OPENCLAW_RESEARCH30_SCRIPT") or os.environ.get(
        "RESEARCH30_SCRIPT"
    )
    if explicit_script:
        candidate = Path(explicit_script).expanduser()
        if candidate.is_file():
            return candidate.resolve()

    explicit_home = os.environ.get("OPENCLAW_RESEARCH30_HOME") or os.environ.get(
        "RESEARCH30_HOME"
    )
    candidates: list[Path] = []
    if explicit_home:
        candidates.append(Path(explicit_home).expanduser())

    home = Path.home()
    candidates.extend(
        [
            home / ".claude" / "skills" / "research30",
            home / ".codex" / "skills" / "research30",
            home / ".local" / "share" / "research30",
            Path("/tmp/research30/research30"),
            Path("/tmp/research30"),
        ]
    )

    for candidate in candidates:
        for root in [candidate, candidate / "research30"]:
            script = root / "scripts" / "research30.py"
            if script.is_file():
                return script.resolve()
    return None


def load_research30_module(script_path: Path):
    spec = importlib.util.spec_from_file_location(
        "openclaw_research30_bridge_module", script_path
    )
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Failed to load research30 module from {script_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def normalize_depth_flags(depth: str) -> dict[str, bool]:
    return {
        "quick": depth == "quick",
        "deep": depth == "deep",
    }


def flatten_report_items(report: dict[str, Any]) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for source_field in SOURCE_FIELDS:
        for raw_item in report.get(source_field, []):
            if not isinstance(raw_item, dict):
                continue
            engagement = raw_item.get("engagement")
            engagement = engagement if isinstance(engagement, dict) else {}
            flattened = {
                "source": source_field,
                "title": raw_item.get("title"),
                "authors": raw_item.get("authors") or raw_item.get("author"),
                "abstract": raw_item.get("abstract"),
                "url": raw_item.get("url"),
                "doi": raw_item.get("doi") or engagement.get("published_doi"),
                "venue": raw_item.get("journal")
                or raw_item.get("source_name")
                or raw_item.get("venue")
                or engagement.get("published_journal"),
                "date": raw_item.get("date"),
                "score": raw_item.get("score"),
                "why_relevant": raw_item.get("why_relevant"),
                "metadata": raw_item,
            }
            items.append(flattened)
    items.sort(
        key=lambda item: (
            -(int(item.get("score") or 0)),
            str(item.get("date") or ""),
            str(item.get("title") or ""),
        )
    )
    return items


def source_counts(report: dict[str, Any]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for source_field in SOURCE_FIELDS:
        values = report.get(source_field, [])
        counts[source_field] = len(values) if isinstance(values, list) else 0
    return counts


def build_query_payload(entry: dict[str, Any]) -> dict[str, Any]:
    return {
        "query": str(entry.get("query") or "").strip(),
        "domain": str(entry.get("domain") or "").strip() or None,
        "rationale": str(entry.get("rationale") or "").strip() or None,
        "entry_key": str(entry.get("entry_key") or "").strip() or None,
        "expected_year": str(entry.get("expected_year") or "").strip() or None,
        "expected_authors": str(entry.get("expected_authors") or "").strip() or None,
        "expected_title": str(entry.get("expected_title") or "").strip() or None,
    }


def load_queries(args: argparse.Namespace) -> list[dict[str, Any]]:
    queries: list[dict[str, Any]] = []
    if args.queries_json:
        payload = read_json(Path(args.queries_json).expanduser().resolve())
        if not isinstance(payload, list):
            raise ValueError("--queries-json must contain a JSON array")
        for entry in payload:
            if isinstance(entry, dict):
                queries.append(build_query_payload(entry))
    for raw_query in args.query:
        raw = str(raw_query or "").strip()
        if raw:
            queries.append(build_query_payload({"query": raw}))
    deduped: list[dict[str, Any]] = []
    seen = set()
    for entry in queries:
        query = entry.get("query")
        if not query:
            continue
        key = (
            str(entry.get("domain") or "").lower(),
            str(query).lower(),
            str(entry.get("entry_key") or "").lower(),
        )
        if key in seen:
            continue
        seen.add(key)
        deduped.append(entry)
    return deduped


def build_report_from_raw(module, topic: str, from_date: str, to_date: str, mode: str, raw_results):
    openalex_items = module.normalize.normalize_openalex_items(
        raw_results.get("openalex", ([], None))[0], from_date, to_date
    )
    s2_items = module.normalize.normalize_semanticscholar_items(
        raw_results.get("semanticscholar", ([], None))[0], from_date, to_date
    )
    biorxiv_items = module.normalize.normalize_biorxiv_items(
        raw_results.get("biorxiv", ([], None))[0], from_date, to_date, "biorxiv"
    )
    medrxiv_items = module.normalize.normalize_biorxiv_items(
        raw_results.get("medrxiv", ([], None))[0], from_date, to_date, "medrxiv"
    )
    arxiv_items = module.normalize.normalize_arxiv_items(
        raw_results.get("arxiv", ([], None))[0], from_date, to_date
    )
    pubmed_items = module.normalize.normalize_pubmed_items(
        raw_results.get("pubmed", ([], None))[0], from_date, to_date
    )
    hf_items = module.normalize.normalize_huggingface_items(
        raw_results.get("huggingface", ([], None))[0], from_date, to_date
    )

    openalex_items = module.normalize.filter_by_date_range(openalex_items, from_date, to_date)
    s2_items = module.normalize.filter_by_date_range(s2_items, from_date, to_date)
    biorxiv_items = module.normalize.filter_by_date_range(biorxiv_items, from_date, to_date)
    medrxiv_items = module.normalize.filter_by_date_range(medrxiv_items, from_date, to_date)
    arxiv_items = module.normalize.filter_by_date_range(arxiv_items, from_date, to_date)
    pubmed_items = module.normalize.filter_by_date_range(pubmed_items, from_date, to_date)
    hf_items = module.normalize.filter_by_date_range(hf_items, from_date, to_date)

    openalex_items = module.score.score_openalex_items(openalex_items)
    s2_items = module.score.score_semanticscholar_items(s2_items)
    biorxiv_items = module.score.score_biorxiv_items(biorxiv_items)
    medrxiv_items = module.score.score_biorxiv_items(medrxiv_items)
    arxiv_items = module.score.score_arxiv_items(arxiv_items)
    pubmed_items = module.score.score_pubmed_items(pubmed_items)
    hf_items = module.score.score_huggingface_items(hf_items)

    openalex_items = module.score.sort_items(openalex_items)
    s2_items = module.score.sort_items(s2_items)
    biorxiv_items = module.score.sort_items(biorxiv_items)
    medrxiv_items = module.score.sort_items(medrxiv_items)
    arxiv_items = module.score.sort_items(arxiv_items)
    pubmed_items = module.score.sort_items(pubmed_items)
    hf_items = module.score.sort_items(hf_items)

    openalex_items = module.dedupe.dedupe_within_source(openalex_items)
    s2_items = module.dedupe.dedupe_within_source(s2_items)
    biorxiv_items = module.dedupe.dedupe_within_source(biorxiv_items)
    medrxiv_items = module.dedupe.dedupe_within_source(medrxiv_items)
    arxiv_items = module.dedupe.dedupe_within_source(arxiv_items)
    pubmed_items = module.dedupe.dedupe_within_source(pubmed_items)
    hf_items = module.dedupe.dedupe_within_source(hf_items)

    deduped_all = module.dedupe.dedupe_cross_source(
        openalex_items
        + s2_items
        + biorxiv_items
        + medrxiv_items
        + arxiv_items
        + pubmed_items
        + hf_items
    )

    report = module.schema.create_report(topic, from_date, to_date, mode)
    report.openalex = [item for item in deduped_all if type(item).__name__ == "OpenAlexItem"]
    report.semanticscholar = [
        item for item in deduped_all if type(item).__name__ == "SemanticScholarItem"
    ]
    report.biorxiv = [
        item
        for item in deduped_all
        if type(item).__name__ == "BiorxivItem" and getattr(item, "source", "") == "biorxiv"
    ]
    report.medrxiv = [
        item
        for item in deduped_all
        if type(item).__name__ == "BiorxivItem" and getattr(item, "source", "") == "medrxiv"
    ]
    report.arxiv = [item for item in deduped_all if type(item).__name__ == "ArxivItem"]
    report.pubmed = [item for item in deduped_all if type(item).__name__ == "PubmedItem"]
    report.huggingface = [
        item for item in deduped_all if type(item).__name__ == "HuggingFaceItem"
    ]

    for source_field in SOURCE_FIELDS:
        if source_field in raw_results:
            _, error = raw_results[source_field]
            if error:
                setattr(report, f"{source_field}_error", error)
    return report.to_dict()


def run_single_query(module, query_entry: dict[str, Any], args: argparse.Namespace) -> dict[str, Any]:
    query = str(query_entry.get("query") or "").strip()
    if not query:
        raise ValueError("research30 query is empty")
    from_date, to_date = module.dates.get_date_range(max(1, int(args.days)))
    config = module.env.get_config()
    sources_set = module.determine_sources(args.sources)
    raw_results = module.run_research(
        query,
        sources_set,
        config,
        from_date,
        to_date,
        depth=args.depth,
        mock=args.mock,
        progress=None,
    )
    report = build_report_from_raw(
        module,
        topic=query,
        from_date=from_date,
        to_date=to_date,
        mode=args.sources,
        raw_results=raw_results,
    )
    flattened = flatten_report_items(report)
    return {
        "query": query,
        "domain": query_entry.get("domain"),
        "rationale": query_entry.get("rationale"),
        "entry_key": query_entry.get("entry_key"),
        "expected_year": query_entry.get("expected_year"),
        "expected_authors": query_entry.get("expected_authors"),
        "expected_title": query_entry.get("expected_title"),
        "range": report.get("range", {}),
        "source_counts": source_counts(report),
        "total_results": len(flattened),
        "top_score": flattened[0].get("score") if flattened else None,
        "top_results": flattened[: max(1, int(args.top_k))],
        "report": report,
    }


def summarize_queries(query_results: list[dict[str, Any]], days: int, sources: str, depth: str):
    domains = sorted(
        {
            str(entry.get("domain"))
            for entry in query_results
            if entry.get("domain")
        }
    )
    total_top_results = sum(len(entry.get("top_results") or []) for entry in query_results)
    all_sources = sorted(
        {
            source
            for entry in query_results
            for source, count in (entry.get("source_counts") or {}).items()
            if isinstance(count, int) and count > 0
        }
    )
    return {
        "query_count": len(query_results),
        "domain_count": len(domains),
        "domains": domains,
        "total_top_results": total_top_results,
        "days": days,
        "sources": sources,
        "depth": depth,
        "backend": "research30",
        "source_coverage": all_sources,
    }


def main() -> int:
    args = parse_args()
    queries = load_queries(args)
    if not queries:
        print(json.dumps({"error": "No queries provided"}))
        return 2

    script_path = discover_research30_script()
    if script_path is None:
        print(
            json.dumps(
                {
                    "backend": "research30",
                    "available": False,
                    "error": "research30 installation not found",
                    "queries": queries,
                },
                indent=2,
            )
        )
        return 1

    module = load_research30_module(script_path)
    query_results = [run_single_query(module, entry, args) for entry in queries]
    payload = {
        "backend": "research30",
        "available": True,
        "script_path": str(script_path),
        "queries": query_results,
        "summary": summarize_queries(
            query_results=query_results,
            days=max(1, int(args.days)),
            sources=args.sources,
            depth=args.depth,
        ),
    }
    print(json.dumps(payload, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
