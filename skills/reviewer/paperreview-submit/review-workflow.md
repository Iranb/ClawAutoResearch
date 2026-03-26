# 完整审稿工作流与结果解析

## 全流程一览

```
1. paper add      → 注册 PDF，创建 job（PENDING_APPROVAL 或 QUEUED）
2. approve        → 若需要手动审批
3. daemon run     → 后台自动提交 + 轮询
4. check          → 强制立即查询
5. status         → 查看 job 状态
6. 读取结果       → review.md / review.json
7. 项目内写回     → external_review_{date}.md
8. openclaw 集成  → 传给 reviewer agent 起草 rebuttal
```

---

## 详细步骤

### 1. 注册论文

```bash
# 基础注册
reviewloop paper add \
  --paper-id main \
  --path paper/main.pdf \
  --backend stanford

# 直接提交，不弹确认
reviewloop paper add \
  --paper-id main \
  --path paper/main.pdf \
  --backend stanford \
  --submit-now \
  --no-submit-prompt

# 注册 camera-ready 版本
reviewloop paper add \
  --paper-id camera_ready \
  --path build/camera_ready.pdf \
  --backend stanford \
  --tag-trigger "custom-review/camera_ready/*"
```

### 2. 手动审批（若状态为 PENDING_APPROVAL）

```bash
# 查看 job-id
reviewloop status --paper-id main --json

# 审批
reviewloop approve --job-id <job-id>
```

### 3. 启动守护进程

```bash
# 安装为系统服务并立即启动
reviewloop daemon install --start true

# 仅前台运行（调试用）
reviewloop daemon run --panel false

# 查看状态
reviewloop daemon status
```

守护进程每 **30 秒**执行一次 tick：扫描触发器 → 处理提交队列 → 轮询处理中的 job。

### 4. 主动检查状态

```bash
# 检查特定论文的最新 job
reviewloop check --paper-id main

# 检查特定 job-id
reviewloop check --job-id <job-id>

# 检查所有处理中的 job
reviewloop check --all-processing
```

### 5. 查看当前状态

```bash
# 文字输出
reviewloop status --paper-id main

# JSON 输出（便于脚本处理）
reviewloop status --paper-id main --json

# 带 token 显示
reviewloop status --paper-id main --show-token
```

---

## 结果文件解析

审稿完成后，结果存放于 `~/.review_loop/artifacts/<job-id>/`：

### review.md — 主要审稿报告（可直接阅读）

典型结构：
```markdown
# Paper Review

## Summary
[论文整体概述]

## Strengths
- 优点1
- 优点2

## Weaknesses
- 缺点1
- 缺点2

## Questions
[审稿人提出的问题]

## Rating
Score: X/10
Confidence: X/5

## Detailed Comments
[详细逐点评论]
```

### review.json — 结构化数据

```json
{
  "summary": "...",
  "strengths": ["...", "..."],
  "weaknesses": ["...", "..."],
  "questions": ["...", "..."],
  "rating": 6,
  "confidence": 3,
  "recommendation": "accept/reject/borderline"
}
```

### meta.json — 提交元信息

```json
{
  "job_id": "...",
  "paper_id": "main",
  "backend": "stanford",
  "pdf_hash": "sha256:...",
  "submitted_at": "...",
  "completed_at": "...",
  "venue": "ICLR"
}
```

---

## 获取最新审稿结果（脚本）

```bash
#!/bin/bash
# 获取最新完成的审稿报告

LATEST_JOB=$(reviewloop status --paper-id main --json 2>/dev/null | \
  python3 -c "
import sys, json
jobs = json.load(sys.stdin)
completed = [j for j in jobs if j.get('status') == 'COMPLETED']
if completed:
    print(sorted(completed, key=lambda x: x.get('completed_at',''))[-1]['job_id'])
")

if [ -n "$LATEST_JOB" ]; then
  REVIEW_PATH="$HOME/.review_loop/artifacts/$LATEST_JOB/review.md"
  echo "审稿报告路径: $REVIEW_PATH"
  cat "$REVIEW_PATH"
else
  echo "暂无已完成的审稿结果，当前状态："
  reviewloop status --paper-id main
fi
```

---

## 失败处理

```bash
# 查看失败原因
reviewloop status --paper-id main --json

# 重试（遵循速率限制）
reviewloop retry --job-id <job-id>

# 强制重试（忽略速率限制，谨慎使用）
reviewloop retry --job-id <job-id> --override-rate-limit

# 手动导入已收到的 token（若邮件自动获取失败）
reviewloop import-token --paper-id main --token <token-from-email> --source email
```

---

## 与 OpenClaw Reviewer Agent 集成

在 openclaw 工作流中，审稿完成后自动触发 reviewer agent 分析：

### 方案一：writer agent 调用 check 后传递结果

```markdown
# academic_writer agent 的任务提示示例
提交完论文后：
1. 运行 `reviewloop check --paper-id main` 等待结果
2. 读取 `~/.review_loop/artifacts/<job-id>/review.md`
3. 将审稿意见交给 reviewer agent 进行分析
```

### 方案二：researcher agent 编排完整流程

```markdown
# researcher agent 编排逻辑
1. 调用 academic_writer 完成论文撰写
2. 使用 paperreview-submit skill 提交 PDF
3. 轮询等待 reviewloop status = COMPLETED
4. 将 review.md/review.json/meta.json 规范化写回 `{PROJ}/reviewer/external_review_{date}.md`
5. 调用 `/review-response` 生成 `{PROJ}/reviewer/rebuttal_{date}.md`
6. reviewer agent 输出修改意见，返回给 academic_writer
7. academic_writer 根据意见修改论文，重复循环
```

### 方案三：在 openclaw 研究实验注册中记录审稿状态

```json
// EXPERIMENT_REGISTRY.md 条目示例
{
  "experiment_id": "paper-submission-v1",
  "paper_id": "main",
  "review_job_id": "<job-id>",
  "review_status": "COMPLETED",
  "review_score": 6,
  "review_path": "~/.review_loop/artifacts/<job-id>/review.md",
  "action": "revise-and-resubmit"
}
```

---

## 触发器模式（高级用法）

### Git Tag 触发

```bash
# 推送 git tag 自动触发提交
git tag review-stanford/main/v1
git push origin review-stanford/main/v1
```

支持的 tag 格式：
- `review-<backend>/<paper-id>/<任意>`
- 自定义：通过 `--tag-trigger "<pattern>"` 指定

### PDF 变更触发

```toml
# reviewloop.toml
[trigger.pdf]
auto_submit_on_change = true   # PDF 文件变更时自动排队
```

---

## 清理与维护

```bash
# 移除论文（保留历史记录）
reviewloop paper remove --paper-id old-paper

# 移除论文并清除所有历史
reviewloop paper remove --paper-id old-paper --purge-history

# 停止并卸载 daemon
reviewloop daemon uninstall
```
