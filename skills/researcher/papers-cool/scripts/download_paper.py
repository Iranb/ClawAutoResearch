#!/usr/bin/env python3
"""
从 papers.cool 下载论文 PDF。支持两种输入：
1) papers.cool 直链（如 https://papers.cool/2ae6f548-411c-48da-b9a5-f40ab4437632）— 直接请求并保存；
2) arXiv ID 或论文页 URL — 用 Playwright 打开论文页，解析 [PDF] 对应的直链后再下载。
依赖: pip install playwright requests && playwright install chromium
"""
from __future__ import annotations

import argparse
import re
import sys
import warnings
from pathlib import Path
from urllib.parse import urljoin, urlparse

from validate_paper_source import validate_pdf_file

warnings.filterwarnings("ignore", message=".*urllib3 v2 only supports OpenSSL.*", category=UserWarning)

try:
    import requests
except ImportError:
    requests = None

try:
    from bs4 import BeautifulSoup
except ImportError:
    BeautifulSoup = None

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    sync_playwright = None

BASE = "https://papers.cool"
# papers.cool 直链格式: https://papers.cool/<uuid> 或 path-only /<uuid>
UUID_PATTERN = re.compile(
    r"^https?://(?:www\.)?papers\.cool/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}(?:\?.*)?\s*$"
)
UUID_PATH_PATTERN = re.compile(
    r"^/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}(?:\?.*)?\s*$"
)
ARXIV_ID_PATTERN = re.compile(r"^(\d{4}\.\d{4,5})(?:v\d+)?$")


def get_pdf_url_from_paper_page_http(arxiv_id: str) -> str | None:
    """
    用 HTTP + BS4 从论文页取 PDF 链接（a.title-pdf 的 data 或 href），无需 Playwright。
    """
    if not requests or not BeautifulSoup:
        return None
    url = f"{BASE}/arxiv/{arxiv_id}"
    try:
        r = requests.get(
            url,
            headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"},
            timeout=15,
        )
        r.raise_for_status()
    except Exception:
        return None
    soup = BeautifulSoup(r.text, "html.parser")
    pdf_a = soup.select_one("a.title-pdf")
    if not pdf_a:
        pdf_a = soup.select_one('a[href*="arxiv.org/pdf"]')
    if pdf_a:
        href = pdf_a.get("data") or pdf_a.get("href") or ""
        href = (href or "").strip()
        if href and "arxiv.org/pdf" in href:
            return href if href.startswith("http") else urljoin("https://arxiv.org", href)
        if href and UUID_PATTERN.match(href.split("?")[0]):
            return href if href.startswith("http") else urljoin(BASE, href)
    return None


def is_direct_download_url(url: str) -> bool:
    return bool(UUID_PATTERN.match(url.strip()))


def get_pdf_url_from_paper_page(arxiv_id: str, headless: bool = True) -> str | None:
    """
    打开 https://papers.cool/arxiv/<arxiv_id>，从页面中解析 [PDF] 链接。
    优先返回 papers.cool/<uuid> 直链；若无则返回 arxiv.org/pdf/<id>.pdf。
    """
    if not sync_playwright:
        return None
    url = f"{BASE}/arxiv/{arxiv_id}"
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless)
        try:
            page = browser.new_page()
            page.set_default_timeout(15000)
            page.goto(url, wait_until="domcontentloaded")
            page.wait_for_load_state("networkidle", timeout=10000)
            # 1) 查找 papers.cool/<uuid> 直链（[PDF] 可能是完整 URL 或相对路径 /uuid）
            def normalize_and_check_uuid(href: str) -> str | None:
                if not (href or href.strip()):
                    return None
                href = href.strip()
                if href.startswith("http") and "papers.cool/" in href:
                    path_only = href.split("?")[0].strip()
                    return href if UUID_PATTERN.match(path_only) else None
                if href.startswith("/"):
                    path_only = href.split("?")[0].strip()
                    if UUID_PATH_PATTERN.match(path_only):
                        return urljoin(BASE, href)
                return None

            for link in page.locator('a[href*="papers.cool/"], a[href^="/"]').all():
                try:
                    href = (link.get_attribute("href") or "").strip()
                    full = normalize_and_check_uuid(href)
                    if full:
                        return full
                    if href.startswith("/") and len(href) > 36:
                        full = urljoin(BASE, href)
                        if UUID_PATTERN.match(full.split("?")[0]):
                            return full
                except Exception:
                    continue
            # 1b) 按链接文本 [PDF] 查找
            try:
                pdf_link = page.locator('a:has-text("PDF")').first
                if pdf_link.count() > 0:
                    href = (pdf_link.get_attribute("href") or "").strip()
                    full = normalize_and_check_uuid(href)
                    if full:
                        return full
                    if "arxiv.org/pdf" in href:
                        return href if href.startswith("http") else urljoin("https://arxiv.org", href)
            except Exception:
                pass
            # 2) 查找 arxiv.org/pdf/ 链接（[PDF] 可能直接链到 arXiv）
            links_arxiv = page.locator('a[href*="arxiv.org/pdf"]').all()
            for link in links_arxiv:
                try:
                    href = (link.get_attribute("href") or "").strip()
                    if "arxiv.org/pdf" in href:
                        return href if href.startswith("http") else urljoin("https://arxiv.org", href)
                except Exception:
                    continue
            # 3) 无解析结果时由调用方回退到固定 arXiv URL
            return None
        finally:
            browser.close()


