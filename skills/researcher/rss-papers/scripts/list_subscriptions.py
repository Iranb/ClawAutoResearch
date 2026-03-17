#!/usr/bin/env python3
"""
从 OPML 文件解析所有 RSS/Atom 订阅，输出扁平列表或按文件夹分组。
支持 NetNewsWire 等导出的标准 OPML 1.1。
"""
from __future__ import annotations

import argparse
import json
import xml.etree.ElementTree as ET
from pathlib import Path


def get_attr(el: ET.Element, key: str, default: str = "") -> str:
    v = el.get(key)
    return (v or "").strip() or default


def collect_feeds(
    root: ET.Element,
    parent_folder: str = "",
) -> list[dict]:
    """递归收集带 xmlUrl 的 outline 为 feed，父级 outline 的 text 作为 folder。"""
    feeds: list[dict] = []
    for child in root:
        if child.tag.endswith("outline"):
            text = get_attr(child, "text") or get_attr(child, "title")
            xml_url = get_attr(child, "xmlUrl")
            if xml_url:
                folder = parent_folder or ""
                feeds.append({
                    "title": text or xml_url,
                    "xml_url": xml_url,
                    "html_url": get_attr(child, "htmlUrl"),
                    "folder": folder,
                    "description": get_attr(child, "description"),
                })
            else:
                # 文件夹/分类：用 text 作为 folder 名递归
                sub_folder = text or parent_folder
                feeds.extend(collect_feeds(child, sub_folder))
    return feeds


def load_opml(path: str) -> ET.Element:
    path_obj = Path(path).expanduser().resolve()
    if not path_obj.is_file():
        raise FileNotFoundError(f"OPML file not found: {path_obj}")
    tree = ET.parse(path_obj)
    root = tree.getroot()
    # 兼容带命名空间的 OPML
    if root.tag.startswith("{"):
        ns = root.tag.split("}")[0] + "}"
        for elem in root.iter():
            if elem.tag.startswith("{"):
                elem.tag = elem.tag[len(ns):]
    return root


def main() -> None:
    ap = argparse.ArgumentParser(description="List RSS/Atom feeds from an OPML file.")
    ap.add_argument("opml_path", help="Path to OPML file (e.g. Subscriptions-iCloud.opml)")
    ap.add_argument("--by-folder", action="store_true", help="Group output by folder")
    ap.add_argument("-o", "--output", default="", help="Output file (default: stdout)")
    ap.add_argument("--json", action="store_true", default=True, help="Output JSON (default)")
    ap.add_argument("--no-json", action="store_false", dest="json", help="Output Markdown when --by-folder")
    args = ap.parse_args()

    root = load_opml(args.opml_path)
    body = root.find("body") or root
    feeds = collect_feeds(body)

    if args.by_folder:
        by_folder: dict[str, list[dict]] = {}
        for f in feeds:
            folder = f.get("folder") or "(No folder)"
            by_folder.setdefault(folder, []).append(f)
        out_data = {"by_folder": by_folder, "feeds": feeds}
    else:
        out_data = {"feeds": feeds}

    def write_out(content: str) -> None:
        if args.output:
            out_path = Path(args.output).expanduser().resolve()
            out_path.parent.mkdir(parents=True, exist_ok=True)
            out_path.write_text(content, encoding="utf-8")
        else:
            print(content)

    if args.by_folder and not args.json:
        lines = ["# Subscriptions by folder\n"]
        for folder, items in sorted(out_data["by_folder"].items()):
            lines.append(f"## {folder}\n")
            for f in items:
                lines.append(f"- **{f['title']}**: {f['xml_url']}\n")
            lines.append("")
        write_out("".join(lines))
    else:
        write_out(json.dumps(out_data, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
