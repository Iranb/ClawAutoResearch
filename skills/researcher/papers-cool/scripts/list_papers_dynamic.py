#!/usr/bin/env python3
"""
从 papers.cool 分类或 Venue 列表页抓取论文列表（HTTP 请求 + HTML 解析，与 search 一致）。
列表页为服务端渲染，无需 Playwright。依赖: pip install requests beautifulsoup4
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import warnings
from pathlib import Path

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

REQUEST_HEADERS = {
    # 与 wget 行为一致，避免站点对脚本/浏览器 UA 返回不同内容导致解析不到 div.papers
    "User-Agent": "Wget/1.21.3 (darwin21.6.0)",
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
}


# arXiv 条目标识格式；Venue 页为 slug 如 Author_Title@CVPR2025@CVF，不匹配此正则
ARXIV_ID_RE = re.compile(r"^\d{4}\.\d{4,5}$")


def scrape_list(
    url: str,
    wait_extra_seconds: float = 3.0,
    max_papers: int = 50,
    headless: bool = True,
) -> dict:
    """
    请求列表页 HTML（与 wget 一致），按 div.papers > div.paper 解析。
    支持两类列表页：arXiv 分类页（id 为 arxiv_id）与 Venue 页（id 为 venue slug）。
    """
    result = {"url": url, "papers": [], "error": None}

    try:
        resp = requests.get(url, headers=REQUEST_HEADERS, timeout=30)
        resp.raise_for_status()
        html = resp.text
    except Exception as e:
        result["error"] = str(e)
        return result

    soup = BeautifulSoup(html, "html.parser")
    papers_div = soup.find("div", class_="papers")
    if not papers_div:
        papers_div = soup
    # 匹配所有带 id 的 div.paper：arXiv 页 id 为 2501.12345，Venue 页 id 为 slug（含 @ 等）
    for panel in papers_div.find_all("div", class_="paper"):
        if len(result["papers"]) >= max_papers:
            break
        paper_id = (panel.get("id") or "").strip()
        if not paper_id:
            continue

        title = ""
        title_link = panel.select_one("h2.title a.title-link")
        if title_link:
            title = (title_link.get_text(strip=True) or "").strip()

        index_el = panel.select_one("span.index")
        index_num = (index_el.get_text(strip=True) or "").strip() if index_el else ""

        summary_el = panel.select_one("p.summary")
        abstract = (summary_el.get_text(strip=True) or "").strip()[:1500] if summary_el else ""

        # arXiv 页用 /arxiv/{id}，Venue 页用 /venue/{slug}
        if ARXIV_ID_RE.match(paper_id):
            paper_url = f"https://papers.cool/arxiv/{paper_id}"
        else:
            paper_url = f"https://papers.cool/venue/{paper_id}"

        result["papers"].append({
            "index": index_num.lstrip("#") or str(len(result["papers"]) + 1),
            "title": title,
            "abstract_snippet": abstract[:800] if abstract else "",
            "arxiv_id": paper_id,
            "url": paper_url,
        })

    return result


def main():
    parser = argparse.ArgumentParser(description="抓取 papers.cool 分类/Venue 列表（HTTP 请求）")
    parser.add_argument(
        "url",
        nargs="?",
        help="列表页 URL，如 https://papers.cool/arxiv/cs.LG 或 https://papers.cool/venue/ICLR.2025",
    )
    parser.add_argument("--wait", type=float, default=3.0, help="保留参数，兼容旧脚本")
    parser.add_argument("--max", type=int, default=50, help="最多抓取篇数")
    parser.add_argument("--no-headless", action="store_true", help="保留参数，兼容旧脚本")
    parser.add_argument("-o", "--output", help="输出路径：文件路径或目录（则写入 list_results.json）")
    parser.add_argument("--json", action="store_true", help="以 JSON 打印")
    args = parser.parse_args()

    if not args.url:
        parser.print_help()
        sys.exit(2)

    out = scrape_list(
        args.url,
        wait_extra_seconds=args.wait,
        max_papers=args.max,
        headless=not args.no_headless,
    )

    if args.output:
        out_path = Path(args.output)
        if not out_path.suffix or (out_path.exists() and out_path.is_dir()):
            out_path = out_path.resolve()
            out_path.mkdir(parents=True, exist_ok=True)
            out_path = out_path / "list_results.json"
        else:
            out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(
            json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"已写入: {out_path}", file=sys.stderr)

    if args.json or args.output:
        print(json.dumps(out, ensure_ascii=False, indent=2))
    else:
        for p in out["papers"]:
            print(p.get("arxiv_id") or p["title"][:60], "|", p["title"][:70])
        if out["error"]:
            print("Error:", out["error"], file=sys.stderr)

    sys.exit(1 if out["error"] else 0)


if __name__ == "__main__":
    main()
