---
name: crawl4ai-search
description: 使用 Crawl4AI 对指定 URL 进行联网抓取，并将结果（Markdown、元数据）保存到本地指定路径。适用于需要把网页内容转为可读 Markdown 并落盘、RAG 或离线分析的场景。当用户要求“联网搜索并保存”“爬取网页保存到某路径”或使用 crawl4ai 抓取并保存时使用本 skill。
homepage: https://github.com/unclecode/crawl4ai
metadata:
  {"openclaw": {"emoji": "🕷️", "homepage": "https://github.com/unclecode/crawl4ai", "requires": {"bins": ["python3"]}}}
---

# Crawl4AI 联网抓取并保存到本地

[Crawl4AI](https://github.com/unclecode/crawl4ai) 是开源的、面向 LLM 的网页爬虫，可将页面转为干净的 Markdown，支持动态页面、截图、结构化抽取等。本 skill 通过脚本对给定 URL 执行抓取，并将结果保存到用户指定的本地路径。

## 前置条件

- 系统已安装 **crawl4ai**：`pip install -U crawl4ai`，并执行 `crawl4ai-setup`（若遇浏览器问题可执行 `python -m playwright install --with-deps chromium`）。
- 脚本依赖见 `scripts/requirements.txt`，在 skill 的虚拟环境中可执行：`pip install -r scripts/requirements.txt`。

## 工作流程

1. **单页抓取**：对单个 URL 调用 Crawl4AI 的 `AsyncWebCrawler`，获取 `CrawlResult`（含 `markdown`、`url`、`success`、`metadata` 等）。
2. **保存到指定路径**：将 Markdown 文本写入 `.md` 文件，可选将元数据（url、success、status_code、error_message 等）写入同名的 `.json`。
3. **多 URL**：支持一次传入多个 URL，按 URL 分别生成文件并保存到同一输出目录。

## 输出到指定位置

- **`-o` / `--output`** 可为：
  - **文件路径**：如 `-o /path/to/result.md`，则 Markdown 写入该文件；若同时 `--meta`，元数据写入同路径的 `.json`（如 `result.json`）。
  - **目录路径**：若为目录（如 `-o /path/to/output_dir`），则在目录下为每个 URL 生成文件：`<slug>.md` 与可选的 `<slug>_meta.json`，其中 `slug` 由 URL 生成（域名+路径的合法文件名形式）。
- 若未指定 `-o`，默认写入当前目录下的 `crawl_result.md`（单 URL）或 `crawl_result_<slug>.md`（多 URL）。

## 使用脚本

主脚本：**`scripts/crawl_and_save.py`**

```bash
# 单 URL，输出到指定文件
python scripts/crawl_and_save.py "https://example.com" -o /path/to/result.md

# 单 URL，输出到目录（生成 <slug>.md）
python scripts/crawl_and_save.py "https://example.com" -o /path/to/output_dir

# 同时保存元数据 JSON
python scripts/crawl_and_save.py "https://example.com" -o /path/to/result.md --meta

# 多 URL，保存到同一目录
python scripts/crawl_and_save.py "https://a.com/page1" "https://b.com/page2" -o /path/to/dir --meta

# 无头模式（默认），调试时可显示浏览器
python scripts/crawl_and_save.py "https://example.com" -o out.md --no-headless
```

### 示例：抓取 Analemma 博客（Introducing FARS）

以 [Analemma 的 Introducing FARS 文章](https://analemma.ai/blog/introducing-fars/) 为例：

```bash
# 保存到当前目录下的 output_example/，并写入元数据
python scripts/crawl_and_save.py "https://analemma.ai/blog/introducing-fars/" -o ./output_example --meta
```

运行成功后，`output_example/` 下会生成：
- `analemma_ai_blog_introducing-fars.md` — 页面正文的 Markdown
- `analemma_ai_blog_introducing-fars_meta.json` — 元数据（url、success、status_code 等）

若指定为单个文件：
```bash
python scripts/crawl_and_save.py "https://analemma.ai/blog/introducing-fars/" -o ./analemma_fars.md --meta
```

### 参数说明

| 参数 | 说明 |
|------|------|
| `url` | 一个或多个要抓取的 URL（位置参数） |
| `-o` / `--output` | 输出路径：文件或目录；默认当前目录 |
| `--meta` | 同时写入元数据 JSON（url、success、status_code、error_message 等） |
| `--headless` / `--no-headless` | 是否无头模式（默认 headless） |
| `--format` | 使用 `raw`（默认）、`fit` 或 `citations` 的 Markdown 变体 |

## 输出内容说明

- **Markdown 文件**：来自 Crawl4AI 的 `CrawlResult.markdown`。若为 `MarkdownGenerationResult`，则默认使用 `raw_markdown`；`--format fit` 使用 `fit_markdown`，`--format citations` 使用 `markdown_with_citations`。
- **元数据 JSON**（`--meta`）：包含 `url`、`success`、`status_code`、`error_message`、`final_url` 等，便于排查与索引。

## 何时使用

- 用户要求“联网搜索并保存到某路径”“爬取这个网页保存下来”“把页面内容保存成 Markdown”。
- 需要将网页内容转为 LLM 友好格式并落盘，用于 RAG、笔记或离线分析。
- 已安装 crawl4ai，希望通过统一脚本和输出路径规范保存结果。

## 参考

- [Crawl4AI GitHub](https://github.com/unclecode/crawl4ai)
- [Crawl4AI 文档](https://docs.crawl4ai.com/)（CrawlResult、Markdown 生成等）
