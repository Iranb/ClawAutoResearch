#!/usr/bin/env python3
"""
Stage local PaperNexus source files onto a remote host over SSH.

This makes project-local PDF/Markdown staging usable by a remote-only
PaperNexus deployment that cannot read the local workstation filesystem.
"""

from __future__ import annotations

import argparse
import json
import os
import shlex
import subprocess
import sys
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Stage local PaperNexus sources to a remote host")
    parser.add_argument("--ssh-target", required=True, help="SSH target, e.g. hyq@10.126.56.30")
    parser.add_argument("--remote-base-dir", required=True, help="Remote base directory for staged sources")
    parser.add_argument("--project-id", required=True, help="Project identifier used under the remote base dir")
    parser.add_argument("--source", action="append", default=[], help="Local source file; may be repeated")
    parser.add_argument("--manifest", help="Local manifest JSON containing source/source_path fields")
    parser.add_argument("--rewrite-manifest-out", help="Output path for a manifest rewritten with server_file_path fields")
    parser.add_argument(
        "--timeout-seconds",
        type=int,
        default=int(os.environ.get("OPENCLAW_PAPERNEXUS_STAGE_TIMEOUT_SECONDS", "60")),
        help="SSH command timeout in seconds (default: 60)",
    )
    return parser.parse_args()


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def write_text(path: Path, value: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(value, encoding="utf-8")


def run_ssh(command: list[str], *, input_bytes: bytes | None, timeout_seconds: int) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        input=input_bytes,
        capture_output=True,
        text=False,
        timeout=timeout_seconds,
        check=False,
    )


def detect_source_kind(source_path: Path) -> str:
    lower = source_path.name.lower()
    if lower.endswith(".md"):
        return "markdown"
    if lower.endswith(".pdf"):
        return "pdf"
    return "unknown"


def build_remote_path(remote_base_dir: str, project_id: str, source_path: Path) -> str:
    kind = detect_source_kind(source_path)
    subdir = "md" if kind == "markdown" else "pdf" if kind == "pdf" else "files"
    return f"{remote_base_dir.rstrip('/')}/{project_id}/{subdir}/{source_path.name}"


def collect_manifest_sources(manifest_path: Path) -> list[tuple[str | None, Path]]:
    payload = json.loads(read_text(manifest_path))
    entries = payload.get("papers") if isinstance(payload, dict) else payload if isinstance(payload, list) else []
    collected: list[tuple[str | None, Path]] = []
    manifest_dir = manifest_path.parent
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        source = entry.get("source") or entry.get("source_path") or entry.get("file") or entry.get("file_path")
        if not isinstance(source, str) or not source.strip():
            continue
        source_path = Path(source)
        resolved = source_path if source_path.is_absolute() else (manifest_dir / source_path).resolve()
        paper_id = entry.get("paper_id") or entry.get("paperId") or entry.get("canonical_id")
        collected.append((str(paper_id) if paper_id else None, resolved))
    return collected


def rewrite_manifest(payload: object, remote_paths: dict[str, str]) -> object:
    if isinstance(payload, list):
        rewritten = []
        for entry in payload:
            rewritten.append(rewrite_manifest_entry(entry, remote_paths))
        return rewritten
    if isinstance(payload, dict):
        rewritten = dict(payload)
        if isinstance(payload.get("papers"), list):
            rewritten["papers"] = [
                rewrite_manifest_entry(entry, remote_paths)
                for entry in payload["papers"]
            ]
        return rewritten
    return payload


def rewrite_manifest_entry(entry: object, remote_paths: dict[str, str]) -> object:
    if not isinstance(entry, dict):
        return entry
    rewritten = dict(entry)
    source = entry.get("source") or entry.get("source_path") or entry.get("file") or entry.get("file_path")
    if isinstance(source, str):
        remote_path = remote_paths.get(source)
        if remote_path is None:
            try:
                remote_path = remote_paths.get(
                    str(Path(source).expanduser().resolve())
                )
            except FileNotFoundError:
                remote_path = None
        if remote_path:
            rewritten["server_file_path"] = remote_path
    return rewritten


def main() -> int:
    args = parse_args()
    timeout_seconds = max(5, int(args.timeout_seconds))

    staged_sources: list[tuple[str | None, Path]] = []
    for raw_source in args.source:
        if raw_source:
            staged_sources.append((None, Path(raw_source).expanduser().resolve()))
    manifest_payload = None
    if args.manifest:
        manifest_path = Path(args.manifest).expanduser().resolve()
        manifest_payload = json.loads(read_text(manifest_path))
        staged_sources.extend(collect_manifest_sources(manifest_path))

    if not staged_sources:
        print(json.dumps({"error": "No local sources were provided"}, indent=2))
        return 2

    uploads = []
    remote_paths_by_source: dict[str, str] = {}
    for paper_id, source_path in staged_sources:
        source_path = source_path.expanduser().resolve()
        if not source_path.is_file():
            uploads.append(
                {
                    "paper_id": paper_id,
                    "local_path": str(source_path),
                    "status": "missing",
                    "remote_path": None,
                    "error": "Local source file does not exist",
                }
            )
            continue

        remote_path = build_remote_path(args.remote_base_dir, args.project_id, source_path)
        mkdir_command = [
            "ssh",
            args.ssh_target,
            f"mkdir -p {shlex.quote(str(Path(remote_path).parent))}",
        ]
        mkdir_result = run_ssh(mkdir_command, input_bytes=None, timeout_seconds=timeout_seconds)
        if mkdir_result.returncode != 0:
            uploads.append(
                {
                    "paper_id": paper_id,
                    "local_path": str(source_path),
                    "status": "mkdir_failed",
                    "remote_path": remote_path,
                    "error": mkdir_result.stderr.decode("utf-8", errors="ignore"),
                }
            )
            continue

        upload_command = [
            "ssh",
            args.ssh_target,
            f"cat > {shlex.quote(remote_path)}",
        ]
        upload_result = run_ssh(
            upload_command,
            input_bytes=source_path.read_bytes(),
            timeout_seconds=timeout_seconds,
        )
        if upload_result.returncode != 0:
            uploads.append(
                {
                    "paper_id": paper_id,
                    "local_path": str(source_path),
                    "status": "upload_failed",
                    "remote_path": remote_path,
                    "error": upload_result.stderr.decode("utf-8", errors="ignore"),
                }
            )
            continue

        remote_paths_by_source[str(source_path)] = remote_path
        uploads.append(
            {
                "paper_id": paper_id,
                "local_path": str(source_path),
                "status": "uploaded",
                "remote_path": remote_path,
                "size_bytes": source_path.stat().st_size,
                "source_kind": detect_source_kind(source_path),
            }
        )

    rewritten_manifest_out = None
    if args.rewrite_manifest_out and manifest_payload is not None:
        rewritten_manifest = rewrite_manifest(manifest_payload, remote_paths_by_source)
        rewritten_manifest_out = str(Path(args.rewrite_manifest_out).expanduser().resolve())
        write_text(Path(rewritten_manifest_out), json.dumps(rewritten_manifest, indent=2) + "\n")

    payload = {
        "ssh_target": args.ssh_target,
        "remote_base_dir": args.remote_base_dir,
        "project_id": args.project_id,
        "timeout_seconds": timeout_seconds,
        "uploads": uploads,
        "rewrite_manifest_out": rewritten_manifest_out,
    }
    print(json.dumps(payload, indent=2))
    if any(entry.get("status") != "uploaded" for entry in uploads):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
