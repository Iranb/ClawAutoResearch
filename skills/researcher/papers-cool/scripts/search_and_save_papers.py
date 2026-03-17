#!/usr/bin/env python3
"""
按关键词在 papers.cool 搜索论文，再逐篇从 https://papers.cool/arxiv/<id> 抓取题目与摘要，保存到文件便于后续分析。
抓取摘要的实现与 fetch_paper_dynamic.py 一致（同一套 scrape_paper）。
依赖: pip install playwright && playwright install chromium
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

# 同目录下模块
try:
    from search_papers import search_papers
except ImportError:
    import search_papers as _sp
    search_papers = _sp.search_papers

try:
    from fetch_paper_dynamic import scrape_paper, build_paper_url
except ImportError:
    import fetch_paper_dynamic as _fpd
    scrape_paper = _fpd.scrape_paper
    build_paper_url = _fpd.build_paper_url


def search_and_save(
    keyword: str,
    output_path: str,
    max_results: int = 20,
    format_output: str = "json",
    wait_search: float = 4.0,
    wait_per_paper: float = 2.0,
    headless: bool = True,
    debug_path: str | None = None,
    sort: int = 0,
) -> dict:
    """
    1) 按关键词搜索得到论文列表；
    2) 对每条有 arxiv_id 的论文，请求 https://papers.cool/arxiv/<arxiv_id> 抓取题目与摘要（与 fetch_paper_dynamic 同一实现）；
    3) 将题目、摘要等写入 output_path（JSON 或 Markdown）。
    """
    out = {
        "keyword": keyword,
        "output_path": output_path,
        "papers": [],
        "errors": [],
    }

    # 1. 搜索
    search_result = search_papers(
        keyword,
        max_results=max_results,
        wait_after_search=wait_search,
        headless=headless,
        debug_path=debug_path,
        sort=sort,
    )
    if search_result.get("error"):
        out["errors"].append(f"搜索失败: {search_result['error']}")
        return out

    papers_from_search = search_result.get("papers") or []
    if not papers_from_search:
        out["_search_url"] = search_result.get("url")
        out["_debug_saved"] = search_result.get("_debug_saved")
        return out

    # 2. 逐篇从 papers.cool/arxiv/<id> 抓取题目与摘要
    for i, item in enumerate(papers_from_search):
        arxiv_id = (item.get("arxiv_id") or "").strip()
        if not arxiv_id:
            out["errors"].append(f"跳过（无 arxiv_id）: {item.get('title', '')[:50]}")
            continue

        url = build_paper_url(arxiv_id)
        try:
            row = scrape_paper(
                url,
                wait_extra_seconds=wait_per_paper,
                wait_for_kimi_selector=None,
                headless=headless,
            )
            entry = {
                "arxiv_id": arxiv_id,
                "url": url,
                "title": row.get("title") or item.get("title") or "",
                "abstract": row.get("abstract") or item.get("abstract_snippet") or "",
            }
            if row.get("error"):
                out["errors"].append(f"{arxiv_id}: {row['error']}")
            out["papers"].append(entry)
        except Exception as e:
            out["errors"].append(f"{arxiv_id}: {e}")
            out["papers"].append({
                "arxiv_id": arxiv_id,
                "url": url,
                "title": item.get("title") or "",
                "abstract": item.get("abstract_snippet") or "",
            })
        time.sleep(0.5)

    # 3. 写入文件
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)

    if format_output.lower() == "md" or path.suffix.lower() in (".md", ".markdown"):
        lines = [f"# 关键词: {keyword}\n", f"共 {len(out['papers'])} 篇\n"]
        for p in out["papers"]:
            lines.append(f"## {p.get('title') or '(无标题)'}\n")
            lines.append(f"- **arXiv**: {p.get('arxiv_id')}\n")
            lines.append(f"- **URL**: {p.get('url')}\n")
            lines.append(f"\n**摘要**\n\n{p.get('abstract') or '(无)'}\n\n---\n")
        path.write_text("".join(lines), encoding="utf-8")
    else:
        path.write_text(
            json.dumps(
                {"keyword": keyword, "papers": out["papers"], "errors": out["errors"]},
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )

    return out


def main():
    parser = argparse.ArgumentParser(
        description="按关键词搜索论文，从 papers.cool/arxiv/<id> 抓取题目与摘要并保存到文件"
    )
    parser.add_argument("keyword", nargs="?", help="搜索关键词")
    parser.add_argument("-q", "--query", dest="query", help="同上")
    parser.add_argument(
        "-o", "--output",
        default="papers_saved.json",
        metavar="FILE_OR_DIR",
        help="输出路径：文件路径（如 /path/to/out.json 或 out.md）或目录（则写入该目录下的 papers_saved.json）；.md 后缀则输出 Markdown",
    )
    parser.add_argument(
        "--max",
        type=int,
        default=20,
        help="最多处理篇数（默认 20）",
    )
    parser.add_argument(
        "--format",
        choices=("json", "md"),
        default=None,
        help="输出格式；不指定时根据 -o 后缀自动判断",
    )
    parser.add_argument("--wait-search", type=float, default=4.0, help="搜索后等待秒数")
    parser.add_argument("--wait-paper", type=float, default=2.0, help="每篇论文页等待秒数")
    parser.add_argument("--no-headless", action="store_true", help="显示浏览器")
    parser.add_argument(
        "--debug",
        dest="debug_search_path",
        default=None,
        metavar="FILE",
        help="当搜索结果为 0 条时，将搜索结果页文本写入该文件便于排查",
    )
    parser.add_argument("--sort", type=int, choices=(0, 1), default=0, metavar="0|1",
        help="搜索排序：0=按时间（默认），1=按 reading star")
    args = parser.parse_args()

    raw = args.keyword or args.query
    if not raw:
        parser.print_help()
        sys.exit(2)

    keyword = raw.strip()
    fmt = args.format
    if fmt is None:
        fmt = "md" if args.output.endswith(".md") else "json"

    # 若 -o 为目录（无后缀或已存在为目录），则在该目录下写入默认文件名
    output_path = args.output
    path_obj = Path(output_path)
    if not path_obj.suffix or (path_obj.exists() and path_obj.is_dir()):
        path_obj = path_obj.resolve()
        path_obj.mkdir(parents=True, exist_ok=True)
        output_path = str(path_obj / ("papers_saved.md" if fmt == "md" else "papers_saved.json"))

    result = search_and_save(
        keyword,
        output_path=output_path,
        max_results=args.max,
        format_output=fmt,
        wait_search=args.wait_search,
        wait_per_paper=args.wait_paper,
        headless=not args.no_headless,
        debug_path=args.debug_search_path,
        sort=args.sort,
    )

    print(f"关键词: {keyword}")
    print(f"已保存 {len(result['papers'])} 篇到: {output_path}")
    if len(result["papers"]) == 0 and not result.get("errors"):
        print(
            "提示：搜索返回 0 条。可能原因：\n"
            "  1) 结果未加载完 → 加大 --wait-search（如 10）；\n"
            "  2) 关键词过窄或站点无匹配 → 试更短关键词或同义词；\n"
            "  3) 页面结构变化 → 用 --no-headless 查看浏览器；\n"
            "  4) 使用 --debug /path/to/debug.txt 保存结果页文本便于排查。",
            file=sys.stderr,
        )
        if result.get("_search_url"):
            print(f"  搜索结果页 URL: {result['_search_url']}", file=sys.stderr)
        if result.get("_debug_saved"):
            print(f"  调试文件已写入: {result['_debug_saved']}", file=sys.stderr)
    if result["errors"]:
        for e in result["errors"][:10]:
            print(f"  警告: {e}", file=sys.stderr)
        if len(result["errors"]) > 10:
            print(f"  ... 共 {len(result['errors'])} 条警告", file=sys.stderr)
    sys.exit(0)


if __name__ == "__main__":
    main()
