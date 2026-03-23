---
name: paperreview-submit
description: 使用 reviewloop 工具将学术论文 PDF 提交到 paperreview.ai（Stanford Agentic Reviewer）获取 AI 审稿意见。适用于 openclaw 研究流程的投稿前审稿阶段。当用户需要提交论文、获取 AI 评审、查看审稿结果、运行 reviewloop、提交 PDF 到 paperreview.ai、获取 Stanford 审稿意见时使用。
allowed-tools:
  - Bash(*)
  - Read
  - research_workflow
---

# 论文提交与 AI 审稿技能 (paperreview-submit)

基于 [reviewloop](https://lib.rs/crates/reviewloop) 工具，将论文 PDF 提交至 [paperreview.ai](https://paperreview.ai)，自动轮询并获取审稿意见。

## 快速工作流

```
[ 安装 reviewloop ] → [ init 初始化 ] → [ paper add 注册 ] → [ daemon 运行 ] → [ 等待/check ] → [ 读取结果 ]
```

详细安装与配置见 [setup.md](setup.md)，完整监控与结果解析见 [review-workflow.md](review-workflow.md)。

---

## Step 1：安装 reviewloop

```bash
# macOS (Homebrew，推荐)
brew tap acture/ac && brew install reviewloop

# 或使用 Cargo
cargo install reviewloop
```

验证安装：`reviewloop --help`

---

## Step 2：初始化

```bash
# 初始化全局配置（仅需一次）
reviewloop init

# 在论文项目目录下初始化项目配置
cd /path/to/paper-project
reviewloop init project --project-id my-paper
```

---

## Step 3：注册并提交论文

```bash
# 注册论文（会提示是否立即提交）
reviewloop paper add \
  --paper-id main \
  --path paper/main.pdf \
  --backend stanford

# 若需要针对特定会议
reviewloop paper add \
  --paper-id main \
  --path paper/main.pdf \
  --backend stanford \
  --submit-now
```

> **关键参数**：`--paper-id` 唯一标识本次提交；`--path` 指向 PDF 文件；`--backend stanford` 对应 paperreview.ai

---

## Step 4：运行后台守护进程

```bash
# 安装并启动 daemon（30秒轮询一次）
reviewloop daemon install --start true

# 查看 daemon 状态
reviewloop daemon status
```

---

## Step 5：查看状态与获取结果

```bash
# 查看所有任务状态
reviewloop status --paper-id main

# 立即强制检查（不等下次轮询）
reviewloop check --paper-id main

# 审稿完成后，结果存放在：
# ~/.review_loop/artifacts/<job-id>/review.md   ← 可读审稿意见
# ~/.review_loop/artifacts/<job-id>/review.json ← 结构化数据
# ~/.review_loop/artifacts/<job-id>/meta.json   ← 提交元信息
```

读取审稿报告：
```bash
cat ~/.review_loop/artifacts/$(reviewloop status --paper-id main --json | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['job_id'])")/review.md
```

---

## 典型状态转移

| 状态 | 含义 | 下一步 |
|------|------|--------|
| `PENDING_APPROVAL` | 等待手动审批 | `reviewloop approve --job-id <id>` |
| `QUEUED` | 已排队，等待提交 | 自动处理 |
| `PROCESSING` | 正在生成审稿意见 | 等待（约 10-60 分钟） |
| `COMPLETED` | 审稿完成 | 读取 `review.md` |
| `FAILED` | 失败 | `reviewloop retry --job-id <id>` |

---

## 与 OpenClaw 集成

### 集成到 `reviewer` 或 `writer` Agent

在 `openclaw.json` 中，将本 skill 目录加入对应 agent 的 skills 路径：

```jsonc
// openclaw.json - academic_writer 或 researcher agent
{
  "id": "academic_writer",
  "skills": [
    "~/.openclaw/skills",
    "./skills/academic_writer",
    "/Users/iranb/Library/Mobile Documents/com~apple~CloudDocs/OpenClawThings/customskills/paperreview-submit"
  ]
}
```

或创建符号链接，将本 skill 纳入全局 openclaw skills：

```bash
ln -s "/Users/iranb/Library/Mobile Documents/com~apple~CloudDocs/OpenClawThings/customskills/paperreview-submit" \
      ~/.openclaw/skills/paperreview-submit
```

### 在 OpenClaw 研究流程中的位置

```
researcher → academic_writer (撰写论文)
           ↓
   citation-integrity-gate
           ↓
     paperreview-submit skill
           ↓
     提交 PDF → 获取审稿意见
           ↓
     reviewer agent (分析审稿意见，迭代改进)
```

## 提交前硬约束

先读取：

```json
{"action":"get_citation_integrity"}
```

若 `verification_status != verified`，或仍存在未解决引用占位符、hallucinated citations，则不要提交到外部审稿系统，先运行 reviewer `/citation-integrity-gate`。

### 审稿结果反馈给 reviewer agent

审稿完成后，将 `review.md` 内容传递给 openclaw reviewer agent：

```bash
# 获取审稿结果路径
REVIEW_MD=$(ls ~/.review_loop/artifacts/*/review.md | tail -1)

# 在 openclaw 中，让 reviewer agent 读取并分析
# agent: reviewer
# 任务: 读取 $REVIEW_MD，分析审稿意见，提出修改建议
```

---

## 邮箱 Token 配置（可选，加速结果获取）

```toml
# ~/.config/reviewloop/config.toml
[imap]
server = "imap.gmail.com"
port = 993
username = "your@gmail.com"
header_first = true
max_lookback_hours = 72

[imap.backend_patterns]
stanford = "https?://paperreview\\.ai/review\\?token=([A-Za-z0-9_-]+)"
```

或使用 Gmail OAuth：`reviewloop email login --provider google`

详见 [setup.md](setup.md)。

---

## 注意事项

- paperreview.ai 免费，每次最多分析前 15 页
- 审稿通常在提交后 10-60 分钟内完成
- 请遵守 reviewloop 的负责任使用原则，不要高频率重复提交
- `--backend stanford` 对应 ICLR 会议，可在 `reviewloop.toml` 中修改 `venue`
