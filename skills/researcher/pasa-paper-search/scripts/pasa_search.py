#!/usr/bin/env python3
"""Query PASA (Paper Search Agent) from the terminal."""

from __future__ import annotations

import argparse
import json
import random
import sys
import time
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen


API_BASE = "https://pasa-agent.ai/paper-agent/api/v1"
USER_AGENT = "codex-pasa-paper-search/1.0"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Search PASA from the command line or resume an existing PASA home URL."
        )
    )
    parser.add_argument(
        "query_or_url",
        nargs="?",
        help="English query text or a full PASA home URL containing query/session.",
    )
    parser.add_argument(
        "--session-id",
        help="Existing PASA session ID to poll or reuse.",
    )
    parser.add_argument(
        "--global-id",
        help="Optional PASA global ID. A fresh one is generated when omitted.",
    )
    parser.add_argument(
        "--start-search",
        action="store_true",
        help="Force a new search request before polling, even if a session URL was provided.",
    )
    parser.add_argument(
        "--resume-only",
        action="store_true",
        help="Do not start a new search; only poll the existing session.",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=45.0,
        help="Maximum total polling time in seconds. Default: 45.",
    )
    parser.add_argument(
        "--poll-interval",
        type=float,
        default=1.0,
        help="Seconds between PASA polling requests. Default: 1.",
    )
    parser.add_argument(
        "--request-timeout",
        type=float,
        default=20.0,
        help="Per-request timeout in seconds. Default: 20.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=20,
        help="Maximum number of results to emit. Use 0 for all results. Default: 20.",
    )
    parser.add_argument(
        "--min-year",
        type=int,
        help="Drop papers published before this year.",
    )
    parser.add_argument(
        "--max-year",
        type=int,
        help="Drop papers published after this year.",
    )
    parser.add_argument(
        "--format",
        choices=("json", "markdown"),
        default="json",
        help="Output format. Default: json.",
    )
    parser.add_argument(
        "--save-json",
        type=Path,
        help="Optional path to save the emitted JSON payload.",
    )
    parser.add_argument(
        "--save-bib",
        type=Path,
        help="Optional path to save BibTeX for the emitted results.",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Print polling progress to stderr.",
    )
    return parser


def generate_id() -> str:
    return f"{int(time.time() * 1000)}{random.randint(100000, 999999)}"


def parse_home_url(value: str) -> tuple[str | None, str | None]:
    parsed = urlparse(value)
    if not parsed.scheme or not parsed.netloc:
        raise ValueError(f"Not a valid URL: {value}")
    params = parse_qs(parsed.query)
    query = params.get("query", [None])[0]
    session_id = params.get("session", [None])[0]
    return query, session_id


def is_url(value: str | None) -> bool:
    return bool(value and value.startswith(("http://", "https://")))


def post_json(endpoint: str, payload: dict[str, Any], timeout: float) -> dict[str, Any]:
    request = Request(
        f"{API_BASE}/{endpoint}",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "content-type": "application/json",
            "user-agent": USER_AGENT,
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code} calling {endpoint}: {body}") from exc
    except URLError as exc:
        raise RuntimeError(f"Network error calling {endpoint}: {exc}") from exc


def parse_embedded_json(value: Any) -> dict[str, Any]:
    if not value:
        return {}
    if isinstance(value, dict):
        return value
    if not isinstance(value, str):
        return {}
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def normalize_paper(raw: dict[str, Any]) -> dict[str, Any]:
    paper_id = raw.get("entry_id") or raw.get("paper_id") or ""
    publish_time = str(raw.get("publish_time") or "")
    embedded = parse_embedded_json(raw.get("json_result"))
    link = embedded.get("link") or (f"https://www.arxiv.org/abs/{paper_id}" if paper_id else "")
    authors = raw.get("authors") or embedded.get("authors") or []
    if not isinstance(authors, list):
        authors = [str(authors)]
    year = None
    if len(publish_time) >= 4 and publish_time[:4].isdigit():
        year = int(publish_time[:4])
    select_reason = raw.get("select_reason")
    if isinstance(select_reason, str):
        select_reason = select_reason.lower() == "true"

    return {
        "paper_id": paper_id,
        "title": raw.get("title") or embedded.get("title") or "",
        "authors": authors,
        "publish_time": publish_time,
        "year": year,
        "score": float(raw.get("score") or embedded.get("score") or 0.0),
        "abstract": raw.get("abstract") or embedded.get("abstract") or "",
        "link": link,
        "source": raw.get("source"),
        "selected_by_pasa": bool(select_reason),
        "user_query": raw.get("user_query"),
        "bib_result": raw.get("bib_result") or "",
        "json_result": embedded,
    }


def collect_results(response: dict[str, Any]) -> list[dict[str, Any]]:
    raw_papers = parse_embedded_json(response.get("papers"))
    papers: list[dict[str, Any]] = []
    for item in raw_papers.values():
        if isinstance(item, dict) and not item.get("stop"):
            papers.append(normalize_paper(item))
    papers.sort(key=lambda item: item.get("score", 0.0), reverse=True)
    for index, paper in enumerate(papers, start=1):
        paper["rank"] = index
    return papers


