#!/usr/bin/env python3
"""
按会议/ Venue 在 papers.cool 查询论文（HTTP 请求 + HTML 解析，与 list/search 一致）。
URL 规则: https://papers.cool/venue/<Venue.Year>?show=N 或 ?group=<Group>&show=N ，支持 wget 直接获取。
依赖: pip install requests beautifulsoup4
"""
from __future__ import annotations

import argparse
import json
import sys
import warnings
from pathlib import Path
from urllib.parse import quote, urlencode

warnings.filterwarnings("ignore", message=".*urllib3 v2 only supports OpenSSL.*", category=UserWarning)

# 复用 list_papers_dynamic 的抓取逻辑
try:
    from list_papers_dynamic import scrape_list
except ImportError:
    scrape_list = None

BASE_URL = "https://papers.cool"


def _venue_url(venue_id: str, show: int, group: str | None = None) -> str:
    """构建 venue 列表页 URL：可选 ?group=xxx&show=N 或 ?show=N。"""
    base = f"https://papers.cool/venue/{quote(venue_id, safe='')}"
    params = {"show": show}
    if group and group.strip():
        params["group"] = group.strip()
    return f"{base}?{urlencode(params)}"


def venue_papers(
    venue_id: str,
    show: int = 100,
    group: str | None = None,
    max_results: int | None = None,
) -> dict:
    """
    按会议 ID（及可选 group）请求 papers.cool 的 venue 页，解析论文列表。
    venue_id: 如 CVPR.2025, NeurIPS.2024（大小写需与网站一致）。
    show: 请求 URL 的 show 参数（单页条数，站点支持如 1000）。
    group: 可选，子分类名（如 Poster、Oral），对应 URL 中 ?group=Poster。
    max_results: 最多保留条数；不设则使用 show。
    """
    show = max(1, min(show, 10000))
    max_results = max(1, max_results) if max_results is not None else show
    url = _venue_url(venue_id, show, group)
    out = scrape_list(url, max_papers=max_results) if scrape_list else {"url": url, "papers": [], "error": "list_papers_dynamic.scrape_list not available"}
    out["venue_id"] = venue_id
    out["show"] = show
    if group and group.strip():
        out["group"] = group.strip()
    return out


def main():
    parser = argparse.ArgumentParser(
        description="按会议(Venue)在 papers.cool 查询论文，HTTP 请求，支持 show 数量"
    )
    parser.add_argument(
        "venue",
        nargs="?",
        help="会议 ID，如 CVPR.2025、NeurIPS.2024、ICLR.2025（与首页 Venue 链接一致）",
    )
    parser.add_argument(
        "-v", "--venue-id",
        dest="venue_opt",
        help="同上，显式指定会议 ID",
    )
    parser.add_argument(
        "--show",
        type=int,
        default=100,
        metavar="N",
        help="请求条数（URL 中 ?show=N，默认 100；站点支持如 1000）",
    )
    parser.add_argument(
        "-g", "--group",
        dest="group",
        default=None,
        metavar="NAME",
        help="子分类/轨道名（如 Poster、Oral），对应 URL ?group=...；不传则查整个会议",
    )
    parser.add_argument(
        "--max",
        type=int,
        default=None,
        metavar="N",
        help="最多解析保留条数（默认等于 --show）",
    )
    parser.add_argument(
        "-o", "--output",
        dest="output_file",
        default=None,
        help="输出路径：文件路径或目录（目录则写入 venue_results.json）",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="以 JSON 格式打印",
    )
    args = parser.parse_args()

    venue_id = (args.venue or args.venue_opt or "").strip()
    if not venue_id:
        parser.print_help()
        print("\n示例: python venue_papers.py CVPR.2025 --show 1000", file=sys.stderr)
        print("      python venue_papers.py CVPR.2025 --group Poster --show 50", file=sys.stderr)
        sys.exit(2)

    out = venue_papers(
        venue_id=venue_id,
        show=args.show,
        group=args.group,
        max_results=args.max,
    )

    if args.output_file:
        path = Path(args.output_file)
        if not path.suffix or (path.exists() and path.is_dir()):
            path = path.resolve()
            path.mkdir(parents=True, exist_ok=True)
            path = path / "venue_results.json"
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"已写入: {path}", file=sys.stderr)

    if args.json or args.output_file:
        print(json.dumps(out, ensure_ascii=False, indent=2))
    else:
        group_info = f" | Group: {out.get('group', '')}" if out.get("group") else ""
        print(f"Venue: {out.get('venue_id', '')}{group_info} | URL: {out.get('url', '')}")
        print(f"结果数: {len(out.get('papers') or [])}")
        if out.get("error"):
            print(f"错误: {out['error']}", file=sys.stderr)
        for p in out.get("papers") or []:
            print(f"  {p.get('arxiv_id', '')} | {(p.get('title') or '')[:70]}")

    sys.exit(1 if out.get("error") else 0)


if __name__ == "__main__":
    main()
