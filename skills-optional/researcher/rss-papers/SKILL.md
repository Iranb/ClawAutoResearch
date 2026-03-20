---
name: rss-papers
description: 基于 OPML 文件持久化 RSS 订阅，抓取订阅源中的论文条目并进行分析。在用户提供 OPML 路径（如 Subscriptions-iCloud.opml）、要同步/分析订阅、或要按分类查看/抓取论文时使用。
homepage: https://agentskills.io
metadata:
  {"openclaw": {"emoji": "📡", "requires": {"bins": ["python3"]}}}
---

# RSS 论文订阅 — OPML 持久化与论文分析

基于 **OPML**（如 NetNewsWire 导出的 `Subscriptions-iCloud.opml`）持久化 RSS 订阅，抓取各 feed 的最新条目，识别论文类链接（arXiv、papers.cool、会议/期刊等）并支持摘要与简单分析。

## 数据源与持久化

- **订阅源**：由用户提供的 OPML 文件路径指定，例如 `/Users/iranb/Downloads/Subscriptions-iCloud.opml`。OPML 内为树形结构：`<outline>` 可带子节点；叶子节点若含 `xmlUrl` 则为 RSS/Atom feed。
- **持久化**：订阅列表即 OPML 文件本身；**不修改**用户 OPML，只读。若需“已读/未读”或“已抓取条目 ID”等状态，脚本将状态写入 **skill 目录下的 `data/`**（如 `data/seen_ids.json`），与 OPML 路径解耦。
- **Feed 属性**：从 OPML 解析 `text`/`title`、`xmlUrl`（必填）、`htmlUrl`、`description`；父级 `outline` 的 `text` 视为**分类/文件夹**名。

## 工作流概览

1. **列出订阅**：用 `list_subscriptions.py` 从 OPML 解析所有 feed 及分类，输出 JSON/Markdown。
2. **抓取条目**：用 `fetch_feeds.py` 按 OPML 或指定 feed URL 列表抓取 RSS/Atom，输出条目（标题、链接、摘要、日期）。
3. **论文分析与摘要**：用 `analyze_papers.py` 对抓取结果中的论文链接（arXiv、papers.cool 等）做结构化提取与可选摘要（可结合 papers-cool skill 的脚本或当前模型总结）。

## 脚本位置与依赖

- 脚本位于本 skill 的 `scripts/` 目录。
- 依赖：`pip install -r scripts/requirements.txt`（`requests`、`beautifulsoup4`）。RSS/Atom 抓取使用**标准库**（urllib + xml.etree），无需 feedparser。

## 1. 列出订阅：`list_subscriptions.py`

从 OPML 文件解析所有 feed，扁平或按文件夹分组输出。

```bash
# 默认输出到 stdout（JSON）
python scripts/list_subscriptions.py /Users/iranb/Downloads/Subscriptions-iCloud.opml

# 按文件夹分组
python scripts/list_subscriptions.py /path/to/file.opml --by-folder

# 输出到文件
python scripts/list_subscriptions.py /path/to/file.opml -o subscriptions.json
python scripts/list_subscriptions.py /path/to/file.opml --by-folder -o subscriptions.md
```

输出字段：`title`、`xml_url`、`html_url`、`folder`（可选）、`description`。

## 2. 抓取 Feed 条目：`fetch_feeds.py`

根据 OPML 或显式传入的 feed URL 列表抓取 RSS/Atom，返回条目列表。

```bash
# 从 OPML 抓取所有 feed（可限制条数）
python scripts/fetch_feeds.py /path/to/file.opml --max-per-feed 20

# 只抓取指定分类下的 feed（与 OPML 中 outline text 匹配）
python scripts/fetch_feeds.py /path/to/file.opml --folder "Conference" --max-per-feed 15

# 指定若干 feed URL（不读 OPML）
python scripts/fetch_feeds.py --feeds "https://papers.cool/venue/CVPR/feed" "https://www.emergentmind.com/feeds/rss" --max-per-feed 10

# 输出到文件
python scripts/fetch_feeds.py /path/to/file.opml -o feed_items.json --max-per-feed 20
```

输出每条：`title`、`link`、`published`、`summary`、`feed_title`、`feed_url`。`-o` 可为文件或目录；为目录时写入默认文件名 `feed_items.json`。

## 3. 论文分析与摘要：`analyze_papers.py`

读取 `fetch_feeds.py` 的输出（或直接指定 JSON 文件），识别论文类链接（arXiv、papers.cool、常见会议/期刊域名），可选拉取摘要并做简单分析。

```bash
# 先抓取再分析（管道或分步）
python scripts/fetch_feeds.py /path/to/file.opml --max-per-feed 15 -o items.json
python scripts/analyze_papers.py items.json -o papers_analysis.json

# 只识别论文链接并输出列表（不请求摘要）
python scripts/analyze_papers.py items.json --list-only -o papers_list.json

# 对论文链接请求 papers.cool 摘要（需 papers-cool 脚本可用时）
python scripts/analyze_papers.py items.json --fetch-abstracts --max 50 -o papers_analysis.json
```

输出：论文条目列表，含 `title`、`link`、`source_feed`、`arxiv_id`（若可解析）、`abstract`（若 `--fetch-abstracts` 且可用）。

## 持久化状态（可选）

- **已抓取条目 ID**：`fetch_feeds.py` 可使用 `--state-dir scripts/data` 记录已见条目（如 link 的 hash），下次 `--since yesterday` 时只输出新条目（若实现该参数）。状态文件存于 skill 的 `data/`，不写回 OPML。
- **OPML 只读**：所有脚本仅读取用户给定的 OPML 路径，不覆盖、不重写该文件。

## 与 papers-cool 的配合

- 若需从 papers.cool 拉取**全文摘要或 Kimi 分析**，在分析阶段可调用 papers-cool 的 `scripts/fetch_paper_dynamic.py` 等（传入 arxiv_id 或 URL），本 skill 只负责 RSS 聚合与论文链接识别。
- 本 skill 的 `analyze_papers.py` 在 `--fetch-abstracts` 时，可调用 papers-cool 的 `scrape_paper` 或脚本，具体见脚本内说明。

## 快速参考

| 目标           | 命令 |
|----------------|------|
| 列出 OPML 中所有订阅 | `python scripts/list_subscriptions.py <opml_path>` |
| 按文件夹列出     | `python scripts/list_subscriptions.py <opml_path> --by-folder` |
| 抓取所有 feed 最新条目 | `python scripts/fetch_feeds.py <opml_path> --max-per-feed N` |
| 只抓取某分类     | `python scripts/fetch_feeds.py <opml_path> --folder "Conference"` |
| 分析条目中的论文   | `python scripts/analyze_papers.py feed_items.json -o papers_analysis.json` |

## 路径与环境

- 从 **skill 根目录**（`rss-papers/`）运行脚本时可用相对路径；`-o` 支持绝对路径（如 `-o /Users/me/Documents/papers_analysis.json`）。
- OPML 路径需为**绝对路径**或相对于当前工作目录的路径；如 `~/Downloads/Subscriptions-iCloud.opml` 需 shell 展开为绝对路径后再传入。
