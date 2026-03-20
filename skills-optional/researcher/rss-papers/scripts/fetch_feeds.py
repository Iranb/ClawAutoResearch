#!/usr/bin/env python3
"""
根据 OPML 或显式 feed URL 列表抓取 RSS/Atom，输出条目列表。
使用标准库 urllib + xml.etree 解析，无需 feedparser（避免 Python 3.12 下 setuptools 兼容问题）。
"""
from __future__ import annotations

import argparse
import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.request import Request, urlopen

# 同目录或 skill 内 list_subscriptions
try:
    from list_subscriptions import load_opml, collect_feeds
except ImportError:
    list_subscriptions = None
else:
    list_subscriptions = __import__("list_subscriptions")

USER_AGENT = "OpenClaw-rss-papers/1.0"


def _text(el: ET.Element | None, default: str = "") -> str:
    if el is None:
        return default
    return (el.text or "").strip() + "".join((e.tail or "") for e in el).strip() or default


def _find_any(el: ET.Element, *tags: str):
    """在子节点中查找第一个匹配的标签（忽略命名空间）。"""
    for child in el:
        local = child.tag.split("}")[-1] if "}" in child.tag else child.tag
        if local in tags:
            return child
    return None


def _find_all(el: ET.Element, tag_local: str) -> list[ET.Element]:
    out = []
    for child in el:
        local = child.tag.split("}")[-1] if "}" in child.tag else child.tag
        if local == tag_local:
            out.append(child)
    return out


def _link_href(el: ET.Element) -> str:
    """Atom <link> 的 href。"""
    href = el.get("href")
    if href:
        return href.strip()
    return _text(el, "").strip()


def _parse_rss_channel(channel: ET.Element, xml_url: str, feed_title: str, max_entries: int) -> tuple[str, list[dict]]:
    """解析 RSS 2.0 <channel>，返回 (channel_title, items)。"""
    title_el = _find_any(channel, "title")
    channel_title = feed_title or _text(title_el, xml_url)
    items = []
    for item in _find_all(channel, "item")[:max_entries]:
        link_el = _find_any(item, "link")
        link = _text(link_el, "").strip()
        if not link:
            continue
        title_el = _find_any(item, "title")
        desc_el = _find_any(item, "description")
        pub_el = _find_any(item, "pubDate")
        items.append({
            "title": _text(title_el, link)[:2000],
            "link": link,
            "published": _text(pub_el, ""),
            "summary": _text(desc_el, "")[:2000],
            "feed_title": channel_title,
            "feed_url": xml_url,
        })
    return channel_title, items


def _parse_atom_feed(root: ET.Element, xml_url: str, feed_title: str, max_entries: int) -> tuple[str, list[dict]]:
    """解析 Atom <feed>，返回 (feed_title, items)。"""
    title_el = _find_any(root, "title")
    feed_title = feed_title or _text(title_el, xml_url)
    items = []
    for entry in _find_all(root, "entry")[:max_entries]:
        link = ""
        for link_el in _find_all(entry, "link"):
            rel = link_el.get("rel") or "alternate"
            if rel in ("alternate", ""):
                link = _link_href(link_el)
                break
        if not link:
            continue
        title_el = _find_any(entry, "title")
        summary_el = _find_any(entry, "summary")
        updated_el = _find_any(entry, "updated")
        published_el = _find_any(entry, "published")
        date_str = _text(updated_el) or _text(published_el)
        items.append({
            "title": _text(title_el, link)[:2000],
            "link": link,
            "published": date_str,
            "summary": _text(summary_el, "")[:2000],
            "feed_title": feed_title,
            "feed_url": xml_url,
        })
    return feed_title, items


def fetch_feed(
    xml_url: str,
    feed_title: str = "",
    max_entries: int = 20,
) -> list[dict]:
    """抓取单个 feed（RSS 2.0 或 Atom），返回条目列表。仅用标准库。"""
    req = Request(xml_url, headers={"User-Agent": USER_AGENT})
    with urlopen(req, timeout=25) as resp:
        raw = resp.read()
    root = ET.fromstring(raw)
    local = root.tag.split("}")[-1] if "}" in root.tag else root.tag
    if local == "rss":
        channel = _find_any(root, "channel")
        if channel is None:
            return []
        _, items = _parse_rss_channel(channel, xml_url, feed_title, max_entries)
        return items
    if local == "feed":
        _, items = _parse_atom_feed(root, xml_url, feed_title, max_entries)
        return items
    # 尝试当作 RSS channel 的根（少数 feed 直接是 channel）
    if local == "channel":
        _, items = _parse_rss_channel(root, xml_url, feed_title, max_entries)
        return items
    return []


def get_feeds_from_opml(opml_path: str, folder: str | None = None) -> list[dict]:
    """从 OPML 解析 feed 列表，可选按 folder 过滤。"""
    if list_subscriptions is None:
        raise RuntimeError("list_subscriptions module required for OPML; run from skill scripts dir")
    root = list_subscriptions.load_opml(opml_path)
    body = root.find("body") or root
    feeds = list_subscriptions.collect_feeds(body)
    if folder:
        feeds = [f for f in feeds if (f.get("folder") or "") == folder]
    return feeds


def main() -> None:
    ap = argparse.ArgumentParser(description="Fetch RSS/Atom feeds from OPML or URL list.")
    ap.add_argument("opml_path", nargs="?", default="", help="Path to OPML file")
    ap.add_argument("--feeds", nargs="*", default=[], help="Feed URLs (when not using OPML)")
    ap.add_argument("--folder", default="", help="Only feeds in this folder (OPML outline text)")
    ap.add_argument("--max-per-feed", type=int, default=20, help="Max entries per feed")
    ap.add_argument("-o", "--output", default="", help="Output file or directory")
    args = ap.parse_args()

    if args.opml_path:
        folder = args.folder.strip() or None
        feeds = get_feeds_from_opml(args.opml_path, folder)
        if not feeds:
            print(json.dumps({"error": "no feeds found", "folder": args.folder}, ensure_ascii=False), file=sys.stderr)
            sys.exit(1)
        feed_list = [{"title": f["title"], "xml_url": f["xml_url"]} for f in feeds]
    elif args.feeds:
        feed_list = [{"title": "", "xml_url": u} for u in args.feeds]
    else:
        print("Provide opml_path or --feeds URL1 URL2 ...", file=sys.stderr)
        sys.exit(1)

    all_items: list[dict] = []
    for f in feed_list:
        url = f["xml_url"]
        try:
            items = fetch_feed(url, f["title"], args.max_per_feed)
            all_items.extend(items)
        except Exception as e:
            all_items.append({
                "title": "",
                "link": "",
                "published": "",
                "summary": f"Error fetching feed: {e}",
                "feed_title": f["title"],
                "feed_url": url,
            })

    out = {"entries": all_items, "feeds_count": len(feed_list)}

    out_path = (args.output or "").strip()
    if out_path:
        p = Path(out_path).expanduser().resolve()
        if p.is_dir() or (not p.suffix and not p.exists()):
            p.mkdir(parents=True, exist_ok=True)
            p = p / "feed_items.json"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    else:
        print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
