#!/usr/bin/env python3
"""
Citation calibration pipeline based on Reffix and bibtex-dblp.

Goals:
- normalize and repair an input BibTeX file using DBLP-backed tools
- generate a deterministic JSON + Markdown verification report
- flag placeholder / suspicious / weakly grounded entries before reviewer gate

This script is intentionally conservative:
- no entry is silently deleted
- tool execution is optional and detected dynamically
- reports explain which tools ran and what still needs manual attention
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import sysconfig
import tempfile
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Iterable


PLACEHOLDER_PATTERNS = [
    re.compile(r"\bunknown\b", re.I),
    re.compile(r"\bplaceholder\b", re.I),
    re.compile(r"\btbd\b", re.I),
    re.compile(r"\btodo\b", re.I),
    re.compile(r"\?\?\?"),
]


@dataclass
class ToolRun:
    name: str
    available: bool
    command: list[str]
    ran: bool
    timed_out: bool
    returncode: int | None
    stdout: str
    stderr: str
    output_path: str | None


@dataclass
class BibEntryCheck:
    key: str
    entry_type: str
    title: str | None
    authors: str | None
    year: str | None
    venue: str | None
    has_provenance: bool
    status: str
    issues: list[str]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Calibrate refs.bib with Reffix + bibtex-dblp")
    parser.add_argument("--bib", required=True, help="Input BibTeX file")
    parser.add_argument("--out", help="Output calibrated BibTeX path (default: <input>.calibrated.bib)")
    parser.add_argument("--report-json", help="JSON report path")
    parser.add_argument("--report-md", help="Markdown report path")
    parser.add_argument(
        "--replace-arxiv",
        action="store_true",
        help="Ask Reffix to prefer published venue versions over arXiv preprints",
    )
    parser.add_argument(
        "--dblp-format",
        default="condensed_doi",
        help="bibtex-dblp format for update_from_dblp / convert_dblp",
    )
    parser.add_argument(
        "--research30-days",
        type=int,
        default=int(os.environ.get("OPENCLAW_RESEARCH30_DAYS", "3650")),
        help="Search horizon in days when validating citations through research30 (default: 3650)",
    )
    parser.add_argument(
        "--research30-sources",
        default=os.environ.get("OPENCLAW_RESEARCH30_SOURCES", "all"),
        help="Source mode for research30 validation (default: all)",
    )
    parser.add_argument(
        "--research30-depth",
        choices=("quick", "default", "deep"),
        default=os.environ.get("OPENCLAW_RESEARCH30_DEPTH", "quick"),
        help="Depth for research30 validation (default: quick)",
    )
    parser.add_argument(
        "--enable-dblp-fallback",
        action="store_true",
        default=os.environ.get("OPENCLAW_ENABLE_DBLP_FALLBACK", "").lower() in {"1", "true", "yes"},
        help="Run update_from_dblp as an optional fallback after research30 validation",
    )
    parser.add_argument(
        "--keep-intermediate",
        action="store_true",
        help="Preserve intermediate .reffix.bib / .dblp.bib files",
    )
    parser.add_argument(
        "--tool-timeout-seconds",
        type=int,
        default=int(os.environ.get("OPENCLAW_CITATION_TOOL_TIMEOUT_SECONDS", "60")),
        help="Per-tool subprocess timeout in seconds (default: 60)",
    )
    return parser.parse_args()


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def discover_user_bin_dirs() -> list[Path]:
    discovered: list[Path] = []
    seen: set[str] = set()

    def add(candidate: str | Path | None) -> None:
        if candidate is None:
            return
        candidate_path = Path(candidate).expanduser()
        try:
            resolved = candidate_path.resolve()
        except FileNotFoundError:
            return
        if not resolved.is_dir():
            return
        key = str(resolved)
        if key in seen:
            return
        seen.add(key)
        discovered.append(resolved)

    for entry in os.environ.get("PATH", "").split(os.pathsep):
        if entry:
            add(entry)

    for scheme in (None, "posix_user"):
        try:
            if scheme is None:
                add(sysconfig.get_path("scripts"))
            else:
                add(sysconfig.get_path("scripts", scheme=scheme))
        except (KeyError, TypeError):
            continue

    user_base = os.environ.get("PYTHONUSERBASE")
    if user_base:
        add(Path(user_base) / "bin")

    home = Path.home()
    add(home / ".local" / "bin")
    library_python = home / "Library" / "Python"
    if library_python.is_dir():
        for version_dir in sorted(library_python.iterdir()):
            add(version_dir / "bin")

    return discovered


def resolve_command(command_name: str) -> str | None:
    direct = shutil.which(command_name)
    if direct:
        return direct

    for candidate_dir in discover_user_bin_dirs():
        candidate = candidate_dir / command_name
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return str(candidate)
    return None


def run_command(
    command: list[str],
    output_path: Path | None = None,
    timeout_seconds: int | None = None,
) -> ToolRun:
    resolved_command = resolve_command(command[0])
    if resolved_command is None:
        return ToolRun(
            name=command[0],
            available=False,
            command=command,
            ran=False,
            timed_out=False,
            returncode=None,
            stdout="",
            stderr=f"{command[0]} not found in PATH or known user bin directories",
            output_path=str(output_path) if output_path else None,
        )

    resolved_invocation = [resolved_command, *command[1:]]
    try:
        completed = subprocess.run(
            resolved_invocation,
            check=False,
            text=True,
            capture_output=True,
            timeout=timeout_seconds,
        )
    except subprocess.TimeoutExpired as error:
        stdout = error.stdout if isinstance(error.stdout, str) else ""
        stderr = error.stderr if isinstance(error.stderr, str) else ""
        timeout_message = f"Timed out after {timeout_seconds}s"
        if stderr:
            stderr = f"{stderr.rstrip()}\n{timeout_message}"
        else:
            stderr = timeout_message
        return ToolRun(
            name=command[0],
            available=True,
            command=resolved_invocation,
            ran=True,
            timed_out=True,
            returncode=124,
            stdout=stdout,
            stderr=stderr,
            output_path=str(output_path) if output_path else None,
        )
    return ToolRun(
        name=command[0],
        available=True,
        command=resolved_invocation,
        ran=True,
        timed_out=False,
        returncode=completed.returncode,
        stdout=completed.stdout,
        stderr=completed.stderr,
        output_path=str(output_path) if output_path else None,
    )


def bib_entries(raw: str) -> list[tuple[str, str]]:
    matches = list(re.finditer(r"(?m)^@\w+\s*{", raw))
    if not matches:
        return []
    chunks: list[tuple[str, str]] = []
    for index, match in enumerate(matches):
        start = match.start()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(raw)
        entry = raw[start:end].strip()
        header_match = re.match(r"@(\w+)\s*{\s*([^,]+),", entry, flags=re.S)
        if not header_match:
            continue
        chunks.append((header_match.group(1).strip(), entry))
    return chunks


def field_value(entry: str, field: str) -> str | None:
    match = re.search(rf"(?im)^\s*{re.escape(field)}\s*=\s*", entry)
    if not match:
        return None
    index = match.end()
    while index < len(entry) and entry[index].isspace():
        index += 1
    if index >= len(entry):
        return None

    if entry[index] == "{":
        start = index + 1
        depth = 0
        index += 1
        while index < len(entry):
            char = entry[index]
            if char == "{":
                depth += 1
            elif char == "}":
                if depth == 0:
                    value = entry[start:index].strip()
                    return value or None
                depth -= 1
            index += 1
        return entry[start:].strip() or None

    if entry[index] == '"':
        start = index + 1
        index += 1
        escaped = False
        while index < len(entry):
            char = entry[index]
            if char == '"' and not escaped:
                value = entry[start:index].strip()
                return value or None
            escaped = char == "\\" and not escaped
            if char != "\\":
                escaped = False
            index += 1
        return entry[start:].strip() or None

    start = index
    while index < len(entry) and entry[index] not in ",\n":
        index += 1
    value = entry[start:index].strip().rstrip(",").strip()
    return value or None


def contains_placeholder(value: str | None) -> bool:
    if not value:
        return False
    return any(pattern.search(value) for pattern in PLACEHOLDER_PATTERNS)


def normalize_text(value: str | None) -> str:
    return " ".join(
        re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).split()
    )


def title_similarity(left: str | None, right: str | None) -> float:
    left_normalized = normalize_text(left)
    right_normalized = normalize_text(right)
    if not left_normalized or not right_normalized:
        return 0.0
    if left_normalized == right_normalized:
        return 1.0
    left_tokens = set(left_normalized.split())
    right_tokens = set(right_normalized.split())
    if not left_tokens or not right_tokens:
        return 0.0
    overlap = len(left_tokens & right_tokens)
    union = len(left_tokens | right_tokens)
    return overlap / max(1, union)


def author_token_overlap(left: str | None, right: str | None) -> float:
    left_tokens = {
        token
        for token in normalize_text(left).split()
        if len(token) >= 3 and token not in {"and", "authors", "author"}
    }
    right_tokens = {
        token
        for token in normalize_text(right).split()
        if len(token) >= 3 and token not in {"and", "authors", "author"}
    }
    if not left_tokens or not right_tokens:
        return 0.0
    return len(left_tokens & right_tokens) / max(1, len(left_tokens))


def extract_year(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    match = re.search(r"\b(19|20)\d{2}\b", text)
    return match.group(0) if match else None


def sanitize_bib_value(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip().replace("{", "").replace("}", "")


def upsert_bib_field(entry: str, field: str, value: str) -> str:
    sanitized = sanitize_bib_value(value)
    if not sanitized:
        return entry
    replacement = f"  {field} = {{{sanitized}}},"
    pattern = re.compile(rf"(?im)^\s*{re.escape(field)}\s*=\s*(\{{.*?\}}|\".*?\"|[^,\n]+)\s*,?\s*$")
    if pattern.search(entry):
        return pattern.sub(replacement, entry, count=1)
    closing_index = entry.rfind("}")
    if closing_index == -1:
        return entry
    prefix = entry[:closing_index].rstrip()
    suffix = entry[closing_index:]
    if not prefix.endswith(","):
        prefix = f"{prefix},"
    return f"{prefix}\n{replacement}\n{suffix}"


def build_research30_queries(raw: str) -> list[dict[str, str]]:
    queries: list[dict[str, str]] = []
    for entry_type, entry in bib_entries(raw):
        key_match = re.match(rf"@{re.escape(entry_type)}\s*{{\s*([^,]+),", entry, flags=re.S)
        if not key_match:
            continue
        key = key_match.group(1).strip()
        title = field_value(entry, "title")
        authors = field_value(entry, "author")
        year = field_value(entry, "year")
        if not title:
            continue
        query = title
        if authors:
            first_author_token = normalize_text(authors).split()
            if first_author_token:
                query = f"{title} {first_author_token[0]}"
        queries.append(
            {
                "entry_key": key,
                "query": query,
                "expected_title": title,
                "expected_authors": authors or "",
                "expected_year": year or "",
            }
        )
    return queries


def select_research30_match(entry: BibEntryCheck, query_result: dict[str, object]) -> dict[str, object] | None:
    candidates = query_result.get("top_results")
    if not isinstance(candidates, list):
        return None
    ranked: list[tuple[float, dict[str, object]]] = []
    for raw_candidate in candidates:
        if not isinstance(raw_candidate, dict):
            continue
        candidate_title = raw_candidate.get("title")
        candidate_authors = raw_candidate.get("authors")
        candidate_year = extract_year(raw_candidate.get("date"))
        similarity = title_similarity(entry.title, str(candidate_title or ""))
        author_overlap = author_token_overlap(entry.authors, str(candidate_authors or ""))
        year_score = 0.0
        expected_year = extract_year(entry.year)
        if expected_year and candidate_year:
            year_score = (
                1.0
                if expected_year == candidate_year
                else 0.5 if abs(int(expected_year) - int(candidate_year)) <= 1 else 0.0
            )
        provenance_bonus = 1.0 if raw_candidate.get("doi") or raw_candidate.get("url") else 0.0
        search_score = float(raw_candidate.get("score") or 0) / 100.0
        combined = similarity * 0.6 + author_overlap * 0.15 + year_score * 0.1 + provenance_bonus * 0.1 + search_score * 0.05
        ranked.append((combined, raw_candidate))
    ranked.sort(key=lambda entry_pair: entry_pair[0], reverse=True)
    if not ranked:
        return None
    score, candidate = ranked[0]
    if score < 0.72:
        return None
    return candidate


def augment_bib_with_research30(raw: str, research30_payload: dict[str, object]) -> str:
    queries = research30_payload.get("queries")
    if not isinstance(queries, list):
        return raw
    query_map: dict[str, dict[str, object]] = {}
    for entry in queries:
        if not isinstance(entry, dict):
            continue
        key = str(entry.get("entry_key") or "").strip()
        if key:
            query_map[key] = entry

    updated_entries: list[str] = []
    for entry_type, entry in bib_entries(raw):
        key_match = re.match(rf"@{re.escape(entry_type)}\s*{{\s*([^,]+),", entry, flags=re.S)
        if not key_match:
            updated_entries.append(entry)
            continue
        key = key_match.group(1).strip()
        entry_check = BibEntryCheck(
            key=key,
            entry_type=entry_type,
            title=field_value(entry, "title"),
            authors=field_value(entry, "author"),
            year=field_value(entry, "year"),
            venue=field_value(entry, "booktitle") or field_value(entry, "journal"),
            has_provenance=any(field_value(entry, field) is not None for field in ("biburl", "doi", "url", "eprint")),
            status="pending",
            issues=[],
        )
        query_result = query_map.get(key)
        best_match = select_research30_match(entry_check, query_result) if query_result else None
        if best_match:
            if not field_value(entry, "doi") and isinstance(best_match.get("doi"), str):
                entry = upsert_bib_field(entry, "doi", best_match["doi"])
            if not field_value(entry, "url") and isinstance(best_match.get("url"), str):
                entry = upsert_bib_field(entry, "url", best_match["url"])
            if not entry_check.venue and isinstance(best_match.get("venue"), str):
                venue = str(best_match["venue"])
                target_field = "journal" if entry_type.lower() == "article" else "booktitle"
                entry = upsert_bib_field(entry, target_field, venue)
        updated_entries.append(entry.strip())
    return "\n\n".join(updated_entries) + "\n"


def check_entries(raw: str) -> list[BibEntryCheck]:
    checks: list[BibEntryCheck] = []
    for entry_type, entry in bib_entries(raw):
        key_match = re.match(rf"@{re.escape(entry_type)}\s*{{\s*([^,]+),", entry, flags=re.S)
        if not key_match:
            continue
        key = key_match.group(1).strip()
        title = field_value(entry, "title")
        authors = field_value(entry, "author")
        year = field_value(entry, "year")
        venue = field_value(entry, "booktitle") or field_value(entry, "journal")
        has_provenance = any(
            field_value(entry, field) is not None
            for field in ("biburl", "doi", "url", "eprint")
        )
        issues: list[str] = []
        if not title:
            issues.append("missing_title")
        if not authors:
            issues.append("missing_author")
        elif contains_placeholder(authors):
            issues.append("placeholder_author")
        if not year:
            issues.append("missing_year")
        if entry_type.lower() not in {"misc", "book"} and not venue:
            issues.append("missing_venue")
        if not has_provenance:
            issues.append("missing_provenance")

        if any(issue.startswith("placeholder") for issue in issues):
            status = "suspicious"
        elif any(issue in {"missing_title", "missing_author", "missing_year"} for issue in issues):
            status = "hallucinated"
        elif issues:
            status = "needs_review"
        else:
            status = "verified"
        checks.append(
            BibEntryCheck(
                key=key,
                entry_type=entry_type,
                title=title,
                authors=authors,
                year=year,
                venue=venue,
                has_provenance=has_provenance,
                status=status,
                issues=issues,
            )
        )
    return checks


def summarize_checks(checks: Iterable[BibEntryCheck]) -> dict[str, int]:
    summary = {"verified": 0, "needs_review": 0, "suspicious": 0, "hallucinated": 0}
    for check in checks:
        summary[check.status] = summary.get(check.status, 0) + 1
    return summary


def markdown_report(
    input_bib: Path,
    output_bib: Path,
    tool_runs: list[ToolRun],
    checks: list[BibEntryCheck],
) -> str:
    summary = summarize_checks(checks)
    lines = [
        "# Citation Calibration Report",
        "",
        f"- input_bib: `{input_bib}`",
        f"- output_bib: `{output_bib}`",
        "",
        "## Tool Pipeline",
        "",
    ]
    for run in tool_runs:
        status = (
            "skipped"
            if not run.available
            else "failed"
            if run.returncode not in (None, 0)
            else "ok"
        )
        lines.extend(
            [
                f"- `{run.name}`: {status}",
                f"  - command: `{' '.join(run.command)}`",
                f"  - output: `{run.output_path}`" if run.output_path else "  - output: n/a",
                f"  - stderr: `{run.stderr.strip() or 'none'}`",
            ]
        )
    lines.extend(
        [
            "",
            "## Summary",
            "",
            f"- verified: {summary.get('verified', 0)}",
            f"- needs_review: {summary.get('needs_review', 0)}",
            f"- suspicious: {summary.get('suspicious', 0)}",
            f"- hallucinated: {summary.get('hallucinated', 0)}",
            "",
            "## Entry Checks",
            "",
            "| key | status | year | venue | issues |",
            "| --- | --- | --- | --- | --- |",
        ]
    )
    for check in checks:
        lines.append(
            f"| {check.key} | {check.status} | {check.year or '—'} | {check.venue or '—'} | {', '.join(check.issues) or 'none'} |"
        )
    return "\n".join(lines) + "\n"


def main() -> int:
    args = parse_args()
    input_bib = Path(args.bib).expanduser().resolve()
    output_bib = (
        Path(args.out).expanduser().resolve()
        if args.out
        else input_bib.with_suffix(".calibrated.bib")
    )
    report_json = (
        Path(args.report_json).expanduser().resolve()
        if args.report_json
        else output_bib.with_suffix(".report.json")
    )
    report_md = (
        Path(args.report_md).expanduser().resolve()
        if args.report_md
        else output_bib.with_suffix(".report.md")
    )

    if not input_bib.exists():
        print(json.dumps({"error": f"Missing input bib: {input_bib}"}))
        return 2

    with tempfile.TemporaryDirectory(prefix="citation-calibrate-") as temp_dir_str:
        temp_dir = Path(temp_dir_str)
        reffix_out = temp_dir / f"{input_bib.stem}.reffix.bib"
        research30_queries_path = temp_dir / "research30-queries.json"
        research30_out = temp_dir / f"{input_bib.stem}.research30.bib"
        dblp_out = temp_dir / f"{input_bib.stem}.dblp.bib"

        reffix_command = ["reffix", str(input_bib), "-o", str(reffix_out)]
        if args.replace_arxiv:
            reffix_command.append("-a")
        reffix_run = run_command(
            reffix_command,
            reffix_out,
            timeout_seconds=args.tool_timeout_seconds,
        )

        current_source = reffix_out if reffix_run.returncode == 0 else input_bib

        research30_queries = build_research30_queries(read_text(current_source))
        write_text(
            research30_queries_path,
            json.dumps(research30_queries, indent=2) + "\n",
        )
        research30_command = [
            sys.executable,
            str(Path(__file__).with_name("research30_bridge.py")),
            "--queries-json",
            str(research30_queries_path),
            "--days",
            str(max(30, args.research30_days)),
            "--sources",
            args.research30_sources,
            "--depth",
            args.research30_depth,
            "--top-k",
            "5",
        ]
        research30_run = run_command(
            research30_command,
            research30_out,
            timeout_seconds=args.tool_timeout_seconds,
        )

        current_raw = read_text(current_source)
        if research30_run.returncode == 0 and research30_run.stdout.strip():
            research30_payload = json.loads(research30_run.stdout)
            augmented_raw = augment_bib_with_research30(current_raw, research30_payload)
            write_text(research30_out, augmented_raw)
            current_source = research30_out
        else:
            current_source = current_source

        dblp_run = ToolRun(
            name="update_from_dblp",
            available=args.enable_dblp_fallback,
            command=[],
            ran=False,
            timed_out=False,
            returncode=None,
            stdout="",
            stderr="DBLP fallback disabled",
            output_path=str(dblp_out),
        )
        if args.enable_dblp_fallback:
            dblp_command = [
                "update_from_dblp",
                str(current_source),
                "--out",
                str(dblp_out),
                "--format",
                args.dblp_format,
            ]
            dblp_run = run_command(
                dblp_command,
                dblp_out,
                timeout_seconds=args.tool_timeout_seconds,
            )
            if dblp_run.returncode == 0:
                current_source = dblp_out

        final_source = current_source

        final_raw = read_text(final_source)
        write_text(output_bib, final_raw)
        checks = check_entries(final_raw)
        summary = summarize_checks(checks)
        tool_runs = [reffix_run, research30_run, dblp_run]
        report = {
            "input_bib": str(input_bib),
            "output_bib": str(output_bib),
            "tool_runs": [asdict(run) for run in tool_runs],
            "summary": summary,
            "checks": [asdict(check) for check in checks],
        }
        write_text(report_json, json.dumps(report, indent=2) + "\n")
        write_text(report_md, markdown_report(input_bib, output_bib, tool_runs, checks))

        if args.keep_intermediate:
            if reffix_run.returncode == 0:
                write_text(input_bib.with_suffix(".reffix.bib"), read_text(reffix_out))
            if dblp_run.returncode == 0:
                write_text(input_bib.with_suffix(".dblp.bib"), read_text(dblp_out))

        print(json.dumps(report, indent=2))

        if summary.get("hallucinated", 0) > 0 or summary.get("suspicious", 0) > 0:
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
