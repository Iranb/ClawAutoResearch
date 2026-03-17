#!/usr/bin/env python3
"""
从 fetch_feeds 输出的条目中识别论文链接（arXiv、papers.cool、常见会议/期刊），
可选拉取摘要并输出结构化分析结果。
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

# 论文相关域名/路径特征
PAPER_PATTERNS = [
    (r"arxiv\.org/(?:abs|pdf)/([\d.]+)", "arxiv"),
    (r"papers\.cool/(?:arxiv|venue)/[^\s\"']+", "papers.cool"),
    (r"proceedings\.mlr\.press", "pmlr"),
    (r"openreview\.net", "openreview"),
    (r"aclanthology\.org", "acl"),
    (r"ieeexplore\.ieee\.org", "ieee"),
    (r"nature\.com", "nature"),
    (r"emergentmind\.com", "emergentmind"),
]


def is_paper_link(link: str) -> bool:
    if not (link or link.strip()):
        return False
    lower = link.strip().lower()
    for pattern, _ in PAPER_PATTERNS:
        if re.search(pattern, lower):
            return True
    return False


def extract_arxiv_id(link: str) -> str | None:
    # arxiv.org/abs/2401.00001 or pdf
    m = re.search(r"arxiv\.org/(?:abs|pdf)/([\d.]+)", link.strip(), re.I)
    if m:
        return m.group(1).replace(".", "")
    # papers.cool/arxiv/2402.12345
    m = re.search(r"papers\.cool/arxiv/([\d.]+)", link.strip(), re.I)
    if m:
        return m.group(1).replace(".", "")
    return None


def source_type(link: str) -> str:
    lower = link.strip().lower()
    for pattern, name in PAPER_PATTERNS:
        if re.search(pattern, lower):
            return name
    return "other"


def analyze_entries(entries: list[dict], fetch_abstracts: bool = False, max_abstracts: int = 50) -> list[dict]:
    """从条目中筛出论文并可选拉取摘要。"""
    papers: list[dict] = []
    abstract_count = 0
    for e in entries:
        link = (e.get("link") or "").strip()
        if not is_paper_link(link):
            continue
        arxiv_id = extract_arxiv_id(link)
        paper = {
            "title": (e.get("title") or "").strip() or link,
            "link": link,
            "source_feed": e.get("feed_title") or e.get("feed_url") or "",
            "source_type": source_type(link),
            "arxiv_id": arxiv_id,
            "published": e.get("published") or "",
            "summary_snippet": (e.get("summary") or "")[:500],
            "abstract": "",
        }
        if fetch_abstracts and abstract_count < max_abstracts and arxiv_id:
            # 可选：调用 papers-cool 的 fetch_paper_dynamic 或 requests 拉摘要
            try:
                abstract = fetch_abstract_for_arxiv(arxiv_id)
                if abstract:
                    paper["abstract"] = abstract
                    abstract_count += 1
            except Exception:
                pass
        papers.append(paper)
    return papers


def fetch_abstract_for_arxiv(arxiv_id: str) -> str | None:
    """通过 papers.cool 单页或 arXiv API 拉取摘要。"""
    try:
        import requests
        from bs4 import BeautifulSoup
    except ImportError:
        return None
    # 优先 papers.cool（与 papers-cool skill 一致）
    url = f"https://papers.cool/arxiv/{arxiv_id}"
    try:
        r = requests.get(url, timeout=15, headers={"User-Agent": "OpenClaw-rss-papers/1.0"})
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "html.parser")
        # 常见摘要所在块
        for sel in ("div.abstract", "section.abstract", "[class*='abstract']", "div.paper div.content"):
            block = soup.select_one(sel)
            if block:
                text = block.get_text(separator=" ", strip=True)
                if len(text) > 50:
                    return text[:3000]
        return None
    except Exception:
        pass
    # fallback: arXiv API
    try:
        api_url = f"http://export.arxiv.org/api/query?id_list={arxiv_id}"
        r = requests.get(api_url, timeout=10)
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "xml")
        summary = soup.find("summary")
        if summary:
            return summary.get_text(separator=" ", strip=True)[:3000]
    except Exception:
        pass
    return None


def main() -> None:
    ap = argparse.ArgumentParser(description="Analyze feed entries for papers and optionally fetch abstracts.")
    ap.add_argument("input", help="JSON file from fetch_feeds.py (or with 'entries' key)")
    ap.add_argument("--list-only", action="store_true", help="Only list paper links, no abstract fetch")
    ap.add_argument("--fetch-abstracts", action="store_true", help="Fetch abstracts for arXiv papers")
    ap.add_argument("--max", type=int, default=50, help="Max abstracts to fetch")
    ap.add_argument("-o", "--output", default="", help="Output JSON file")
    args = ap.parse_args()

    p = Path(args.input).expanduser().resolve()
    if not p.is_file():
        print(f"File not found: {p}", file=sys.stderr)
        sys.exit(1)
    data = json.loads(p.read_text(encoding="utf-8"))
    entries = data.get("entries") if isinstance(data, dict) else data
    if not isinstance(entries, list):
        entries = []

    papers = analyze_entries(
        entries,
        fetch_abstracts=args.fetch_abstracts and not args.list_only,
        max_abstracts=args.max,
    )

    out = {"papers": papers, "total": len(papers)}

    if args.output:
        out_path = Path(args.output).expanduser().resolve()
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    else:
        print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
