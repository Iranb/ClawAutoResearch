#!/usr/bin/env python3
"""
使用 Crawl4AI 抓取指定 URL，将 Markdown 与可选元数据保存到本地指定路径。
依赖: pip install -r requirements.txt，并已执行 crawl4ai-setup（或 playwright install chromium）。
"""
from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

try:
    from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig
except ImportError as e:
    print("请先安装 crawl4ai: pip install -U crawl4ai && crawl4ai-setup", file=sys.stderr)
    raise SystemExit(1) from e


def url_to_slug(url: str, max_len: int = 120) -> str:
    """将 URL 转为安全文件名（用于多 URL 时的默认文件名）。"""
    parsed = urlparse(url)
    netloc = parsed.netloc or "unknown"
    path = (parsed.path or "").strip("/") or "index"
    combined = f"{netloc}_{path}"
    combined = re.sub(r"[^\w\-.]", "_", combined)
    combined = re.sub(r"_+", "_", combined).strip("_")
    return combined[:max_len] or "page"


def get_markdown_text(result, format_key: str) -> str:
    """从 CrawlResult.markdown 取出字符串。支持 str 或 MarkdownGenerationResult。"""
    md = result.markdown
    if md is None:
        return ""
    if isinstance(md, str):
        return md
    # MarkdownGenerationResult
    if format_key == "fit" and getattr(md, "fit_markdown", None):
        return md.fit_markdown or ""
    if format_key == "citations" and getattr(md, "markdown_with_citations", None):
        return md.markdown_with_citations or ""
    return getattr(md, "raw_markdown", "") or ""


def build_meta(result) -> dict:
    """从 CrawlResult 构建可 JSON 序列化的元数据。"""
    return {
        "url": getattr(result, "url", None),
        "success": getattr(result, "success", False),
        "status_code": getattr(result, "status_code", None),
        "error_message": getattr(result, "error_message", None),
        "redirected_url": getattr(result, "redirected_url", None),
    }


async def crawl_one(
    crawler: AsyncWebCrawler,
    url: str,
    config: CrawlerRunConfig | None = None,
) -> "CrawlResult":
    """抓取单个 URL，返回 CrawlResult。"""
    return await crawler.arun(url=url, config=config or CrawlerRunConfig())


async def run(
    urls: list[str],
    output_path: str,
    save_meta: bool = False,
    format_key: str = "raw",
    headless: bool = True,
) -> list[dict]:
    """
    抓取所有 URL，将 Markdown 写入 output_path（若为目录则按 URL 生成多个文件），
    可选写入元数据 JSON。返回每页的简要结果列表。
    """
    out = Path(output_path).expanduser().resolve()
    # 目录：已存在且为目录，或不存在且路径无扩展名
    is_dir = (out.exists() and out.is_dir()) or (not out.exists() and not out.suffix)
    if is_dir:
        out.mkdir(parents=True, exist_ok=True)
    else:
        out.parent.mkdir(parents=True, exist_ok=True)

    browser_config = BrowserConfig(headless=headless, verbose=False)
    run_config = CrawlerRunConfig()
    results_summary = []

    async with AsyncWebCrawler(config=browser_config) as crawler:
        for i, url in enumerate(urls):
            slug = url_to_slug(url)
            if is_dir:
                md_path = out / f"{slug}.md"
                meta_path = out / f"{slug}_meta.json" if save_meta else None
            else:
                if len(urls) > 1:
                    base = out.stem
                    parent = out.parent
                    md_path = parent / f"{base}_{slug}.md"
                    meta_path = parent / f"{base}_{slug}_meta.json" if save_meta else None
                else:
                    md_path = out if str(out).endswith(".md") else out.with_suffix(".md")
                    meta_path = md_path.with_suffix(".json") if save_meta else None

            try:
                result = await crawl_one(crawler, url, run_config)
            except Exception as e:
                results_summary.append({"url": url, "success": False, "error": str(e)})
                if is_dir or len(urls) > 1:
                    md_path.write_text(f"# Crawl failed\n\nURL: {url}\nError: {e}", encoding="utf-8")
                continue

            text = get_markdown_text(result, format_key)
            md_path.write_text(text, encoding="utf-8")
            summary = {"url": url, "path": str(md_path), "success": getattr(result, "success", False)}
            if save_meta and meta_path:
                meta_path.write_text(
                    json.dumps(build_meta(result), ensure_ascii=False, indent=2),
                    encoding="utf-8",
                )
                summary["meta_path"] = str(meta_path)
            results_summary.append(summary)
    return results_summary


def main() -> None:
    ap = argparse.ArgumentParser(
        description="使用 Crawl4AI 抓取 URL 并保存 Markdown 到指定路径",
    )
    ap.add_argument("urls", nargs="+", help="要抓取的一个或多个 URL")
    ap.add_argument("-o", "--output", default=".", help="输出路径：文件或目录（默认当前目录）")
    ap.add_argument("--meta", action="store_true", help="同时保存元数据 JSON")
    ap.add_argument(
        "--format",
        choices=["raw", "fit", "citations"],
        default="raw",
        help="Markdown 变体: raw（默认）, fit, citations",
    )
    ap.add_argument("--no-headless", action="store_true", dest="no_headless", help="显示浏览器窗口")
    args = ap.parse_args()

    summary = asyncio.run(
        run(
            urls=args.urls,
            output_path=args.output,
            save_meta=args.meta,
            format_key=args.format,
            headless=not args.no_headless,
        )
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    if not any(s.get("success") for s in summary):
        sys.exit(1)


if __name__ == "__main__":
    main()
