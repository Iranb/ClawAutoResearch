# rss-papers 测试命令

在 skill 根目录 `customskills/rss-papers/` 下执行，或把 `scripts/` 换成绝对路径。

OPML 示例路径：`/Users/iranb/Downloads/Subscriptions-iCloud.opml`，请按本机路径修改。

---

## 0. 安装依赖

```bash
cd customskills/rss-papers
pip install -r scripts/requirements.txt
```

---

## 1. 列出订阅（无需网络）

```bash
# 扁平 JSON 输出到 stdout
python scripts/list_subscriptions.py /Users/iranb/Downloads/Subscriptions-iCloud.opml

# 按文件夹分组并保存
python scripts/list_subscriptions.py /Users/iranb/Downloads/Subscriptions-iCloud.opml --by-folder -o /tmp/subs.json

# 输出为 Markdown
python scripts/list_subscriptions.py /Users/iranb/Downloads/Subscriptions-iCloud.opml --by-folder --no-json -o /tmp/subs.md
```

---

## 2. 抓取 Feed（需要网络）

```bash
# 只抓 1 个分类、每 feed 最多 5 条（快速试跑）
python scripts/fetch_feeds.py /Users/iranb/Downloads/Subscriptions-iCloud.opml --folder "Conference" --max-per-feed 5 -o /tmp/feed_items.json

# 抓取全部订阅，每 feed 最多 10 条
python scripts/fetch_feeds.py /Users/iranb/Downloads/Subscriptions-iCloud.opml --max-per-feed 10 -o /tmp/feed_items.json

# 不读 OPML，直接指定两个 feed URL
python scripts/fetch_feeds.py --feeds "https://www.emergentmind.com/feeds/rss" "https://papers.cool/venue/CVPR/feed" --max-per-feed 5 -o /tmp/feed_items.json
```

---

## 3. 论文识别与分析（可用本地样本，无需网络）

```bash
# 用自带的样本 JSON 测试论文识别（不拉摘要）
python scripts/analyze_papers.py scripts/sample_feed_items.json --list-only

# 用样本输出到文件
python scripts/analyze_papers.py scripts/sample_feed_items.json --list-only -o /tmp/papers_list.json
```

若已有 `feed_items.json`（来自上面抓取）：

```bash
# 只识别论文链接
python scripts/analyze_papers.py /tmp/feed_items.json --list-only -o /tmp/papers_list.json

# 识别并拉取摘要（需要网络，会请求 papers.cool / arXiv）
python scripts/analyze_papers.py /tmp/feed_items.json --fetch-abstracts --max 10 -o /tmp/papers_analysis.json
```

---

## 4. 一键流水线（列出 → 抓取 → 分析）

```bash
# 抓取 Conference 分类并分析论文（每 feed 5 条）
python scripts/fetch_feeds.py /Users/iranb/Downloads/Subscriptions-iCloud.opml --folder "Conference" --max-per-feed 5 -o /tmp/feed_items.json
python scripts/analyze_papers.py /tmp/feed_items.json --list-only -o /tmp/papers_list.json
```

---

## 5. 查看结果

```bash
# 订阅列表
cat /tmp/subs.json | python -m json.tool | head -80

# 抓取条目数量
python -c "import json; d=json.load(open('/tmp/feed_items.json')); print('entries:', len(d.get('entries',[])))"

# 识别出的论文数量
python -c "import json; d=json.load(open('/tmp/papers_list.json')); print('papers:', d.get('total',0))"
```
