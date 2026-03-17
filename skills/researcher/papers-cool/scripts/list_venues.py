#!/usr/bin/env python3
"""
从 papers.cool 首页解析当前支持的会议（Venue）列表（HTTP 请求 + HTML 解析）。
依赖: pip install requests beautifulsoup4
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import warnings
from pathlib import Path
from urllib.parse import urlparse

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

HOME_URL = "https://papers.cool/"
REQUEST_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

# Venue ID 格式: 字母数字点横线，如 AAAI.2025, CVPR.2025, USENIX-Fast
VENUE_ID_RE = re.compile(r"^[A-Za-z0-9_.-]+$")


def list_venues(home_url: str = HOME_URL) -> dict:
    """
    请求 papers.cool 首页，解析所有 /venue/<id> 链接，去重排序返回会议 ID 列表。
    """
    result = {"url": home_url, "venues": [], "error": None}
    try:
        resp = requests.get(home_url, headers=REQUEST_HEADERS, timeout=30)
        resp.raise_for_status()
        html = resp.text
    except Exception as e:
        result["error"] = str(e)
        return result

    soup = BeautifulSoup(html, "html.parser")
    seen = set()
    for a in soup.find_all("a", href=True):
        href = a.get("href", "").strip()
        if "/venue/" not in href:
            continue
        parsed = urlparse(href)
        path = (parsed.path or "").strip().rstrip("/")
        if not path.startswith("/venue/"):
            continue
        # 取最后一段作为 venue id（去掉 ?group= 等）
        segment = path.split("/")[-1].split("?")[0].strip()
        if not segment or not VENUE_ID_RE.match(segment):
            continue
        if segment not in seen:
            seen.add(segment)
            result["venues"].append(segment)
    result["venues"].sort(key=lambda x: (x.split(".")[0].upper(), x))
    return result


def main():
    parser = argparse.ArgumentParser(
        description="从 papers.cool 首页解析当前支持的会议(Venue)列表"
    )
    parser.add_argument(
        "--url",
        default=HOME_URL,
        help="首页 URL（默认 https://papers.cool/）",
    )
    parser.add_argument(
        "-o", "--output",
        dest="output_file",
        default=None,
        help="输出路径：文件路径或目录（目录则写入 venues_list.json）",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="以 JSON 格式打印",
    )
    args = parser.parse_args()

    out = list_venues(home_url=args.url)

    if args.output_file:
        path = Path(args.output_file)
        if not path.suffix or (path.exists() and path.is_dir()):
            path = path.resolve()
            path.mkdir(parents=True, exist_ok=True)
            path = path / "venues_list.json"
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"已写入: {path}", file=sys.stderr)

    if args.json or args.output_file:
        print(json.dumps(out, ensure_ascii=False, indent=2))
    else:
        print(f"来源: {out.get('url', '')}")
        print(f"会议数: {len(out.get('venues') or [])}")
        if out.get("error"):
            print(f"错误: {out['error']}", file=sys.stderr)
        for v in out.get("venues") or []:
            print(f"  {v}  -> https://papers.cool/venue/{v}")

    sys.exit(1 if out.get("error") else 0)


if __name__ == "__main__":
    main()
