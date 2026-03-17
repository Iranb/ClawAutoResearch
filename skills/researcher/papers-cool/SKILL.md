---
name: papers-cool
description: Search and fetch paper abstracts and PDFs from papers.cool (arXiv + Venue index), then use Kimi or the current model to summarize or explain content. Use when the user asks to find papers by keyword, get paper summaries, download PDFs from arXiv/papers.cool, or have Kimi understand a paper.
homepage: https://papers.cool/
metadata:
  {"openclaw": {"emoji": "📄", "homepage": "https://papers.cool/", "requires": {"bins": ["python3"]}}}
---

# Papers.cool — Paper discovery, abstract fetching & Kimi analysis

[papers.cool](https://papers.cool/) is an on-site paper search engine built on **tantivy**, indexing **arXiv** and many **Venues** (AAAI, ACL, CVPR, ICLR, ICML, NeurIPS, etc.). It stays in sync with arXiv, usually with under 10 minutes delay. The site is by [kexue.fm](https://kexue.fm/) and powered by [Kimi](https://kimi.moonshot.cn/?ref=papers.cool).

## Data sources and URL rules

- **Home**: `https://papers.cool/` — use `web_fetch` to get arXiv categories and Venue links.
- **arXiv by category**: `https://papers.cool/arxiv/<category>`  
  Common: `cs.LG` (ML), `cs.AI`, `cs.CL`, `cs.CV`, `math.LO`, `stat.ML`. Full list on the home page.
- **Venue browse**: `https://papers.cool/venue/<Venue.Year>` 或 `https://papers.cool/venue/<Venue.Year>?group=<GroupName>&show=N`  
  e.g. `ICLR.2025`, `NeurIPS.2024`；按子分类（如 Poster、Oral）用 `?group=Poster`。**支持 `?show=N` 指定返回条数**（如 `?show=1000`），可直接 wget/HTTP 获取列表页。
- **Single paper page**: `https://papers.cool/arxiv/<arxiv_id>`  
  e.g. `https://papers.cool/arxiv/2502.00032`. Page includes title, authors, **full abstract**, Subjects, and PDF/Copy/Kimi/REL links.
- **On-site search**: Home page has a “Search” box (tantivy). **To find papers by keyword**, use this skill’s Python script `scripts/search_papers.py`: it requests the search URL directly (HTTP + HTML parse), no browser. **Do not use web_search**.

## Workflow: keyword → list → abstract → PDF → Kimi analysis

### 1. Find papers by keyword

- **Use the Python script**: run `python scripts/search_papers.py "<keyword>"` (or `--query "<keyword>"`). The script **requests the search URL** (`https://papers.cool/arxiv/search?highlight=1&query=...&sort=0|1`) with HTTP and parses the HTML (BeautifulSoup); the site is server-rendered, **no browser**. Use **`--sort 0`** for time order (default), **`--sort 1`** for reading star order. Output: title, abstract snippet, arxiv_id, links. Use `-o result.json` to save.
- **Save titles and abstracts**: Use `scripts/search_and_save_papers.py`. It (1) searches by keyword (HTTP), (2) for each result fetches full title and abstract from **https://papers.cool/arxiv/<arxiv_id>** (HTTP first, Playwright only if needed), (3) writes JSON or Markdown. Use `--debug /path/to/file` to save search-page debug when 0 results.
- **Optional**: For a known category or venue, use `list_papers_dynamic.py` (also HTTP + BeautifulSoup), e.g. `python scripts/list_papers_dynamic.py https://papers.cool/arxiv/cs.LG`. **按会议查询**：使用 `venue_papers.py`，传入会议 ID 与 `--show N`，可选 `--group <子分类>`（如 Poster、Oral）做分类查询，如 `python scripts/venue_papers.py CVPR.2025 --show 1000`、`python scripts/venue_papers.py CVPR.2025 --group Poster --show 50`；当前支持的会议列表可用 `list_venues.py` 从首页解析获得。
- **Do not** use `web_search` for “find papers by keyword”; use this skill’s Python scripts for on-site results.

### 2. Fetch abstracts

- **Python (recommended)**: Target URL is **https://papers.cool/arxiv/<arxiv_id>**. Use `fetch_paper_dynamic.py`’s `scrape_paper`: when **not** needing Kimi it first uses **HTTP + BeautifulSoup** to get title/abstract (no browser); only when you need **Kimi analysis** does it use Playwright to open the page and click the Kimi entry. Use `search_and_save_papers.py` to batch-fetch and save after a keyword search.
- With OpenClaw `web_fetch`: open the single-page URL; the long block under “## #1 …” is the **abstract**. You can also extract title, authors, Subjects.
- If you already have the abstract text, skip to the Kimi step.

### 3. Get PDF

- **papers.cool direct link**: The site offers direct download URLs like `https://papers.cool/<uuid>`. Use **`scripts/download_paper.py`**: pass the direct link to download immediately. For **arXiv ID or paper page URL**, the script first tries **HTTP + BeautifulSoup** to get the PDF link from `a.title-pdf`; if that fails it uses Playwright to open the page and parse [PDF], then downloads; fallback is `https://arxiv.org/pdf/<arxiv_id>.pdf`. Dependencies: `requests`, `beautifulsoup4`; `playwright` only for fallback when HTTP parse fails.
- **arXiv**: PDF is also at `https://arxiv.org/pdf/<arxiv_id>.pdf`. Use `web_fetch` to check; download with `curl`/`wget` or this skill’s `download_paper.py`.
- **Venue papers**: Some link to arXiv; if there’s no arXiv ID, get the PDF URL from the page [PDF] link or the venue site, then use `web_fetch` or a download tool.

### 4. Kimi analysis

- **Preferred: scrape the on-page Kimi analysis.** Single-paper pages on papers.cool **already show Kimi analysis** (generated by the site). Use **`scripts/fetch_paper_dynamic.py`** with a Kimi selector (e.g. `--kimi-selector 'a.title-kimi'`): it then opens the page with **Playwright**, **clicks** the Kimi entry, waits for content, and extracts **`kimi_analysis`** from the next sibling or containers like `div[id*="kimi-content"]`. If you only need title/abstract, the script uses HTTP first and does not start a browser.

## Extraction and output

- From `web_fetch` Markdown/text: list pages use `## #N Title [PDF...]` as title; the long paragraph between “Authors:” and “Subjects:” is the abstract. Same for single-page “## #1 Title”.
- Prefer output to the user: **title, arXiv ID (if any), abstract, PDF link, and on-page Kimi analysis** (from `fetch_paper_dynamic.py`’s `kimi_analysis`).

## Notes

- papers.cool is a third-party site; respect its terms and robots; avoid high-frequency requests; throttle if needed.
- PDFs are copyrighted by publishers/authors; only provide links and summary-level understanding; do not store or redistribute PDF content.
- Kimi content is obtained by scraping the on-page analysis; no Kimi API key is required. For additional `web_search(provider kimi)` you need to configure the key.

## Quick reference

| Goal | URL or action |
|------|----------------|
| Home / categories & Venue list | `https://papers.cool/` |
| arXiv category (e.g. ML) | `https://papers.cool/arxiv/cs.LG` |
| Single paper (abstract) | `https://papers.cool/arxiv/<arxiv_id>` |
| arXiv PDF | `https://arxiv.org/pdf/<arxiv_id>.pdf` |
| **Kimi analysis** | On-page; use `scripts/fetch_paper_dynamic.py` to get `kimi_analysis` |
| **Find papers by keyword** | Use `scripts/search_papers.py` (Python crawler); **do not use web_search** |
| **按会议查询论文** | Use `scripts/venue_papers.py <Venue.Year> --show N`，可选 `--group Poster` 等子分类；会议列表 `scripts/list_venues.py` |
| **Search and save title+abstract** | Use `scripts/search_and_save_papers.py`; abstracts from papers.cool/arxiv/<id> |
| **Download PDF (papers.cool link)** | Direct link `https://papers.cool/<uuid>`; with arXiv ID the script first gets PDF URL via HTTP (BeautifulSoup), else Playwright then arXiv fallback; use `scripts/download_paper.py`; **`-o` 可为文件或目录路径** |

**输出到指定位置**：各脚本的 `-o` 均可为**绝对/相对文件路径**或**目录**；为目录时在该目录下写入默认文件名（见下方「将输出保存到指定位置」）。

Example: user asks “find a few transformer papers and get Kimi’s take”. Run `python scripts/search_papers.py transformer -o search.json`, take arxiv_ids from the result, then for each run `python scripts/fetch_paper_dynamic.py <arxiv_id> -o out.json`; `out.json`’s `kimi_analysis` is the on-page Kimi analysis — no need for the current model or web_search to summarize.

---

## Python scripts (search/list: HTTP; fetch/download: HTTP first, Playwright when needed)

Search and list pages on papers.cool are **server-rendered**; the scripts use **HTTP requests + BeautifulSoup** for them (no browser). Single-paper title/abstract and PDF link are also fetched via HTTP first; **Playwright** is used only when (1) you need **on-page Kimi analysis**, or (2) HTTP parsing fails (e.g. download PDF link).

### Script location and dependencies

- Scripts live under `{baseDir}/scripts/` (the `scripts/` folder in this skill).
- Dependencies: `pip install -r scripts/requirements.txt` (installs `requests`, `beautifulsoup4`, `playwright`). For **search** and **list** and for most **fetch** (title/abstract) and **download** (PDF URL) flows, only `requests` and `beautifulsoup4` are used. Run `playwright install chromium` if you need Kimi analysis or when HTTP parsing fails and the script falls back to the browser.

### 将输出保存到指定位置

所有脚本的 **`-o / --output`** 均支持：

- **完整文件路径**：如 `-o /Users/me/Documents/papers/result.json`、`-o ~/papers/out.md`，会创建父目录并写入该文件。
- **目录路径**：若 `-o` 指向目录（无扩展名或路径为已存在目录），则在**该目录下**写入默认文件名：
  - `search_papers.py` → `search_results.json`
  - `search_and_save_papers.py` → `papers_saved.json` 或 `papers_saved.md`
  - `fetch_paper_dynamic.py` → `paper_<arxiv_id>.json` 或 `.txt`
  - `list_papers_dynamic.py` → `list_results.json`
  - `venue_papers.py` → `venue_results.json`
  - `list_venues.py` → `venues_list.json`
  - `download_paper.py` → `<arxiv_id>.pdf` 或根据直链生成文件名

示例（指定目录）：

```bash
python scripts/search_papers.py "transformer" -o /path/to/my_papers
# 写入 /path/to/my_papers/search_results.json

python scripts/search_and_save_papers.py "LLM" -o ~/Documents/papers
# 写入 ~/Documents/papers/papers_saved.json

python scripts/download_paper.py 2602.20400 -o ./downloads
# 写入 ./downloads/2602_20400.pdf
```

### 1. Single paper page (incl. Kimi): `fetch_paper_dynamic.py`

Fetches **title, abstract**, and optionally **on-page Kimi analysis**. When you **do not** pass `--kimi-selector`, the script uses **HTTP + BeautifulSoup** only (no browser). When you need Kimi, pass `--kimi-selector`; then it uses Playwright to open the page, **click** the Kimi entry (e.g. `a#kimi-<arxiv_id>` or `a.title-kimi`), wait, and get `kimi_analysis` from the next sibling or `div[id*="kimi-content"]`.

```bash
# By arXiv ID or full URL
python scripts/fetch_paper_dynamic.py 2502.00032
python scripts/fetch_paper_dynamic.py https://papers.cool/arxiv/2502.00032

# Increase wait (seconds) if dynamic content is slow
python scripts/fetch_paper_dynamic.py 2502.00032 --wait 8

# JSON or file output
python scripts/fetch_paper_dynamic.py 2502.00032 --json
python scripts/fetch_paper_dynamic.py 2502.00032 -o result.json
python scripts/fetch_paper_dynamic.py 2502.00032 -o result.txt

# Custom selector for Kimi trigger (if needed)
python scripts/fetch_paper_dynamic.py 2502.00032 --kimi-selector "button:has-text('Kimi')"

# Show browser window for debugging
python scripts/fetch_paper_dynamic.py 2502.00032 --no-headless
```

Output fields: `title`, `abstract`, **`kimi_analysis`** (only when using Playwright/Kimi path; empty when using HTTP-only), `full_main` (when using Playwright), `error`. If `kimi_analysis` is empty, use `--kimi-selector` and optionally increase `--wait`.

### 2. Category/Venue list: `list_papers_dynamic.py`

Fetches **list pages** (e.g. an arXiv category or venue) via **HTTP + BeautifulSoup** (server-rendered; no browser). Parses `div.papers` > `div.paper`; extracts title, abstract snippet, arxiv_id, links.

```bash
python scripts/list_papers_dynamic.py https://papers.cool/arxiv/cs.LG
python scripts/list_papers_dynamic.py "https://papers.cool/venue/ICLR.2025" --max 20
python scripts/list_papers_dynamic.py https://papers.cool/arxiv/cs.LG -o list.json --json
```

### 2b. 按会议查询: `venue_papers.py`

按 **会议 ID（Venue）** 查询论文，可选 **子分类（group）**：请求 `https://papers.cool/venue/<Venue.Year>?show=N` 或 `?group=<Group>&show=N`（HTTP + BeautifulSoup），与 wget 行为一致。会议 ID 与首页 Venue 链接一致，如 `CVPR.2025`、`NeurIPS.2024`。子分类名与站点一致，如 `Poster`、`Oral`（见会议页内 Subject 链接）。支持的会议列表可用 `list_venues.py` 从首页解析。

```bash
python scripts/venue_papers.py CVPR.2025 --show 100
python scripts/venue_papers.py CVPR.2025 --group Poster --show 50
python scripts/venue_papers.py NeurIPS.2024 --show 1000 -o ./out
python scripts/venue_papers.py -v ICLR.2025 -g Oral --show 500 --json
```

### 2c. 列出支持的会议: `list_venues.py`

从 **papers.cool 首页** 解析当前支持的会议（Venue）ID 列表（HTTP + BeautifulSoup），便于确认可用的会议名与年份。

```bash
python scripts/list_venues.py
python scripts/list_venues.py --json -o venues_list.json
```

### 3. Keyword search: `search_papers.py`

Searches papers.cool **on-site** by keyword: **HTTP request** to `https://papers.cool/arxiv/search?highlight=1&query=<query>&sort=<sort>`, then **BeautifulSoup** parse (server-rendered; no browser). **`--sort 0`** = by time (default), **`--sort 1`** = by reading star. **Use this script for keyword search; do not use web_search.**

```bash
python scripts/search_papers.py "transformer"
python scripts/search_papers.py "reinforcement learning" --max 10 -o search.json
python scripts/search_papers.py "transformer" --sort 1
python scripts/search_papers.py --query "large language model" --wait 5 --json
```

### 4. Search and save titles & abstracts: `search_and_save_papers.py`

After on-site keyword search (HTTP), **fetches title and abstract per paper** from https://papers.cool/arxiv/<arxiv_id> (HTTP path when possible) and **saves to file**. Use **`--sort 0`** (time) or **`--sort 1`** (reading star) for search order. Use `--debug /path/to/file` to save search-page content when 0 results (for debugging).

```bash
# Default output papers_saved.json (each entry: title, abstract, arxiv_id, url)
python scripts/search_and_save_papers.py "unsupervised elicitation" -o papers_saved.json

# Markdown output (.md or --format md)
python scripts/search_and_save_papers.py "transformer" -o papers.md --max 10

# When 0 results, save search page for debugging
python scripts/search_and_save_papers.py "transformer" -o ./out --debug ./out/debug_search.html

# Adjust wait
python scripts/search_and_save_papers.py "reinforcement learning" -o out.json --wait-paper 3

# Sort by reading star
python scripts/search_and_save_papers.py "transformer" -o out.json --sort 1
```

Output formats:
- **JSON**: `{"keyword": "...", "papers": [{"arxiv_id", "url", "title", "abstract"}, ...], "errors": [...]}`.
- **Markdown**: each paper as `## Title`, arXiv, URL, **abstract** paragraph.

### 5. PDF download: `download_paper.py`

**Direct papers.cool URL** → download with `requests`. **arXiv ID or paper URL** → script first gets PDF URL via **HTTP + BeautifulSoup** (`a.title-pdf`); if that fails, uses **Playwright** to open the page and parse [PDF], then download; fallback `https://arxiv.org/pdf/<arxiv_id>.pdf`. Depends: `requests`, `beautifulsoup4`; `playwright` only for fallback.

```bash
# Direct papers.cool link
python scripts/download_paper.py "https://papers.cool/2ae6f548-411c-48da-b9a5-f40ab4437632" -o paper.pdf

# By arXiv ID: parse [PDF] from paper page then download
python scripts/download_paper.py 2602.20400 -o out.pdf
python scripts/download_paper.py https://papers.cool/arxiv/2602.20400 -o ./downloads/
```

### When to use which script

- **Find papers by keyword**: use `search_papers.py`; do not use `web_search`.
- **Search and save titles/abstracts**: use `search_and_save_papers.py`; abstracts come from https://papers.cool/arxiv/<id>.
- **Download PDF** (direct link or from arXiv ID): use `download_paper.py`.
- **Kimi analysis**: use `fetch_paper_dynamic.py` to get `kimi_analysis` from the on-page content; same script for full JS-rendered body.
- **Abstract + PDF link only** and no dynamic content: `web_fetch` is enough; no script required.
- **List pages**: use `list_papers_dynamic.py` (HTTP + BeautifulSoup; same as search). For static copy, `web_fetch` may suffice.
- **按会议查询**: use `venue_papers.py <Venue.Year> --show N`，可选 `--group <子分类>`（如 Poster、Oral）；会议列表 use `list_venues.py`.

### Testing

- **Copy-paste commands**: see `scripts/TEST_COMMANDS.md` for ready-to-run examples (search, list, fetch, download, search-and-save, one-liner).
- **Single entry**: `scripts/test_papers_cool.py`.
  - Default: unit tests (URL parsing, direct-link detection; no network/browser).
  - `--integration`: unit + integration (needs Playwright + network).
  - `--manual [--list] [--search keyword]`: run single fetch, optional list/search.
  - `--search-and-save [keyword] [--max N]`: run keyword → fetch abstracts → save.
  ```bash
  cd customskills/papers-cool && python scripts/test_papers_cool.py -v
  python scripts/test_papers_cool.py --integration
  python scripts/test_papers_cool.py --manual --list
  python scripts/test_papers_cool.py --search-and-save "transformer" --max 3
  ```

### Paths and environment

- Run from the **skill root** (`papers-cool/`) when using relative paths, e.g. `python scripts/fetch_paper_dynamic.py 2502.00032`, or use **absolute paths** for `-o` to save to any location (e.g. `-o /Users/me/Documents/papers/result.json` or `-o ~/papers/`).
- If OpenClaw or the agent runs in a sandbox/container, install Python, pip, and Playwright Chromium there, or run the scripts on the host and pass the result (JSON/text) to the agent.
