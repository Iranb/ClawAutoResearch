---
name: papers-cool
description: Search and fetch paper abstracts and PDFs from papers.cool (arXiv + Venue index), then use Kimi or the current model to summarize or explain content. Use when the user asks to find papers by keyword, get paper summaries, download PDFs from arXiv/papers.cool, or have Kimi understand a paper.
homepage: https://papers.cool/
metadata:
  {"openclaw": {"emoji": "📄", "homepage": "https://papers.cool/", "requires": {"bins": ["python3"]}}}
---

# Papers.cool — Paper discovery, abstract fetching & Kimi analysis

[papers.cool](https://papers.cool/) is an on-site paper search engine built on **tantivy**, indexing **arXiv** and many **Venues** (AAAI, ACL, CVPR, ICLR, ICML, NeurIPS, etc.). It stays in sync with arXiv, usually with under 10 minutes delay. The site is by [kexue.fm](https://kexue.fm/) and powered by [Kimi](https://kimi.moonshot.cn/?ref=papers.cool).

## 🚀 MANDATORY WORKFLOW FOR RESEARCH PIPELINE

**When used in research-pipeline context:**

1. **Search papers by keyword** → Get arXiv IDs and titles
2. **For EACH paper found** (not just 1-2):
   - **Priority 1:** Try HuggingFace markdown first (`/hugging-face-paper-pages`)
   - **Priority 2:** If HF fails, download PDF
   - **Priority 3:** Save to `paper_source_dir/md/` or `paper_source_dir/pdf/`
3. **After ingesting ≥3 new papers** → Auto-trigger `/graph-build`
4. **After graph build** → Update `PROJECT_MANIFEST.json` with `graph_presence_checked_at`

**Do NOT:**
- Only pick 1-2 papers from search results
- Skip graph build after paper ingestion
- Download PDFs without first checking HuggingFace for markdown

---

## HuggingFace Paper Pages (PRIORITY 1)

**Use `/hugging-face-paper-pages` skill FIRST** before downloading PDFs.

### HuggingFace Markdown Fetch

For each arXiv ID from search results:

```bash
# Check HuggingFace for markdown
/hugging-face-paper-pages --arxiv <arxiv_id> --output-dir {PROJ}/researcher/paper_source/md/
```

**If markdown found:**
- Save to `{paper_source_dir}/md/<arxiv_id>--<normalized-title>.md`
- **Immediately add to graph build queue**
- Skip PDF download for this paper

**If markdown NOT found:**
- Fall back to PDF download (see below)
- Save to `{paper_source_dir}/pdf/<arxiv_id>--<normalized-title>.pdf`

### Batch HuggingFace Check

For efficiency, check multiple papers at once:

```python
# scripts/check_hf_batch.py
import requests
from concurrent.futures import ThreadPoolExecutor

def check_hf(arxiv_id):
    url = f"https://huggingface.co/papers/{arxiv_id}"
    # Check if markdown available
    ...

arxiv_ids = [...]  # From search results
with ThreadPoolExecutor(max_workers=10) as executor:
    results = list(executor.map(check_hf, arxiv_ids))
```

---

## Data sources and URL rules

- **Home**: `https://papers.cool/` — use `web_fetch` to get arXiv categories and Venue links.
- **arXiv by category**: `https://papers.cool/arxiv/<category>`  
  Common: `cs.LG` (ML), `cs.AI`, `cs.CL`, `cs.CV`, `math.LO`, `stat.ML`. Full list on the home page.
- **Venue browse**: `https://papers.cool/venue/<Venue.Year>` 或 `https://papers.cool/venue/<Venue.Year>?group=<GroupName>&show=N`  
  e.g. `ICLR.2025`, `NeurIPS.2024`；按子分类（如 Poster、Oral）用 `?group=Poster`。**支持 `?show=N` 指定返回条数**（如 `?show=1000`），可直接 wget/HTTP 获取列表页。
- **Single paper page**: `https://papers.cool/arxiv/<arxiv_id>`  
  e.g. `https://papers.cool/arxiv/2502.00032`. Page includes title, authors, **full abstract**, Subjects, and PDF/Copy/Kimi/REL links.
- **On-site search**: Home page has a "Search" box (tantivy). **To find papers by keyword**, use this skill's Python script `scripts/search_papers.py`: it requests the search URL directly (HTTP + HTML parse), no browser. **Do not use web_search**.

## Workflow: keyword → list → abstract → PDF → Kimi analysis

### 1. Find papers by keyword

- **Use the Python script**: run `python scripts/search_papers.py "<keyword>"` (or `--query "<keyword>"`). The script **requests the search URL** (`https://papers.cool/arxiv/search?highlight=1&query=...&sort=0|1`) with HTTP and parses the HTML (BeautifulSoup); the site is server-rendered, **no browser**. Use **`--sort 0`** for time order (default), **`--sort 1`** for reading star order. Output: title, abstract snippet, arxiv_id, links. Use `-o result.json` to save.
- **Save ALL results**: Use `scripts/search_and_save_papers.py`. It (1) searches by keyword (HTTP), (2) for each result fetches full title and abstract from **https://papers.cool/arxiv/<arxiv_id>** (HTTP first, Playwright only if needed), (3) writes JSON or Markdown. Use `--debug /path/to/file` to save search-page debug when 0 results.
- **ALL papers must be processed**: Do not filter or select only a few. The research pipeline needs comprehensive literature coverage.
- **Optional**: For a known category or venue, use `list_papers_dynamic.py` (also HTTP + BeautifulSoup), e.g. `python scripts/list_papers_dynamic.py https://papers.cool/arxiv/cs.LG`. **按会议查询**：使用 `venue_papers.py`，传入会议 ID 与 `--show N`，可选 `--group <子分类>`（如 Poster、Oral）做分类查询，如 `python scripts/venue_papers.py CVPR.2025 --show 1000`、`python scripts/venue_papers.py CVPR.2025 --group Poster --show 50`；当前支持的会议列表可用 `list_venues.py` 从首页解析获得。
- **Do not** use `web_search` for "find papers by keyword"; use this skill's Python scripts for on-site results.

### 2. Fetch abstracts

- **Python (recommended)**: Target URL is **https://papers.cool/arxiv/<arxiv_id>**. Use `fetch_paper_dynamic.py`'s `scrape_paper`: when **not** needing Kimi it first uses **HTTP + BeautifulSoup** to get title/abstract (no browser); only when you need **Kimi analysis** does it use Playwright to open the page and click the Kimi entry. Use `search_and_save_papers.py` to batch-fetch and save after a keyword search.
- With OpenClaw `web_fetch`: open the single-page URL; the long block under "## #1 …" is the **abstract**. You can also extract title, authors, Subjects.
- If you already have the abstract text, skip to the Kimi step.

### 3. Get PDF (PRIORITY 2 - after HuggingFace check)

- **Check HuggingFace FIRST**: Before downloading PDF, check if markdown is available on HuggingFace
- **papers.cool direct link**: The site offers direct download URLs like `https://papers.cool/<uuid>`. Use **`scripts/download_paper.py`**: pass the direct link to download immediately. For **arXiv ID or paper page URL**, the script first tries **HTTP + BeautifulSoup** to get the PDF link from `a.title-pdf`; if that fails it uses Playwright to open the page and parse [PDF], then downloads; fallback is `https://arxiv.org/pdf/<arxiv_id>.pdf`. Dependencies: `requests`, `beautifulsoup4`; `playwright` only for fallback when HTTP parse fails.
- **arXiv**: PDF is also at `https://arxiv.org/pdf/<arxiv_id>.pdf`. Use `web_fetch` to check; download with `curl`/`wget` or this skill's `download_paper.py`.
- **Venue papers**: Some link to arXiv; if there's no arXiv ID, get the PDF URL from the page [PDF] link or the venue site, then use `web_fetch` or a download tool.

### 4. Kimi analysis

- **Preferred: scrape the on-page Kimi analysis.** Single-paper pages on papers.cool **already show Kimi analysis** (generated by the site). Use **`scripts/fetch_paper_dynamic.py`** with a Kimi selector (e.g. `--kimi-selector 'a.title-kimi'`): it then opens the page with **Playwright**, **clicks** the Kimi entry, waits for content, and extracts **`kimi_analysis`** from the next sibling or containers like `div[id*="kimi-content"]`. If you only need title/abstract, the script uses HTTP first and does not start a browser.

## Extraction and output

- From `web_fetch` Markdown/text: list pages use `## #N Title [PDF...]` as title; the long paragraph between "Authors:" and "Subjects:" is the abstract. Same for single-paper "## #1 Title".
- Prefer output to the user: **title, arXiv ID (if any), abstract, PDF link, and on-page Kimi analysis** (from `fetch_paper_dynamic.py`'s `kimi_analysis`).

## Notes

- papers.cool is a third-party site; respect its terms and robots; avoid high-frequency requests; throttle if needed.
- PDFs are copyrighted by publishers/authors; only provide links and summary-level understanding; do not store or redistribute PDF content.
- Kimi content is obtained by scraping the on-page analysis; no Kimi API key is required. For additional `web_search(provider kimi)` you need to configure the key.
- **RESEARCH PIPELINE INTEGRATION**: After every paper ingestion batch (≥3 papers), trigger `/graph-build` to update the corpus.

## Quick reference

| Goal | URL or action |
|------|----------------|
| Home / categories & Venue list | `https://papers.cool/` |
| arXiv category (e.g. ML) | `https://papers.cool/arxiv/cs.LG` |
| Single paper (abstract) | `https://papers.cool/arxiv/<arxiv_id>` |
| arXiv PDF | `https://arxiv.org/pdf/<arxiv_id>.pdf` |
| **HuggingFace Markdown** | `https://huggingface.co/papers/<arxiv_id>` → use `/hugging-face-paper-pages` |
| **Kimi analysis** | On-page; use `scripts/fetch_paper_dynamic.py` to get `kimi_analysis` |
| **Find papers by keyword** | Use `scripts/search_papers.py` (Python crawler); **do not use web_search** |
| **按会议查询论文** | Use `scripts/venue_papers.py <Venue.Year> --show N`，可选 `--group Poster` 等子分类；会议列表 `scripts/list_venues.py` |
| **Search and save title+abstract** | Use `scripts/search_and_save_papers.py`; abstracts from papers.cool/arxiv/<id> |
| **Download PDF (papers.cool link)** | Direct link `https://papers.cool/<uuid>`; with arXiv ID the script first gets PDF URL via HTTP (BeautifulSoup), else Playwright then arXiv fallback; use `scripts/download_paper.py`; **`-o` 可为文件或目录路径** |

**输出到指定位置**：各脚本的 `-o` 均可为**绝对/相对文件路径**或**目录**；为目录时在该目录下写入默认文件名（见下方「将输出保存到指定位置」）。

Example: user asks "find a few transformer papers and get Kimi's take". Run `python scripts/search_papers.py transformer -o search.json`, take arxiv_ids from the result, then for each run `python scripts/fetch_paper_dynamic.py <arxiv_id> -o out.json`; `out.json`'s `kimi_analysis` is the on-page Kimi analysis — no need for the current model or web_search to summarize.

---

## Python scripts (search/list: HTTP; fetch/download: HTTP first, Playwright when needed)
