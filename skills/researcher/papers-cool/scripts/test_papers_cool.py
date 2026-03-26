#!/usr/bin/env python3
"""
papers-cool 统一测试入口（合并 test_fetch、test_search_and_save、test_papers_cool）。

- 默认：运行单元测试（URL 解析、直链判断，无需网络/浏览器）
- --integration：运行单元 + 集成测试（需 Playwright + 网络）
- --manual：手动试跑「单篇抓取 + 可选列表 + 可选搜索」
- --search-and-save [关键词]：手动试跑「关键词搜索 → 抓摘要 → 保存到文件」

运行方式：
  cd customskills/papers-cool && python scripts/test_papers_cool.py
  python scripts/test_papers_cool.py -v
  python scripts/test_papers_cool.py --integration
  python scripts/test_papers_cool.py --manual [--list] [--search 关键词]
  python scripts/test_papers_cool.py --search-and-save [关键词] [--max N]
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SKILL_ROOT = os.path.dirname(SCRIPT_DIR)
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)
os.chdir(SKILL_ROOT)

RUN_INTEGRATION = os.environ.get("RUN_INTEGRATION", "").lower() in ("1", "true", "yes")


# ---------- 单元测试（无网络） ----------


class TestBuildPaperUrl(unittest.TestCase):
    """fetch_paper_dynamic.build_paper_url"""

    def setUp(self):
        from fetch_paper_dynamic import build_paper_url
        self.build_paper_url = build_paper_url

    def test_arxiv_id_short(self):
        self.assertEqual(
            self.build_paper_url("2502.00032"),
            "https://papers.cool/arxiv/2502.00032",
        )

    def test_arxiv_id_with_version(self):
        self.assertEqual(
            self.build_paper_url("2602.20400v1"),
            "https://papers.cool/arxiv/2602.20400v1",
        )

    def test_full_url_passthrough(self):
        url = "https://papers.cool/arxiv/2602.20400"
        self.assertEqual(self.build_paper_url(url), url)

    def test_full_url_trailing_slash_stripped(self):
        self.assertEqual(
            self.build_paper_url("https://papers.cool/arxiv/2602.20400/"),
            "https://papers.cool/arxiv/2602.20400",
        )


class TestDownloadPaperUrlDetection(unittest.TestCase):
    """download_paper: 直链判断与 arXiv ID 正则"""

    def setUp(self):
        from download_paper import is_direct_download_url, UUID_PATTERN, ARXIV_ID_PATTERN
        self.is_direct = is_direct_download_url
        self.uuid_pattern = UUID_PATTERN
        self.arxiv_pattern = ARXIV_ID_PATTERN

    def test_direct_download_url_valid(self):
        self.assertTrue(
            self.is_direct("https://papers.cool/2ae6f548-411c-48da-b9a5-f40ab4437632")
        )
        self.assertTrue(
            self.is_direct("http://papers.cool/2ae6f548-411c-48da-b9a5-f40ab4437632")
        )

    def test_direct_download_url_with_query(self):
        url = "https://papers.cool/2ae6f548-411c-48da-b9a5-f40ab4437632?foo=1"
        self.assertTrue(self.is_direct(url))
        self.assertTrue(self.uuid_pattern.match(url.split("?")[0].strip()))

    def test_not_direct_url(self):
        self.assertFalse(self.is_direct("https://papers.cool/arxiv/2602.20400"))
        self.assertFalse(self.is_direct("https://arxiv.org/pdf/2602.20400.pdf"))

    def test_arxiv_id_pattern(self):
        self.assertTrue(self.arxiv_pattern.match("2602.20400"))
        self.assertTrue(self.arxiv_pattern.match("2502.00032"))
        self.assertIsNotNone(self.arxiv_pattern.match("2602.20400v1"))


class TestCanonicalPaperFilenames(unittest.TestCase):
    def setUp(self):
        from paper_filename import canonical_paper_filename, normalize_arxiv_id, slugify_paper_title
        from download_paper import build_pdf_candidates
        self.canonical_paper_filename = canonical_paper_filename
        self.normalize_arxiv_id = normalize_arxiv_id
        self.slugify_paper_title = slugify_paper_title
        self.build_pdf_candidates = build_pdf_candidates

    def test_arxiv_filename_keeps_dot_and_drops_version(self):
        self.assertEqual(self.normalize_arxiv_id("2602.20400v1"), "2602.20400")
        self.assertEqual(
            self.canonical_paper_filename(".pdf", arxiv_id="2602.20400v1"),
            "2602.20400.pdf",
        )

    def test_title_filename_slugifies_special_characters(self):
        self.assertEqual(
            self.slugify_paper_title("Graph & Reasoning: A Survey / 2026?"),
            "graph-and-reasoning-a-survey-2026",
        )
        self.assertEqual(
            self.canonical_paper_filename(".md", title="Graph & Reasoning: A Survey / 2026?"),
            "graph-and-reasoning-a-survey-2026.md",
        )

    def test_direct_pdf_download_uses_title_slug_when_provided(self):
        candidates, default_name = self.build_pdf_candidates(
            "https://papers.cool/2ae6f548-411c-48da-b9a5-f40ab4437632",
            "https://papers.cool/2ae6f548-411c-48da-b9a5-f40ab4437632",
            headless=True,
            title="Graph & Reasoning: A Survey / 2026?",
        )
        self.assertEqual(len(candidates), 1)
        self.assertEqual(default_name, "graph-and-reasoning-a-survey-2026.pdf")


class TestPaperSourceValidation(unittest.TestCase):
    """validate_paper_source helpers"""

    def setUp(self):
        from validate_paper_source import validate_markdown_file, validate_pdf_file
        self.validate_markdown_file = validate_markdown_file
        self.validate_pdf_file = validate_pdf_file

    def test_valid_pdf_header(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "paper.pdf"
            path.write_bytes(b"%PDF-1.7\n" + b"0" * 1024)
            valid, reason = self.validate_pdf_file(path)
            self.assertTrue(valid, reason)

    def test_html_disguised_as_pdf_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "paper.pdf"
            path.write_text("<!DOCTYPE html><html><body>Access denied</body></html>", encoding="utf-8")
            valid, reason = self.validate_pdf_file(path)
            self.assertFalse(valid)
            self.assertIn(reason, {"html_or_error_page", "too_small"})

    def test_valid_markdown_passes(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "paper.md"
            path.write_text(
                "# Paper Title\n\n## Abstract\n\nThis paper studies a method for robust training.\n\n## Introduction\n\n"
                + ("content " * 120),
                encoding="utf-8",
            )
            valid, reason = self.validate_markdown_file(path)
            self.assertTrue(valid, reason)

    def test_html_disguised_as_markdown_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "paper.md"
            path.write_text("<!DOCTYPE html><html><body>Just a moment...</body></html>", encoding="utf-8")
            valid, reason = self.validate_markdown_file(path)
            self.assertFalse(valid)
            self.assertIn(reason, {"html_or_error_page", "too_small"})


# ---------- 集成测试（需 Playwright + 网络，默认跳过） ----------


@unittest.skipUnless(RUN_INTEGRATION or "--integration" in sys.argv, "集成测试默认跳过")
class TestIntegrationScrapePaper(unittest.TestCase):
    """单篇论文页抓取（真实请求）"""

    def test_scrape_one_paper(self):
        from fetch_paper_dynamic import scrape_paper, build_paper_url
        url = build_paper_url("2602.20400")
        result = scrape_paper(url, wait_extra_seconds=2.0)
        self.assertIsNone(result.get("error"), result.get("error"))
        self.assertTrue(len(result.get("title") or "") > 0 or len(result.get("abstract") or "") > 0)


@unittest.skipUnless(RUN_INTEGRATION or "--integration" in sys.argv, "集成测试默认跳过")
class TestIntegrationSearchAndSave(unittest.TestCase):
    """关键词搜索 + 抓摘要 + 保存（真实请求，最多 1 篇）"""

    def test_search_and_save_one(self):
        import tempfile
        from search_and_save_papers import search_and_save
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "papers.json"
            result = search_and_save(
                keyword="unsupervised elicitation",
                output_path=str(out),
                max_results=1,
                format_output="json",
                wait_search=3.0,
                wait_per_paper=2.0,
                headless=True,
            )
            self.assertIn("papers", result)
            if result.get("papers"):
                p = result["papers"][0]
                self.assertIn("title", p)
                self.assertIn("abstract", p)
                self.assertIn("arxiv_id", p)


# ---------- 手动试跑：单篇 + 列表 + 搜索 ----------


def run_manual_fetch() -> int:
    """手动试跑：单篇论文抓取，可选列表页、关键词搜索。"""
    from fetch_paper_dynamic import scrape_paper, build_paper_url

    url = build_paper_url("2502.00032")
    print("=== papers-cool 手动试跑：单篇 + 可选列表/搜索 ===\n")
    print(f"1. 抓取单篇: {url}")
    print("   等待约 5 秒…")
    result = scrape_paper(url, wait_extra_seconds=5.0)
    if result.get("error"):
        print(f"   错误: {result['error']}\n")
    else:
        print(f"   标题: {(result.get('title') or '(无)')[:80]}")
        print(f"   摘要长度: {len(result.get('abstract') or '')} 字符")
        print(f"   Kimi 分析长度: {len(result.get('kimi_analysis') or '')} 字符")
        if result.get("abstract"):
            print(f"   摘要前 200 字: {(result['abstract'][:200])}…")
        if result.get("kimi_analysis"):
            print(f"   Kimi 分析前 200 字: {(result['kimi_analysis'][:200])}…")
    print()

    if "--list" in sys.argv or "-l" in sys.argv:
        from list_papers_dynamic import scrape_list
        list_url = "https://papers.cool/arxiv/cs.LG"
        print(f"2. 抓取列表: {list_url} (最多 5 条)")
        list_result = scrape_list(list_url, wait_extra_seconds=3.0, max_papers=5)
        if list_result.get("error"):
            print(f"   错误: {list_result['error']}")
        else:
            papers = list_result.get("papers") or []
            print(f"   共 {len(papers)} 条")
            for i, p in enumerate(papers[:5], 1):
                print(f"   [{i}] {p.get('arxiv_id', '')} | {(p.get('title') or '')[:60]}")
        print()
    else:
        print("(加 --list 或 -l 可同时测试列表页)\n")

    if "--search" in sys.argv or "-s" in sys.argv:
        from search_papers import search_papers
        kw = "transformer"
        for i, a in enumerate(sys.argv):
            if a in ("--search", "-s") and i + 1 < len(sys.argv):
                kw = sys.argv[i + 1]
                break
        print(f"3. 关键词搜索: “{kw}”")
        sr = search_papers(kw, max_results=5, wait_after_search=4.0)
        if sr.get("error"):
            print(f"   错误: {sr['error']}")
        else:
            papers = sr.get("papers") or []
            print(f"   共 {len(papers)} 条")
            for i, p in enumerate(papers[:5], 1):
                print(f"   [{i}] {p.get('arxiv_id', '')} | {(p.get('title') or '')[:60]}")
        print()

    out_path = Path(SKILL_ROOT) / "test_output.json"
    out_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"单篇结果已写入: {out_path}")
    print("=== 结束 ===")
    return 0 if not result.get("error") else 1


# ---------- 手动试跑：关键词搜索 + 抓摘要 + 保存 ----------


def run_manual_search_and_save() -> int:
    """手动试跑：关键词搜索 → 抓摘要 → 保存到文件。"""
    from search_and_save_papers import search_and_save

    keyword = "unsupervised elicitation"
    max_results = 2
    for i, a in enumerate(sys.argv):
        if a == "--max" and i + 1 < len(sys.argv):
            max_results = int(sys.argv[i + 1])
            break
        if a not in ("--max", "-m") and not a.startswith("-") and a != "--search-and-save":
            keyword = a
            break

    out_json = Path(SKILL_ROOT) / "test_papers_saved.json"
    out_md = Path(SKILL_ROOT) / "test_papers_saved.md"
    print("=== 手动试跑：关键词搜索 + 抓摘要 + 保存 ===\n")
    print(f"关键词: {keyword}, 最多: {max_results}")
    print(f"输出: {out_json} 与 {out_md}\n")

    result = search_and_save(
        keyword=keyword,
        output_path=str(out_json),
        max_results=max_results,
        format_output="json",
        wait_search=4.0,
        wait_per_paper=2.0,
        headless=True,
    )

    for e in result.get("errors") or []:
        print(f"  警告: {e}", file=sys.stderr)
    papers = result.get("papers") or []
    print(f"已保存 {len(papers)} 篇到 {out_json}")

    if not papers:
        print("未获取到论文。")
        return 1

    lines = [f"# 关键词: {keyword}\n", f"共 {len(papers)} 篇\n\n"]
    for p in papers:
        lines.append(f"## {p.get('title') or '(无标题)'}\n")
        lines.append(f"- **arXiv**: {p.get('arxiv_id')}\n")
        lines.append(f"- **URL**: {p.get('url')}\n\n**摘要**\n\n{p.get('abstract') or '(无)'}\n\n---\n\n")
    out_md.write_text("".join(lines), encoding="utf-8")
    print(f"已保存 Markdown 到 {out_md}")

    first = papers[0]
    print("\n--- 首条预览 ---")
    print(f"标题: {(first.get('title') or '')[:70]}")
    print(f"arXiv: {first.get('arxiv_id')}")
    print(f"摘要长度: {len(first.get('abstract') or '')} 字符")
    if first.get("abstract"):
        print(f"摘要前 300 字: {(first['abstract'][:300])}…")
    print("\n=== 结束 ===")
    return 0


# ---------- 主入口 ----------


def suite_unit_only():
    loader = unittest.TestLoader()
    return unittest.TestSuite([
        loader.loadTestsFromTestCase(TestBuildPaperUrl),
        loader.loadTestsFromTestCase(TestDownloadPaperUrlDetection),
        loader.loadTestsFromTestCase(TestCanonicalPaperFilenames),
        loader.loadTestsFromTestCase(TestPaperSourceValidation),
    ])


def suite_all():
    loader = unittest.TestLoader()
    s = suite_unit_only()
    s.addTests(loader.loadTestsFromTestCase(TestIntegrationScrapePaper))
    s.addTests(loader.loadTestsFromTestCase(TestIntegrationSearchAndSave))
    return s


if __name__ == "__main__":
    if "--manual" in sys.argv:
        sys.exit(run_manual_fetch())
    if "--search-and-save" in sys.argv:
        sys.argv.remove("--search-and-save")
        sys.exit(run_manual_search_and_save())

    use_integration = "--integration" in sys.argv or RUN_INTEGRATION
    sys.argv = [a for a in sys.argv if a != "--integration"]
    runner = unittest.TextTestRunner(verbosity=2)
    s = suite_all() if use_integration else suite_unit_only()
    result = runner.run(s)
    sys.exit(0 if result.wasSuccessful() else 1)
