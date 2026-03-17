#!/usr/bin/env python3
"""
针对单篇论文的完整测试：抓取摘要、页上 Kimi 分析，并下载 PDF。

用法（二选一）:
  # 在 skill 根目录 papers-cool/ 下:
  python scripts/test_one_paper.py [arxiv_id]
  # 或在 scripts/ 目录下:
  python test_one_paper.py [arxiv_id]

示例: python test_one_paper.py 2502.09564
依赖: pip install -r requirements.txt && playwright install chromium
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SKILL_ROOT = os.path.dirname(SCRIPT_DIR)
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)
os.chdir(SKILL_ROOT)

ARXIV_ID = (sys.argv[1] if len(sys.argv) > 1 else "2502.09564").strip()


def main():
    print(f"=== 测试论文 https://papers.cool/arxiv/{ARXIV_ID} ===\n")
    result = {}

    # 1. 抓取摘要 + Kimi 分析
    from fetch_paper_dynamic import scrape_paper, build_paper_url
    url = build_paper_url(ARXIV_ID)
    print("1. 抓取摘要与页上 Kimi 分析…")
    result = scrape_paper(url, wait_extra_seconds=6.0)
    if result.get("error"):
        print(f"   错误: {result['error']}")
        if "playwright" in (result["error"] or "").lower():
            print("   请先执行: pip install -r requirements.txt && playwright install chromium")
        print()
    else:
        print(f"   标题: {(result.get('title') or '(无)')[:80]}")
        print(f"   摘要长度: {len(result.get('abstract') or '')} 字符")
        print(f"   Kimi 分析长度: {len(result.get('kimi_analysis') or '')} 字符")
        if result.get("abstract"):
            print(f"   摘要: {(result['abstract'][:400])}…")
        if result.get("kimi_analysis"):
            print(f"   Kimi 分析: {(result['kimi_analysis'][:400])}…")
        out_json = Path(SKILL_ROOT) / f"test_one_{ARXIV_ID.replace('.', '_')}.json"
        out_json.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"   已保存: {out_json}\n")

    # 2. 下载 PDF（先解析直链再下载，或直链）
    print("2. 下载 PDF…")
    from download_paper import run as download_run
    out_pdf = Path(SKILL_ROOT) / f"{ARXIV_ID.replace('.', '_')}.pdf"
    code = download_run(ARXIV_ID, output_path=str(out_pdf))
    if code == 0:
        print(f"   已保存: {out_pdf}\n")
    else:
        print("   若未解析到 papers.cool 直链，可用 arXiv 官方: https://arxiv.org/pdf/" + ARXIV_ID + ".pdf\n")

    print("=== 结束 ===")
    return 0 if not result.get("error") else 1


if __name__ == "__main__":
    sys.exit(main())