def download_file(url: str, output_path: Path, session: "requests.Session | None" = None) -> Path | None:
    """
    请求 url，按 Content-Disposition 或 URL 决定文件名，将内容写入 output_path。
    """
    if not requests:
        print("请安装 requests: pip install requests", file=sys.stderr)
        return None
    sess = session or requests.Session()
    sess.headers.setdefault("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36")
    try:
        r = sess.get(url, stream=True, timeout=60, allow_redirects=True)
        r.raise_for_status()
        # 优先从 Content-Disposition 取文件名
        cd = r.headers.get("Content-Disposition")
        if cd and "filename=" in cd:
            m = re.search(r'filename[*]?=(?:"([^"]+)"|([^;\s]+))', cd, re.I)
            if m:
                name = (m.group(1) or m.group(2) or "").strip()
                if name and not output_path.suffix:
                    output_path = output_path.parent / name
        content_type = (r.headers.get("Content-Type") or "").lower()
        if "pdf" in content_type and not output_path.suffix:
            output_path = output_path.with_suffix(".pdf")
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "wb") as f:
            for chunk in r.iter_content(chunk_size=65536):
                if chunk:
                    f.write(chunk)
        return output_path
    except Exception as e:
        print(f"下载失败: {e}", file=sys.stderr)
        return None


def dedupe_preserve_order(items: list[str]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for item in items:
        key = item.strip()
        if not key or key in seen:
            continue
        seen.add(key)
        ordered.append(key)
    return ordered


def remove_if_exists(path: Path) -> None:
    try:
        if path.exists():
            path.unlink()
    except Exception:
        pass


def build_pdf_candidates(raw: str, target_url: str, headless: bool) -> tuple[list[str], str]:
    candidates: list[str] = []
    default_name = "paper.pdf"

    if is_direct_download_url(target_url):
        candidates.append(target_url)
        default_name = Path(urlparse(target_url).path).name or "paper.pdf"
        if not Path(default_name).suffix:
            default_name += ".pdf"
        return dedupe_preserve_order(candidates), default_name

    arxiv_id = None
    if "/arxiv/" in target_url:
        arxiv_id = target_url.split("/arxiv/")[-1].split("?")[0].strip("/")
    elif ARXIV_ID_PATTERN.match(raw):
        arxiv_id = raw

    if not arxiv_id:
        return [], default_name

    default_name = f"{arxiv_id.replace('.', '_')}.pdf"
    http_candidate = get_pdf_url_from_paper_page_http(arxiv_id)
    if http_candidate:
        candidates.append(http_candidate)

    browser_candidate = get_pdf_url_from_paper_page(arxiv_id, headless=headless)
    if browser_candidate:
        candidates.append(browser_candidate)

    candidates.append(f"https://arxiv.org/pdf/{arxiv_id}.pdf")
    return dedupe_preserve_order(candidates), default_name


def run(
    url_or_arxiv_id: str,
    output_path: str | None = None,
    headless: bool = True,
) -> int:
    """
    若为 papers.cool 直链则直接下载；若为 arxiv_id 或论文页 URL 则先解析 PDF 直链再下载。
    返回 0 成功，1 失败。
    """
    raw = url_or_arxiv_id.strip()
    # 归一化为 URL
    if raw.startswith("http"):
        target_url = raw.split("?")[0]
    else:
        target_url = f"{BASE}/arxiv/{raw}"

    candidates, default_name = build_pdf_candidates(raw, target_url, headless=headless)
    if not candidates:
        print("未解析到 PDF 链接且无 arXiv ID。", file=sys.stderr)
        return 1

    out = Path(output_path) if output_path else Path(default_name)
    if out.is_dir():
        out = out / default_name
    if not out.suffix:
        out = out.with_suffix(".pdf")
    errors: list[str] = []

    for index, pdf_url in enumerate(candidates, start=1):
        print(f"尝试 {index}/{len(candidates)}: {pdf_url}")
        print(f"保存: {out}")
        downloaded_path = download_file(pdf_url, out)
        if not downloaded_path:
            errors.append(f"{pdf_url} -> download_failed")
            continue

        valid, reason = validate_pdf_file(downloaded_path)
        if valid:
            return 0

        remove_if_exists(downloaded_path)
        print(f"文件校验失败，准备重试其他来源: {reason}", file=sys.stderr)
        errors.append(f"{pdf_url} -> invalid_pdf:{reason}")

    print("所有候选 PDF 来源都失败。", file=sys.stderr)
    for error in errors:
        print(f"- {error}", file=sys.stderr)
    return 1


def main():
    parser = argparse.ArgumentParser(
        description="从 papers.cool 下载论文 PDF（支持直链或 arXiv ID）"
    )
    parser.add_argument(
        "url_or_arxiv_id",
        nargs="?",
        help="papers.cool 直链（如 https://papers.cool/2ae6f548-411c-48da-b9a5-f40ab4437632）或 arXiv ID（如 2602.20400）",
    )
    parser.add_argument(
        "-o", "--output",
        default=None,
        help="输出路径：文件路径（如 /path/to/paper.pdf）或目录（则在该目录下保存为 <arxiv_id>.pdf）",
    )
    parser.add_argument("--no-headless", action="store_true", help="解析论文页时显示浏览器")
    args = parser.parse_args()

    if not args.url_or_arxiv_id:
        parser.print_help()
        sys.exit(2)

    sys.exit(run(
        args.url_or_arxiv_id,
        output_path=args.output,
        headless=not args.no_headless,
    ))


if __name__ == "__main__":
    main()