def filter_results(
    papers: list[dict[str, Any]],
    min_year: int | None,
    max_year: int | None,
    limit: int,
) -> list[dict[str, Any]]:
    filtered: list[dict[str, Any]] = []
    for paper in papers:
        year = paper.get("year")
        if min_year is not None and year is not None and year < min_year:
            continue
        if max_year is not None and year is not None and year > max_year:
            continue
        filtered.append(paper)
    if limit > 0:
        filtered = filtered[:limit]
    for index, paper in enumerate(filtered, start=1):
        paper["rank"] = index
    return filtered


def infer_query(query: str | None, papers: list[dict[str, Any]]) -> str | None:
    if query:
        return query
    for paper in papers:
        candidate = paper.get("user_query")
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()
    return query


def render_markdown(payload: dict[str, Any]) -> str:
    lines = [
        "# PASA Search Results",
        "",
        f"- query: {payload.get('query') or ''}",
        f"- session_id: {payload.get('session_id')}",
        f"- finished: {payload.get('finished')}",
        f"- returned_results: {payload.get('returned_results')}",
        f"- total_results: {payload.get('total_results')}",
        "",
    ]
    for paper in payload.get("results", []):
        authors = ", ".join(paper.get("authors") or [])
        lines.extend(
            [
                f"{paper['rank']}. [{paper.get('title') or paper.get('paper_id')}]({paper.get('link')})",
                f"paper_id: {paper.get('paper_id')}",
                f"score: {paper.get('score')}",
                f"publish_time: {paper.get('publish_time')}",
                f"authors: {authors}",
                f"abstract: {paper.get('abstract')}",
                "",
            ]
        )
    if not payload.get("results"):
        lines.append("No papers matched the current filters.")
    return "\n".join(lines).rstrip() + "\n"


def maybe_write_json(path: Path | None, payload: dict[str, Any]) -> None:
    if path is None:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def maybe_write_bib(path: Path | None, papers: list[dict[str, Any]]) -> None:
    if path is None:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    bib = "\n".join(paper["bib_result"].strip() for paper in papers if paper.get("bib_result"))
    path.write_text((bib.strip() + "\n") if bib else "", encoding="utf-8")


def log(verbose: bool, message: str) -> None:
    if verbose:
        print(message, file=sys.stderr)


def resolve_inputs(args: argparse.Namespace) -> tuple[str | None, str | None, bool]:
    parsed_query = None
    parsed_session = None
    source_is_url = is_url(args.query_or_url)
    if source_is_url and args.query_or_url:
        parsed_query, parsed_session = parse_home_url(args.query_or_url)

    query = None
    if args.query_or_url and not source_is_url:
        query = args.query_or_url.strip()
    elif parsed_query:
        query = parsed_query

    session_id = args.session_id or parsed_session

    if args.resume_only:
        should_start = False
    elif args.start_search:
        should_start = True
    else:
        should_start = bool(query and not source_is_url)

    return query, session_id, should_start


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    query, session_id, should_start = resolve_inputs(args)

    if should_start and not query:
        parser.error("A query is required when starting a new search.")
    if not should_start and not session_id:
        parser.error("Provide a PASA home URL or --session-id when resuming an existing search.")

    global_id = args.global_id or generate_id()
    if should_start and not session_id:
        session_id = generate_id()

    if should_start:
        log(args.verbose, f"Starting PASA search with session {session_id}...")
        post_json(
            "single_paper_agent",
            {
                "user_query": query,
                "session_id": session_id,
                "global_id": global_id,
            },
            args.request_timeout,
        )

    assert session_id is not None
    deadline = time.time() + max(args.timeout, 0.0)
    latest_response: dict[str, Any] | None = None
    latest_papers: list[dict[str, Any]] = []

    while True:
        latest_response = post_json(
            "single_get_result",
            {"session_id": session_id},
            args.request_timeout,
        )
        latest_papers = collect_results(latest_response)
        finished = bool(latest_response.get("finish"))
        log(
            args.verbose,
            f"Polled {len(latest_papers)} papers from session {session_id}; finished={finished}",
        )
        if finished or time.time() >= deadline:
            break
        time.sleep(max(args.poll_interval, 0.0))

    if latest_response is None:
        raise RuntimeError("No PASA response received.")

    query = infer_query(query, latest_papers)
    filtered = filter_results(latest_papers, args.min_year, args.max_year, args.limit)
    payload = {
        "query": query,
        "session_id": session_id,
        "global_id": global_id,
        "finished": bool(latest_response.get("finish")),
        "timed_out": not bool(latest_response.get("finish")),
        "total_results": len(latest_papers),
        "returned_results": len(filtered),
        "filters": {
            "min_year": args.min_year,
            "max_year": args.max_year,
            "limit": args.limit,
        },
        "results": filtered,
    }

    maybe_write_json(args.save_json, payload)
    maybe_write_bib(args.save_bib, filtered)

    if args.format == "markdown":
        sys.stdout.write(render_markdown(payload))
    else:
        sys.stdout.write(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("Interrupted.", file=sys.stderr)
        raise SystemExit(130)
    except Exception as exc:  # pragma: no cover - CLI guard
        print(f"Error: {exc}", file=sys.stderr)
        raise SystemExit(1)
