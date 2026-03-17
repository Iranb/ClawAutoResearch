#!/usr/bin/env python3
"""
从 papers.cool 单篇论文页抓取内容，包括 JS 动态加载的 Kimi 分析等。
依赖: pip install playwright && playwright install chromium
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
import warnings
from pathlib import Path

warnings.filterwarnings("ignore", message=".*urllib3 v2 only supports OpenSSL.*", category=UserWarning)

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    sync_playwright = None  # 仅 scrape_paper 需要；build_paper_url 可无依赖使用

try:
    import requests
except ImportError:
    requests = None

try:
    from bs4 import BeautifulSoup
except ImportError:
    BeautifulSoup = None

BASE_URL = "https://papers.cool/arxiv"


def build_paper_url(url_or_arxiv_id: str) -> str:
    if url_or_arxiv_id.startswith("http"):
        return url_or_arxiv_id.strip("/")
    arxiv_id = url_or_arxiv_id.strip()
    if not re.match(r"^[\d]+\.[\d]+v?\d*$", arxiv_id) and not re.match(r"^\d{4}\.\d{4,5}$", arxiv_id):
        arxiv_id = arxiv_id.replace(" ", "")
    return f"{BASE_URL}/{arxiv_id}"


def _scrape_paper_http(url: str) -> dict | None:
    """用 HTTP + BS4 抓取单篇页的 title/abstract（与 search 同结构）。无需 Playwright。"""
    if not requests or not BeautifulSoup:
        return None
    try:
        resp = requests.get(
            url,
            headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"},
            timeout=15,
        )
        resp.raise_for_status()
    except Exception:
        return None
    soup = BeautifulSoup(resp.text, "html.parser")
    arxiv_id = url.split("/arxiv/")[-1].split("?")[0].strip("/") if "/arxiv/" in url else ""
    panel = soup.find("div", class_="paper", id=re.compile(r"^\d{4}\.\d{4,5}$"))
    if not panel and arxiv_id:
        panel = soup.find("div", id=arxiv_id, class_=lambda c: c and "paper" in (c if isinstance(c, list) else [c]))
    if not panel:
        return None
    title = ""
    a = panel.select_one("h2.title a.title-link")
    if a:
        title = (a.get_text(strip=True) or "").strip()
    summary_el = panel.select_one("p.summary")
    abstract = (summary_el.get_text(strip=True) or "").strip() if summary_el else ""
    return {"url": url, "title": title, "abstract": abstract[:5000], "kimi_analysis": "", "full_main": "", "error": None}


def extract_text(element) -> str:
    try:
        return (element.inner_text() or "").strip()
    except Exception:
        return ""


def scrape_paper(
    url: str,
    wait_extra_seconds: float = 5.0,
    wait_for_kimi_selector: str | None = None,
    headless: bool = True,
) -> dict:
    """
    使用 Playwright 打开论文页，等待动态内容加载，提取标题、摘要及 Kimi 分析等。
    若不需要 Kimi（wait_for_kimi_selector 为 None），先尝试 HTTP 解析以加速且无需浏览器。
    """
    if wait_for_kimi_selector is None:
        http_result = _scrape_paper_http(url)
        if http_result and (http_result.get("title") or http_result.get("abstract")):
            return http_result

    result = {"url": url, "title": "", "abstract": "", "kimi_analysis": "", "full_main": "", "error": None}
    if sync_playwright is None:
        result["error"] = "请先安装: pip install playwright && playwright install chromium"
        return result

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless)
        try:
            page = browser.new_page()
            page.set_default_timeout(20000)

            page.goto(url, wait_until="domcontentloaded")
            page.wait_for_load_state("networkidle", timeout=15000)

            if wait_extra_seconds > 0:
                time.sleep(wait_extra_seconds)

            # 从 URL 解析 arxiv_id，用于定位 Kimi 入口（id="kimi-<arxiv_id>"）
            arxiv_id_from_url = ""
            if "/arxiv/" in url:
                arxiv_id_from_url = url.split("/arxiv/")[-1].split("?")[0].strip("/")

            # 优先点击 papers.cool 的 Kimi 入口（触发 toggleKimi 加载真实分析内容）
            kimi_clicked = False
            kimi_link_selector: str | None = None
            for selector in (
                wait_for_kimi_selector,
                f'a#kimi-{arxiv_id_from_url}' if arxiv_id_from_url else None,
                'a.title-kimi',
                'a[id^="kimi-"]',
                'a[onclick*="toggleKimi"]',
                'a:has-text("Kimi")',
            ):
                if not selector:
                    continue
                try:
                    el = page.locator(selector).first
                    if el.count() > 0 and el.is_visible():
                        el.click()
                        kimi_link_selector = selector
                        kimi_clicked = True
                        break
                except Exception:
                    pass

            # 若未点击到，再尝试通用选择器
            if not kimi_clicked:
                for selector in (
                    'a[href*="kimi"]',
                    'button:has-text("Kimi")',
                    '[class*="kimi"]:not(a)',
                ):
                    try:
                        el = page.locator(selector).first
                        if el.count() > 0 and el.is_visible():
                            el.click()
                            kimi_link_selector = selector
                            break
                    except Exception:
                        pass

            # 点击后等待 Kimi 内容加载（常见为下一兄弟节点或独立内容区）
            if kimi_link_selector:
                try:
                    page.wait_for_load_state("networkidle", timeout=8000)
                except Exception:
                    pass
                # 等待可能出现的 Kimi 内容区域（若站点用 div 展示）
                for wait_sel in (
                    'div[id*="kimi-content"]',
                    'div[class*="kimi-content"]',
                    '[class*="kimi-analy"]',
                ):
                    try:
                        page.wait_for_selector(wait_sel, state="visible", timeout=5000)
                        break
                    except Exception:
                        continue
                time.sleep(max(4, int(wait_extra_seconds)))

            # 提取主内容区
            main = page.locator("main").first
            if main.count() == 0:
                main = page.locator("#content, .content, [role='main'], body").first
            if main.count() > 0:
                result["full_main"] = extract_text(main)

            # 标题：h1 或 第一个 #N Title 形式
            h1 = page.locator("h1").first
            if h1.count() > 0:
                result["title"] = extract_text(h1)

            # 摘要：第一个长段落（Authors: 与 Subjects: 之间的内容，或首段长文本）
            for selector in (
                "article p",
                "main p",
                "[class*='abstract']",
                "[class*='summary']",
            ):
                try:
                    paras = page.locator(selector).all()
                    for p in paras:
                        text = extract_text(p)
                        if len(text) > 200 and "Authors:" not in text and "Subjects:" not in text:
                            result["abstract"] = text
                            break
                    if result["abstract"]:
                        break
                except Exception:
                    pass
            if not result["abstract"] and result["full_main"]:
                # 从 full_main 中按经验截取摘要：## #1 Title 后到 Subjects: 前
                m = re.search(
                    r"#\d+(.+?)(?:Authors:.*?)(.+?)(?=Subjects:|---|$)",
                    result["full_main"],
                    re.DOTALL,
                )
                if m:
                    result["abstract"] = m.group(2).strip()[:5000]

            # Kimi 分析：点击后出现的真实内容块（常见为链接的下一兄弟节点或独立 div）
            # 1) 先尝试点击过的 Kimi 链接的下一兄弟节点（papers.cool 常用结构）
            if kimi_link_selector and not result["kimi_analysis"]:
                try:
                    link_loc = page.locator(kimi_link_selector).first
                    if link_loc.count() > 0:
                        sibling = link_loc.locator("xpath=following-sibling::*").first
                        if sibling.count() > 0:
                            text = extract_text(sibling)
                            if text and len(text) > 200 and text != (result.get("abstract") or ""):
                                if any(k in text for k in ("分析", "总结", "解读", "本文", "论文", "This paper", "approach", "method")):
                                    result["kimi_analysis"] = text
                                elif len(text) > 400:
                                    result["kimi_analysis"] = text
                except Exception:
                    pass
            # 2) 常见内容容器
            for selector in (
                'div[id*="kimi-content"]',
                'div[class*="kimi-content"]',
                '[class*="kimi-analy"]',
                'div[class*="kimi"]:not(.title-kimi)',
                '[id*="kimi-content"]',
            ):
                if result["kimi_analysis"]:
                    break
                try:
                    els = page.locator(selector).all()
                    for el in els:
                        text = extract_text(el)
                        if not text or len(text) < 150:
                            continue
                        if text == result.get("abstract"):
                            continue
                        if any(k in text for k in ("分析", "总结", "解读", "本文", "论文", "This paper")):
                            result["kimi_analysis"] = text
                            break
                        if len(text) > 300:
                            result["kimi_analysis"] = text
                            break
                except Exception:
                    pass
            # 兜底：从 full_main 中排除摘要和标题，取点击后可能多出来的长段（Kimi 分析通常在页面靠后）
            if not result["kimi_analysis"] and result["full_main"]:
                parts = re.split(r"Save\s*$|Bug report\?|Github:", result["full_main"], flags=re.M)
                abstract_pre = (result.get("abstract") or "")[:100]
                for part in reversed(parts):
                    part = part.strip()
                    if len(part) > 200 and abstract_pre and abstract_pre not in part:
                        if "分析" in part or "总结" in part or "本文" in part or "论文" in part:
                            result["kimi_analysis"] = part[:12000]
                            break

        except Exception as e:
            result["error"] = str(e)
        finally:
            browser.close()

    return result


def main():
    parser = argparse.ArgumentParser(
        description="抓取 papers.cool 论文页内容（含动态加载的 Kimi 分析）"
    )
    parser.add_argument(
        "url_or_arxiv_id",
        nargs="?",
        help="论文 URL 或 arXiv ID，如 2502.00032 或 https://papers.cool/arxiv/2502.00032",
    )
    parser.add_argument(
        "--url",
        dest="url_explicit",
        help="同上，显式指定 URL 或 arxiv_id",
    )
    parser.add_argument(
        "--wait",
        type=float,
        default=5.0,
        metavar="SECONDS",
        help="页面加载后额外等待秒数，便于动态内容出现（默认 5）",
    )
    parser.add_argument(
        "--kimi-selector",
        dest="kimi_selector",
        default=None,
        help="可选：用于触发或定位 Kimi 分析区域的 CSS 选择器",
    )
    parser.add_argument(
        "--no-headless",
        action="store_true",
        help="显示浏览器窗口（便于调试）",
    )
    parser.add_argument(
        "-o", "--output",
        dest="output_file",
        default=None,
        help="输出路径：文件路径（如 /path/to/result.json）或目录（则写入该目录下 paper_<arxiv_id>.json）",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="始终以 JSON 格式输出",
    )
    args = parser.parse_args()

    raw = args.url_or_arxiv_id or args.url_explicit
    if not raw:
        parser.print_help()
        sys.exit(2)

    url = build_paper_url(raw)
    out = scrape_paper(
        url,
        wait_extra_seconds=args.wait,
        wait_for_kimi_selector=args.kimi_selector,
        headless=not args.no_headless,
    )

    arxiv_id_from_url = url.split("/arxiv/")[-1].split("?")[0].strip("/") if "/arxiv/" in url else "paper"
    if args.output_file:
        path = Path(args.output_file)
        if not path.suffix or (path.exists() and path.is_dir()):
            path = path.resolve()
            path.mkdir(parents=True, exist_ok=True)
            default_name = f"paper_{arxiv_id_from_url.replace('/', '_')}.json" if args.json else f"paper_{arxiv_id_from_url.replace('/', '_')}.txt"
            path = path / default_name
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
        if path.suffix.lower() == ".json" or args.json:
            path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
        else:
            parts = [
                f"# {out['title'] or 'Paper'}\n",
                f"URL: {out['url']}\n",
                "\n## Abstract\n",
                out["abstract"] or "(未提取到)\n",
                "\n## Kimi 分析\n",
                out["kimi_analysis"] or "(未检测到动态 Kimi 分析，可增大 --wait 或检查页面)\n",
            ]
            path.write_text("".join(parts), encoding="utf-8")
        print(f"已写入: {path}", file=sys.stderr)

    if args.json or args.output_file and Path(args.output_file).suffix.lower() == ".json":
        print(json.dumps(out, ensure_ascii=False, indent=2))
    else:
        print(out["title"] or "(无标题)")
        print(out["url"])
        print("\n--- Abstract ---")
        print(out["abstract"] or "(未提取到)")
        print("\n--- Kimi 分析 ---")
        print(out["kimi_analysis"] or "(未检测到)")
        if out["error"]:
            print("\nError:", out["error"], file=sys.stderr)

    sys.exit(1 if out["error"] else 0)


if __name__ == "__main__":
    main()
