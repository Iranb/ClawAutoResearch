#!/usr/bin/env python3
"""
在 papers.cool 站内按关键词搜索论文（HTTP 请求 + HTML 解析，与 wget 行为一致）。
搜索页为服务端渲染，无需 Playwright。依赖: pip install requests beautifulsoup4
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import warnings
from pathlib import Path
from urllib.parse import quote_plus

# macOS 系统 Python 使用 LibreSSL 时，urllib3 v2 会打印 NotOpenSSLWarning，忽略以便输出清爽
warnings.filterwarnings("ignore", message=".*urllib3 v2 only supports OpenSSL.*", category=UserWarning)

try:
    import requests
except ImportError:
    print("请先安装: pip install requests", file=sys.stderr)
    sys.exit(1)

try:
    from bs4 import BeautifulSoup
except ImportError:
    print("请先安装: pip install beautifulsoup4", file=sys.stderr)
    sys.exit(1)

BASE_URL = "https://papers.cool"
SEARCH_URL_TEMPLATE = "https://papers.cool/arxiv/search?highlight=1&query={query}&sort={sort}"
# sort=0 按时间，sort=1 按 reading star

# 与 wget 类似，简单 UA 即可（服务端返回完整 HTML），简单 UA 即可（服务端返回完整 HTML）
REQUEST_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}


def search_papers(
    keyword: str,
    max_results: int = 20,
    wait_after_search: float = 4.0,
    headless: bool = True,
    debug_path: str | None = None,
    sort: int = 0,
) -> dict:
    """
    使用 papers.cool 站内搜索 URL 直接请求 HTML（与 wget 一致），按页面真实结构解析。
    页面结构: div.papers > div.panel.paper (id=arxiv_id)，内为 .title-link、.summary 等。
    sort: 0=按时间，1=按 reading star。
    """
    result = {"keyword": keyword, "url": "", "papers": [], "error": None}
    sort_val = 1 if sort == 1 else 0
    search_url = SEARCH_URL_TEMPLATE.format(query=quote_plus(keyword), sort=sort_val)
    result["url"] = search_url

    try:
        resp = requests.get(search_url, headers=REQUEST_HEADERS, timeout=30)
        resp.raise_for_status()
        html = resp.text
    except Exception as e:
        result["error"] = str(e)
        if debug_path:
            Path(debug_path).write_text(f"URL: {search_url}\nerror: {e}", encoding="utf-8")
            result["_debug_saved"] = debug_path
        return result

    soup = BeautifulSoup(html, "html.parser")
    papers_div = soup.find("div", class_="papers")
    if not papers_div:
        if debug_path:
            Path(debug_path).write_text(
                f"URL: {search_url}\nkeyword: {keyword}\n\n--- HTML (first 50k) ---\n{html[:50000]}",
                encoding="utf-8",
            )
            result["_debug_saved"] = debug_path
        return result

    # 每条论文: <div id="2603.01320" class="panel paper">，内含 h2.title > a.title-link, p.summary
    for panel in papers_div.find_all("div", class_="paper", id=re.compile(r"^\d{4}\.\d{4,5}$")):
        if len(result["papers"]) >= max_results:
            break
        arxiv_id = panel.get("id", "").strip()
        if not arxiv_id:
            continue

        title = ""
        title_link = panel.select_one("h2.title a.title-link")
        if title_link:
            title = (title_link.get_text(strip=True) or "").strip()

        index_el = panel.select_one("span.index")
        index_num = (index_el.get_text(strip=True) or "").strip() if index_el else ""

        summary_el = panel.select_one("p.summary")
        abstract = (summary_el.get_text(strip=True) or "").strip()[:1500] if summary_el else ""

        result["papers"].append({
            "index": index_num.lstrip("#") or str(len(result["papers"]) + 1),
            "title": title,
            "abstract_snippet": abstract[:800] if abstract else "",
            "arxiv_id": arxiv_id,
            "url": f"https://papers.cool/arxiv/{arxiv_id}",
        })

    if debug_path and len(result["papers"]) == 0:
        base = debug_path.rsplit(".", 1)[0] if "." in debug_path else debug_path
        txt_path = base + ".txt" if not debug_path.endswith(".txt") else debug_path
        Path(txt_path).write_text(
            f"URL: {search_url}\nkeyword: {keyword}\n\n--- HTML (first 80k) ---\n{html[:80000]}",
            encoding="utf-8",
        )
        result["_debug_saved"] = txt_path

    return result


def main():
    parser = argparse.ArgumentParser(
        description="在 papers.cool 站内按关键词搜索论文（HTTP 请求，同 wget）"
    )
    parser.add_argument(
        "keyword",
        nargs="?",
        help="搜索关键词，如 transformer 或 reinforcement learning",
    )
    parser.add_argument(
        "-q", "--query",
        dest="query",
        help="同上，显式指定关键词",
    )
    parser.add_argument(
        "--max",
        type=int,
        default=20,
        metavar="N",
        help="最多返回条数（默认 20）",
    )
    parser.add_argument(
        "--wait",
        type=float,
        default=4.0,
        metavar="SECONDS",
        help="保留参数，兼容旧脚本；当前实现为 HTTP 请求，无需等待",
    )
    parser.add_argument(
        "--no-headless",
        action="store_true",
        help="保留参数，兼容旧脚本；当前实现不使用浏览器",
    )
    parser.add_argument(
        "-o", "--output",
        dest="output_file",
        default=None,
        help="输出路径：可为文件路径（如 /path/to/result.json）或目录（则写入该目录下的 search_results.json）",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="以 JSON 格式打印到 stdout",
    )
    parser.add_argument(
        "--debug",
        dest="debug_path",
        default=None,
        metavar="FILE",
        help="当搜索结果为 0 条时，将页面 HTML 写入该文件便于排查",
    )
    parser.add_argument(
        "--sort",
        type=int,
        choices=(0, 1),
        default=0,
        metavar="0|1",
        help="排序：0=按时间（默认），1=按 reading star",
    )
    args = parser.parse_args()

    raw = args.keyword or args.query
    if not raw:
        parser.print_help()
        sys.exit(2)

    keyword = raw.strip()
    out = search_papers(
        keyword,
        max_results=args.max,
        wait_after_search=args.wait,
        headless=not args.no_headless,
        debug_path=args.debug_path,
        sort=args.sort,
    )

    if args.output_file:
        path = Path(args.output_file)
        if not path.suffix or (path.exists() and path.is_dir()):
            path = path.resolve()
            path.mkdir(parents=True, exist_ok=True)
            path = path / "search_results.json"
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"已写入: {path}", file=sys.stderr)

    if args.json or args.output_file:
        print(json.dumps(out, ensure_ascii=False, indent=2))
    else:
        print(f"关键词: {out['keyword']}")
        print(f"结果数: {len(out['papers'])}")
        if out.get("error"):
            print(f"错误: {out['error']}", file=sys.stderr)
        if out.get("_debug_saved"):
            print(f"调试: 已保存页面到 {out['_debug_saved']}", file=sys.stderr)
        for p in out.get("papers") or []:
            print(f"  {p.get('arxiv_id', '')} | {(p.get('title') or '')[:70]}")

    sys.exit(1 if out.get("error") else 0)


if __name__ == "__main__":
    main()
